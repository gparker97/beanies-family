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
import { CorruptPayloadError, PayloadTooLargeError, PayloadLoadError } from '@/types/sync';
import type { PayloadLoadStep } from '@/types/sync';
import { isAllocationFailure } from '@/utils/isAllocationFailure';
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
  // Apply in place (NOT a defensive clone): `Automerge.applyChanges` consumes
  // `doc`'s handle and only READS `changes` — same pattern as `mergeDocs`. Every
  // caller immediately reassigns to the returned doc and drops the old handle
  // (the worker's `currentDoc`, or a freshly-loaded base in the cache-reload path,
  // which owns no shared handle). See ADR-032 Plan B (docs/plans/2026-07-07-…).
  const [next] = Automerge.applyChanges(doc, changes);
  const migrated = migrateDoc(next);
  return { doc: migrated, heads: getHeads(migrated) };
}

// ─── Change-log framing (length-delimited `Uint8Array[]` ⇄ one buffer) ────────
//
// A capture from `getChangesSince` is a `Uint8Array[]`; AES-GCM encrypts a single
// buffer, so both the B1 cache increments and the B2 Drive chunks serialize the
// array with an explicit per-change length prefix. A naive concatenation would
// lose the boundaries `applyChanges(Change[])` needs. Format (little-endian):
//   [uint32 count] ( [uint32 len] [len bytes] )*
// Pure + symmetric; a malformed buffer throws (caught by the cache recovery path).

export function frameChanges(changes: Uint8Array[]): Uint8Array {
  let total = 4;
  for (const c of changes) total += 4 + c.byteLength;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let off = 0;
  view.setUint32(off, changes.length, true);
  off += 4;
  for (const c of changes) {
    view.setUint32(off, c.byteLength, true);
    off += 4;
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}

export function unframeChanges(buf: Uint8Array): Uint8Array[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 4) throw new Error('unframeChanges: buffer too short for count');
  let off = 0;
  const count = view.getUint32(off, true);
  off += 4;
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 4 > buf.byteLength) throw new Error('unframeChanges: truncated length prefix');
    const len = view.getUint32(off, true);
    off += 4;
    if (off + len > buf.byteLength) throw new Error('unframeChanges: truncated change payload');
    out.push(buf.subarray(off, off + len));
    off += len;
  }
  return out;
}

/**
 * CRDT-merge `remote` into `local`. `dirty` = did the merged doc advance beyond
 * remote (i.e. local carried unsynced changes remote lacks) → must be re-uploaded.
 * Computed on the MERGED doc vs remote (a pre-merge heads compare would falsely
 * flag a clean local and re-introduce the save ping-pong). See ADR-032.
 */
export function mergeDocs(local: Doc, remote: Doc): { doc: Doc; dirty: boolean; heads: Heads } {
  // Merge into `local` in place (NOT a defensive clone): `Automerge.merge(a, b)`
  // applies b's changes onto a's handle and only READS b, so `dirty` — computed
  // as `getChanges(remote, merged)` — is byte-identical to the old clone-based
  // path (ADR-032; a pre-merge heads compare would re-introduce save ping-pong).
  // Never invert to `merge(remote, local)`: that switches the converged doc's
  // actorId to remote's. Safe because the caller immediately reassigns
  // `currentDoc = merged` and drops the stale `local` reference; and it keeps ONE
  // stable actorId per device (the old `clone` did `fork()` → a fresh random actor
  // every poll-merge → actor-list bloat). See docs/plans/2026-07-06-worker-ios-large-doc-load.md.
  const merged = migrateDoc(Automerge.merge(local, remote));
  const dirty = Automerge.getChanges(remote, merged).length > 0;
  return { doc: merged, dirty, heads: getHeads(merged) };
}

/**
 * Poll-merge projection optimization: the entities that changed between two heads
 * of the SAME doc, as `ProjectionDelta[]` — instead of re-materializing the whole
 * document. Returns `null` when the diff can't be confidently interpreted (an
 * unknown top-level key, an unexpected shape, or `Automerge.diff` throwing) so the
 * caller falls back to a full `buildFullProjection` — a correct full rebuild beats
 * a wrong delta.
 *
 * PURE + half-update-safe: it fully derives its result (or `null`) BEFORE the
 * caller streams anything, so a derivation failure can never leave a partially
 * streamed projection. Do NOT make this stream directly.
 *
 * Closed over the known doc shape (`COLLECTION_NAMES` + the `settings` singleton),
 * so a future schema change degrades to correct-but-full, never a wrong delta.
 */
export function projectionDeltasBetween(
  doc: Doc,
  fromHeads: Heads,
  toHeads: Heads
): ProjectionDelta[] | null {
  try {
    const patches = Automerge.diff(doc, fromHeads, toHeads);
    const touched = new Map<CollectionName, Set<string>>();
    let settingsChanged = false;
    for (const patch of patches) {
      const top = patch.path[0];
      if (top === 'settings') {
        settingsChanged = true;
        continue;
      }
      if (patch.path.length < 2) continue; // top-level/migrate create — no entity
      if (typeof top !== 'string' || !(COLLECTION_NAMES as readonly string[]).includes(top)) {
        // Unknown top-level key / unexpected shape → fall back to a full rebuild.
        console.warn(
          `[docOps] projectionDeltasBetween: unexpected diff path root "${String(top)}" — falling back to full projection.`
        );
        return null;
      }
      const collection = top as CollectionName;
      const id = String(patch.path[1]);
      let ids = touched.get(collection);
      if (!ids) {
        ids = new Set();
        touched.set(collection, ids);
      }
      ids.add(id);
    }
    const deltas: ProjectionDelta[] = [];
    for (const [collection, ids] of touched) {
      const coll = (doc[collection] ?? {}) as AnyRecord;
      for (const id of ids) {
        const raw = coll[id];
        if (raw === undefined) deltas.push({ kind: 'remove', collection, id });
        else deltas.push({ kind: 'upsert', collection, id, entity: toPlain(raw) });
      }
    }
    // One settings delta regardless of how many settings.* keys changed
    // (re-materializing the singleton is idempotent).
    if (settingsChanged) deltas.push({ kind: 'settings', settings: toPlain(doc.settings ?? null) });
    return deltas;
  } catch (e) {
    console.warn(
      '[docOps] projectionDeltasBetween: Automerge.diff derivation failed — falling back to full projection.',
      e
    );
    return null;
  }
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
 * check the Drive read path has always had; this is now its ONLY home, the old
 * main-thread `fileSync.decryptBeanpodPayload` copy having been deleted).
 * Does NOT migrate — the caller replaces/merges then migrates. Throws
 * `CorruptPayloadError` for bad bytes, or `PayloadTooLargeError` when this
 * device simply could not allocate enough memory to inflate them (both
 * reconstructed across `postMessage` via the protocol error registry, so
 * `instanceof` recovery dispatch on main keeps working).
 */
export function loadAndVerify(binary: Uint8Array, familyId: string | null): Doc {
  let doc: Doc;
  try {
    doc = Automerge.load<FamilyDocument>(binary);
  } catch (e) {
    throw payloadFailure('load', e, familyId, binary.byteLength);
  }
  // Touching `familyMembers` (always a Record) forces the first materialize.
  try {
    Object.keys(doc.familyMembers ?? {});
  } catch (e) {
    throw payloadFailure('materialize', e, familyId, binary.byteLength);
  }
  return doc;
}

/**
 * Plaintext byte count implied by a base64 AES-GCM payload, without decoding
 * it — for LABELLING a failure that happened before the decrypt could run.
 *
 * Base64 is 4 characters per 3 bytes; padding removes 1 or 2. The ciphertext
 * then carries a 12-byte IV and a 16-byte GCM tag that the plaintext does not,
 * so those come off: `payloadBytes` means DECRYPTED bytes at every other
 * producer and it rides into `perf_doc_bytes`, where a units mismatch would
 * skew the "pods above N MB fail on 3GB devices" threshold.
 *
 * Tolerant of a missing or malformed value on purpose: it is only ever used to
 * label a failure, and a wrong number here must never become a second throw
 * inside a catch. Returns `null` rather than 0 for anything it cannot size, so
 * an unknown reaches CloudWatch as absent instead of "zero-byte payload".
 */
export function decodedSizeOf(base64: unknown): number | null {
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  const rem = base64.length % 4;
  if (rem === 1) return null; // not a valid base64 length
  const padding = rem === 0 ? (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) : 0;
  const ciphertext = Math.floor(base64.length / 4) * 3 - padding + (rem === 0 ? 0 : rem - 1);
  const plaintext = ciphertext - AES_GCM_OVERHEAD_BYTES;
  return plaintext > 0 ? plaintext : null;
}

/** AES-GCM 12-byte IV prefix + 16-byte auth tag, per `familyKeyService`. */
const AES_GCM_OVERHEAD_BYTES = 28;

/**
 * THE classifier: is this throw bad data, or a device that ran out of memory?
 *
 * Exported and used by every step that touches payload bytes (`loadAndVerify`,
 * `decryptToDoc`, the cache's increment replay) so the decision cannot drift
 * between them — and it is a decision with teeth, because the corruption branch
 * DELETES the local cache to self-heal and the out-of-memory branch must not.
 *
 * `payloadBytes` is always DECRYPTED BYTES. It rides into `perf_doc_bytes`,
 * where every other producer means real bytes, and into the diagnostic blob a
 * user pastes into a support email — so a base64 CHARACTER count here would
 * silently overstate by 4/3 on exactly the step that fires first on the
 * smallest devices, skewing the "pods above N MB fail on 3GB devices"
 * threshold. Before the decrypt has run the true length is not known, so
 * callers pass `decodedSizeOf(base64)` (above), which subtracts the AES-GCM
 * overhead and is exact to within two bytes.
 */
export function payloadFailure(
  step: PayloadLoadStep,
  e: unknown,
  familyId: string | null,
  payloadBytes: number | null
): PayloadLoadError {
  // An already-classified error passes straight through: re-wrapping it at an
  // outer boundary would relabel a `materialize` OOM as a `decrypt` one.
  // `PayloadLoadError` (the base), never an enumeration of its subclasses — a
  // third subclass would otherwise be silently re-wrapped and mislabelled.
  if (e instanceof PayloadLoadError) return e;
  const what =
    step === 'load'
      ? 'Automerge.load'
      : step === 'materialize'
        ? 'Automerge materialize'
        : 'Payload decrypt';
  const message = `${what} failed on payload: ${e instanceof Error ? e.message : String(e)}`;
  return isAllocationFailure(e)
    ? new PayloadTooLargeError(message, step, familyId, payloadBytes)
    : new CorruptPayloadError(message, step, familyId, payloadBytes);
}

/** Decrypt a fetched V4 envelope's payload → verified Automerge doc (unmigrated). */
export async function decryptToDoc(envelope: BeanpodFileV4, familyKey: CryptoKey): Promise<Doc> {
  const familyId = envelope.familyId ?? null;
  // The decode + decrypt allocate two more multi-megabyte buffers BEFORE
  // Automerge is reached, so on a small device this is a place the open can run
  // out of memory — and an unclassified throw here would reach
  // `initAndLoadCache` looking like corruption and DELETE the local cache.
  let binary: Uint8Array;
  try {
    const encrypted = new Uint8Array(base64ToBuffer(envelope.encryptedPayload));
    binary = await decryptPayload(familyKey, encrypted);
  } catch (e) {
    // `?.length` on the value that may itself have caused the throw would make
    // the CATCH throw an unclassified TypeError, which lands on the cache-clear
    // branch — the one outcome this whole classification exists to avoid.
    throw payloadFailure('decrypt', e, familyId, decodedSizeOf(envelope.encryptedPayload));
  }
  return loadAndVerify(binary, familyId);
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
