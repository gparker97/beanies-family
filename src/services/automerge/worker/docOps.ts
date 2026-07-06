/**
 * ADR-032 — the pure, worker-side Automerge operations. Shared by the worker
 * message loop AND the inline fallback (one implementation, two contexts), so
 * the two paths can't diverge.
 *
 * This module is deliberately PURE + vue-free + main-thread-free: it takes a doc
 * in and returns a new doc + the projection delta describing what changed. State
 * (currentDoc / familyKey / cache), the persist debounce, and the `dirty` signal
 * live in `applyAndProject` / `docWorker`. The mutation ops are the declarative
 * replacement for the `changeDoc(fn)` closures that can't cross `postMessage`.
 */
import * as Automerge from '@automerge/automerge';
import { COLLECTION_NAMES, type FamilyDocument, type CollectionName } from '@/types/automerge';
import { encryptPayload, decryptPayload } from '@/services/crypto/familyKeyService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { CorruptPayloadError } from '@/types/sync';
import {
  calculateAmortization,
  calculateExtraPayment,
  findLoanDetails,
  type LoanDetails,
} from '@/utils/loanPayment';
import type { Asset, Account, Goal } from '@/types/models';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import type { MutationOp, ProjectionDelta, Heads } from './protocol';

type Doc = Automerge.Doc<FamilyDocument>;
type AnyRecord = Record<string, unknown>;

/** JSON round-trip an Automerge value to a plain, structured-clone-safe object. */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── Doc lifecycle ───────────────────────────────────────────────────────────

/** Initialize any collections missing from an older document. */
export function migrateDoc(doc: Doc): Doc {
  const missing = COLLECTION_NAMES.filter((name) => doc[name] === undefined || doc[name] === null);
  if (missing.length === 0) return doc;
  return Automerge.change(doc, 'migrate: add missing collections', (d) => {
    for (const name of missing) (d as unknown as AnyRecord)[name] = {};
  });
}

export function loadDoc(binary: Uint8Array): Doc {
  return migrateDoc(Automerge.load<FamilyDocument>(binary));
}

export function saveDoc(doc: Doc): Uint8Array {
  return Automerge.save(doc);
}

export function getHeads(doc: Doc): Heads {
  return Automerge.getHeads(doc);
}

export function getChangesSince(doc: Doc, heads: Heads): Uint8Array[] {
  return Automerge.getChanges(Automerge.view(doc, heads), doc);
}

export function applyChanges(doc: Doc, changes: Uint8Array[]): { doc: Doc; heads: Heads } {
  const [next] = Automerge.applyChanges(Automerge.clone(doc), changes);
  const migrated = migrateDoc(next);
  return { doc: migrated, heads: getHeads(migrated) };
}

/**
 * CRDT-merge `remote` into `local`. `dirty` = did the merged doc advance beyond
 * remote (i.e. local carried unsynced changes remote lacks) → must be re-uploaded.
 * Computed on the MERGED doc vs remote (a pre-merge heads compare would falsely
 * flag a clean local and re-introduce the save ping-pong). See ADR-032.
 */
export function mergeDocs(local: Doc, remote: Doc): { doc: Doc; dirty: boolean; heads: Heads } {
  const merged = migrateDoc(Automerge.merge(Automerge.clone(local), remote));
  const dirty = Automerge.getChanges(remote, merged).length > 0;
  return { doc: merged, dirty, heads: getHeads(merged) };
}

// ─── Async payload crypto (Drive path) ───────────────────────────────────────
//
// These are the async, CryptoKey-touching handlers the worker owns (the pure
// sync ops are above). They are shared by the worker AND the inline fallback.
// Timing is the caller's job (applyAndProject relays `automerge.remoteLoad` /
// `automerge.save` perf samples to main) — these stay perf-plumbing-free.

/**
 * Load a decrypted binary as an Automerge doc, catching the "loads but the WASM
 * materializer blows up on first read" corruption at the boundary (the same
 * check the Drive read path has always had — `fileSync.decryptBeanpodPayload`).
 * Does NOT migrate — the caller replaces/merges then migrates. Throws
 * `CorruptPayloadError` (reconstructed across `postMessage` via the protocol
 * error registry, so `instanceof` recovery dispatch on main keeps working).
 */
export function loadAndVerify(binary: Uint8Array, familyId: string | null): Doc {
  let doc: Doc;
  try {
    doc = Automerge.load<FamilyDocument>(binary);
  } catch (e) {
    throw new CorruptPayloadError(
      `Automerge.load failed on decrypted payload: ${e instanceof Error ? e.message : String(e)}`,
      'load',
      familyId
    );
  }
  // Touching `familyMembers` (always a Record) forces the first materialize.
  try {
    Object.keys(doc.familyMembers ?? {});
  } catch (e) {
    throw new CorruptPayloadError(
      `Automerge materialize failed on decrypted payload: ${e instanceof Error ? e.message : String(e)}`,
      'materialize',
      familyId
    );
  }
  return doc;
}

/** Decrypt a fetched V4 envelope's payload → verified Automerge doc (unmigrated). */
export async function decryptToDoc(envelope: BeanpodFileV4, familyKey: CryptoKey): Promise<Doc> {
  const encrypted = new Uint8Array(base64ToBuffer(envelope.encryptedPayload));
  const binary = await decryptPayload(familyKey, encrypted);
  return loadAndVerify(binary, envelope.familyId ?? null);
}

/**
 * Serialize + encrypt a doc → base64 payload. The worker returns ONLY this;
 * envelope assembly (wrappedKeys/inviteKeys) stays on main so key material never
 * leaves the main thread for the upload path. See ADR-032.
 */
export async function encryptDocPayload(doc: Doc, familyKey: CryptoKey): Promise<string> {
  const binary = saveDoc(doc);
  const encrypted = await encryptPayload(familyKey, binary);
  return bufferToBase64(encrypted);
}

// ─── Materialization → projection ────────────────────────────────────────────

/** Plain `[id, entity]` pairs for a collection (structured-clone-safe). */
export function materializeCollection(
  doc: Doc,
  collection: CollectionName
): Array<[string, unknown]> {
  const coll = (doc[collection] ?? {}) as AnyRecord;
  return Object.entries(coll).map(([id, entity]) => [id, toPlain(entity)]);
}

/**
 * The full projection as one delta per collection (+ settings), each a `bulk`
 * reset. `docWorker` streams these across messages (chunking large collections)
 * so the main-thread receive never becomes a long task.
 */
export function buildFullProjection(doc: Doc): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = COLLECTION_NAMES.map((collection) => ({
    kind: 'bulk',
    collection,
    reset: true,
    entities: materializeCollection(doc, collection),
  }));
  deltas.push({ kind: 'settings', settings: toPlain(doc.settings ?? null) });
  return deltas;
}

// ─── Named-op registry (nested-structure handlers, e.g. photo attach) ────────

/** A named handler mutates the draft doc and returns its projection delta(s). */
export type NamedOpHandler = (
  draft: FamilyDocument,
  args: Record<string, unknown>
) => { result?: unknown; deltas: ProjectionDelta[] };

const namedRegistry = new Map<string, NamedOpHandler>();

/** Register a nested-structure op (photo attach/collect etc.). Static, at load. */
export function registerNamedOp(name: string, handler: NamedOpHandler): void {
  namedRegistry.set(name, handler);
}

// ─── Core domain named ops (atomic read-modify-write against the worker doc) ──
//
// These are the atomic financial ops. `increment` can't express them: goals need
// a max(0,…) floor + auto-complete, loans a non-linear amortization written to a
// possibly-nested host. Doing the read-modify-write inside one `Automerge.change`
// closes the async lost-update a concurrent poll-merge would otherwise cause.

const nowIso = (): string => new Date().toISOString();

/** Goal contribution: clamp at 0, auto-complete at target. Returns the goal. */
const applyGoalContributionOp: NamedOpHandler = (draft, args) => {
  const id = args.id as string;
  const delta = args.delta as number;
  const goals = draft.goals as unknown as Record<string, Goal>;
  const goal = goals[id];
  if (!goal) throw new Error(`applyGoalContribution: goal ${id} not found`);
  const current = typeof goal.currentAmount === 'number' ? goal.currentAmount : 0;
  goal.currentAmount = Math.max(0, current + delta);
  if (!goal.isCompleted && goal.currentAmount >= goal.targetAmount) goal.isCompleted = true;
  goal.updatedAt = nowIso();
  const entity = toPlain(goals[id]);
  return { result: entity, deltas: [{ kind: 'upsert', collection: 'goals', id, entity }] };
};

/** Write `newBalance` to the loan host (nested asset-loan or account) + echo it. */
function writeLoanBalance(
  draft: FamilyDocument,
  loan: LoanDetails,
  newBalance: number
): { collection: CollectionName; entity: unknown } {
  if (loan.type === 'asset') {
    const asset = (draft.assets as unknown as Record<string, Asset>)[loan.entityId];
    if (asset?.loan) {
      asset.loan.outstandingBalance = newBalance;
      asset.updatedAt = nowIso();
    }
    return { collection: 'assets', entity: toPlain(asset) };
  }
  const account = (draft.accounts as unknown as Record<string, Account>)[loan.entityId];
  if (account) {
    account.balance = newBalance;
    account.updatedAt = nowIso();
  }
  return { collection: 'accounts', entity: toPlain(account) };
}

const findLoan = (draft: FamilyDocument, loanId: string): LoanDetails | null =>
  findLoanDetails(
    loanId,
    Object.values((draft.assets ?? {}) as unknown as Record<string, Asset>),
    Object.values((draft.accounts ?? {}) as unknown as Record<string, Account>)
  );

/** Apply a loan payment: amortize (recurring) or extra-payment (one-time), write
 * the new balance atomically, return the host entity + interest/principal split
 * (main writes those onto the transaction via the existing repo). */
const applyLoanPaymentOp: NamedOpHandler = (draft, args) => {
  const loan = findLoan(draft, args.loanId as string);
  if (!loan || loan.outstandingBalance <= 0) return { result: { applied: false }, deltas: [] };
  const res = args.isRecurring
    ? calculateAmortization(
        loan.outstandingBalance,
        loan.interestRate,
        args.paymentAmount as number
      )
    : calculateExtraPayment(loan.outstandingBalance, args.paymentAmount as number);
  const { collection, entity } = writeLoanBalance(draft, loan, res.newBalance);
  return {
    result: {
      applied: true,
      hostCollection: collection,
      host: entity,
      interestPortion: res.interestPortion,
      principalPortion: res.principalPortion,
    },
    deltas: [{ kind: 'upsert', collection, id: loan.entityId, entity }],
  };
};

/** Reverse a loan payment: restore the principal portion to the balance. */
const reverseLoanPaymentOp: NamedOpHandler = (draft, args) => {
  const loan = findLoan(draft, args.loanId as string);
  if (!loan) return { result: { applied: false }, deltas: [] };
  const restored = loan.outstandingBalance + (args.principalToRestore as number);
  const { collection, entity } = writeLoanBalance(draft, loan, restored);
  return {
    result: { applied: true, hostCollection: collection, host: entity },
    deltas: [{ kind: 'upsert', collection, id: loan.entityId, entity }],
  };
};

/** Replace the settings singleton (`doc.settings` is `Settings | null`, not a
 * collection map — so `set`/`patch` don't fit). Emits a `settings` delta. */
const setSettingsOp: NamedOpHandler = (draft, args) => {
  (draft as unknown as AnyRecord).settings = args.settings;
  const settings = toPlain(draft.settings ?? null);
  return { result: settings, deltas: [{ kind: 'settings', settings }] };
};

/** Register the core domain ops. Called at module load + re-registered after a
 * test reset, so production + tests always have them (plugins like photo attach
 * register separately). */
export function registerCoreNamedOps(): void {
  registerNamedOp('applyGoalContribution', applyGoalContributionOp);
  registerNamedOp('applyLoanPayment', applyLoanPaymentOp);
  registerNamedOp('reverseLoanPayment', reverseLoanPaymentOp);
  registerNamedOp('setSettings', setSettingsOp);
}
registerCoreNamedOps();

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Mutate the draft for one op (recurses for `batch`). Pure structural mutation
 * — the projection deltas are built afterwards from the COMMITTED doc (reading a
 * mid-change proxy is fragile). Returns named-op deltas inline (they own theirs). */
function mutateDraft(
  draft: FamilyDocument,
  op: MutationOp,
  named: ProjectionDelta[],
  namedResults: unknown[]
): void {
  switch (op.op) {
    case 'set':
      (draft[op.collection] as AnyRecord)[op.id] = op.entity;
      break;
    case 'patch': {
      const col = draft[op.collection] as Record<string, AnyRecord>;
      let entity = col[op.id];
      if (!entity) {
        switch (op.onMissing ?? 'throw') {
          case 'skip':
            return; // no-op: tolerates the concurrent-delete race (echoes undefined)
          case 'create':
            col[op.id] = {};
            entity = col[op.id]; // re-read: the assigned `{}` is detached; the doc holds the proxy
            break;
          default:
            throw new Error(`patch: ${op.collection}/${op.id} not found`);
        }
      }
      for (const [k, v] of Object.entries(op.patch)) entity[k] = v;
      for (const k of op.deleteKeys ?? []) delete entity[k];
      if (op.updatedAt) entity.updatedAt = op.updatedAt;
      break;
    }
    case 'delete':
      delete (draft[op.collection] as AnyRecord)[op.id];
      break;
    case 'increment': {
      // Read-modify-write ATOMIC inside the change — no interleave with a merge.
      const entity = (draft[op.collection] as Record<string, AnyRecord>)[op.id];
      if (!entity) {
        if ((op.onMissing ?? 'throw') === 'skip') return; // concurrent-delete race → no-op
        throw new Error(`increment: ${op.collection}/${op.id} not found`);
      }
      const cur = typeof entity[op.field] === 'number' ? (entity[op.field] as number) : 0;
      entity[op.field] = cur + op.delta;
      if (op.updatedAt) entity.updatedAt = op.updatedAt;
      break;
    }
    case 'batch':
      for (const sub of op.ops) mutateDraft(draft, sub, named, namedResults);
      break;
    case 'named': {
      const handler = namedRegistry.get(op.name);
      if (!handler) throw new Error(`named op not registered: ${op.name}`);
      const { result, deltas } = handler(draft, op.args);
      named.push(...deltas);
      namedResults.push(result);
      break;
    }
  }
}

/** Build the projection delta for one op by reading the COMMITTED post-change doc. */
function deltaFor(after: Doc, op: MutationOp, out: ProjectionDelta[]): unknown {
  switch (op.op) {
    case 'set':
      out.push({ kind: 'upsert', collection: op.collection, id: op.id, entity: op.entity });
      return op.entity;
    case 'patch':
    case 'increment': {
      const raw = (after[op.collection] as Record<string, unknown>)[op.id];
      if (raw === undefined) {
        // The target is absent post-change — the op was skipped (onMissing:'skip')
        // or the entity was deleted earlier in the same batch. Sync the projection
        // to reality with a `remove` instead of round-tripping `undefined` (which
        // would throw in toPlain). Only reachable for a skipped/deleted target,
        // never a live entity. Echo `undefined` so callers can detect the skip.
        out.push({ kind: 'remove', collection: op.collection, id: op.id });
        return undefined;
      }
      const entity = toPlain(raw);
      out.push({ kind: 'upsert', collection: op.collection, id: op.id, entity });
      return entity;
    }
    case 'delete':
      out.push({ kind: 'remove', collection: op.collection, id: op.id });
      return true;
    case 'batch': {
      for (const sub of op.ops) deltaFor(after, sub, out);
      return undefined;
    }
    case 'named':
      return undefined; // named handler already contributed its deltas
  }
}

/**
 * Apply a declarative mutation. Returns the new doc, the affected entity
 * (`result`, for read-after-write), and the projection delta. A `batch` (and a
 * single op) is exactly ONE `Automerge.change` → atomic: a mid-batch throw
 * commits nothing.
 */
export function applyMutation(
  doc: Doc,
  op: MutationOp
): { doc: Doc; result: unknown; delta: ProjectionDelta } {
  const namedDeltas: ProjectionDelta[] = [];
  const namedResults: unknown[] = [];
  const after = Automerge.change(doc, (d) =>
    mutateDraft(d as FamilyDocument, op, namedDeltas, namedResults)
  );
  const out: ProjectionDelta[] = [];
  const structuralResult = deltaFor(after, op, out);
  const all = [...out, ...namedDeltas];
  const delta: ProjectionDelta = all.length === 1 ? all[0]! : { kind: 'multi', deltas: all };
  // A top-level `named` op returns its handler's result (the echoed entity for
  // read-after-write); structural ops return the affected entity.
  const result = op.op === 'named' ? namedResults[0] : structuralResult;
  return { doc: after, result, delta };
}

/** Test-only: clear plugin ops but keep the core domain ops registered. */
export function __resetNamedOpsForTesting(): void {
  namedRegistry.clear();
  registerCoreNamedOps();
}
