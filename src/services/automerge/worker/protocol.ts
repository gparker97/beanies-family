/**
 * ADR-032 — the typed wire contract between the main thread (`docClient`) and
 * the Automerge Web Worker (`docWorker`). This file owns ONLY the message
 * envelope + error/delta shapes; it imports domain payload types rather than
 * re-declaring them so the wire can never drift from the entity model.
 *
 * Design:
 *   - Every request carries a correlation id (`cid`); every response echoes it.
 *   - Responses are generic (`result` + optional `delta`); the typed method
 *     wrappers live in `docClient`, keeping this contract small.
 *   - Unsolicited worker→main messages (ready / perf / log) carry NO `cid` and
 *     are distinguished by `signal`.
 *   - Typed errors survive `postMessage` via a name→{serialize,reconstruct}
 *     registry (structured-clone drops the class); unknown names fall back to a
 *     generic `DocWorkerError`.
 */
import type { CollectionName } from '@/types/automerge';
import {
  CorruptPayloadError,
  PayloadTooLargeError,
  LocalDocUnreadableError,
  CacheInitError,
  StaleBuildCounterError,
} from '@/types/sync';
import type { CacheInitStage, CacheInitLoss } from '@/types/sync';
import type { PayloadLoadError, PayloadLoadStep } from '@/types/sync';
import { PodLineageError, type LineageVerdict } from '@/services/sync/podLineage';
import type { PodLineage } from '@/types/models';
import type { ReconcileNote } from './reconcile';
import type { RemoteBaselineRow } from '@/services/sync/remoteBaseline';
// Type-only: erased on main, so the main bundle never pulls `counterFields`' Automerge import.
import type { CounterStats } from './counterFields';

/** Automerge heads — the change-frontier hashes. Opaque to the main thread. */
export type Heads = string[];

/**
 * What `exportEncryptedPayload` hands main. ONE declaration, imported by both
 * the worker function and the `docClient` wrapper. The two sides used to
 * hand-write the same literal independently with nothing cross-checking them;
 * if the client learns `lineage` and the worker forgets to return it, the
 * destructure yields `undefined`, typed by a lying declaration, and every save
 * writes 4.0 for a compacted pod. A type here makes that a compile error.
 */
export interface ExportedPayload {
  payload: string;
  heads: Heads;
  /** The document's lineage at export; `null` for a never-compacted family. */
  lineage: PodLineage | null;
  /**
   * The document holds Counter keys or a fold ledger (#117): `beanpodVersionFor` writes 6.0.
   * Optional so an older worker double degrades to "no" (today's label), never a throw.
   */
  hasCounters?: boolean;
}

// ─── Projection deltas (worker → main, applied before an RPC resolves) ───────

/**
 * A change to apply to the main-thread projection mirror. Kept entity-level for
 * edits (O(1) surgical apply — no whole-collection re-clone) and `bulk` only for
 * first-load / merge, where the worker streams a collection in slices.
 */
export type ProjectionDelta =
  | { kind: 'upsert'; collection: CollectionName; id: string; entity: unknown }
  | { kind: 'remove'; collection: CollectionName; id: string }
  | { kind: 'settings'; settings: unknown }
  /** A slice of one collection. `reset` on the FIRST slice clears it first. */
  | { kind: 'bulk'; collection: CollectionName; reset: boolean; entities: Array<[string, unknown]> }
  /** Several deltas applied together (one batch op, or a multi-collection merge). */
  | { kind: 'multi'; deltas: ProjectionDelta[] };

/**
 * What the caller can tell the worker about ITS OWN document's standing.
 *
 * ⚠️ REQUIRED, and exhaustive, so a merge cannot be reached without stating one.
 * The old `adopt = false` boolean was a second entry point with a default, and a
 * default is a decision nobody made.
 *
 * ⚠️ `no-local-document` is NOT a lineage verdict. Three store paths force a
 * wholesale install because the worker may be holding a DIFFERENT family's
 * document. If they said `user-file`, a `same` verdict would return `merge` and
 * the remote would be CRDT-merged into a foreign family's document — durable
 * cross-family corruption. Two orthogonal questions, two arms.
 *
 * ⚠️ `heads`, never a fingerprint string: `remoteBaseline.ts` is type-imported
 * by worker code and must stay value-free so those imports are erased. Main
 * decodes; the worker compares heads.
 */
export type LineageBasis =
  | { kind: 'no-local-document' }
  /**
   * ⚠️ `user-file` CARRIES HEADS TOO, and omitting them made the whole
   * "an explicit choice should not be the destructive one" fix a no-op. The
   * worker needs a baseline to REBASE; with no heads on this arm the rebase was
   * structurally unreachable and every user-file open fell through to a
   * wholesale adopt — exactly the behaviour the policy change was meant to
   * replace. The producer had the heads in hand and threw them away.
   */
  | { kind: 'user-file'; heads: string[] | null }
  | { kind: 'baseline'; heads: string[] | null };

/**
 * What `mergeRemoteEnvelope` answers — THE contract, declared once.
 *
 * ⚠️ IT WAS HAND-COPIED FIVE TIMES: the worker's return annotation, `docClient`'s
 * declared return, a `MergeResult` local inside that same function,
 * `MergeTerminusOutcome`, and a `merged` local in `syncService`. Five places to
 * check when asking "what does a merge return?", and five chances to disagree — a
 * field added to the worker and forgotten in `syncService`'s copy is dropped
 * silently, because that copy is an annotation on a value that already has the
 * field. This is that declaration; the two deliberately-LOOSER views below name it.
 *
 * The optional fields are optional for a reason worth keeping: **the presence of
 * the field is itself the answer**. `replayed` only exists on a rebase, so a
 * consumer testing `replayed !== undefined` is asking "did a rebase happen?" —
 * which is why they are not defaulted to 0.
 */
export interface MergeOutcome {
  action: 'merged' | 'adopted' | 'kept-local' | 'rebased';
  heads: Heads;
  dirty: boolean;
  changed: boolean;
  remoteHeads: Heads;
  /** How many ops a rebase replayed. Absent on every other action. */
  replayed?: number;
  /** Fields both sides wrote that could not be merged; the saved value stayed. */
  conflicts?: number;
  /**
   * The policy asked for a rebase and it could not run, so this outcome is a
   * fallback rather than the policy's own answer. Diagnostic only — nothing
   * branches on it. `user-file` adopts only; every other context throws.
   */
  rebaseUnavailable?: true;
  /** Why the rebase could not run, when the composer said (C8): `'transactions'`. */
  rebaseConflictKind?: 'transactions';
  /**
   * A RESTORE (`ours-newer` × `user-file` adopt) carried this device's `removedMembers`
   * tombstones into the chosen file and deleted the matching member rows (C10), so a restore
   * cannot un-remove a member. Absent when it changed nothing.
   */
  removedMembers?: { carried: number; rowsDeleted: number };
  /**
   * Root keys (`COLLECTION_NAMES` + `settings`) holding more than one concurrent value after
   * this operation, and how many of those it introduced (#117, plan F; `countRootConflicts`).
   * A root conflict hides the losing map's entities and persists forever, so only `added > 0`
   * is news: it raises the terminus to `warn`, and on a merge it is also when the worker
   * pushed a full projection instead of deltas. Present on every action the worker returns;
   * optional so the deliberately looser views (`MergeTerminusOutcome`) can omit it.
   */
  rootConflicts?: { total: number; added: number };
  /**
   * The Counter map's shape after this operation (#117 Phase 2, `counterStats`): live keys,
   * keys two writers shared (`conflicts`, a bug, raises the terminus to `warn`), keys this build
   * cannot read (`malformed`, info only: they persist until compaction) and the fold ledger's
   * size. Present on every action the worker returns; optional for the looser views.
   */
  counterStats?: CounterStats;
  /** Of `replayed`, the Counter `increment` ops the rebase's ledger pass emitted. `rebased` only. */
  counterIncrements?: number;
}

/** What a cache replay did (C5c, data-layer audit 2026-10-03). Main logs it as `cache-replay`. */
export interface CacheReplay {
  /** Anything was skipped or left pending: `droppedIncrements > 0 || missingDeps > 0`. */
  recovered: boolean;
  /** Increment rows that would not decrypt, unframe or apply. Kept on disk, never replayed. */
  droppedIncrements: number;
  /** Change hashes the replayed document depends on and does not hold (`getMissingDeps`). */
  missingDeps: number;
  /** Increment rows read. */
  incrementCount: number;
  /**
   * The cache's BASE was proven corrupt under a live same-family document, so the cache was
   * deleted and re-seeded from that document (C5e). Absent otherwise.
   */
  corruptBaseReplaced?: true;
  /**
   * Round 3: the cache held another LINEAGE than the live same-family document, so it was not
   * merged in; the live document was kept and the cache superseded. Main logs
   * `cache-lineage-stale`.
   */
  lineageStale?: true;
  /** Round 3 (C5a): the base would not decrypt on 3 consecutive opens and was re-seeded. */
  baseReseeded?: 'repeated-decrypt-failure';
  /**
   * Round 3: rows reported for the FIRST time this open (newly quarantined, or newly seen
   * waiting on missing deps). Only these page; a row already reported is logged, not paged.
   */
  newlyReported?: number;
  /** Round 3: increment rows moved out of replay (`qinc:*`) this open. */
  quarantined?: number;
  /** Round 3: the missing-deps fence gave up after 3 opens and the base was rewritten. */
  fenceGaveUp?: true;
}

/** What `initAndLoadCache` answers. `replay` is present whenever a cache was read. */
export interface InitAndLoadResult {
  loaded: boolean;
  remoteBaseline: RemoteBaselineRow | null;
  replay?: CacheReplay;
}

// ─── Mutation ops (main → worker; the `changeDoc` closures, made declarative) ─

export type MutationOp =
  | { op: 'set'; collection: CollectionName; id: string; entity: unknown }
  | {
      op: 'patch';
      collection: CollectionName;
      id: string;
      patch: Record<string, unknown>;
      deleteKeys?: string[];
      /** Stamped onto the entity ONLY when the patch actually wrote something (#117), so an
       *  all-unchanged patch leaves the heads untouched and reports `changed: false`. */
      updatedAt?: string;
      /**
       * The snapshot `patch` was derived from (#117, ADR-039): for each patched key, the value
       * the caller read before building the new one. The worker reconciles three-way, writing
       * only the caller's own changes (`patch` vs `base`) and leaving anything the document
       * changed meanwhile (a merged peer edit, a queued write) alone. A key absent from a
       * supplied `base` is additive: it inserts and overwrites, never deletes. Omitted
       * entirely, the document itself is the base (the target becomes `patch` in place).
       * Never widens what a write touches: only the keys of `patch` are walked.
       * A patch to a `COUNTER_FIELDS` field (#117 Phase 2) WITHOUT a base is applied raw (not
       * unfolded) and is reserved for the worker's rebase composer.
       */
      base?: Record<string, unknown>;
      /** Behavior when `collection[id]` is absent (default `'throw'`):
       *  - `'throw'`  — reject (a real entity should exist; a genuine bug).
       *  - `'create'` — init `collection[id] = {}` then apply (the two-level
       *                 `notificationReads[memberId]` sub-map, whose member slice
       *                 may not exist yet).
       *  - `'skip'`   — no-op, echo `undefined` (tolerates the concurrent-delete
       *                 TOCTOU race; the caller leaves a breadcrumb). */
      onMissing?: 'throw' | 'create' | 'skip';
    }
  | { op: 'delete'; collection: CollectionName; id: string }
  /** Relative read-modify-write done atomically INSIDE one worker `changeDoc`.
   * `onMissing:'skip'` no-ops (echoes `undefined`) on the concurrent-delete race
   * instead of throwing. `updatedAt`, when supplied, is stamped onto the entity
   * (mirrors `patch`) so a cascade balance change advances the entity timestamp. */
  | {
      op: 'increment';
      collection: CollectionName;
      id: string;
      field: string;
      delta: number;
      updatedAt?: string;
      onMissing?: 'throw' | 'skip';
    }
  | { op: 'batch'; ops: MutationOp[] }
  /** Named handlers whose domain logic lives in the worker (e.g. photo attach). */
  | { op: 'named'; name: string; args: Record<string, unknown> };

/**
 * The args of the `patchSettings` named op: a per-key, three-way merge into the settings
 * singleton (#95, #117). A `type`, not an `interface`, so it is assignable to the named op's
 * `Record<string, unknown>` args.
 */
export type PatchSettingsArgs = {
  /** The fields to write. Reconciled per key against `base` (arrays per item). */
  patch: Record<string, unknown>;
  /** Fields to clear. Each counts as a write only when the field exists. */
  deleteKeys?: string[];
  /** Seeds a document that has no settings object yet; ignored once one exists. */
  defaults?: Record<string, unknown>;
  /** The snapshot `patch` was derived from (see the `patch` op's `base`). Omitted: the
   *  document's own settings are the base. */
  base?: Record<string, unknown>;
  /** Stamped onto the settings ONLY when the op wrote something. */
  updatedAt?: string;
};

// ─── Envelope ────────────────────────────────────────────────────────────────

/** A request from main → worker. `method` names the handler; `args` is its input. */
export interface RpcRequest {
  cid: number;
  method: string;
  args?: unknown;
}

/** A successful response. `delta` (when present) is applied to the projection
 * BEFORE the caller's promise resolves, so read-after-write is race-free. */
export interface RpcOk {
  cid: number;
  ok: true;
  result?: unknown;
  delta?: ProjectionDelta;
  /** `mutate` only: did the op actually change the doc? A no-op (a skipped
   * `onMissing:'skip'`, or a named op that wrote nothing) leaves heads unchanged;
   * `docClient.mutate` then skips the Drive-save trigger. Absent ⇒ treated as
   * changed (the safe default for every non-mutate response). */
  changed?: boolean;
  /** `mutate` only: what the reconciler found worth reporting (#117). The worker cannot
   * telemeter, so its findings ride the response and `docClient.mutate` logs them. Absent
   * when there is nothing to report. */
  notes?: ReconcileNote[];
  /** `mutate` only: the document's heads after the write (C12), so main can tell a respawn's
   * rehydrate that lost an acknowledged write. */
  heads?: Heads;
}

/** What one dispatched RPC hands back before the envelope wraps it: `RpcOk` minus the
 * correlation fields. ONE declaration shared by `dispatch`, the worker loop, the inline
 * bridge and `docClient`'s executor type, so a new response field cannot be carried on one
 * path and dropped on another. */
export type DispatchReply = Omit<RpcOk, 'cid' | 'ok'>;

export interface RpcErr {
  cid: number;
  ok: false;
  error: SerializedError;
}

export type RpcResponse = RpcOk | RpcErr;

/** Which cache OPERATION failed + its error class — small triage detail carried on
 * a `cache-persist-failed: true` signal so a durability failure is diagnosable
 * blind (see docs/plans/2026-07-13-cache-persist-durability-signal.md). Only the
 * failing error's `name`, or a fixed sentinel where the failure has no `Error`
 * (a blocked delete), crosses the postMessage boundary — PII-free, no stack, no
 * message.
 *
 * `'open'` is not a write: it means the cache DB itself could not be opened or
 * re-seeded, so nothing will persist for the rest of the session. Widening this
 * union is safe — verified 2026-09-07 that NO exhaustive `switch` or `Record`
 * anywhere in the tree is keyed on `kind`; every consumer either passes it
 * through or reads only the boolean beside it. */
export interface CachePersistFailureDetail {
  kind: 'base' | 'increment' | 'open';
  errorName: string;
}

/** Outcome of a cache-DB delete. `deleted: false` means the delete was still
 *  blocked by another connection at the deadline (`CACHE_DELETE_TIMEOUT_MS`) and
 *  the encrypted cache is still on disk.
 *
 *  ⚠️ AN OBJECT, NOT A BARE BOOLEAN. This value crosses four layers and a
 *  postMessage boundary; `await docClient.clearCache(id)` returning `true` reads
 *  as "did what?" at every one of them, and a bool is the signature that quietly
 *  acquires a second meaning later. A future field joins the object instead of
 *  forcing a fifth signature change. */
export interface CacheClearResult {
  deleted: boolean;
}

/** Unsolicited worker → main messages (no correlation id). */
export type WorkerSignal =
  | { signal: 'ready' }
  | { signal: 'perf'; label: string; durationMs: number; ctx?: Record<string, number> }
  | { signal: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  /**
   * A streamed projection chunk for a first-load / remote-merge. The worker
   * posts these across successive messages (one per collection slice) BEFORE the
   * triggering RPC's response, so each is applied on the main thread as its own
   * task (no single long task) and all land before the promise resolves (the
   * load/merge barrier). `final` marks the last chunk — `docClient` bumps
   * `docVersion` once then, not per-chunk. See ADR-032.
   */
  | { signal: 'projection'; delta: ProjectionDelta; final: boolean }
  /**
   * The worker's debounced cache persist failed (or recovered). Main maps this
   * to the persistent "local durability broken" banner — the worker owns the
   * cache post-migration, so this replaces the old main-thread
   * `setCachePersistFailed` coupling. See ADR-032 (Persist/Drive split).
   */
  | { signal: 'cache-persist-failed'; failed: boolean; detail?: CachePersistFailureDetail }
  /**
   * Another context (usually another tab) deleted this family's cache, and the
   * worker has closed its connection so that delete could finish (#100). Main
   * ends this tab's session: the person asked for the family's data to leave
   * this browser, and this tab must not keep showing it or writing it back.
   * No payload: the one other `versionchange` cause (an upgrade) never leaves
   * the worker realm.
   */
  | { signal: 'cache-released' };

/** Type guards for routing an inbound worker message. */
export function isRpcResponse(m: unknown): m is RpcResponse {
  return typeof m === 'object' && m !== null && typeof (m as RpcResponse).cid === 'number';
}
export function isWorkerSignal(m: unknown): m is WorkerSignal {
  return typeof m === 'object' && m !== null && typeof (m as WorkerSignal).signal === 'string';
}

// ─── Typed error transport ───────────────────────────────────────────────────

/** A wire-safe error: plain fields only, plus a discriminant for reconstruction. */
export interface SerializedError {
  name: string;
  message: string;
  /** Extra allowlisted fields for typed errors (e.g. CorruptPayloadError.step). */
  data?: Record<string, unknown>;
}

/** Generic error for any worker failure that isn't a registered typed error. */
export class DocWorkerError extends Error {
  readonly op?: string;
  constructor(message: string, op?: string) {
    super(message);
    this.name = 'DocWorkerError';
    this.op = op;
  }
}

/**
 * The worker crashed while calls were in flight. `onWorkerError` rejects EVERY
 * pending call with this — so it's classified as an expected-degradation in
 * `surface()` (like `CorruptPayloadError`) and stays QUIET per-call: the crash is
 * surfaced exactly ONCE at the crash site, not once per drained pending RPC.
 * Awaiting callers still reject (only the duplicate toasts are suppressed).
 */
export class WorkerCrashError extends DocWorkerError {
  constructor(message: string, op?: string) {
    super(message, op);
    this.name = 'WorkerCrashError';
  }
}

interface ErrorCodec {
  serialize: (err: unknown) => Record<string, unknown> | undefined;
  reconstruct: (message: string, data: Record<string, unknown> | undefined) => Error;
}

/**
 * name → codec. Register a typed error once; new typed errors are a one-line
 * add, not new plumbing. Reconstruction preserves the class so downstream
 * `instanceof` checks (e.g. the CorruptPayloadError recovery dispatch) keep
 * working across the boundary.
 */
type PayloadErrorCtor = new (
  message: string,
  step: PayloadLoadStep,
  familyId: string | null,
  payloadBytes: number | null
) => PayloadLoadError;

/**
 * One codec for every `PayloadLoadError` subclass — they share a constructor
 * shape, so a second hand-written codec would be the same six lines waiting to
 * drift on the next field.
 */
const payloadCodec = (Ctor: PayloadErrorCtor): ErrorCodec => ({
  serialize: (err) =>
    err instanceof Ctor
      ? { step: err.step, familyId: err.familyId, payloadBytes: err.payloadBytes }
      : undefined,
  reconstruct: (message, data) =>
    new Ctor(
      message,
      (data?.step as PayloadLoadStep) ?? 'load',
      (data?.familyId as string | null) ?? null,
      (data?.payloadBytes as number | null) ?? null
    ),
});

/**
 * `PodLineageError`'s own codec — its constructor shape is (verdict, message),
 * not the payload family's (message, step, familyId, bytes), so it cannot reuse
 * `payloadCodec`.
 */
const lineageCodec: ErrorCodec = {
  serialize: (err) =>
    err instanceof PodLineageError
      ? {
          verdict: err.verdict,
          rebaseUnavailable: err.rebaseUnavailable,
          remoteMovedAfterCompaction: err.remoteMovedAfterCompaction,
          conflictKind: err.conflictKind,
        }
      : undefined,
  reconstruct: (message, data) => {
    const err = new PodLineageError((data?.verdict as LineageVerdict) ?? 'conflict', message);
    // ⚠️ ONLY SET IT WHEN TRUE. Assigning `undefined` still MINTS the own
    // property, so `'rebaseUnavailable' in err` and `{...err}` would both
    // report it on every ordinary block. Nothing reads it that way today, and
    // `toBeUndefined()` cannot tell absent from present-and-undefined — so the
    // test would not catch the day something does.
    if (data?.rebaseUnavailable === true) err.rebaseUnavailable = true;
    if (data?.remoteMovedAfterCompaction === true) err.remoteMovedAfterCompaction = true;
    if (typeof data?.conflictKind === 'string') err.conflictKind = data.conflictKind;
    return err;
  },
};

const ERROR_REGISTRY: Record<string, ErrorCodec> = {
  // ⚠️ Keys are LITERAL strings, never `Ctor.name`: the prod build minifies and
  // a mangled key would never match `serializeError`'s `err.name`, silently
  // degrading every typed error to a generic DocWorkerError on main.
  CorruptPayloadError: payloadCodec(CorruptPayloadError),
  PayloadTooLargeError: payloadCodec(PayloadTooLargeError),
  // Reconstruct to the real class so `surface()`'s `instanceof WorkerCrashError`
  // check (crash-toast dedup) works when a drained pending call rejects.
  WorkerCrashError: {
    serialize: () => undefined,
    reconstruct: (message) => new WorkerCrashError(message),
  },
  PodLineageError: lineageCodec,
  // ⚠️ REQUIRED NOW THAT THE REFUSAL IS THROWN IN THE WORKER. Without an entry
  // here the class arrives on main as a generic `DocWorkerError`, `blockCode`
  // and `inlineMessageKey` are gone, `isRemoteBlocker` returns false, and every
  // latch, banner and save-refusal that dispatches on it silently stops seeing
  // it — the refusal would protect the document and then say nothing, which is
  // the exact failure this whole change set exists to eliminate.
  //
  // Its constructor takes the failure class, and the message is rebuilt from it,
  // so `cause` is what has to survive the wire.
  LocalDocUnreadableError: {
    serialize: (err) => (err instanceof LocalDocUnreadableError ? { cause: err.cause } : undefined),
    reconstruct: (_message, data) =>
      new LocalDocUnreadableError(typeof data?.cause === 'string' ? data.cause : 'unknown'),
  },
  // ⚠️ WITHOUT THIS ENTRY THE VERDICT IS THE FIELD THAT GETS STRIPPED. The class
  // would arrive on main as a generic `DocWorkerError`, `loss` would read
  // `undefined`, and `replaceDocWithCacheRecovery`'s table lookup would land on
  // the fail-safe "refuse" arm for EVERY cache-init failure — reinstating the
  // cold-boot lockout this class exists to remove, while type-checking clean.
  CacheInitError: {
    serialize: (err) =>
      err instanceof CacheInitError
        ? { stage: err.stage, loss: err.loss, cause: err.cause }
        : undefined,
    reconstruct: (_message, data) =>
      new CacheInitError(
        // Fail SAFE on a malformed wire value: an unrecognised `loss` must mean
        // "something to lose" (refuse) rather than silently authorising a
        // wholesale install. The stage default is diagnostic only.
        data?.stage === 'load' ? 'load' : ('open' as CacheInitStage),
        (data?.loss === 'nothing-to-lose'
          ? 'nothing-to-lose'
          : 'something-to-lose') as CacheInitLoss,
        typeof data?.cause === 'string' ? data.cause : 'unknown'
      ),
  },
  // #117 Phase 2: a compaction refused over a newer build's Counter field. Without this entry
  // it arrives on main as a `DocWorkerError` and `usePodCompaction` reports it as a corrupt
  // rebuild, when the honest answer is "update the app".
  StaleBuildCounterError: {
    serialize: (err) =>
      err instanceof StaleBuildCounterError
        ? { collection: err.collection, field: err.field }
        : undefined,
    reconstruct: (_message, data) =>
      new StaleBuildCounterError(
        typeof data?.collection === 'string' ? data.collection : 'unknown',
        typeof data?.field === 'string' ? data.field : 'unknown'
      ),
  },
};

/** Convert any thrown value into a wire-safe `SerializedError`. Never throws. */
export function serializeError(err: unknown): SerializedError {
  const name = err instanceof Error && err.name ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  const codec = ERROR_REGISTRY[name];
  return { name, message, data: codec?.serialize(err) };
}

/**
 * Rebuild an Error from the wire. Registered typed errors reconstruct to their
 * real class (so `instanceof` works); everything else becomes a `DocWorkerError`
 * carrying the original name in its message.
 */
export function reconstructError(se: SerializedError, op?: string): Error {
  const codec = ERROR_REGISTRY[se.name];
  if (codec) return codec.reconstruct(se.message, se.data);
  const e = new DocWorkerError(se.name === 'Error' ? se.message : `${se.name}: ${se.message}`, op);
  return e;
}

/** Test-only: register an extra codec (kept out of the frozen default set). */
export function __registerErrorCodecForTesting(name: string, codec: ErrorCodec): void {
  ERROR_REGISTRY[name] = codec;
}
