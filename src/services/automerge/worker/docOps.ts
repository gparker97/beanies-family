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
import {
  COLLECTION_NAMES,
  NON_COLLECTION_KEYS,
  MIGRATED_ROOT_KEYS,
  type FamilyDocument,
  type CollectionName,
  type MigratedRootKey,
} from '@/types/automerge';
import type { PodLineage } from '@/types/models';
import type { CompactionLineage } from '@/services/sync/podLineage';
// ⚠️ NOT a bare `crypto.randomUUID()`. It is undefined on a NON-SECURE origin —
// which is exactly how a tablet is tested (`npm run dev -- --host` on a LAN IP)
// — and the resulting TypeError matches none of `isAllocationFailure`'s
// patterns, so `payloadFailure` classifies it as a CorruptPayloadError and the
// user is told their family data may be damaged. `generateUUID` has the
// fallback this needs and is what the rest of the app uses.
import { generateUUID } from '@/utils/id';
import { encryptPayload, decryptPayload } from '@/services/crypto/familyKeyService';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { CorruptPayloadError, PayloadTooLargeError, PayloadLoadError } from '@/types/sync';
import type { PayloadLoadStep } from '@/types/sync';
import { isAllocationFailure } from '@/utils/isAllocationFailure';
import { docInitOpts } from './docActor';
import { MIGRATION_CHANGES } from './migrationChanges';
import { rebaseBlockingTransactionConflict } from './transactionFields';
import {
  adjustField,
  fieldDecimals,
  foldEntity,
  foldIndex,
  foldValue,
  counterGrowthOps,
  targetKnowledge,
  baselineKnowledge,
  LEDGER_WINDOW,
  type GrowthKnowledge,
  isCounterCollection,
  parseCounterKey,
  resolveField,
  sigma,
  unfoldPatch,
  shiftAbsolute,
  COUNTER_FIELDS,
  type CounterField,
  type CounterIndex,
  type FoldIndex,
} from './counterFields';
import {
  calculateAmortization,
  calculateExtraPayment,
  findLoanDetails,
  type LoanDetails,
} from '@/utils/loanPayment';
import type { Asset, Account, Goal, GoalManualContribution } from '@/types/models';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import type {
  MutationOp,
  ProjectionDelta,
  Heads,
  PatchSettingsArgs,
  RebaseBlock,
  CounterRebaseMode,
} from './protocol';
import {
  reconcileInto,
  canonicalEqual,
  KEY_FIELDS,
  type ReconcileContext,
  type ReconcileNote,
} from './reconcile';

type Doc = Automerge.Doc<FamilyDocument>;
type AnyRecord = Record<string, unknown>;

/** JSON round-trip an Automerge value to a plain, structured-clone-safe object. */
function toPlain<T>(value: T): T {
  // ⚠️ `undefined` PASSES THROUGH. `JSON.stringify(undefined)` is `undefined`,
  // which `JSON.parse` coerces to the STRING "undefined" and throws on — so
  // every `toPlain(x) ?? fallback` guard in this file was dead, and an absent
  // singleton (a pod created before `settings` shipped is a documented real
  // state) threw a `SyntaxError` from deep inside a pure composer. In the
  // rebase that throw cost the peer its ENTIRE offline session, not just the
  // field: it escaped to the fallback and raised the block R1 exists to remove.
  if (value === undefined) return undefined as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * THE materialisation funnel (#117 Phase 2, plan §B): a live document value → the plain entity
 * main sees, with every Counter-backed field FOLDED (`abs + Σ`). Every entity that leaves this
 * module for the projection, a delta or an op echo goes through here, so main never sees a raw
 * baseline and never computes a sum.
 *
 * `index` is `foldIndex(doc)` of the SAME document `live` was read from, built once by the
 * caller per materialisation call (never per entity). `id` is the map key the entity lives
 * under, which is what a Counter key names.
 *
 * NOT for the rebase composer (`buildRebaseOps`, `threeWayFields`, `carryOnlyNewFields`): it
 * works in RAW space, and folding there would count every Counter twice.
 */
function materialiseEntity<T>(collection: string, id: string, live: T, index: FoldIndex): T {
  return foldEntity(collection, id, toPlain(live), index);
}

/** An entity's projection delta: a folded `upsert` when it is present, else a `remove`. */
type EntityDelta = Extract<ProjectionDelta, { kind: 'upsert' } | { kind: 'remove' }>;

/**
 * THE one "entity present → materialised upsert, else remove" rule, for the poll delta, the
 * structural op echo and the goal/loan named handlers. `doc` may be a committed document or a
 * draft (a draft's Counters already include this change's increments, probe m).
 */
function entityDelta(
  doc: Readonly<FamilyDocument>,
  collection: CollectionName,
  id: string,
  index: FoldIndex
): EntityDelta {
  const live = (doc[collection] as AnyRecord | undefined)?.[id];
  if (live === undefined) return { kind: 'remove', collection, id };
  return { kind: 'upsert', collection, id, entity: materialiseEntity(collection, id, live, index) };
}

// ─── Doc lifecycle ───────────────────────────────────────────────────────────

/**
 * This document's lineage, normalised — the ONE place absent-or-null is decided.
 *
 * `podLineage` is typed `PodLineage | null` but is ABSENT on every pod created
 * before it shipped, exactly as `settings` is: `migrateDoc` seeds only
 * `COLLECTION_NAMES`, and it must stay that way — seeding this field would emit
 * a real `Automerge.change` into every legacy pod on open, churn in the document
 * the whole tier exists to shrink.
 *
 * Reading it directly would push that three-state distinction (absent / null /
 * present) onto every caller, and `compareLineage` deliberately accepts only
 * two. So: read it HERE, or not at all.
 */
export function docLineage(doc: Doc): CompactionLineage | null {
  return (doc as { podLineage?: CompactionLineage | null }).podLineage ?? null;
}

/**
 * The next lineage generation after `prev`. THE ONE MINT, and there is no
 * second: a lineage is a fresh id at the next seq, whoever is asking.
 *
 * Three callers, each applying it differently and each right where it is:
 *  - `compactDoc` stamps it INTO the plain source before `Automerge.from`, so
 *    the rebuilt document is a single change and the verify runs against the
 *    stamped bytes;
 *  - the restore stamp in `mergeRemoteEnvelope` applies it as an
 *    `Automerge.change` to an already-built document, because rebuilding there
 *    would destroy the history the restore exists to recover;
 *  - the env-gated `beanpodProfile` diagnostic, like `compactDoc`.
 *
 * #117 writer flip: `restoreSeq` (the last restore generation) is carried forward unchanged, so
 * a peer that predates a restore still takes the restore rule after any number of later
 * compactions. The restore stamp itself overrides it with the new `seq`.
 */
export function nextLineage(prev: PodLineage | null): PodLineage {
  return {
    id: generateUUID(),
    seq: (prev?.seq ?? 0) + 1,
    ...(prev?.restoreSeq !== undefined ? { restoreSeq: prev.restoreSeq } : {}),
  };
}

/**
 * Plain `atob` decode (browser, worker and Node alike) for the small, trusted migration table.
 * Deliberately NOT `base64ToBuffer`: that one is perf-instrumented and chunked for multi-MB
 * payloads, and store tests mock it, which would break every document they create.
 */
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decode the committed migration change for `name` (#117, plan F). A table entry that does not
 * decode, or decodes to anything but one root op creating `name`, is a BUILD defect: it throws,
 * loudly, rather than silently creating the collection the old, merge-unsafe way.
 */
function storedMigrationChange(name: MigratedRootKey): Uint8Array {
  const b64 = MIGRATION_CHANGES[name];
  if (typeof b64 !== 'string') {
    throw new Error(`migrateDoc: no stored migration change for "${name}" (build defect)`);
  }
  let bytes: Uint8Array;
  let decoded: Automerge.DecodedChange;
  try {
    bytes = decodeBase64(b64);
    decoded = Automerge.decodeChange(bytes);
  } catch (e) {
    // Classified as a build defect and rethrown with the collection named: the worker cannot
    // telemeter, so the throw IS the signal, surfaced on main through the RPC error path.
    throw new Error(`migrateDoc: stored migration change for "${name}" is undecodable`, {
      cause: e,
    });
  }
  const op = decoded.ops[0];
  const shapeOk =
    decoded.ops.length === 1 &&
    op?.action === 'makeMap' &&
    op.obj === '_root' &&
    op.key === name &&
    decoded.deps.length === 0;
  if (!shapeOk) {
    throw new Error(`migrateDoc: stored migration change for "${name}" has the wrong shape`);
  }
  return bytes;
}

/**
 * Initialize any collections missing from an older document.
 *
 * ⚠️ ABSENT AND `null` ARE DIFFERENT CASES (#117, plan F):
 *  - ABSENT: apply the committed `MIGRATION_CHANGES` entry (fixed actor, seq 1, deps []). Every
 *    device that migrates the pod applies the SAME change, so they all hold the SAME map object
 *    and concurrent writes into it merge. An ordinary `d[name] = {}` here would give each device
 *    its own object, and only one device's entities would survive the merge.
 *  - `null`: an ordinary change, as before. The stored change is concurrent with whatever wrote
 *    the `null`, which sits behind earlier ops and so wins on op counter: the key would STAY
 *    `null` (`automergeSemantics.test.ts`, probe c).
 * Collections that already exist are never touched, and a doc with nothing missing is returned
 * as-is (same handle, heads unchanged).
 *
 * A key still absent AFTER its stored change was applied means the change was already in the
 * history and the key was later deleted (no code path deletes a collection). Applying a change a
 * document already holds is a no-op, so that key falls through to the ordinary change: usable,
 * just not merge-deterministic.
 */
export function migrateDoc(doc: Doc): Doc {
  const absent = MIGRATED_ROOT_KEYS.filter((name) => doc[name] === undefined);
  const nulls = MIGRATED_ROOT_KEYS.filter((name) => doc[name] === null);
  if (absent.length === 0 && nulls.length === 0) return doc;
  let next = doc;
  if (absent.length > 0) {
    [next] = Automerge.applyChanges(next, absent.map(storedMigrationChange));
  }
  const ordinary = [...nulls, ...absent.filter((name) => next[name] === undefined)];
  if (ordinary.length === 0) return next;
  return Automerge.change(next, 'migrate: add missing collections', (d) => {
    for (const name of ordinary) (d as unknown as AnyRecord)[name] = {};
  });
}

/** The root keys a root conflict can occur at: every migrated root map (each collection, plus
 *  `counterDeltas`) and the settings seed. */
const ROOT_CONFLICT_KEYS = [...MIGRATED_ROOT_KEYS, 'settings'] as const;

/** Conflicted root keys only, each with how many concurrent values it holds (always 2+). */
export type RootConflictSnapshot = ReadonlyMap<string, number>;

/**
 * Which root keys (`COLLECTION_NAMES` + `settings`) hold MORE than one concurrent value (#117,
 * plan F). A root conflict means two devices each created that key with their own object (a
 * pre-#117 device's `{}` beside the stored migration change, or the settings seed race), so the
 * losing map's entities are invisible. Nothing reassigns a collection key, so a conflict
 * persists: callers compare before/after an operation (`rootConflictsSince`) rather than alert
 * on the total.
 *
 * On 3.4.1 `getConflicts` returns `undefined` for a key with a single value (probes c/d), so only
 * a result with 2+ entries counts. Pure, and cheap: one lookup per root key.
 */
export function rootConflictSnapshot(doc: Doc): RootConflictSnapshot {
  const out = new Map<string, number>();
  for (const key of ROOT_CONFLICT_KEYS) {
    const values = Automerge.getConflicts(doc, key);
    const n = values ? Object.keys(values).length : 0;
    if (n > 1) out.set(key, n);
  }
  return out;
}

/** How many root keys hold more than one concurrent value. See `rootConflictSnapshot`. */
export function countRootConflicts(doc: Doc): number {
  return rootConflictSnapshot(doc).size;
}

/**
 * The root conflicts `doc` holds, and how many keys an operation since `before` ADDED. A key
 * counts as added when it was not conflicted before OR its conflict grew (a third device's value
 * arrived): either can change which map wins, and with it which entities are visible, which is
 * exactly what a delta projection cannot express.
 */
export function rootConflictsSince(
  before: RootConflictSnapshot,
  doc: Doc
): { total: number; added: number } {
  const after = rootConflictSnapshot(doc);
  let added = 0;
  for (const [key, n] of after) if (n > (before.get(key) ?? 1)) added++;
  return { total: after.size, added };
}

export function loadDoc(binary: Uint8Array): Doc {
  return migrateDoc(Automerge.load<FamilyDocument>(binary, docInitOpts()));
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
/**
 * Which entities changed between two points in one document's history?
 *
 * Extracted so the projection delta builder and the Stage 3 REBASE share one
 * implementation. Both need exactly this — "what did the peer touch since its
 * last synced baseline?" — and its null-on-anything-unexpected contract is what
 * makes both safe: the projection falls back to a full rebuild, the rebase falls
 * back to the block it was replacing.
 *
 * ⚠️ `podLineage` AND EVERY OTHER SINGLETON ARE IGNORED, and that is
 * load-bearing twice over. Folding one into `settingsChanged` would push a
 * spurious settings delta on every compaction, and — far worse — make a lineage
 * write look like a settings change to the rebase, which would then carry the
 * peer's settings over the compactor's.
 */
/** The root map holding the Counters (#117 Phase 2); `satisfies` pins the name to the type. */
const COUNTER_ROOT = 'counterDeltas' satisfies keyof FamilyDocument;

export function touchedBetween(
  doc: Doc,
  fromHeads: Heads,
  toHeads: Heads
): { touched: Map<CollectionName, Set<string>>; settingsChanged: boolean } | null {
  const patches = Automerge.diff(doc, fromHeads, toHeads);
  const touched = new Map<CollectionName, Set<string>>();
  let settingsChanged = false;
  const touch = (collection: CollectionName, id: string): void => {
    let ids = touched.get(collection);
    if (!ids) {
      ids = new Set();
      touched.set(collection, ids);
    }
    ids.add(id);
  };
  for (const patch of patches) {
    const top = patch.path[0];
    if (top === 'settings') {
      settingsChanged = true;
      continue;
    }
    // #117 Phase 2: a Counter key (`[counterDeltas, key]`, a create `put` or an `inc`) changes
    // its ENTITY's folded value, so it touches that entity: a merge that brings a peer's
    // Counter must re-emit the entity's upsert. Checked BEFORE the non-collection skip below,
    // which would otherwise swallow it; the migrate's own length-1 `put [counterDeltas]` still
    // falls through to that skip. A key this build cannot parse (a future build's field, a
    // malformed key) is warned and skipped, never a `null`: the fold skips it too, so a full
    // rebuild would show exactly the same values.
    if (top === COUNTER_ROOT && patch.path.length >= 2) {
      const key = String(patch.path[1]);
      const parsed = parseCounterKey(key);
      if (parsed) touch(parsed.collection, parsed.id);
      else console.warn(`[docOps] touchedBetween: skipping unparseable Counter key "${key}".`);
      continue;
    }
    if (typeof top === 'string' && (NON_COLLECTION_KEYS as readonly string[]).includes(top)) {
      continue;
    }
    if (patch.path.length < 2) continue; // top-level/migrate create — no entity
    if (typeof top !== 'string' || !(COLLECTION_NAMES as readonly string[]).includes(top)) {
      console.warn(
        `[docOps] touchedBetween: unexpected diff path root "${String(top)}" — caller must fall back.`
      );
      return null;
    }
    touch(top as CollectionName, String(patch.path[1]));
  }
  return { touched, settingsChanged };
}

export function projectionDeltasBetween(
  doc: Doc,
  fromHeads: Heads,
  toHeads: Heads
): ProjectionDelta[] | null {
  try {
    const scan = touchedBetween(doc, fromHeads, toHeads);
    if (!scan) return null; // unexpected shape → full rebuild, as before
    const { touched, settingsChanged } = scan;
    const deltas: ProjectionDelta[] = [];
    const index = foldIndex(doc);
    for (const [collection, ids] of touched) {
      for (const id of ids) deltas.push(entityDelta(doc, collection, id, index));
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
    doc = Automerge.load<FamilyDocument>(binary, docInitOpts());
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

/**
 * Plain, folded `[id, entity]` pairs for a collection (structured-clone-safe).
 *
 * ⚠️ `index` IS REQUIRED: pass `foldIndex(doc)` of this same `doc`, built once per call site
 * and shared across collections. An optional parameter whose omission silently changes the
 * result (raw baselines instead of folded values) is a trap.
 */
export function materializeCollection(
  doc: Doc,
  collection: CollectionName,
  index: FoldIndex
): Array<[string, unknown]> {
  const coll = (doc[collection] ?? {}) as AnyRecord;
  return Object.entries(coll).map(([id, entity]) => [
    id,
    materialiseEntity(collection, id, entity, index),
  ]);
}

/**
 * The full projection as one delta per collection (+ settings), each a `bulk`
 * reset. `docWorker` streams these across messages (chunking large collections)
 * so the main-thread receive never becomes a long task.
 */
export function buildFullProjection(doc: Doc): ProjectionDelta[] {
  const index = foldIndex(doc); // once, for every collection
  const deltas: ProjectionDelta[] = COLLECTION_NAMES.map((collection) => ({
    kind: 'bulk',
    collection,
    reset: true,
    entities: materializeCollection(doc, collection, index),
  }));
  deltas.push({ kind: 'settings', settings: toPlain(doc.settings ?? null) });
  return deltas;
}

// ─── Named-op registry (nested-structure handlers, e.g. photo attach) ────────

/**
 * What `applyMutation` hands every named handler beside the draft and its args (#117 Phase 2).
 * ONE object rather than a positional parameter per field, for the same reason `MutationSink`
 * is: the next one is a field, not a signature change at every handler. Handlers that write no
 * Counter field (photo attach, settings) ignore it.
 */
export interface NamedOpContext {
  /** The Counter writer id `adjustField` keys this change's adjustments by: the handle's
   *  Automerge actor alone (#117 writer flip), unique per live handle and fresh per load. */
  readonly writerId: string;
}

/** A named handler mutates the draft doc and returns its projection delta(s), plus any
 * reconciler notes (#117) for main to log. */
export type NamedOpHandler = (
  draft: FamilyDocument,
  args: Record<string, unknown>,
  ctx: NamedOpContext
) => { result?: unknown; deltas: ProjectionDelta[]; notes?: ReconcileNote[] };

// ─── Fine-grained field writes (#117, ADR-039) ───────────────────────────────

/**
 * The base for one patched key: the caller's snapshot when it sent one, else the document's
 * own value. ONE rule for `patch` and `patchSettings`.
 *
 * With no caller base, the target IS the base, so the reconciler takes the target to `next`
 * in place: today's semantics, minus the whole-object writes. That is the path for the
 * worker-internal rebase (whose ops are already three-way) and the scalar-only direct sites.
 * With a caller base that lacks `k`, the base stays `undefined`: nothing is known about that
 * key, so the write is additive and never deletes. (Without this rule a base-less rebase
 * would be additive and silently drop a peer's removed rate or API key.)
 */
function baseFor(opBase: AnyRecord | undefined, target: AnyRecord, k: string): unknown {
  return opBase ? opBase[k] : toPlain(target[k]);
}

/**
 * The one per-key loop behind `patch` and `patchSettings`: reconcile every key of `patch`
 * into `target`, then clear `deleteKeys`. A clear counts as a write only when the key is
 * there (Automerge stores no `undefined`, so `=== undefined` is "absent").
 */
function reconcileFields(
  target: AnyRecord,
  patch: AnyRecord,
  opBase: AnyRecord | undefined,
  deleteKeys: readonly string[],
  ctx: ReconcileContext
): void {
  for (const [k, v] of Object.entries(patch)) {
    reconcileInto(target, k, v, baseFor(opBase, target, k), ctx);
  }
  for (const k of deleteKeys) {
    if (target[k] === undefined) continue;
    delete target[k];
    ctx.writes++;
  }
}

/** Prefix each note's field with where it happened (`lists.items`, `settings.exchangeRates`),
 * so the one allowlisted `kind` key isolates the collection in CloudWatch. */
function scopeNotes(where: string, notes: readonly ReconcileNote[]): ReconcileNote[] {
  return notes.map((n) => ({ ...n, kind: n.kind ? `${where}.${n.kind}` : where }));
}

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

/** The `applyGoalContribution` args (built by `goalRepository.applyContribution`). */
interface GoalContributionArgs {
  id: string;
  /** The requested change to the folded `currentAmount` (signed). */
  delta: number;
  /** A history entry to append for this change (`amount` is replaced by the applied delta). */
  contribution?: GoalManualContribution;
  /** The id of a history entry to remove (Undo). */
  undoContributionId?: string;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== '';

function isContributionEntry(v: unknown): v is GoalManualContribution {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    typeof v.amount === 'number' &&
    Number.isFinite(v.amount) &&
    isNonEmptyString(v.at) &&
    isNonEmptyString(v.updatedBy) &&
    (v.note === undefined || typeof v.note === 'string')
  );
}

/**
 * Validate the args main sent. A malformed shape is a programming error on main: throw (the
 * worker error path surfaces it as a toast + report), never half-apply a money write.
 */
function parseGoalContributionArgs(args: Record<string, unknown>): GoalContributionArgs {
  const { id, delta, contribution, undoContributionId } = args;
  const fail = (why: string): Error => new Error(`applyGoalContribution: ${why}`);
  if (!isNonEmptyString(id)) throw fail('`id` must be a non-empty string.');
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    throw fail(`\`delta\` must be a finite number (got ${String(delta)}).`);
  }
  if (contribution !== undefined && undoContributionId !== undefined) {
    throw fail('pass `contribution` or `undoContributionId`, never both.');
  }
  if (contribution !== undefined && !isContributionEntry(contribution)) {
    throw fail(
      '`contribution` must be a GoalManualContribution ({ id, amount, at, updatedBy, note? }); ' +
        'build it with goalsStore.contributionEntry.'
    );
  }
  if (undoContributionId !== undefined && !isNonEmptyString(undoContributionId)) {
    throw fail('`undoContributionId` must be a non-empty string.');
  }
  return { id, delta, contribution, undoContributionId };
}

/**
 * Goal contribution, RELATIVE (#117 Phase 2): decided on the FOLDED amount and written through
 * `adjustField` (a Counter with writes on, today's absolute with writes off), so two devices'
 * contributions both land after a merge. Returns the goal, folded.
 *
 *  - Floor: `applied = max(delta, −folded)`, today's `max(0, current + delta)` as a delta.
 *  - Auto-complete on `folded + applied ≥ targetAmount`; sets true only (as `goalsStore` does).
 *  - The history edit rides the SAME change, so the amount and its entry stay one atomic op:
 *    `contribution` appends `{ ...entry, amount: applied }` (nothing when `applied` is 0);
 *    `undoContributionId` splices that entry out by id (`splice`, never `delete arr[i]`,
 *    ADR-039).
 *  - AN UNDO REVERSES THE ENTRY, NOT MAIN'S DELTA. With `undoContributionId` the applied delta
 *    is `−entry.amount` (through the same floor), read from the entry this change splices out,
 *    so the money removed is exactly the money that entry recorded. `args.delta` is advisory
 *    there: main computes it from its own view, which a concurrent contribution merged in
 *    between can make stale. A mismatch is not an error; the entry wins.
 *  - MONEY AND HISTORY MOVE TOGETHER, IN BOTH DIRECTIONS. The entry is the receipt: a
 *    `contribution` whose id is already in the history (a retry), or an `undoContributionId`
 *    whose entry is absent (a second undo, or one already undone elsewhere), is a full no-op.
 *    No amount, no history edit, no `updatedAt`, so the change is empty and `mutate` reports
 *    `changed: false`.
 *
 * Every write-time read folds with the draft's own index: keys are single-writer, so the
 * draft's Σ is exact and already includes this change (probe m). The index is built ONCE, at
 * entry; `adjustField` records its own Counter write in it, so the echo after the write reads
 * the same Σ a rebuild would.
 */
const applyGoalContributionOp: NamedOpHandler = (draft, rawArgs, { writerId }) => {
  const { id, delta, contribution, undoContributionId } = parseGoalContributionArgs(rawArgs);
  const goals = draft.goals as unknown as Record<string, Goal>;
  const goal = goals[id];
  if (!goal) throw new Error(`applyGoalContribution: goal ${id} not found`);
  const index = foldIndex(draft);
  const echo = (): ReturnType<NamedOpHandler> => {
    const d = entityDelta(draft, 'goals', id, index);
    return { result: d.kind === 'upsert' ? d.entity : undefined, deltas: [d] };
  };
  if (contribution && goal.manualContributions?.some((c) => c.id === contribution.id)) {
    return echo();
  }
  const undoAt =
    undoContributionId === undefined
      ? -1
      : (goal.manualContributions?.findIndex((c) => c.id === undoContributionId) ?? -1);
  if (undoContributionId !== undefined && undoAt < 0) return echo();

  const decimals = fieldDecimals(resolveField('goals', 'currentAmount'), goal);
  const folded = foldValue(
    goal.currentAmount,
    sigma(index, 'goals', id, 'currentAmount'),
    0,
    decimals
  );
  // An undo reverses the entry's recorded amount; `delta` is advisory there (see above).
  const requested = undoAt >= 0 ? -goal.manualContributions![undoAt]!.amount : delta;
  const applied = Math.max(requested, -folded);
  // C9c: what actually moved. `updatedAt` is stamped only when something did, so a no-op
  // (a delta that rounds to 0, a clamp onto the value already stored) leaves the heads alone.
  const wrote = adjustField(draft, 'goals', id, 'currentAmount', applied, writerId, index);
  let changed = wrote;
  if (!goal.isCompleted && foldValue(folded, applied, 0, decimals) >= goal.targetAmount) {
    goal.isCompleted = true;
    changed = true;
  }

  // The receipt is appended only when the money moved: an entry for an amount that rounded to
  // nothing would be history with no money behind it.
  if (contribution && wrote) {
    const entry: GoalManualContribution = {
      id: contribution.id,
      amount: applied,
      at: contribution.at,
      updatedBy: contribution.updatedBy,
      // Field by field: Automerge rejects an `undefined` value, and a key main added by
      // mistake has no business in the document.
      ...(contribution.note !== undefined ? { note: contribution.note } : {}),
    };
    if (goal.manualContributions) goal.manualContributions.push(entry);
    else goal.manualContributions = [entry];
    changed = true;
  } else if (undoAt >= 0) {
    goal.manualContributions!.splice(undoAt, 1);
    changed = true;
  }

  if (changed) goal.updatedAt = nowIso();
  return echo();
};

/** Where a loan's balance lives: the nested asset loan, or a loan account's `balance`. */
function loanHost(loan: LoanDetails): { collection: 'assets' | 'accounts'; field: string } {
  return loan.type === 'asset'
    ? { collection: 'assets', field: 'loan.outstandingBalance' }
    : { collection: 'accounts', field: 'balance' };
}

/**
 * Move the loan host's balance by `delta` through `adjustField` (a Counter with writes on,
 * today's absolute with writes off), stamp `updatedAt`, and echo the host through the funnel
 * (`entityDelta`), so the echo and the delta carry the folded value.
 *
 * Relative, never `= newBalance`, so two devices' payments against one loan both land after a
 * merge. With writes off, `toMinor` rounds the float `newBalance − outstandingBalance` to four
 * decimals, so the stored value lands on the `round2` `newBalance` exactly.
 */
function adjustLoanBalance(
  draft: FamilyDocument,
  loan: LoanDetails,
  delta: number,
  writerId: string,
  index: CounterIndex
): { collection: CollectionName; entity: unknown; delta: EntityDelta } | null {
  const { collection, field } = loanHost(loan);
  // `findLoan` just found the host in this same draft, so `adjustField`'s existence throw is
  // reachable only through a programming error. `index` is the handler's one `foldIndex(draft)`;
  // `adjustField` records the write in it, so the echo below needs no rebuild.
  // C9c: `null` when nothing was written, so the handler reports `applied: false` and stamps
  // nothing, instead of moving the heads for a payment that changed no balance.
  if (!adjustField(draft, collection, loan.entityId, field, delta, writerId, index)) return null;
  (draft[collection] as unknown as Record<string, AnyRecord>)[loan.entityId]!.updatedAt = nowIso();
  const echo = entityDelta(draft, collection, loan.entityId, index);
  return { collection, entity: echo.kind === 'upsert' ? echo.entity : undefined, delta: echo };
}

/**
 * The loan `loanId` names, with its `outstandingBalance` FOLDED. `findLoanDetails` reads the
 * draft's proxies as today and returns a fresh plain object, so only the one number it carries
 * is folded (one index lookup), never every asset and account. The payment no-op
 * (`outstandingBalance <= 0`) and the amortisation input both read this folded value.
 */
function findLoan(draft: FamilyDocument, loanId: string, index: FoldIndex): LoanDetails | null {
  const loan = findLoanDetails(
    loanId,
    Object.values((draft.assets ?? {}) as unknown as Record<string, Asset>),
    Object.values((draft.accounts ?? {}) as unknown as Record<string, Account>)
  );
  if (!loan) return null;
  const { collection, field } = loanHost(loan);
  const host = (draft[collection] as unknown as Record<string, AnyRecord>)[loan.entityId];
  loan.outstandingBalance = foldValue(
    loan.outstandingBalance,
    sigma(index, collection, loan.entityId, field),
    0,
    fieldDecimals(resolveField(collection, field), host)
  );
  return loan;
}

/** Apply a loan payment: amortize (recurring) or extra-payment (one-time), write
 * the new balance atomically, return the host entity + interest/principal split
 * (main writes those onto the transaction via the existing repo). */
const applyLoanPaymentOp: NamedOpHandler = (draft, args, { writerId }) => {
  const index = foldIndex(draft); // once: `findLoan`'s fold and the echo both read it
  const loan = findLoan(draft, args.loanId as string, index);
  if (!loan || loan.outstandingBalance <= 0) return { result: { applied: false }, deltas: [] };
  const res = args.isRecurring
    ? calculateAmortization(
        loan.outstandingBalance,
        loan.interestRate,
        args.paymentAmount as number
      )
    : calculateExtraPayment(loan.outstandingBalance, args.paymentAmount as number);
  const moved = adjustLoanBalance(
    draft,
    loan,
    res.newBalance - loan.outstandingBalance,
    writerId,
    index
  );
  if (!moved) return { result: { applied: false }, deltas: [] };
  const { collection, entity, delta } = moved;
  return {
    result: {
      applied: true,
      hostCollection: collection,
      host: entity,
      interestPortion: res.interestPortion,
      principalPortion: res.principalPortion,
    },
    deltas: [delta],
  };
};

/** Reverse a loan payment: restore the principal portion to the balance. */
const reverseLoanPaymentOp: NamedOpHandler = (draft, args, { writerId }) => {
  const index = foldIndex(draft); // once: `findLoan`'s fold and the echo both read it
  const loan = findLoan(draft, args.loanId as string, index);
  if (!loan) return { result: { applied: false }, deltas: [] };
  const restored = loan.outstandingBalance + (args.principalToRestore as number);
  const moved = adjustLoanBalance(draft, loan, restored - loan.outstandingBalance, writerId, index);
  if (!moved) return { result: { applied: false }, deltas: [] };
  const { collection, entity, delta } = moved;
  return {
    result: { applied: true, hostCollection: collection, host: entity },
    deltas: [delta],
  };
};

/** Replace the settings singleton (`doc.settings` is `Settings | null`, not a
 * collection map — so `set`/`patch` don't fit). Emits a `settings` delta. */
const setSettingsOp: NamedOpHandler = (draft, args) => {
  (draft as unknown as AnyRecord).settings = args.settings;
  const settings = toPlain(draft.settings ?? null);
  return { result: settings, deltas: [{ kind: 'settings', settings }] };
};

/**
 * MERGE a partial into the settings singleton, inside the worker, against the AUTHORITATIVE
 * document (#95 fix, 2026-10-01). `setSettings` replaces the whole object, and every repository
 * writer used to build that object from the MAIN-THREAD projection; in the window after the
 * worker has loaded the document but before the projection has hydrated, that read returns
 * the defaults, so the first boot-time write (the exchange-rate refresh) replaced a family's
 * settings with defaults-plus-one-field and silently dropped every field that has no default,
 * the plan token first among them. Merging here cannot read anything stale: the draft IS the
 * document. `deleteKeys` is the explicit way to clear a field; an absent key is left alone.
 */
const patchSettingsOp: NamedOpHandler = (draft, rawArgs) => {
  const args = rawArgs as PatchSettingsArgs;
  const ctx: ReconcileContext = { writes: 0, notes: [] };
  const d = draft as unknown as AnyRecord;
  // PER KEY, never a whole-map assignment: two devices patching DIFFERENT fields concurrently
  // (a pasted plan token here, a rate refresh there) must both survive the CRDT merge, and
  // Automerge only merges field-wise when the fields themselves are the writes. A whole-map
  // assignment would make the two patches a conflict on `settings` and keep one of them.
  // And per ITEM inside each key (#117): arrays (`exchangeRates`, `preferredCurrencies`, ...)
  // and map-like objects (`aiApiKeys`, `helpfulHintLeadDays`) are reconciled in place against
  // `base`, so two devices each adding a rate both keep theirs.
  // A document with no settings yet (a fresh family's first write) starts from the DEFAULTS the
  // caller passes, so the document carries the full settings object, as every reader of the
  // raw document (exports, the .beanpod file, the E2E bridge) expects. Never applied to an
  // existing object: that would reset real values. Defaults come in as an argument because this
  // runs in the worker, which must not import main-thread modules.
  if (!d.settings || typeof d.settings !== 'object') {
    d.settings = { ...(args.defaults ?? {}) };
    ctx.writes++;
  }
  const target = d.settings as AnyRecord; // re-read: the doc holds the proxy, not the literal
  reconcileFields(target, args.patch ?? {}, args.base, args.deleteKeys ?? [], ctx);
  // Only on a write, matching `patch`: an all-unchanged save leaves the heads alone, so it
  // schedules no persist and no Drive save.
  if (args.updatedAt && ctx.writes > 0) target.updatedAt = args.updatedAt;
  const settings = toPlain(draft.settings ?? null);
  return {
    result: settings,
    deltas: [{ kind: 'settings', settings }],
    notes: scopeNotes('settings', ctx.notes),
  };
};

/** Register the core domain ops. Called at module load + re-registered after a
 * test reset, so production + tests always have them (plugins like photo attach
 * register separately). */
export function registerCoreNamedOps(): void {
  registerNamedOp('applyGoalContribution', applyGoalContributionOp);
  registerNamedOp('applyLoanPayment', applyLoanPaymentOp);
  registerNamedOp('reverseLoanPayment', reverseLoanPaymentOp);
  registerNamedOp('setSettings', setSettingsOp);
  registerNamedOp('patchSettings', patchSettingsOp);
}
registerCoreNamedOps();

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * What one `applyMutation` accumulates across its (possibly batched) ops. ONE object rather
 * than a positional parameter per accumulator, so the next one is a field, not a signature
 * change at every recursion.
 *  - `deltas`: named ops build their own projection deltas (structural ops' are built
 *    afterwards from the committed doc);
 *  - `results`: named ops' results, in order (a top-level named op returns the first);
 *  - `notes`: reconciler findings (#117), logged on main;
 *  - `writerId`: the Automerge actor, read once per `applyMutation` (#117 writer flip): the
 *    Counter writer id for `increment` and every named handler's `NamedOpContext`;
 *  - `carrySuperseded`: foreign `carry` ops that met an existing register and stood down (the
 *    register rule, #117 writer flip). Only the rebase emits carries.
 */
interface MutationSink {
  deltas: ProjectionDelta[];
  results: unknown[];
  notes: ReconcileNote[];
  readonly writerId: string;
  carrySuperseded: number;
}

/**
 * The entity a `set` assigns: for a Counter collection, the caller's (folded) entity unfolded
 * into raw space, so it reads back as sent even under an id with stale Counter keys (#117
 * Phase 2, plan §C). The identity whenever the entity has no keys (every create, seed and
 * rebase `set`), and `unfoldPatch` copies rather than mutates: inline mode hands the worker
 * the caller's own op object. `deltaFor`'s echo keeps returning `op.entity`, which is what the
 * fold of the stored raw value reads back as.
 */
function unfoldSetEntity(draft: FamilyDocument, op: Extract<MutationOp, { op: 'set' }>): unknown {
  if (!isCounterCollection(op.collection) || !isPlainObject(op.entity)) return op.entity;
  const stored = (draft[op.collection] as AnyRecord | undefined)?.[op.id];
  return unfoldPatch(op.collection, op.id, op.entity, undefined, foldIndex(draft), stored).patch;
}

/** Mutate the draft for one op (recurses for `batch`). Pure structural mutation
 * — the projection deltas are built afterwards from the COMMITTED doc (reading a
 * mid-change proxy is fragile). Named ops contribute their deltas to the sink. */
function mutateDraft(draft: FamilyDocument, op: MutationOp, sink: MutationSink): void {
  switch (op.op) {
    case 'set':
      (draft[op.collection] as AnyRecord)[op.id] = unfoldSetEntity(draft, op);
      break;
    case 'patch': {
      const col = draft[op.collection] as Record<string, AnyRecord>;
      const ctx: ReconcileContext = { writes: 0, notes: [] };
      let entity = col[op.id];
      if (!entity) {
        switch (op.onMissing ?? 'throw') {
          case 'skip':
            return; // no-op: tolerates the concurrent-delete race (echoes undefined)
          case 'create':
            col[op.id] = {};
            entity = col[op.id]; // re-read: the assigned `{}` is detached; the doc holds the proxy
            ctx.writes++;
            break;
          default:
            throw new Error(`patch: ${op.collection}/${op.id} not found`);
        }
      }
      // A programming error, never data to reconcile into: throw, so the worker's error path
      // surfaces it (toast + report on main) rather than the edit vanishing quietly.
      if (!isPlainObject(entity)) {
        throw new Error(`patch: ${op.collection}/${op.id} is not an object`);
      }
      // Fine-grained, three-way (#117, ADR-039): only what the caller changed relative to
      // `base` is written, in place, so a concurrent edit to the same array or object survives
      // the merge instead of losing to a whole-value assignment.
      // #117 Phase 2: a BASED patch is main-thread (folded) space; the unfold converts its
      // Counter fields to raw (stored) space first, so the reconciler compares raw to raw and
      // never meets a Counter. A base-less patch is raw by contract (the rebase composer).
      const { patch, base } =
        op.base && isCounterCollection(op.collection)
          ? unfoldPatch(op.collection, op.id, op.patch, op.base, foldIndex(draft), entity)
          : op;
      reconcileFields(entity, patch, base, op.deleteKeys ?? [], ctx);
      // Only on a write: an all-unchanged patch must leave the heads untouched so `mutate`
      // reports `changed: false` (no persist, no Drive save).
      if (op.updatedAt && ctx.writes > 0) entity.updatedAt = op.updatedAt;
      sink.notes.push(...scopeNotes(op.collection, ctx.notes));
      break;
    }
    case 'delete':
      delete (draft[op.collection] as AnyRecord)[op.id];
      break;
    case 'increment': {
      // An unknown field throws FIRST, even on `onMissing: 'skip'`: a numeric field outside
      // `COUNTER_FIELDS` would otherwise take an absolute path and lose concurrent adjustments.
      resolveField(op.collection, op.field);
      const entity = (draft[op.collection] as Record<string, AnyRecord>)[op.id];
      if (!entity) {
        if ((op.onMissing ?? 'throw') === 'skip') return; // concurrent-delete race → no-op
        throw new Error(`increment: ${op.collection}/${op.id} not found`);
      }
      // #117 Phase 2: a Counter increment with writes on (merge-safe), today's atomic
      // read-modify-write of the absolute with writes off; both in integer minor units.
      // C9c: stamp only on a real write, so a zero-delta adjustment leaves the heads alone.
      const wrote = adjustField(draft, op.collection, op.id, op.field, op.delta, sink.writerId);
      if (wrote && op.updatedAt) entity.updatedAt = op.updatedAt;
      break;
    }
    case 'carry': {
      // #117 writer flip: a rebase CARRY REGISTER (counterFields rule 5). The composer built the
      // full name; nothing is parsed or named here. An entity the compactor deleted is skipped,
      // exactly as `onMissing: 'skip'` does for the entity ops.
      const entity = (draft[op.collection] as unknown as Record<string, AnyRecord> | undefined)?.[
        op.id
      ];
      if (!entity) return;
      const map = (draft as { counterDeltas?: Record<string, unknown> }).counterDeltas;
      if (!map) {
        throw new Error(
          `carry: the document has no counterDeltas map (${op.collection}). ` +
            `Run migrateDoc on every document before writing.`
        );
      }
      // THE REGISTER RULE: own actor overwrites (its growth was computed without the register,
      // so the fold becomes exactly its view), foreign fills. Between two foreign copies
      // nothing says which is fresher, so the first stands and this one is counted.
      if (map[op.name] !== undefined && !op.exact) {
        sink.carrySuperseded++;
        return;
      }
      // A PLAIN INTEGER, never a Counter and never `.increment`: a register is put-only.
      map[op.name] = op.minor;
      break;
    }
    case 'batch':
      for (const sub of op.ops) mutateDraft(draft, sub, sink);
      break;
    case 'named': {
      const handler = namedRegistry.get(op.name);
      if (!handler) throw new Error(`named op not registered: ${op.name}`);
      const { result, deltas, notes } = handler(draft, op.args, { writerId: sink.writerId });
      sink.deltas.push(...deltas);
      sink.results.push(result);
      if (notes) sink.notes.push(...notes);
      break;
    }
  }
}

/** Build the projection delta for one op by reading the COMMITTED post-change doc. `index` is
 * `foldIndex(after)`, built once per `applyMutation` and shared down the batch recursion. */
function deltaFor(after: Doc, op: MutationOp, out: ProjectionDelta[], index: FoldIndex): unknown {
  switch (op.op) {
    case 'set':
      out.push({ kind: 'upsert', collection: op.collection, id: op.id, entity: op.entity });
      return op.entity;
    case 'patch':
    case 'increment':
    case 'carry': {
      // An absent target post-change means the op was skipped (onMissing:'skip') or the entity
      // was deleted earlier in the same batch: `entityDelta` syncs the projection to reality
      // with a `remove`, and the echo is `undefined` so callers can detect the skip. Only
      // reachable for a skipped/deleted target, never a live entity.
      const delta = entityDelta(after, op.collection, op.id, index);
      out.push(delta);
      return delta.kind === 'upsert' ? delta.entity : undefined;
    }
    case 'delete':
      out.push({ kind: 'remove', collection: op.collection, id: op.id });
      return true;
    case 'batch': {
      for (const sub of op.ops) deltaFor(after, sub, out, index);
      return undefined;
    }
    case 'named':
      return undefined; // named handler already contributed its deltas
  }
}

/**
 * Apply a declarative mutation. Returns the new doc, the affected entity
 * (`result`, for read-after-write), the projection delta, and the reconciler's
 * `notes` (#117; empty when there is nothing to report). A `batch` (and a
 * single op) is exactly ONE `Automerge.change` → atomic: a mid-batch throw
 * commits nothing.
 *
 * The rebase replay (`applyAndProject`) ignores `notes` on purpose: its ops are
 * composed from document reads, never from a caller, and its losses are
 * already counted in `conflicts`.
 */
export function applyMutation(
  doc: Doc,
  op: MutationOp
): {
  doc: Doc;
  result: unknown;
  delta: ProjectionDelta;
  notes: ReconcileNote[];
  /** Foreign `carry` ops the register rule stood down (#117 writer flip; rebase only). */
  carrySuperseded: number;
} {
  // The Counter writer id (the actor alone, #117 writer flip): read once, before the change
  // (the change keeps the actor).
  const sink: MutationSink = {
    deltas: [],
    results: [],
    notes: [],
    writerId: Automerge.getActorId(doc),
    carrySuperseded: 0,
  };
  const after = Automerge.change(doc, (d) => mutateDraft(d as FamilyDocument, op, sink));
  const out: ProjectionDelta[] = [];
  const structuralResult = deltaFor(after, op, out, foldIndex(after));
  const all = [...out, ...sink.deltas];
  const delta: ProjectionDelta = all.length === 1 ? all[0]! : { kind: 'multi', deltas: all };
  // A top-level `named` op returns its handler's result (the echoed entity for
  // read-after-write); structural ops return the affected entity.
  const result = op.op === 'named' ? sink.results[0] : structuralResult;
  return { doc: after, result, delta, notes: sink.notes, carrySuperseded: sink.carrySuperseded };
}

/**
 * Compose the peer's unsynced work as ops that can be replayed onto a document
 * of a DIFFERENT lineage (Stage 3, R1).
 *
 * ⚠️ A PURE COMPOSER. It reads two documents and returns a `MutationOp`; it
 * mutates nothing. The caller applies it with `applyMutation`, which is exactly
 * one `Automerge.change`, so the whole replay lands atomically or not at all.
 *
 * ⚠️ IT IS STRUCTURALLY INCAPABLE OF WRITING `podLineage`. `MutationOp`'s
 * `collection` is typed `CollectionName`, which EXCLUDES the non-collection
 * keys, and the only op it emits that writes a singleton is
 * `named:patchSettings`, which writes into `settings` and nothing else. That is
 * what makes it safe to replay onto the compacted document at all: an op that
 * stamped the OLD lineage onto the NEW document would be self-inflicted lineage
 * corruption with no external cause. `touchedBetween` ignoring `podLineage` is
 * the second belt. The Counter pass (#117 writer flip) emits `carry` ops, whose
 * only non-collection write is a plain-integer register in `counterDeltas`.
 *
 * ⚠️ THE COUNTER PASS CARRIES, IT NEVER INCREMENTS, AND NO KEY HAS AN OWNER (#117 writer
 * flip, plan §B-C; `counterFields` rule 5). The mode is decided ONCE, from the target's
 * lineage, reusing `before` as the baseline:
 *  - RESTORE RULE (`baseline`): the target's `restoreSeq` is above the peer's own `seq`, so the
 *    peer predates a restore; growth is `local − before` per canonical key (only what this peer
 *    has not synced), signed for every key. Never window-blocked (it reads no ledger).
 *  - LEDGER RULE (`ledger`): growth against the target's fold ledger (`targetKnowledge`) for
 *    every key, when the peer is FRESH (it holds every `fromHeads` change the compactor folded,
 *    `Automerge.hasHeads`).
 *  - LEDGER + BASELINE (`ledger+baseline`): a non-fresh peer keeps the ledger rule for its OWN
 *    keys and takes the baseline rule for foreign ones, whose copy may be stale in either
 *    direction (plan Requirement 4, amended in the build). Nothing is skipped or sign-filtered.
 *  A ledger-reading peer more than `LEDGER_WINDOW` generations behind that holds Counter keys is
 *  blocked (`ledger-window`): a pruned entry would read as "never folded".
 *
 * ⚠️ TWO DIFFERENT EMPTY ANSWERS, and conflating them costs a family a working
 * sync. `null` means CANNOT COMPOSE — an unexpected diff shape, or a baseline
 * this history does not contain — and the caller must fall back to the block it
 * was replacing. `{ op: null }` means NOTHING TO REPLAY: the peer is level with
 * its baseline (or moved only on ignored singletons, which a `migrateDoc` alone
 * can do), so adopting the remote outright loses nothing and blocking would
 * strand it for no reason.
 *
 * Shallow field comparison is deliberate: the composer decides WHICH fields to
 * carry, and the worker's `patch`/`patchSettings` reconciler (#117) then writes
 * each one in place against the target, per item for arrays and per key for
 * `MERGE_FIELDS` such as `asset.loan`. See `docs/adr/039-fine-grained-crdt-writes.md`.
 *
 * Three rules from the data-layer audit (2026-10-03), each pinned in `rebase.test.ts`:
 *  - C8: AN ID-KEYED ARRAY BOTH SIDES CHANGED IS UNIONED, NOT DROPPED. `manualContributions`,
 *    `exchangeRates` and every array whose items carry an `id` (or a `KEY_FIELDS` key) ride a
 *    SECOND, BASED patch (`base` = the peer's baseline value), so the list reconciler applies
 *    the peer's own inserts and removals and leaves the compactor's alone. A keyless array still
 *    counts a conflict.
 *  - C8: A TRANSACTION CONFLICT MAKES THE REBASE UNAVAILABLE. A transaction and its balance,
 *    goal or loan effects are written as a pair; settling the transaction as a conflict while
 *    its Counter growth crosses would move money with no record (or a record with no money).
 *    `blockedBy: 'transactions'` sends the caller to the block it would otherwise have raised.
 *    Round 3 narrowed it: only an EXISTENCE conflict or a conflict on a money/derived field
 *    (`transactionFields.ts`) blocks; a note or category conflict settles target-wins, counted.
 *    And a goal's Counter growth is emitted only when its contribution history crossed with it.
 *  - C9d/g: `updatedAt` is never a conflict (it is carried, newest wins, only beside a real
 *    field), and a Counter-backed ABSOLUTE both sides moved is carried as a SHIFT.
 */
export function buildRebaseOps(
  local: Doc,
  baselineHeads: Heads,
  target: Doc
): {
  op: MutationOp | null;
  /** Ops replayed, Counter carries included. */
  count: number;
  conflicts: number;
  /** Of `count`, the `carry` ops the Counter pass emitted (one per canonical key). */
  counterCarries: number;
  /** Which knowledge the Counter pass subtracted (`CounterRebaseMode`). */
  rebaseMode: CounterRebaseMode;
  /** The peer held every `fromHeads` change, so its foreign keys read the ledger too. */
  fresh: boolean;
  /** Set when the replay must not run at all (`RebaseBlock`): the caller blocks, as for `null`. */
  blockedBy?: RebaseBlock;
} | null {
  // ⚠️ AN EMPTY BASELINE IS NOT "THE BEGINNING OF TIME", IT IS "UNKNOWN".
  // `decodeHeadsFingerprint('')` legitimately answers `[]` for a document with
  // no heads, and `Automerge.hasHeads(doc, [])` is TRUE, so without this the
  // composer would diff from the empty document, mark every entity as new, and
  // emit a `set` for the peer's ENTIRE document over the compacted target —
  // discarding everything the compactor did after the baseline. It only failed
  // safe before by accident, via a `toPlain` throw on the empty view's absent
  // settings; fixing that throw is what makes this guard load-bearing.
  if (baselineHeads.length === 0) return null;

  // The peer's own history must contain the baseline, or "what changed since"
  // has no meaning. `hasHeads` answers that without materializing anything.
  if (!Automerge.hasHeads(local, baselineHeads)) return null;

  let before: Doc;
  try {
    before = Automerge.view(local, baselineHeads) as Doc;
  } catch {
    return null;
  }

  const scan = touchedBetween(local, baselineHeads, getHeads(local));
  if (!scan) return null;

  // #117 writer flip: the Counter pass's knowledge per kind of key, decided ONCE (plan §C and
  // Requirement 4). `before` IS the baseline rule's knowledge; no second `Automerge.view`.
  const tl = docLineage(target);
  const localSeq = docLineage(local)?.seq ?? 0;
  const targetSeq = tl?.seq ?? 0;
  const restoreRule = tl?.restoreSeq !== undefined && tl.restoreSeq > localSeq;
  const fresh =
    !restoreRule && Array.isArray(tl?.fromHeads) && Automerge.hasHeads(local, tl.fromHeads);
  const rebaseMode: CounterRebaseMode = restoreRule
    ? 'baseline'
    : fresh
      ? 'ledger'
      : 'ledger+baseline';
  const baseline = baselineKnowledge(before);
  const ledger = restoreRule ? baseline : targetKnowledge(target, localSeq, targetSeq);
  const knowledge: GrowthKnowledge = { exact: ledger, foreign: fresh ? ledger : baseline };
  // Only where the ledger is read: beyond the window a folded key may have been pruned, and its
  // absence would read as "never folded" (a double count). A peer with no Counter keys has
  // nothing the ledger decides, so it rebases at any distance.
  const windowBlocked =
    !restoreRule && tl !== null && tl.seq - localSeq > LEDGER_WINDOW && foldIndex(local).size > 0;
  const counterFigures = { rebaseMode, fresh };

  const ops: MutationOp[] = [];
  /** Writes that could not be carried across. The saved value stayed. */
  let conflicts = 0;
  /** C8: a transaction lost a write, so the whole replay is unavailable. */
  let blockedBy: RebaseBlock | undefined;
  /**
   * Round 3 (C8 narrowing): an EXISTENCE conflict (delete vs edit, a resurrection) on a
   * transaction always blocks; a FIELD conflict blocks only on a money or derived field
   * (`rebaseBlockingTransactionConflict`). Every other conflict settles target-wins and is
   * counted, exactly as on any other collection. `blocks` says which this is.
   */
  const noteConflicts = (collection: CollectionName, n: number, blocks = true): void => {
    if (n <= 0) return;
    conflicts += n;
    if (collection === 'transactions' && blocks) blockedBy = 'transactions';
  };
  /** C8: goals whose contribution history did NOT cross; their Counter growth must not either. */
  const growthHeldBack = new Set<string>();
  // ⚠️ COUNTER-ONLY TOUCHES FALL THROUGH THIS LOOP ON PURPOSE (#117 Phase 2). `touchedBetween`
  // reports an entity whose only change is a Counter key; it reaches `threeWayFields` with no
  // field difference (the absolute did not move) and is skipped. If the compactor deleted it,
  // it counts as a conflict below, which is honest: its adjustment is dropped by the ledger
  // pass's `onMissing: 'skip'`. The Counter work itself is that ledger pass, after this loop.
  for (const [collection, ids] of scan.touched) {
    const localColl = (local[collection] ?? {}) as AnyRecord;
    const beforeColl = (before[collection] ?? {}) as AnyRecord;
    const targetColl = (target[collection] ?? {}) as AnyRecord;
    for (const id of ids) {
      const now = localColl[id];
      const wasPresent = beforeColl[id] !== undefined;
      const inTarget = targetColl[id] !== undefined;

      // ⚠️ AN ENTITY DELETE IS A WRITE LIKE ANY OTHER, and applying the
      // three-way rule only to FIELDS left this whole level unguarded — in both
      // directions, and uncounted. A peer deleting an account the compactor had
      // just renamed destroyed that saved rename; a peer editing an account the
      // compactor had deleted resurrected it. Same inversion the field rule
      // exists to prevent, one level up.
      if (now === undefined) {
        if (collection === 'goals') growthHeldBack.add(id); // the peer deleted it
        if (!inTarget) continue; // already gone there — nothing to say
        if (!same(beforeColl[id], targetColl[id])) {
          noteConflicts(collection, 1); // the compactor wrote it after compacting; its copy stays
          continue;
        }
        ops.push({ op: 'delete', collection, id });
        continue;
      }

      if (!inTarget) {
        // The peer created it, or the compactor deleted it. Creating is safe;
        // resurrecting a deletion is not — the delete is already saved for the
        // whole family, and one device's edit must not undo it silently.
        if (wasPresent) {
          noteConflicts(collection, 1);
          continue;
        }
        ops.push({ op: 'set', collection, id, entity: toPlain(now) });
        continue;
      }

      // ⚠️ PRESENT IN THE TARGET MEANS MERGE, whatever the baseline says. The
      // first cut short-circuited on `!wasPresent` and wrote the peer's WHOLE
      // entity — so an entity the peer received from a third device, and the
      // compactor then edited, was reverted to the peer's older copy. With no
      // baseline for it we cannot attribute changes, so the conservative
      // reading applies: carry only fields the target does not have, and treat
      // the rest as conflicts rather than reverting saved data.
      //
      // ⚠️ AND THAT READING NEEDS ITS OWN FUNCTION, not `threeWayFields` with
      // the target passed as the baseline. That looks equivalent and is its
      // exact inverse: with `before === target`, the rule "the compactor did
      // not change it, so the peer's wins" (`same(a[key], t[key])`) is true for
      // EVERY key, so the peer's older entity overwrote the saved one wholesale
      // and every target-only field landed in `deleteKeys` — with `conflicts`
      // at 0, so the telemetry reported a clean rebase while saved data was
      // being replaced. The comment above was right; the call under it did the
      // opposite.
      const patch = wasPresent
        ? threeWayFields(
            beforeColl[id],
            now,
            targetColl[id],
            0,
            shiftFor(collection, now, targetColl[id])
          )
        : carryOnlyNewFields(now, targetColl[id]);
      if (collection === 'goals' && !historyCrossed(beforeColl[id], now, targetColl[id], patch)) {
        growthHeldBack.add(id);
      }
      if (!patch) continue;
      const nowPlain = (toPlain(now) ?? {}) as AnyRecord;
      const targetPlain = (toPlain(targetColl[id]) ?? {}) as AnyRecord;
      noteConflicts(
        collection,
        patch.conflicts,
        patch.conflictKeys.some((k) =>
          rebaseBlockingTransactionConflict(k, nowPlain[k], targetPlain[k])
        )
      );
      if (Object.keys(patch.set).length || patch.deleteKeys.length) {
        ops.push({
          op: 'patch',
          collection,
          id,
          patch: patch.set,
          ...(patch.deleteKeys.length ? { deleteKeys: patch.deleteKeys } : {}),
          // Present in the target by the check above, and this runs synchronously
          // against a local document, so it cannot vanish in between.
          onMissing: 'skip',
        });
      }
      // C8: the id-keyed arrays both sides changed, as a BASED patch: the reconciler applies
      // only the peer's own changes relative to `base`, so both sides' entries survive. A
      // separate op because a based patch on a Counter collection is unfolded (main-thread
      // space), and the RAW scalars above must not be.
      const based = basedPatch(patch.based);
      if (based) ops.push({ op: 'patch', collection, id, ...based, onMissing: 'skip' });
    }
  }

  if (scan.settingsChanged) {
    // ⚠️ FIELD-MERGED, NEVER WHOLE-REPLACED. `setSettings` replaces the
    // singleton, so emitting the peer's entire settings object would silently
    // revert a currency, locale or theme the compactor changed. `patchSettings`
    // writes only the carried fields, in place. It is sent WITHOUT a `base`, so
    // the target is the base (`baseFor`): the composer's already-three-way value
    // is applied exactly, including a peer's removed rate or API key.
    const changed = threeWayFields(before.settings, local.settings, target.settings);
    if (changed && (Object.keys(changed.set).length || changed.deleteKeys.length)) {
      const args: PatchSettingsArgs = { patch: changed.set, deleteKeys: changed.deleteKeys };
      ops.push({ op: 'named', name: 'patchSettings', args });
    }
    // C8: `exchangeRates` and other keyed arrays both sides changed, unioned through `base`.
    const based = changed ? basedPatch(changed.based) : null;
    if (based) ops.push({ op: 'named', name: 'patchSettings', args: based });
    if (changed) conflicts += changed.conflicts;
  }

  // C8: a transaction that could not be carried whole means no partial replay at all. The
  // window block rides the same exit (a transaction block, when both apply, is reported).
  if (!blockedBy && windowBlocked) blockedBy = 'ledger-window';
  if (blockedBy) {
    return { op: null, count: 0, conflicts, counterCarries: 0, ...counterFigures, blockedBy };
  }

  // The Counter pass: the growth the target does not hold, as ONE `carry` op per canonical key
  // (every live key the peer holds, own or foreign; nobody owns a key). AFTER the entity ops, so
  // an entity the peer created arrives by its raw `set` before its registers land on it.
  // C8: a goal whose contribution history could not cross keeps its growth back too, so the
  // money and its receipt either both arrive or both stay. (Every growth op is a `carry`, so
  // this is the increment filter's shape, by the op's own `(collection, id)`.)
  const growthOps = counterGrowthOps(local, knowledge, targetSeq).filter(
    (op) => !(op.collection === 'goals' && growthHeldBack.has(op.id))
  );
  ops.push(...growthOps);

  // nothing to replay
  if (ops.length === 0) {
    return { op: null, count: 0, conflicts, counterCarries: 0, ...counterFigures };
  }
  return {
    op: ops.length === 1 ? ops[0]! : { op: 'batch', ops },
    count: ops.length,
    conflicts,
    counterCarries: growthOps.length,
    ...counterFigures,
  };
}

/** What a field merge carries: plain writes, deletes, the conflict count, and (C8) the id-keyed
 *  arrays to reconcile against the peer's baseline value. */
interface FieldCarry {
  set: Record<string, unknown>;
  deleteKeys: string[];
  conflicts: number;
  based: Record<string, { next: unknown; base: unknown }>;
  /**
   * Round 3 (C8 narrowing): the TOP-LEVEL keys a conflict was counted under (a nested conflict
   * is attributed to its top-level key). Lets the transaction rule block only on the fields
   * that move money (`transactionFields.ts`) instead of on any conflict at all.
   */
  conflictKeys: string[];
}

/** A `based` carry as the `patch` + `base` pair a based write takes, or `null` when empty. */
function basedPatch(
  based: FieldCarry['based']
): { patch: Record<string, unknown>; base: Record<string, unknown> } | null {
  const keys = Object.keys(based);
  if (keys.length === 0) return null;
  const patch: Record<string, unknown> = {};
  const base: Record<string, unknown> = {};
  for (const k of keys) {
    patch[k] = based[k]!.next;
    base[k] = based[k]!.base;
  }
  return { patch, base };
}

/** The Counter-backed absolutes of `collection`, as `threeWayFields` paths, with the entity's
 *  scale (C9g). `undefined` for a collection with none. */
interface ShiftSpec {
  readonly paths: readonly (readonly string[])[];
  readonly decimals: number;
}

function shiftFor(collection: string, now: unknown, target: unknown): ShiftSpec | undefined {
  if (!isCounterCollection(collection)) return undefined;
  const specs = COUNTER_FIELDS[collection] as readonly CounterField[];
  // Every Counter field of a collection is scaled by the same entity `currency`.
  return {
    paths: specs.map((f) => [...f.abs]),
    decimals: fieldDecimals(specs[0]!, toPlain(target), toPlain(now)),
  };
}

/**
 * Did a goal's contribution history make it across (C8)? True when the peer did not change it,
 * the target already agrees, or the carry includes it. False only when the peer's history
 * edit was LOST, which is when its Counter growth must stay behind with it.
 */
function historyCrossed(
  before: unknown,
  now: unknown,
  target: unknown,
  carry: FieldCarry | null
): boolean {
  const k = 'manualContributions';
  const a = (before as AnyRecord | undefined)?.[k];
  const b = (now as AnyRecord | undefined)?.[k];
  const t = (target as AnyRecord | undefined)?.[k];
  if (same(a, b) || same(b, t)) return true;
  if (!carry) return false;
  return k in carry.set || k in carry.based || carry.deleteKeys.includes(k);
}

/**
 * An array the list reconciler can merge item by item (C8): every item on every side is a
 * plain object identified by a string `id` or by its `KEY_FIELDS` entry. A keyless array (plain
 * strings, value objects) has no identity a union could respect, so it stays a conflict.
 */
function isKeyedArray(field: string, ...arrays: unknown[]): boolean {
  const keys = KEY_FIELDS[field];
  return arrays.every(
    (arr) =>
      Array.isArray(arr) &&
      arr.every(
        (item) =>
          isPlainObject(item) &&
          (typeof item.id === 'string' ||
            (keys !== undefined && keys.every((f) => typeof item[f] === 'string')))
      )
  );
}

/**
 * A THREE-WAY field merge: what did the peer change, that the compactor did not?
 *
 * ⚠️ IT IS THREE-WAY, AND A TWO-WAY DIFF HERE SILENTLY REVERTS SAVED DATA. The
 * first cut compared only baseline against local and replayed the peer's whole
 * field value. For an object-valued field that reverts the compactor's SIBLING
 * sub-fields: peer edits `loan.rate`, compactor edits `loan.term`, and replaying
 * `{rate, term}` puts `term` back to its baseline value although the peer never
 * touched it. The compactor's change was already saved to the family file; the
 * peer's was not. Destroying saved data to preserve unsaved data, silently, is
 * the worst trade this code could make.
 *
 * So each changed field is classified against the TARGET as well:
 *  - the compactor did not touch it → take the peer's value;
 *  - both changed, and both are plain objects → recurse one level and merge;
 *  - both changed, a Counter-backed absolute (C9g) → the peer's change as a SHIFT;
 *  - both changed, an id-keyed array (C8) → carried in `based` for the list reconciler;
 *  - both changed, and it cannot be merged (a keyless array, a scalar, a type
 *    change) → KEEP THE TARGET'S. The family file already holds it, and no machine
 *    can reconcile two whole-value writes. Counted, so the loss is measurable.
 *
 * ⚠️ `updatedAt` IS NEVER A CONFLICT (C9d). Every write stamps it, so two devices that edited
 * DIFFERENT fields always "both changed" it, and counting that made every rebased edit look
 * like lost work (and, for a transaction, blocked the rebase outright). It is carried only
 * beside a real field, and only when the peer's stamp is the newer one.
 */
function threeWayFields(
  before: unknown,
  now: unknown,
  target: unknown,
  depth = 0,
  shift?: ShiftSpec
): FieldCarry | null {
  const a = (toPlain(before) ?? {}) as AnyRecord;
  const b = (toPlain(now) ?? {}) as AnyRecord;
  const t = (toPlain(target) ?? {}) as AnyRecord;
  const set: Record<string, unknown> = {};
  const deleteKeys: string[] = [];
  const based: FieldCarry['based'] = {};
  let conflicts = 0;
  const conflictKeys: string[] = [];
  const isStamp = (key: string): boolean => depth === 0 && key === 'updatedAt';

  for (const key of Object.keys(b)) {
    if (isStamp(key)) continue; // carried below, never counted
    if (same(a[key], b[key])) continue; // the peer did not change it
    // ⚠️ AGREEMENT IS NOT A CONFLICT. Without this, two devices that wrote the
    // SAME value both counted as unmergeable — so `conflicts` measured "fields
    // where the two sides agreed", not "work that was lost". The realistic
    // trigger is a peer whose session reached Drive but whose baseline commit
    // did not land: every field it wrote would have read as a conflict.
    if (same(b[key], t[key])) continue;
    if (same(a[key], t[key])) {
      set[key] = b[key]; // the compactor did not change it — the peer's wins
      continue;
    }
    // C9g: a Counter-backed absolute both sides moved. The compaction's fold moves the
    // target's absolute without anyone editing it, so "both changed" is the NORMAL state
    // there, and keeping the target's dropped the peer's offline "set to X". The peer's own
    // change, applied to the target's value, keeps both.
    if (
      shift?.paths.some((p) => p.length === 1 && p[0] === key) &&
      typeof a[key] === 'number' &&
      typeof b[key] === 'number' &&
      typeof t[key] === 'number'
    ) {
      const v = shiftAbsolute(t[key] as number, a[key] as number, b[key] as number, shift.decimals);
      if (v !== t[key]) set[key] = v;
      continue;
    }
    // ⚠️ A DEPTH CAP. The plan says "one level"; unbounded recursion on the
    // low-memory device this tier exists to spare is not what it asked for, and
    // a pathologically nested value should degrade to a conflict rather than a
    // deep walk.
    if (
      depth < MAX_MERGE_DEPTH &&
      isPlainObject(a[key]) &&
      isPlainObject(b[key]) &&
      isPlainObject(t[key])
    ) {
      const inner = threeWayFields(a[key], b[key], t[key], depth + 1, subShift(shift, key));
      if (inner) {
        conflicts += inner.conflicts;
        if (inner.conflicts > 0) conflictKeys.push(key);
        // ⚠️ ONLY WRITE IF SOMETHING ACTUALLY MOVED. A conflicts-only recursion
        // used to assign `{...target[key]}` — writing the sub-object back to
        // exactly what it already held. That is a no-op that inflates the
        // replayed count, mints a fresh Automerge object identity, and moves the
        // heads, which flips `dirty` into a full pod re-encrypt and upload for
        // nothing.
        if (Object.keys(inner.set).length || inner.deleteKeys.length) {
          const merged = { ...(t[key] as AnyRecord), ...inner.set };
          for (const k of inner.deleteKeys) delete merged[k];
          set[key] = merged;
        }
      }
      continue;
    }
    // C8: an id-keyed array (a goal's `manualContributions`, `exchangeRates`) both sides
    // changed. The list reconciler unions it item by item against the peer's baseline value.
    if (depth === 0 && isKeyedArray(key, a[key] ?? [], b[key], t[key])) {
      based[key] = { next: b[key], base: a[key] ?? [] };
      continue;
    }
    conflicts++; // both wrote it and it cannot be merged — the saved value stays
    conflictKeys.push(key);
  }

  for (const key of Object.keys(a)) {
    if (key in b || isStamp(key)) continue;
    // The peer deleted it. Honour that only if the compactor left it alone —
    // and COUNT the case where it did not, or a delete that lost to a saved
    // write is invisible in exactly the way the field rule exists to expose.
    if (same(a[key], t[key])) deleteKeys.push(key);
    else {
      conflicts++;
      conflictKeys.push(key);
    }
  }

  const carried =
    Object.keys(set).length > 0 || deleteKeys.length > 0 || Object.keys(based).length > 0;
  if (depth === 0 && carried) carryStamp(set, a.updatedAt, b.updatedAt, t.updatedAt);

  return carried || conflicts ? { set, deleteKeys, conflicts, based, conflictKeys } : null;
}

/** `shift`'s paths under `key`, one level down (`loan.outstandingBalance` → `outstandingBalance`). */
function subShift(shift: ShiftSpec | undefined, key: string): ShiftSpec | undefined {
  if (!shift) return undefined;
  const paths = shift.paths.filter((p) => p.length > 1 && p[0] === key).map((p) => p.slice(1));
  return paths.length ? { paths, decimals: shift.decimals } : undefined;
}

/**
 * Carry the peer's `updatedAt` beside a real field (C9d): when only the peer moved it, theirs;
 * when both did, the NEWER of the two (an ISO string, so lexical order is time order); when the
 * peer did not move it, nothing.
 */
function carryStamp(
  set: Record<string, unknown>,
  before: unknown,
  peer: unknown,
  target: unknown
): void {
  if (peer === undefined || same(before, peer) || same(peer, target)) return;
  if (same(before, target)) {
    set.updatedAt = peer;
    return;
  }
  if (typeof peer === 'string' && (typeof target !== 'string' || peer > target)) {
    set.updatedAt = peer;
  }
}

/**
 * The same entity id on both sides, with NO baseline that ever held it.
 *
 * There is no third point to attribute a change to, so "who edited this field"
 * is unanswerable. Only one reading is safe: the target's values are already
 * saved to the family file and the peer's are not, so
 *
 *  - a field the target does not have is free to carry (nothing saved is at
 *    risk, and losing it would drop the peer's work for no gain);
 *  - a field both hold with the same value is a no-op;
 *  - a field both hold with DIFFERENT values is a conflict — the saved value
 *    stays, and it is counted;
 *  - nothing is ever deleted. A key the peer lacks is not evidence the peer
 *    deleted it; with no baseline, its absence says nothing at all.
 *
 * Deliberately NOT `threeWayFields(target, now, target)`. That is the inverse
 * of this rule, not a shorthand for it — see the call site.
 */
function carryOnlyNewFields(now: unknown, target: unknown): FieldCarry | null {
  const b = (toPlain(now) ?? {}) as AnyRecord;
  const t = (toPlain(target) ?? {}) as AnyRecord;
  const set: Record<string, unknown> = {};
  let conflicts = 0;
  const conflictKeys: string[] = [];

  for (const key of Object.keys(b)) {
    if (key === 'updatedAt') continue; // C9d: a stamp, never a conflict; carried below
    if (!(key in t)) {
      set[key] = b[key];
      continue;
    }
    if (same(b[key], t[key])) continue;
    conflicts++; // both hold it, differently, and nothing can attribute it
    conflictKeys.push(key);
  }
  // No baseline: the peer's stamp crosses only beside a real field, and only if it is newer.
  if (Object.keys(set).length) carryStamp(set, undefined, b.updatedAt, t.updatedAt);

  return Object.keys(set).length || conflicts
    ? { set, deleteKeys: [], conflicts, based: {}, conflictKeys }
    : null;
}

/** How deep the merge walks before treating a nested value as unmergeable. */
const MAX_MERGE_DEPTH = 2;

/** JSON-equality, via the worker's one equality (`canonicalEqual`, key-order blind). The
 * document model is pure JSON, so this is exact. */
function same(x: unknown, y: unknown): boolean {
  return canonicalEqual(x, y);
}

function isPlainObject(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Test-only: clear plugin ops but keep the core domain ops registered. */
export function __resetNamedOpsForTesting(): void {
  namedRegistry.clear();
  registerCoreNamedOps();
}
