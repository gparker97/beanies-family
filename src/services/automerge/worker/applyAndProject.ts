/**
 * ADR-032 — the stateful orchestrator shared by the worker message loop AND the
 * inline fallback (one implementation, two contexts — so debounce / dirty /
 * projection logic can't diverge). It owns the mutable state the pure `docOps`
 * deliberately don't:
 *   - `currentDoc` (the in-memory Automerge doc — the source of truth),
 *   - `familyKey` (posted once at unlock; every crypto op guards `if(!familyKey)`),
 *   - the debounced cache persist (~120 ms — short, since the whole-doc `save`
 *     is now off the main thread; not zero, since `save` is still whole-doc),
 *   - the `dirty` derivation (heads-based, on merge) and the chunked projection
 *     push (first-load / merge streamed per-collection so no single main-thread
 *     receive is a long task).
 *
 * Everything reaches the main thread through an injected `WorkerSink` (posts
 * signals in the worker; applies directly in the inline adapter). Heavy-op perf
 * is relayed via `sink.perf` — the worker CAN'T telemeter (`perfTiming`'s queue
 * flushes on `window`/`pagehide`), so `docClient` replays the samples through the
 * single main-thread buffer. See ADR-032.
 */
import * as Automerge from '@automerge/automerge';
import { docInitOpts, setDocActor, resetDocActor } from './docActor';
import { firstJsonDifference } from '@/utils/firstJsonDifference';
import {
  guardLineage,
  lineageBlockError,
  type CompactionLineage,
  type LineageContext,
} from '@/services/sync/podLineage';
import type { LineageBasis, ExportedPayload } from './protocol';
import type { PodLineage, DriveConnection, RemovedMember } from '@/types/models';
import {
  PayloadLoadError,
  CorruptPayloadError,
  LocalDocUnreadableError,
  CacheInitError,
  StaleBuildCounterError,
} from '@/types/sync';
import { withTimeout } from '@/utils/timing';
import type { CacheInitLoss } from '@/types/sync';
import { COLLECTION_NAMES, NON_COLLECTION_KEYS, type FamilyDocument } from '@/types/automerge';
import { importFamilyKey } from '@/services/crypto/familyKeyService';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import {
  docLineage,
  buildRebaseOps,
  // ⚠️ ONE NAME. This module used to import `applyMutation` TWICE — once aliased
  // as `applyMutationOp` and once bare — with each name used exactly once, so a
  // reader could not tell which was canonical.
  applyMutation as applyMutationOp,
  migrateDoc,
  loadDoc,
  saveDoc,
  mergeDocs,
  getHeads as headsOf,
  getChangesSince as changesSince,
  applyChanges as applyChangesOp,
  decryptToDoc,
  materializeCollection,
  encryptDocPayload,
  buildFullProjection,
  projectionDeltasBetween,
  frameChanges,
  registerNamedOp,
  payloadFailure,
  nextLineage,
  rootConflictSnapshot,
  rootConflictsSince,
  type RootConflictSnapshot,
} from './docOps';
import { attachPhotoNamedHandler, collectReferencedPhotoIds as collectPhotoIds } from './photoOps';
import { registerTransactionOps } from './transactionOps';
import { foldDoc, foldIndex, counterStats, type CounterStats } from './counterFields';
import * as cache from './cache';
import type { RemoteBaselineRow } from '@/services/sync/remoteBaseline';
import type {
  MutationOp,
  ProjectionDelta,
  Heads,
  MergeOutcome,
  CachePersistFailureDetail,
  CacheClearResult,
  WorkerSignal,
  DispatchReply,
  CacheReplay,
  InitAndLoadResult,
} from './protocol';
import { canonicalEqual, type ReconcileNote } from './reconcile';

type Doc = Automerge.Doc<FamilyDocument>;
type PerfCtx = Record<string, number>;

/** How the orchestrator reaches the main thread. Posts signals in the worker;
 * applies to the projection directly in the inline adapter (Task #6). */
export interface WorkerSink {
  /** Stream one projection chunk. `final` on the last chunk → main bumps once. */
  pushChunk(delta: ProjectionDelta, final: boolean): void;
  /** Relay a heavy-op timing sample (replayed through main-thread telemetry). */
  perf(label: string, durationMs: number, ctx?: PerfCtx): void;
  /** The debounced cache persist failed (or recovered) → durability banner. On a
   * failure, `detail` names which write failed + its error class (triage). */
  cachePersistFailed(failed: boolean, detail?: CachePersistFailureDetail): void;
  /** Another context deleted this family's cache; the connection is closed (#100). */
  cacheReleased(): void;
}

const NOOP_SINK: WorkerSink = {
  pushChunk() {},
  perf() {},
  cachePersistFailed() {},
  cacheReleased() {},
};

/**
 * The ONE mapping from sink calls to `WorkerSignal`s, shared by both realms.
 * The worker posts them across `postMessage`; the inline bridge hands them to
 * `docClient.receiveSignal` directly. Before #100 the worker sink, the inline
 * sink and `docClient.handleSignal` each hand-mirrored every signal, so a new
 * signal meant five edits and the inline copy had drifted (it lacked the
 * projection `reportError` guards). A signal is now defined here and handled
 * in `docClient.receiveSignal`, and nowhere else.
 */
export function postingSink(post: (sig: WorkerSignal) => void): WorkerSink {
  return {
    pushChunk(delta, final) {
      post({ signal: 'projection', delta, final });
    },
    perf(label, durationMs, ctx) {
      post({ signal: 'perf', label, durationMs, ctx });
    },
    cachePersistFailed(failed, detail) {
      post({ signal: 'cache-persist-failed', failed, detail });
    },
    cacheReleased() {
      post({ signal: 'cache-released' });
    },
  };
}

/** Entities per streamed chunk. A big collection is sliced so each `postMessage`
 * is a bounded main-thread task rather than one giant structured clone. */
const PROJECTION_CHUNK = 1000;
/** Cache-persist coalesce window. Short (off-thread now, incremental) — a safety
 * valve, not zero (batches a rapid burst of mutations into one increment write). */
const PERSIST_DEBOUNCE_MS = 120;
/** Re-compact (rewrite a fresh whole-doc base, clearing increments) once this many
 * increments sit on top of the base — bounds both cache size and cold-reload cost.
 *
 * Lowered 200 → 50 (2026-07-15) after prod CloudWatch showed `automerge.cacheLoad`
 * p50 ~21s: a cold load replays EVERY increment (`cache.loadCachedDoc`), so ≤200 was
 * ~19s of decrypt+apply over the ~2s base floor. `cacheLoad` cost scales ~linearly
 * with this value; base-rewrite frequency scales as ~(200/N) (each rewrite = a full
 * `saveDoc`+encrypt+IDB-put of the whole doc). N=50 cuts cold-load ~4× at half the
 * write-amplification of 25. The rewrite runs behind the single-flight `persistInFlight`
 * chain, debounced (`PERSIST_DEBOUNCE_MS`) off the RPC path, so it does not slow a
 * `mutate` response — but do NOT lower this further without re-checking `automerge.saveBase`
 * p95 for a save-side regression. See docs/plans/2026-07-15-compaction-primary-retire-change-chunks.md. */
const INCREMENT_COMPACTION_THRESHOLD = 50;

/** The projection snapshot is a whole-projection re-serialize+encrypt (far heavier
 * than an `inc:` delta), so it rides its OWN coarse coalescing timer — never per
 * mutate. A few seconds' staleness is fine: it only seeds next open's first paint,
 * and the authoritative rebuild always corrects it. */
const SNAPSHOT_PERSIST_DEBOUNCE_MS = 3_000;

// ─── Module state (one instance per realm — worker OR inline main) ───────────

let currentDoc: Doc | null = null;
let familyKey: CryptoKey | null = null;

/**
 * Is there anything of OURS to lose if the caller now installs the remote
 * wholesale? Answered HERE because this realm is the only one that can see both
 * the document and the state of the cache.
 *
 * ⚠️ TWO CALL SITES, TWO DIFFERENT QUESTIONS, AND SHARING ONE EXPRESSION WAS A
 * BUG. The first version asked `currentDoc || cache.isCacheReady()` at both
 * throw sites. `isCacheReady()` answers "is a DB HANDLE open" — not "does the
 * cache hold anything" — and at the load stage those come apart in the worst
 * possible direction: `clearCache` CLOSES the handle before deleting, so a
 * delete blocked by another tab (the normal state after a two-session soak)
 * leaves every `inc:*` row on disk with the handle null, and the expression
 * answered `nothing-to-lose` — authorising a wholesale install that strands
 * them. A review caught it; the suite did not.
 *
 * So each site answers its own question, in one line each.
 */

/**
 * The OPEN stage: `initPersistenceDB(id)` failed, so there is no cache handle for
 * this family and there never was one this call — `isCacheReady()` is
 * unconditionally false here and adds nothing. The only thing at risk is a
 * document already in memory.
 *
 * ⚠️ It may belong to a DIFFERENT family (the DB was never re-pointed), which is
 * exactly why the verdict is the coarse "is anything of value at risk" rather
 * than a residency claim: the answer is the same either way — do not install
 * over it without the guard.
 */
function openStageLoss(): CacheInitLoss {
  return currentDoc ? 'something-to-lose' : 'nothing-to-lose';
}

/**
 * The LOAD stage (C5a, data-layer audit 2026-10-03): the cache is cleared ONLY when its
 * payload is PROVEN corrupt — a `CorruptPayloadError` from the `load`/`materialize` step that
 * cannot be a wrong key. Everything else (an IndexedDB error, a wrong-key decrypt, an
 * unclassified throw) used to reseed too, and then reported `nothing-to-lose`, so main
 * installed the remote wholesale over a cache that was merely unreachable for a moment.
 */
function isProvenCorrupt(e: unknown): boolean {
  return (
    e instanceof CorruptPayloadError &&
    !e.keyMayBeWrong &&
    (e.step === 'load' || e.step === 'materialize')
  );
}
let sink: WorkerSink = NOOP_SINK;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let cachePersistFailed = false;
/** B1 cache-persist cursor: the heads already written to the IDB increments. `null`
 * forces the next persist to write a fresh whole-doc BASE (first persist for a doc,
 * after an adopt/replace, or a recovery). In-memory + DERIVED — never a stored row;
 * on reload it is re-derived from the reconstructed doc, so it can't drift. */
let lastPersistedHeads: Heads | null = null;
/** Single-flight chain: every persist + re-compaction runs one-at-a-time so two
 * overlapping persists (e.g. a debounce firing while `flush()` runs) can't interleave
 * their shared `seq`/`lastPersistedHeads`/row mutations. */
let persistInFlight: Promise<void> = Promise.resolve();

/** Projection-snapshot persist: own coarse timer + own single-flight chain (kept
 * separate from the doc persist so the heavy whole-projection write never rides the
 * per-mutate `inc:` path). */
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotInFlight: Promise<void> = Promise.resolve();
/** Projection-snapshot cursor: heads of the doc whose projection is already in the
 * snapshot row. Suppresses re-serializing + re-encrypting an identical projection.
 * Advanced ONLY after a successful write (see `persistSnapshotOnce`) — an eager
 * advance would let one transient IDB error silently disable snapshots for the whole
 * session, since this function swallows its failures by design. */
let lastSnapshotHeads: Heads | null = null;
/**
 * The open-guard remote baseline (#61) waiting to be committed durably: the
 * namespaced revision our doc now provably contains, set by `noteRemoteBaseline`
 * AFTER main has merged that remote state (plan C10). It is a value learned at a
 * remote-merge/write terminus and committed only inside `persistOnce`, where the
 * cache provably holds the doc it describes (C4a/C4c/C10b/C11). Cleared on every
 * doc-lifecycle reset (below) AND explicitly at the two DB-open entry points
 * (C18 — a leftover value must not be committed into a different family's cache).
 */
let pendingRemoteBaseline: string | null = null;

/**
 * Which document INSTALL the cursors above describe (C5d, data-layer audit 2026-10-03).
 * Bumped by `resetDocCursors` and by every other install site; NEVER by an ordinary edit or
 * merge, which only grow the same document.
 *
 * It replaces the `currentDoc === doc` guards. Automerge documents are immutable values, so a
 * mutation landing during a persist's IDB write made `currentDoc !== doc` true, the cursor was
 * never advanced, and every later persist re-wrote the same increment and re-compacted the
 * base. Identity answered "did anything change", where the question is "was the document
 * replaced".
 */
let docGeneration = 0;
/**
 * The next base write SUPERSEDES the cache (a new document generation was installed), so it
 * may delete every increment row; otherwise it deletes only the rows the document provably
 * contains (`cache.persistDocBinary`, C5h). Set by `resetDocCursors`, cleared by the first
 * base write of the generation and by a cache-load install.
 */
let baseSupersedes = true;
/**
 * The replayed cache was missing deps (C5c): never rewrite the base while the document
 * still depends on changes it does not hold. Re-checked on every persist, so a merge that
 * delivers the deps lifts it. Cleared at every install.
 */
let baseFence = false;
/**
 * The family whose document `currentDoc` is, when this realm knows it: set by a cache load,
 * `openCache`, and a merge or install for a named family; cleared by `initDoc`, `dropDoc` and
 * `reset`. Read only to recognise a SAME-family live document (C5e) and to decide whether a
 * pending persist may be flushed into the open cache.
 */
let docFamilyId: string | null = null;

/** How long a teardown or a cache re-point waits for an in-flight persist (C5f/g). */
const SETTLE_TIMEOUT_MS = 5_000;

/**
 * Null every in-memory, doc-derived cursor in one place.
 *
 * These cursors describe "what has already been written for the doc currently in
 * memory". The moment that doc is replaced, dropped or reset they are lies, and a
 * stale cursor is silent data loss (a skipped persist), silent staleness (a
 * skipped snapshot), or a baseline committed against the wrong doc. There are
 * five reset sites and now several cursors, so the "forgot one" bug is a matter
 * of time — every site calls this instead.
 *
 * `pendingRemoteBaseline` is cleared here for the doc-LIFECYCLE cases (drop/reset/
 * replace). The two DB-open entry points (`initAndLoadCache`/`openCache`) ALSO
 * clear it explicitly, for the distinct SCOPE concern (C18) — a leftover value
 * surviving a DB re-point without a preceding reset.
 */
function resetDocCursors(): void {
  lastPersistedHeads = null;
  lastSnapshotHeads = null;
  pendingRemoteBaseline = null;
  // C5d: any persist still in flight describes the document that was just replaced; its
  // cursor advance must not land on this one.
  docGeneration++;
  baseSupersedes = true;
  baseFence = false;
}

/**
 * Let the persist chains settle before the cache handle is closed or re-pointed (C5f/g),
 * bounded so a wedged IndexedDB can never hold a sign-out hostage. Never throws.
 *
 * `flushPending` also writes what the debounce was still holding, which is only correct when
 * the open cache is this document's own family's: flushing a different family's document into
 * it is the cross-family write the C18 guards exist to prevent.
 */
async function settlePersists(flushPending: boolean): Promise<void> {
  cancelPendingPersists();
  const work = flushPending ? enqueuePersist() : persistInFlight;
  try {
    await withTimeout(
      Promise.all([work, snapshotInFlight]).then(() => undefined),
      SETTLE_TIMEOUT_MS,
      `cache persist did not settle within ${SETTLE_TIMEOUT_MS}ms`,
      'PersistSettleTimeoutError'
    );
  } catch (e) {
    console.warn('[applyAndProject] pending cache persist did not settle in time', e);
  }
}

/** Is the open cache this document's own family's? Only then may a pending persist be flushed. */
function docOwnsOpenCache(): boolean {
  return currentDoc !== null && docFamilyId !== null && docFamilyId === cache.cacheFamilyId();
}

/**
 * Open (or reuse) `id`'s cache DB. A re-point to ANOTHER family first lets the previous
 * family's persists finish against their own handle (C5g), so none of them can land in the
 * new one.
 */
async function openCacheFor(id: string): Promise<void> {
  const open = cache.cacheFamilyId();
  if (open !== null && open !== id) await settlePersists(docOwnsOpenCache());
  await cache.initPersistenceDB(id);
}

/** Wire the sink once (worker startup / inline adapter init). Also registers the
 * photo attach/collect family here (not at module load) so it can't hit a
 * docOps `namedRegistry` TDZ under a circular import — configure runs after all
 * modules have finished loading, in whichever realm (worker OR inline). */
export function configure(nextSink: WorkerSink): void {
  sink = nextSink;
  registerNamedOp('attachPhotoToEntity', attachPhotoNamedHandler);
  // C7: the atomic transaction cascade (create/update/delete in ONE change).
  registerTransactionOps();
  // #100: another tab deleted this family's cache and `cache.ts` has already
  // closed the connection. Stop scheduling writes against it; the doc and key
  // are KEPT, because the teardown main is about to run still does a bounded
  // force-save, and `reset()` drops them a moment later. Reads `sink` at call
  // time, so a later `configure` is honoured.
  cache.setCacheReleasedListener((reason) => {
    cancelPendingPersists();
    if (reason === 'deleted') sink.cacheReleased();
    // Cannot happen today (the DB is opened at version 1 forever). Surfaced
    // through the existing durability signal rather than widening
    // `cache-released`, so it is never silent and never a new code path on main.
    else raiseCachePersistFailure('open', 'CacheUpgradeElsewhere');
  });
}

/** Cancel the debounced cache + snapshot persists. Shared by `flush`, `reset`
 * and the #100 release, so the three cannot disagree about what "pending" means. */
function cancelPendingPersists(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
}

// ─── Timing (relayed, not telemetered in-worker) ─────────────────────────────

function time<T>(label: string, fn: () => T, ctx?: PerfCtx): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    sink.perf(label, performance.now() - start, ctx);
  }
}

// ─── Cache persist (debounced + flush) ───────────────────────────────────────

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void enqueuePersist();
  }, PERSIST_DEBOUNCE_MS);
}

/** Run a persist behind the single-flight chain (never two at once). `persistOnce`
 * never rejects (it catches), so the chain never breaks. */
function enqueuePersist(): Promise<void> {
  persistInFlight = persistInFlight.catch(() => {}).then(() => persistOnce());
  return persistInFlight;
}

// ─── Projection snapshot persist (coarse, own single-flight) ─────────────────

function scheduleSnapshotPersist(): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void enqueueSnapshotPersist();
  }, SNAPSHOT_PERSIST_DEBOUNCE_MS);
}

/** Run a snapshot persist behind its own single-flight chain (never two at once;
 * never rejects — it catches). */
function enqueueSnapshotPersist(): Promise<void> {
  snapshotInFlight = snapshotInFlight.catch(() => {}).then(() => persistSnapshotOnce());
  return snapshotInFlight;
}

/** Serialize the CURRENT full projection (`buildFullProjection` — the same deltas
 * the worker streams) and persist it encrypted. Non-fatal on failure: the doc +
 * Drive remain durable, so a missing snapshot only costs a slow next open. */
async function persistSnapshotOnce(): Promise<void> {
  if (!currentDoc || !familyKey || !cache.isCacheReady()) return;
  const doc = currentDoc;
  const key = familyKey;
  const gen = docGeneration;
  // Entry snapshot — everything below is computed from THIS doc, so a mutation
  // landing mid-write cannot make us record the wrong heads (same discipline as
  // `persistOnce`).
  const captureHeads = headsOf(doc);

  // Nothing has moved since the snapshot row was written, so re-serializing and
  // re-encrypting the entire projection would produce byte-identical content.
  // The standing win is the `pagehide` backgrounding flush, which until now
  // re-wrote the whole projection on EVERY app background even when the user had
  // only read. (The open-time double-persist this also removes largely disappears
  // once the open-path Drive read is gated.)
  if (lastSnapshotHeads && headsEqual(lastSnapshotHeads, captureHeads)) return;

  try {
    const start = performance.now();
    const deltas = buildFullProjection(doc);
    await cache.persistProjectionSnapshot(key, { version: cache.SNAPSHOT_VERSION, deltas });
    // Advance ONLY on success, and only if the doc we captured is still the live
    // one — this function swallows failures, so an eager or cross-doc advance
    // would silently disable snapshots for the rest of the session.
    if (docGeneration === gen) lastSnapshotHeads = captureHeads;
    sink.perf('snapshot.persist', performance.now() - start, {
      perf_entity_count: countEntities(doc),
    });
  } catch (e) {
    // Console is the worker's only local channel; not a durability-banner event —
    // the snapshot is display-only, so its loss never risks data.
    console.warn('[applyAndProject] projection snapshot persist failed (non-fatal)', e);
  }
}

/**
 * Load + push the display-only projection snapshot for a fast first paint. Installs
 * NO `currentDoc` (the authoritative rebuild owns that). Any failure — absent,
 * version mismatch, or decrypt/parse — returns `{ hit: false, reason }` after
 * logging, so the caller falls back to the rebuild and the main thread never sees a
 * raw throw. Opens the cache DB itself (idempotent) so it does not depend on the
 * rebuild RPC having run first.
 */
async function loadProjectionSnapshot(id: string): Promise<{ hit: boolean; reason?: string }> {
  try {
    await openCacheFor(id);
    const key = requireKey('loadProjectionSnapshot');
    const snap = await time2('snapshot.workerLoad', () => cache.loadProjectionSnapshot(key));
    if (!snap) return { hit: false, reason: 'absent' };
    if (snap.version !== cache.SNAPSHOT_VERSION) return { hit: false, reason: 'version' };
    pushDeltas(snap.deltas);
    return { hit: true };
  } catch (e) {
    console.warn('[applyAndProject] projection snapshot load failed — falling back', e);
    return { hit: false, reason: 'error' };
  }
}

/** Clear the durability banner after a successful write. */
function markPersistOk(): void {
  if (cachePersistFailed) {
    cachePersistFailed = false;
    sink.cachePersistFailed(false);
  }
}

/**
 * The ONE writer of the durability signal.
 *
 * ⚠️ IT EXISTS SO `markPersistOk()` CAN EVER CLEAR THE BANNER. That function
 * sends the clearing edge only `if (cachePersistFailed)`, the worker-local flag.
 * A producer that called `sink.cachePersistFailed(true, …)` directly would raise
 * the banner on main, whose own setter is edge-triggered on ITS copy, while
 * leaving the worker unable to ever send the edge back: a durability banner
 * stuck on for the rest of the session, after a recovery that actually worked.
 * Both producers go through here, so the flag and the banner cannot disagree.
 */
function raiseCachePersistFailure(
  kind: CachePersistFailureDetail['kind'],
  errorName: string
): void {
  cachePersistFailed = true;
  sink.cachePersistFailed(true, { kind, errorName });
}

/**
 * Re-seed a clean cache DB after a corrupt-cache clear.
 *
 * ⚠️ NEVER THROWS. Its only caller is inside a `catch` whose job is to rethrow
 * the ORIGINAL classification (App.vue's cache-corrupt self-heal dispatches on
 * that class), so every failure here is reported through the durability signal
 * rather than raised. Do not "improve" this by letting it propagate.
 *
 * ⚠️ AND IT IS WHY THE HANG IS GONE. Re-opening a database whose delete is
 * queued behind another connection is a promise that never settles: the open
 * waits for a delete that waits for a connection nobody here controls. When the
 * delete did not land, the only safe thing is not to ask.
 */
async function reseedCacheAfterCorruption(id: string): Promise<boolean> {
  const result = await cache.clearCache(id).catch(() => null);
  // `?.` deliberately. A null (it threw) and a `{ deleted: false }` (it was
  // blocked) both mean "do not re-open", and an `undefined` from a stale mock or
  // an older bundle must degrade to the same safe answer rather than throwing a
  // TypeError over the error the caller still has to classify.
  if (!result?.deleted) {
    raiseCachePersistFailure('open', 'DeleteBlocked');
    // ⚠️ FALSE, AND THE CALLER'S REFUSAL DEPENDS ON IT. The delete was BLOCKED —
    // by another tab, which after a two-session soak is the normal state — so
    // every `inc:*` row this family had is still on disk, unread. The caller
    // must not be allowed to install the remote wholesale over them.
    return false;
  }
  try {
    await cache.initPersistenceDB(id);
  } catch (openErr) {
    console.error('[applyAndProject] cache re-open after clear failed', openErr);
    raiseCachePersistFailure('open', openErr instanceof Error ? openErr.name : 'UnknownError');
  }
  // The rows are gone either way — the DELETE is what mattered, not the re-open.
  return true;
}

/**
 * Commit the open-guard baseline (#61) captured at the start of a persist, once
 * the doc write it accompanies has succeeded. Called immediately before each
 * `markPersistOk()` (C4c: doc write → baseline → markPersistOk).
 *
 * - `pending === null` → nothing to commit (never persist an mtime / absent rev).
 * - the document generation moved → the doc was replaced/reset mid-write; committing
 *   now would write this revision into a DIFFERENT family's cache (C11). Skip.
 * - Its OWN try/catch (C4b): a failed baseline write is advisory — at most one
 *   extra Drive read next open — and must NEVER raise the local-durability
 *   banner. Console-only (the worker's only local channel).
 * - Clears the module var ONLY if it still `=== pending` (C4a): a newer
 *   `noteRemoteBaseline` landing during the write must survive to its own commit.
 */
async function commitPendingBaseline(pending: string | null, gen: number): Promise<void> {
  if (pending === null) return;
  if (docGeneration !== gen) return;
  try {
    await cache.writeRemoteBaseline(pending);
    if (pendingRemoteBaseline === pending) pendingRemoteBaseline = null;
  } catch (e) {
    console.error(
      '[applyAndProject] remote-baseline write failed — baseline not advanced (next open will re-read, no data at risk)',
      e
    );
  }
}

/** Write a fresh whole-doc BASE (clears increments, resets seq) and advance the
 * cursor. Used for the first persist of a doc, after adopt/replace, on recovery,
 * and for re-compaction. `doc` is the entry snapshot — stable across the await even
 * if a concurrent `reset()`/replace nulls or swaps `currentDoc`. */
async function writeBase(key: CryptoKey, doc: Doc, gen: number, supersede: boolean): Promise<void> {
  const captureHeads = headsOf(doc);
  const start = performance.now();
  const binary = saveDoc(doc);
  sink.perf('automerge.saveBase', performance.now() - start, { perf_doc_bytes: binary.byteLength });
  await cache.persistDocBinary(key, binary, { supersede });
  if (docGeneration === gen) {
    lastPersistedHeads = captureHeads;
    baseSupersedes = false;
  }
}

/**
 * Persist the current doc to cache INCREMENTALLY: capture `getChangesSince(doc,
 * lastPersistedHeads)`, encrypt only that delta, append it as an `inc:*` row, and
 * advance the cursor — so a persist costs a delta, enabling persist-on-(near-)every-
 * mutation (closing the backgrounding last-edit-loss window). Writes a whole-doc base
 * instead when there's no base yet (`lastPersistedHeads === null`) or when the
 * increment count crosses the re-compaction threshold. Surfaces failure to the
 * durability banner (does not throw — it runs detached from any RPC).
 *
 * ATOMICITY: everything is computed from ONE entry snapshot (`doc`/`captureHeads`/
 * `changes`, all read before the first `await`). The cursor advances to
 * `captureHeads` (the snapshot's heads), NEVER a post-await re-read of `currentDoc`
 * — a mutation landing during the IDB write must not be skipped from the next
 * capture. The `docGeneration` guard drops a stale cursor advance if the doc was
 * replaced/reset mid-write (C5d).
 */
async function persistOnce(): Promise<void> {
  if (!currentDoc || !familyKey || !cache.isCacheReady()) return;
  const doc = currentDoc;
  const key = familyKey;
  const gen = docGeneration;
  const supersede = baseSupersedes;
  // C4a: capture the pending baseline in the SAME pre-`await` snapshot as `doc`,
  // so a newer value arriving DURING this write is not committed against this
  // (older) doc state. Committed only via `commitPendingBaseline` below.
  const pending = pendingRemoteBaseline;
  // C5c: while the document still depends on changes it does not hold, a base write would
  // drop them from the cache's reach. Increments only, until a merge delivers the deps.
  const fenced = baseFence && Automerge.getMissingDeps(doc, []).length > 0;
  if (baseFence && !fenced) baseFence = false;
  // Track which write is in flight so the failure signal can carry `kind` — MUST be
  // explicit, not inferred from lastPersistedHeads (the re-compaction writeBase below
  // runs with a non-null lastPersistedHeads and would be mislabeled 'increment').
  let writeKind: 'base' | 'increment' = 'base';
  try {
    if (lastPersistedHeads === null) {
      if (fenced) {
        // Unreachable by construction: the fence is only ever raised beside a real cursor.
        console.warn('[applyAndProject] base write refused: the document is missing deps');
        return;
      }
      writeKind = 'base';
      await writeBase(key, doc, gen, supersede);
    } else {
      const captureHeads = headsOf(doc);
      const changes = changesSince(doc, lastPersistedHeads);
      if (changes.length === 0) {
        // No new doc changes to persist, but the cache already holds `doc` (which
        // contains the merged remote state that set `pending`), so this is a valid
        // commit terminus (C10a: `noteRemoteBaseline` schedules a persist precisely
        // to reach here on a read-only merge).
        await commitPendingBaseline(pending, gen);
        markPersistOk();
        return;
      }
      const framed = frameChanges(changes);
      const start = performance.now();
      writeKind = 'increment';
      await cache.persistIncrement(key, framed);
      sink.perf('automerge.saveIncremental', performance.now() - start, {
        perf_chunk_bytes: framed.byteLength,
      });
      if (docGeneration === gen) lastPersistedHeads = captureHeads;
      if (!fenced && cache.incrementCount() >= INCREMENT_COMPACTION_THRESHOLD) {
        writeKind = 'base';
        // Re-compaction of the SAME document: drops only the rows it contains.
        await writeBase(key, doc, gen, false);
      }
    }
    // C4c: the doc write above has succeeded and the cache now holds `doc`.
    await commitPendingBaseline(pending, gen);
    markPersistOk();
  } catch (e) {
    // A durable-cache write failure is the "local durability broken" signal —
    // surface it (persistent banner on main + telemetry), don't swallow it.
    // `lastPersistedHeads` is NOT advanced on failure → the delta is re-captured
    // next tick. The console.error is the worker's only local channel (it can't
    // reach logEvent/reportError) — keep it; the signal carries triage detail.
    //
    // ⚠️ #100: a write that was already in flight when another tab deleted the
    // cache fails here AFTER the handle was released. That is not this device
    // losing durability, it is a session that is about to end, so it must not
    // raise the banner or a false `cache-persist` warning. Safe ONLY in this
    // catch, which follows a successful open: after a FAILED open the handle is
    // always null, so the same check in an open catch would swallow every real
    // open failure.
    if (!cache.isCacheReady()) {
      console.warn(
        '[applyAndProject] cache write failed after the handle was released; the session is ending',
        e
      );
      return;
    }
    // C5g: the handle was re-pointed or closed while this write was encrypting. Nothing was
    // written and the cursor did not move, so the next persist re-captures the same delta.
    if (e instanceof Error && e.name === 'CacheHandleChangedError') {
      console.warn('[applyAndProject] cache write abandoned: the handle changed mid-write', e);
      return;
    }
    raiseCachePersistFailure(writeKind, e instanceof Error ? e.name : 'UnknownError');
    console.error('[applyAndProject] cache persist failed', e);
  }
}

// ─── Projection push (chunked) ───────────────────────────────────────────────

/** Stream a list of projection deltas, slicing large `bulk` collections so no
 * single main-thread receive is a long task. A non-empty list lands `final` on
 * its last chunk (→ main bumps `docVersion` once); an EMPTY list streams nothing
 * — correct for a no-op poll-merge (the projection already matches; the RPC result
 * resolves via its response, not a projection chunk). */
function pushDeltas(deltas: ProjectionDelta[]): void {
  const chunks: ProjectionDelta[] = [];
  for (const delta of deltas) {
    if (delta.kind === 'bulk' && delta.entities.length > PROJECTION_CHUNK) {
      for (let i = 0; i < delta.entities.length; i += PROJECTION_CHUNK) {
        chunks.push({
          kind: 'bulk',
          collection: delta.collection,
          reset: i === 0,
          entities: delta.entities.slice(i, i + PROJECTION_CHUNK),
        });
      }
    } else {
      chunks.push(delta);
    }
  }
  const last = chunks.length - 1;
  chunks.forEach((delta, i) => sink.pushChunk(delta, i === last));
}

/** Push the FULL projection for `doc` (first-load / replace / create). Always
 * emits ≥1 delta (27 collections + settings), so `final` always lands. */
function pushProjection(doc: Doc): void {
  pushDeltas(buildFullProjection(doc));
}

/** Cheap entity count across all collections — for the `pushProjection` perf
 * sample only (reads proxy keys, not full materialize). */
function countEntities(doc: Doc): number {
  let n = 0;
  for (const name of COLLECTION_NAMES) n += Object.keys((doc[name] ?? {}) as object).length;
  return n;
}

// ─── Guards ──────────────────────────────────────────────────────────────────

function requireDoc(method: string): Doc {
  if (!currentDoc) throw new Error(`docWorker: no document loaded for '${method}'`);
  return currentDoc;
}
function requireKey(method: string): CryptoKey {
  if (!familyKey) throw new Error(`docWorker: family key not set for '${method}'`);
  return familyKey;
}

// ─── RPC handlers (the surface `docClient` calls) ────────────────────────────

/**
 * Post the family key (once at unlock; re-posted on re-spawn).
 *
 * ⚠️ ACCEPTS RAW BYTES AS WELL AS A `CryptoKey`, AND THE BYTES ARE THE WORKER WIRE FORMAT.
 * A `CryptoKey` is structured-cloneable per spec, but iOS WKWebView throws `DataCloneError`
 * ("The object can not be cloned.") when one is posted to a worker — observed in production on
 * two families across two builds. `postMessage` throws SYNCHRONOUSLY there, so the key never
 * arrives, every later crypto op fails its `if (!familyKey)` guard, and the whole realm falls
 * back to running Automerge inline on the main thread.
 *
 * Raw bytes clone everywhere, so `docClient` exports once and posts those instead. The
 * `CryptoKey` arm is still live and is NOT dead code: inline mode hands the key over directly
 * with no clone in the way, and it is also the fallback when a key cannot be exported.
 */
export async function setKey(key: CryptoKey | Uint8Array): Promise<void> {
  familyKey = key instanceof Uint8Array ? await importFamilyKey(key) : key;
}

/**
 * Post the stable device actor into this realm.
 *
 * ⚠️ ORDERING: this must arrive BEFORE `setKey` and before the rehydrator runs.
 * The rehydrator loads the document, and an actor that turns up after that has
 * pinned nothing — the load has already minted a random one.
 */
export function setActor(actor: string | null): void {
  setDocActor(actor);
}

/** Create a fresh empty document (create-family). Pushes the full projection. */
export function initDoc(): { loaded: true } {
  currentDoc = migrateDoc(Automerge.init<FamilyDocument>(docInitOpts()));
  resetDocCursors(); // fresh doc → first persist writes a base, first snapshot writes fresh
  docFamilyId = null; // a new family's document; `openCache` names it
  pushProjection(currentDoc);
  scheduleSnapshotPersist();
  return { loaded: true };
}

/**
 * Open the family's cache DB and load the cached doc if present. On a hit the doc
 * is installed + the full projection pushed (`loaded:true`); on a miss the worker
 * holds no doc yet (`loaded:false`) and the caller loads from Drive. A
 * materialize-corrupt cache throws `CorruptPayloadError` → the caller clears +
 * rebuilds (rather than the old invisible later-throw).
 */
/**
 * Open the family's cache DB WITHOUT loading a cached doc — for `createNewFile`,
 * which has just built + verified the owner doc and only needs an open DB to
 * `flush()`/`persistEnvelope` into. `initAndLoadCache` would instead LOAD any
 * pre-existing cache row (from a prior/interrupted create attempt for the same
 * familyId) and install it OVER the fresh owner doc → data loss (ADR-032 F1).
 */
export async function openCache(id: string): Promise<{ loaded: false }> {
  // Scope change: a different family's DB is now open, so cursors describing the
  // previous doc must not survive. `persistSnapshotOnce` swallows its failures, so
  // a stale cursor here would silently suppress this family's snapshot for the
  // whole session — invisible, and it costs the fast first paint. resetDocCursors
  // also clears `pendingRemoteBaseline` (C18 scope clear).
  // C5g: a previous family's persist must finish against ITS handle first. Never flushed here:
  // the document in memory is the NEW family's, and the open cache may be the old one's.
  if (cache.cacheFamilyId() !== null && cache.cacheFamilyId() !== id) await settlePersists(false);
  resetDocCursors();
  await cache.initPersistenceDB(id);
  docFamilyId = currentDoc ? id : null; // createNewFile: the document it built IS this family's
  // C16: this is the deliberate don't-load path (createNewFile). A baseline row
  // left by a prior/interrupted create describes a doc we are about to discard —
  // a baseline row may exist ONLY alongside a cache that was actually loaded.
  await cache.clearRemoteBaseline().catch(() => {});
  return { loaded: false };
}

export async function initAndLoadCache(id: string): Promise<InitAndLoadResult> {
  // ⚠️ C5e: A SAME-FAMILY LIVE DOCUMENT IS MERGED WITH, NEVER REPLACED. Two live-session paths
  // reach here over a document that holds this session's edits (`replaceDocWithCacheRecovery`
  // and the Settings grant-permission reload). This used to cancel the pending persist without
  // writing it and then REPLACE the document with the cache, so the last ~120 ms of edits, and
  // on any load failure the whole document (`dropDoc`), were gone. Now: write what is pending
  // (bounded), read the cache, and merge it in.
  const live = currentDoc !== null && docFamilyId === id;
  if (live) await settlePersists(docOwnsOpenCache());
  // C18: clear any leftover pending baseline for the PREVIOUS family's doc BEFORE the DB
  // re-point — else the next persist for THIS family's doc would commit it. (After the settle
  // above, so a same-family live document's own pending baseline was committed first.)
  pendingRemoteBaseline = null;
  try {
    await openCacheFor(id);
  } catch (e) {
    // ⚠️ THE SAME HOLE `reseedCacheAfterCorruption` GUARDS, on the opening call.
    // Now that this can reject rather than hang, a device whose cache never
    // opens loads fine from the remote and then persists NOTHING for the rest
    // of the session, because `persistOnce` early-returns on `isCacheReady()`.
    // The caller's degrade path is the right answer; going quiet about it is
    // not. Raise, then rethrow so nothing downstream changes.
    const name = e instanceof Error ? e.name : 'UnknownError';
    raiseCachePersistFailure('open', name);
    // ⚠️ WRAPPED, NOT RETHROWN. The bare rejection reaches main as an anonymous
    // `Error` and main then GUESSED whether this device still holds anything
    // worth protecting — guessing "yes" on a cold boot behind a second tab, which
    // latched the session behind an overlay whose only action reproduced the
    // timeout. `cacheInitLoss()` answers it here instead.
    throw new CacheInitError('open', openStageLoss(), name);
  }
  const key = requireKey('initAndLoadCache');
  let loaded: ({ doc: Doc } & CacheReplay) | null;
  try {
    loaded = await time2('automerge.cacheLoad', () => cache.loadCachedDoc(key, id));
  } catch (e) {
    return loadFailed(e, id, live);
  }

  if (!loaded) {
    // Reached AFTER `openCacheFor(id)` re-pointed the DB, so the cursors still
    // describe the previous family's doc. Reset before returning.
    resetDocCursors();
    if (live) {
      // An EMPTY cache under this family's live document: the document is the whole truth,
      // and it is still loaded. Answering `loaded:false` here sent main down the
      // `no-local-document` path, which installs the remote WHOLESALE over it.
      docFamilyId = id;
      void enqueuePersist(); // seed the empty cache from the live document (a base)
      return { loaded: true, remoteBaseline: null, replay: emptyReplay() };
    }
    return { loaded: false, remoteBaseline: null };
  }
  const replay: CacheReplay = {
    recovered: loaded.recovered,
    droppedIncrements: loaded.droppedIncrements,
    missingDeps: loaded.missingDeps,
    incrementCount: loaded.incrementCount,
  };
  // C-5/C16: a recovered cache no longer holds the doc state the baseline row describes.
  // DELETE it — returning null alone would leave it on disk to mislead the next open into
  // skipping a read it must do. Read on every other path in the same round-trip as the cache.
  const baselineFor = async (): Promise<RemoteBaselineRow | null> => {
    if (!loaded!.recovered) return cache.readRemoteBaseline();
    await cache.clearRemoteBaseline().catch(() => {});
    return null;
  };

  if (live) {
    // C5e: MERGE. `mergeDocs` keeps the live document's actor and history and adds whatever
    // the cache holds that it lacks (another tab's increments, a write this realm missed).
    const local = currentDoc!;
    const localHeads = headsOf(local);
    const cacheHeads = headsOf(loaded.doc);
    const merged = time('automerge.merge', () => mergeDocs(local, loaded!.doc));
    currentDoc = merged.doc;
    // The cache provably holds exactly `cacheHeads` (plus anything still pending, which the
    // fence below protects), so the next increment is precisely the live document's own work.
    // A new generation so an in-flight persist from before the merge cannot overwrite it.
    docGeneration++;
    lastPersistedHeads = cacheHeads;
    lastSnapshotHeads = null;
    baseSupersedes = false;
    baseFence = loaded.missingDeps > 0;
    const doc = currentDoc;
    pushDeltas(projectionDeltasBetween(doc, localHeads, merged.heads) ?? buildFullProjection(doc));
    schedulePersist();
    scheduleSnapshotPersist();
    return { loaded: true, remoteBaseline: await baselineFor(), replay };
  }

  // Capture the reconstructed heads BEFORE migrate (which consumes the handle). A
  // migrate delta, if any, then persists as an increment on the next tick; the
  // cursor is DERIVED here from the reconstructed doc, never a stored value.
  const preHeads = headsOf(loaded.doc);
  currentDoc = migrateDoc(loaded.doc);
  // A different doc is now live: a new generation, and the snapshot cursor is stale. (The
  // persist cursor is set per-branch below — it has a real derived value on the clean path.)
  docGeneration++;
  lastSnapshotHeads = null;
  baseSupersedes = false; // this IS the cache's document: a base write keeps what it lacks
  baseFence = false;
  docFamilyId = id;
  if (loaded.missingDeps > 0) {
    // C5c: the replay buffered changes whose deps are absent. They stay on disk (their rows
    // are not `contained`), and the base is NEVER rewritten while the document depends on
    // them: increments only, from the heads the cache provably holds.
    lastPersistedHeads = preHeads;
    baseFence = true;
    schedulePersist();
  } else if (loaded.recovered) {
    // A corrupt increment was skipped on load — rewrite a clean base. The base write deletes
    // only the rows this document contains, so the skipped row stays for a build (or a key)
    // that can read it. Immediate: a smaller replay next open matters here.
    lastPersistedHeads = null;
    void enqueuePersist();
  } else if (cache.incrementCount() > INCREMENT_COMPACTION_THRESHOLD) {
    // Over-threshold on a clean load — e.g. a device that accumulated many
    // increments before this build lowered the threshold. `persistOnce`'s
    // re-compaction only fires on a `mutate`, so without this a read-heavy
    // session would replay all of them on EVERY hard-refresh until the user
    // happens to edit. Compact once to a fresh base so this and every later cold
    // load replays few increments — self-heals already-deployed devices on first
    // load. Debounced (`schedulePersist`, NOT the recovered path's immediate
    // `enqueuePersist`) so the ~2MB saveDoc+encrypt runs AFTER the projection
    // push below, not competing with it for the worker's single thread.
    lastPersistedHeads = null;
    schedulePersist();
  } else {
    lastPersistedHeads = preHeads;
  }
  const doc = currentDoc;
  time('automerge.pushProjection', () => pushProjection(doc), {
    perf_entity_count: countEntities(doc),
  });
  scheduleSnapshotPersist(); // refresh the fast-paint snapshot from the authoritative load
  return { loaded: true, remoteBaseline: await baselineFor(), replay };
}

const emptyReplay = (): CacheReplay => ({
  recovered: false,
  droppedIncrements: 0,
  missingDeps: 0,
  incrementCount: 0,
});

/**
 * `initAndLoadCache`'s load-stage failure (C5a/C5e). Throws, except where a same-family live
 * document replaces a proven-corrupt cache and so the load, in effect, succeeded.
 *
 *  - PROVEN corrupt (`isProvenCorrupt`): the cache is deleted and re-seeded. With a live
 *    same-family document that document becomes the new cache (it IS this family's data);
 *    cold, the `CorruptPayloadError` is rethrown so a fresh remote load re-seeds it.
 *  - out of memory: the bytes are fine, the device could not inflate them; rethrown, cache kept.
 *  - ANYTHING ELSE (an IndexedDB error, a wrong-key decrypt, an unclassified throw): the cache
 *    is KEPT and `CacheInitError('load', 'something-to-lose')` tells main not to install over
 *    it. Cold, the handle is also CLOSED, so a fresh empty document installed next (App's
 *    path 3) cannot write its base over the rows this failure kept.
 *  - A same-family live document is NEVER dropped.
 */
async function loadFailed(e: unknown, id: string, live: boolean): Promise<InitAndLoadResult> {
  const name = e instanceof Error ? e.name : 'UnknownError';
  const proven = isProvenCorrupt(e);
  if (live) {
    if (proven && (await reseedCacheAfterCorruption(id))) {
      resetDocCursors(); // the next persist writes the live document as the new base
      docFamilyId = id;
      void enqueuePersist();
      return {
        loaded: true,
        remoteBaseline: null,
        replay: { ...emptyReplay(), recovered: true, corruptBaseReplaced: true },
      };
    }
    if (e instanceof PayloadLoadError && e.deviceCannotOpen) throw e;
    throw new CacheInitError('load', 'something-to-lose', name);
  }
  // DROP THE DOC (cold). `openCacheFor(id)` already re-pointed the DB at THIS family, so
  // whatever `currentDoc` holds belongs to a DIFFERENT family (or none) and must never be
  // written here. A bare `resetDocCursors()` would be actively worse: it nulls
  // `lastPersistedHeads`, which makes the next persist write a BASE over this family's cache.
  dropDoc();
  if (proven) {
    // Corrupt cache: clear it so a fresh Drive load can re-seed a clean cache, then rethrow
    // so the caller (and telemetry) sees the CorruptPayloadError. `reseedCacheAfterCorruption`
    // never throws; a blocked delete is reported through the durability signal.
    await reseedCacheAfterCorruption(id);
    // ⚠️ `PayloadLoadError` IS NOT WRAPPED. `syncStore.ts` and App.vue dispatch on the class.
    throw e;
  }
  // An OUT-OF-MEMORY failure must NOT clear the cache: the cached bytes are fine, this device
  // could not allocate enough to inflate them. Rethrown unwrapped (`deviceCannotOpen` is what
  // main dead-ends on); the handle stays open exactly as before.
  if (e instanceof PayloadLoadError && e.deviceCannotOpen) throw e;
  cache.closeCacheDB();
  raiseCachePersistFailure('open', name);
  throw new CacheInitError('load', 'something-to-lose', name);
}

/** Compare two Automerge heads (deterministic sorted change-hash arrays). */
function headsEqual(a: Heads, b: Heads): boolean {
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

/** Apply a declarative mutation; schedule a cache persist ONLY if the doc actually
 * changed. The delta rides the response (applied to the projection before the
 * caller's promise resolves). `changed:false` for a no-op (skipped `onMissing`, a
 * named op that wrote nothing, or a patch whose values all matched, #117) → no
 * cache persist here, and the caller skips the Drive save (F10). The reconciler's
 * `notes` ride the response too (only when there are any): the worker cannot
 * telemeter, so main logs them. */
export function mutate(op: MutationOp): {
  result: unknown;
  delta: ProjectionDelta;
  changed: boolean;
  notes?: ReconcileNote[];
  heads: Heads;
} {
  const doc = requireDoc('mutate');
  const before = headsOf(doc);
  const { doc: next, result, delta, notes } = applyMutationOp(doc, op);
  const changed = !headsEqual(before, headsOf(next));
  currentDoc = next;
  if (changed) {
    schedulePersist();
    scheduleSnapshotPersist(); // coarse-coalesced; won't fire per-mutate
  }
  // `heads` (C12): main remembers the last acknowledged write, so a respawn that rehydrates a
  // document WITHOUT it is caught (`hasHeads`) instead of silently showing older data.
  return { result, delta, changed, ...(notes.length ? { notes } : {}), heads: headsOf(next) };
}

/**
 * Does the live document contain every change in `heads`? (C12.) Main asks after a respawn's
 * rehydrate with the heads of the last write it was told landed: `false` means the cache the
 * rehydrate read is BEHIND an acknowledged write (a persist that never landed), which is data
 * the person was shown and that is now gone from this device.
 */
export function hasHeads(heads: Heads): { has: boolean; loaded: boolean } {
  if (!currentDoc) return { has: false, loaded: false };
  return { has: Automerge.hasHeads(currentDoc, heads), loaded: true };
}

/** Re-stream the full projection of the live document (C12): main asks after a projection
 *  apply failure or a heads regression, so its mirror cannot stay diverged. */
export function pushFullProjection(): { pushed: boolean } {
  if (!currentDoc) return { pushed: false };
  pushProjection(currentDoc);
  return { pushed: true };
}

/**
 * Learn a remote baseline to commit durably (#61 C10a). Main calls this from a
 * post-merge / post-write terminus where `currentDoc` provably contains the
 * remote state `revision` names. The FIFO orders this strictly after the
 * already-resolved merge, so any persist entering afterwards holds a doc ⊇ that
 * state. Sets the pending value AND schedules a persist, so it is committed even
 * on a read-only session (where no mutation would otherwise schedule one). It is
 * a plain last-write-wins set — correctness comes from WHERE it is called, never
 * from comparing revisions (C10b).
 */
export function noteRemoteBaseline(payload: string): void {
  pendingRemoteBaseline = payload;
  schedulePersist();
}

/**
 * Decrypt a fetched remote envelope and CRDT-merge it into the local doc.
 * Returns heads plus two heads-derived booleans, which answer DIFFERENT questions
 * and must not be conflated:
 *   - `dirty`  — did the merge leave local changes the converged doc must push
 *                BACK to the file? (drives the re-upload decision)
 *   - `changed` — did the merge move OUR doc at all? (drives the re-projection
 *                decision: when false, the projection the stores already hold is
 *                still current, so re-projecting ~21 stores is pure waste)
 * A no-op poll-merge is `{dirty:false, changed:false}`; adopting a remote into an
 * empty slot is `{dirty:false, changed:true}` — nothing to push back, but the
 * projection is brand new. Mirrors `applyChanges`'s existing `changed` contract.
 * Pushes the full merged projection (chunked); the caller resolves only after the
 * final chunk → post-merge readers (e.g. dedup) see the complete set. Persists the
 * merged doc to cache.
 */
/**
 * What this device can PROVE about its own document, from the basis main sent.
 *
 * Main owns the only fact the worker cannot see (what Drive HELD at the last
 * durable baseline); the worker owns the only fact main cannot see at the
 * instant it matters (what our document's heads are RIGHT NOW). Asking here
 * closes a real window: answered on main before the RPC, a mutation landing in
 * between yields a stale `clean` and therefore a wrong ADOPT that discards it.
 */
/** A completed rebase: the new document and what the replay carried. */
interface RebaseResult {
  doc: Doc;
  /** Ops replayed, Counter increments included. */
  replayed: number;
  conflicts: number;
  /** Of `replayed`, the `increment` ops the Counter ledger pass emitted (#117 Phase 2). */
  counterIncrements: number;
}

/**
 * Replay the peer's unsynced work onto the remote's lineage — or answer `null`.
 *
 * ⚠️ EVERY FAILURE ANSWERS `null`, and the caller then raises the same block the
 * policy would have. Five things can go wrong — no baseline heads, a baseline
 * this history does not contain, a `view`/`diff` that throws, a composer that
 * cannot express the change, an `applyMutation` that throws — and none of them
 * may leave a half-rebased document behind. That is why this returns a NEW
 * document rather than mutating: the caller's single assignment is the only
 * write, so "untouched on failure" is structural rather than a restore step.
 */
function rebaseOntoRemote(
  local: Doc,
  baselineHeads: Heads,
  /**
   * ⚠️ ALREADY MIGRATED, and it must be the CALLER'S one migrate. This used to
   * take the raw `remote` and call `migrateDoc` itself, which dead-ended the
   * rollback route: `migrateDoc` emits a real `Automerge.change` on a remote that
   * predates a collection, marking that handle OUTDATED, and when `buildRebaseOps`
   * then answered `null` the caller's wholesale-install branch migrated the SAME
   * handle again and threw `RangeError: Attempting to change an outdated
   * document`. The whole merge rejected, `doSave` classified it as a blocker and
   * refused, and the human who had just hand-picked their pre-compaction
   * `.beanpod` had no way forward — on the one path the policy calls "the only
   * exit there is". Reproduced against @automerge/automerge 3.4.1.
   */
  target: Doc
): RebaseResult | { blockedBy: 'transactions' } | null {
  try {
    const ops = buildRebaseOps(local, baselineHeads, target);
    if (!ops) return null; // cannot compose → the caller blocks
    // C8: a transaction conflict makes the replay unavailable rather than partial.
    if (ops.blockedBy) return { blockedBy: ops.blockedBy };
    // Nothing to replay: the peer is level with its baseline, so the remote can
    // simply be adopted. Blocking here would strand a device that has lost
    // nothing — and `migrateDoc` alone can move heads without any user edit.
    if (!ops.op)
      return { doc: target, replayed: 0, conflicts: ops.conflicts, counterIncrements: 0 };
    return {
      doc: applyMutationOp(target, ops.op).doc,
      replayed: ops.count,
      conflicts: ops.conflicts,
      counterIncrements: ops.counterIncrements,
    };
  } catch (e) {
    console.warn('[applyAndProject] rebase unavailable — falling back to the block:', e);
    return null;
  }
}

/**
 * Replace the id segment of a document path with a placeholder.
 *
 * `driveConnections.greg@example.com.refreshToken` → `driveConnections.<id>.refreshToken`.
 * Entity ids are UUIDs almost everywhere, which are harmless, but one map is
 * keyed by an email address and this message reaches the firehose and Slack.
 * Masking positionally rather than special-casing that one collection means a
 * future map keyed by something personal is covered the day it is added.
 */
function maskEntityIds(path: string): string {
  const parts = path.split('.');
  const root = parts[0] ?? '';
  // ⚠️ SINGLETONS HAVE NO ID SEGMENT. `settings` and `podLineage` are the two
  // `NON_COLLECTION_KEYS` — maps of FIELDS, not of entities — so segment 2 is a
  // field name, the single most useful token for triage. Masking it turned
  // `settings.baseCurrency` into `settings.<id>`, which tells a reader nothing.
  if ((NON_COLLECTION_KEYS as readonly string[]).includes(root)) return path;
  // `collection` alone, or `collection.<id>` with the id as the leaf. Masking
  // the leaf is the whole point: an id can be a Google account email.
  if (parts.length <= 2) return parts.length === 2 ? `${root}.<id>` : path;
  // ⚠️ EVERYTHING BETWEEN THE COLLECTION AND THE LEAF. Ids are joined into the
  // path with '.', and AN EMAIL CONTAINS DOTS — so masking only segment 2 left
  // `driveConnections.<id>.com.refreshToken`, still leaking the domain, and for
  // a three-segment path it promoted the TLD into the leaf position. Keeping
  // the first and last segments is total: whatever the id is made of, it cannot
  // survive.
  return `${root}.<id>.${parts[parts.length - 1]}`;
}

/**
 * The document-health figures every merge outcome carries: the root conflicts this operation
 * ADDED (#117 plan F) and the Counter map's shape (#117 Phase 2). One function spread into all
 * four returns of `mergeRemoteEnvelope`, so the next diagnostic is a field here rather than a
 * fifth edit at four sites. Reporting only: nothing branches on it except the merge path's
 * `rootConflicts.added` full-projection gate.
 */
function mergeHealth(
  conflictsBefore: RootConflictSnapshot,
  doc: Doc
): { rootConflicts: { total: number; added: number }; counterStats: CounterStats } {
  return {
    rootConflicts: rootConflictsSince(conflictsBefore, doc),
    counterStats: counterStats(doc),
  };
}

/**
 * Does `remote` hold any change the compaction stamped with `fromHeads` was not built from?
 * (C1.) True when any remote head is not one of `fromHeads`:
 *  - the remote contains `fromHeads` and has heads beyond them: a peer wrote after the
 *    compaction's source was captured. Definitely moved;
 *  - the remote LACKS part of `fromHeads` and has a head outside them: either it is merely
 *    behind (its head is an ancestor of the source) or it diverged. The source's history is
 *    gone, so the two cannot be told apart, and the answer is the safe one: moved. The level
 *    check before `compactDoc` makes this arm rare; blocking it never loses work.
 * False only when every remote head is a source head, which proves the remote is a subset of
 * the compacted history.
 */
function remoteMovedPast(remote: Doc, fromHeads: readonly string[]): boolean {
  const source = new Set(fromHeads);
  return headsOf(remote).some((h) => !source.has(h));
}

/** A document's `removedMembers` tombstones as plain values (empty when absent). */
function removedMembersOf(doc: Doc | null): Record<string, RemovedMember> {
  const map = (doc as { removedMembers?: Record<string, RemovedMember> } | null)?.removedMembers;
  return map ? (JSON.parse(JSON.stringify(map)) as Record<string, RemovedMember>) : {};
}

/**
 * Union `prior` into the draft's `removedMembers` and delete every `familyMembers` row the union
 * names (C10). Returns the counts for the merge outcome, or `null` when nothing changed.
 */
function carryRemovedMembers(
  d: FamilyDocument,
  prior: Record<string, RemovedMember>
): { carried: number; rowsDeleted: number } | null {
  const tombstones = d.removedMembers as Record<string, RemovedMember> | undefined;
  if (!tombstones) return null; // `migrateDoc` creates it; absent only on a malformed pod
  let carried = 0;
  for (const [id, rec] of Object.entries(prior)) {
    if (tombstones[id] === undefined) {
      tombstones[id] = rec;
      carried++;
    }
  }
  let rowsDeleted = 0;
  const members = d.familyMembers as Record<string, unknown> | undefined;
  for (const id of Object.keys(tombstones)) {
    if (members?.[id] !== undefined) {
      delete members[id];
      rowsDeleted++;
    }
  }
  return carried || rowsDeleted ? { carried, rowsDeleted } : null;
}

function lineageContextFor(basis: LineageBasis, doc: Doc): LineageContext {
  if (basis.kind === 'user-file') return 'user-file';
  // `no-local-document` never reaches here: the caller installs wholesale
  // without consulting the context at all. Kept exhaustive so a future basis
  // cannot slip through as an unconsidered default.
  if (basis.kind === 'no-local-document') return 'clean';
  // `null` heads means "we cannot prove what Drive held", which is `dirty` —
  // the fail-safe direction, since it never adopts over unsynced work.
  if (basis.heads === null) return 'dirty';
  return headsEqual(basis.heads, headsOf(doc)) ? 'clean' : 'dirty';
}

export async function mergeRemoteEnvelope(
  envelope: BeanpodFileV4,
  id: string | null,
  basis: LineageBasis
  // ⚠️ `MergeOutcome`, not an inline literal. This shape used to be hand-copied
  // five times across the worker, `docClient` and `syncService`; it is declared
  // once in `protocol.ts` so a new field cannot be added here and silently
  // dropped by a consumer's stale annotation.
): Promise<MergeOutcome> {
  const key = requireKey('mergeRemoteEnvelope');
  const remote = await time2('automerge.remoteLoad', () => decryptToDoc(envelope, key), {
    perf_doc_bytes: envelope.encryptedPayload.length,
  });
  // ⚠️ THE LINEAGE GUARD. THIS IS THE ONLY PLACE IT RUNS, AND IT RUNS HERE
  // BECAUSE THIS IS THE ONLY PLACE BOTH DOCUMENTS EXIST.
  //
  // It used to run on MAIN, over the two ENVELOPES. That does not work: the
  // envelope is maintained on three tracks independent of the document — the
  // store's copy, the service's copy, and the worker's envelope cache, which
  // `setEnvelope` writes on its own — so a device can hold the compacted file's
  // stamp while its document is still the pre-compaction one. The guard then
  // compared two envelopes that agreed, returned `same`, and permitted the merge
  // it exists to prevent. Observed in the field, 2026-09-05.
  //
  // ⚠️ `!currentDoc` SHORT-CIRCUITS BEFORE THE BASIS IS READ. Deriving
  // clean/dirty from a document that does not exist either throws or answers
  // `dirty` (a null baseline is the common case on the path that gets here),
  // and `adopt-remote` × `dirty` BLOCKS — so a device whose cache missed would
  // be permanently unable to adopt a compacted pod. "There is no local document"
  // is a fact this function can observe, and it outranks anything the caller
  // asserted. The lineage question is moot when there is nothing to lose.
  //
  // ⚠️ AND `no-local-document` MEANS IT. The arm is an INSTRUCTION, not a hint:
  // three store paths use it because the worker may be holding a DIFFERENT
  // family's document, and `initAndLoadCache` on a cache MISS leaves that
  // document installed. Deriving the install from `!currentDoc` alone made the
  // arm decorative — `clean` + `same` resolves to `merge`, so the remote was
  // CRDT-merged into the foreign document, persisted to the wrong family's
  // cache and uploaded to the wrong family's file. It also broke the retry: a
  // respawn rehydrates a document, so a replayed `no-local-document` found one
  // and merged. The intent has to travel WITH the request, not be re-inferred
  // from state the rehydrator can change underneath it.
  // ⚠️ NO ENVELOPE FALLBACK HERE, AND THAT IS A DECISION, NOT AN OMISSION.
  //
  // A pod compacted by the retired Tier-2 code recorded its lineage ONLY on the
  // envelope, so after ADR-036 such a file reads as never-compacted. A reader
  // for that field was written and then REMOVED, because it cannot be made
  // correct: the local side has no sound equivalent (our envelope copy drifts
  // from our document — that drift IS ADR-036), so `compareLineage(legacy, null)`
  // answers `adopt-remote` even when the truth is `same`. The device that RAN
  // the compaction holds a compacted-but-unstamped document beside its own
  // legacy-stamped file, so it blocked on its own pod, and the block's only
  // recovery ADOPTS — destroying real, same-lineage unsynced edits that a plain
  // merge would have kept. Strictly worse than reading nothing.
  //
  // Telling the two apart needs a shared-ancestry walk over the change graph, on
  // the low-memory device this whole tier exists to spare. Not worth it: the
  // entire affected population is the pods that were compacted while the
  // envelope carried the lineage — a window that closed when the lineage moved
  // into the document (ADR-036). ⚠️ THE OLD CLAIM HERE, "`podCompaction` is OFF
  // and has never shipped enabled", STOPPED BEING TRUE at `142d25a8`; the flag
  // is now committed ON. What bounds the population is the format, not the flag:
  // a compacted pod is written as 5.0 and carries its lineage in the document,
  // so no NEW pod can join this case. Reading nothing means such a pod compares `same` and
  // MERGES, which is right for every device that already holds it and wrong only
  // for one still on the pre-compaction history.
  //
  // ⚠️ NOTHING IN THE PLAN FIXES THAT LAST CASE, and an earlier version of this
  // comment wrongly said the rebase would. The rebase changes exactly ONE POLICY
  // cell — `adopt-remote` × `dirty` — and a pod compacted by the retired code
  // carries NO document stamp, so its verdict is `same`, which never routes to
  // that cell in any context. (It is also Stage THREE, not two.) The only
  // mitigation is resetting the one affected dev family before soaking. Do not
  // reintroduce the reader.
  // ⚠️ A POSITIVE ASSERTION, NOT A DERIVATION — and the change is the whole
  // point of this guard.
  //
  // This was `!currentDoc || basis.kind === 'no-local-document'`, which reads as
  // "install wholesale if there is nothing to lose". It is really "install
  // wholesale if we CANNOT SEE anything to lose", and those are different
  // claims. Three separate routes reached it with a document that existed:
  //
  //   1. A cache READ that failed. `syncStore` sent `no-local-document` for any
  //      false `loadedFromCache`, including a ten-second IndexedDB timeout on a
  //      device whose document was sitting in memory with unsaved work in it.
  //      Now classified on main and refused there.
  //   2. A rehydrate that THREW after a worker teardown, leaving this worker
  //      docless. A main-thread latch was tried and could not work: the check
  //      ran BEFORE the `ensureReady()` that performs the rehydrate, so it could
  //      not fire on the merge it was written to stop.
  //   3. A rehydrate that RESOLVED `{loaded: false}` — no throw, no latch, no
  //      signal of any kind. `initAndLoadCache` does exactly this whenever the
  //      cache row is absent, which `reseedCacheAfterCorruption` guarantees.
  //
  // Only the CALLER knows whether this device genuinely holds nothing, and it
  // already says so. So the install is driven by that statement alone, and a
  // docless worker that was NOT told to install wholesale is a contradiction we
  // refuse rather than resolve in the remote's favour. That refusal cannot be
  // forgotten by a future route, because there is no longer a route: every path
  // into the wholesale install now runs through one explicit instruction.
  // The CALLER's instruction, and the only thing that may put us in the
  // wholesale branch before the guard has run. Kept separate from the mutable
  // flag below so the assertion cannot be weakened by a later assignment.
  const toldToInstallWholesale = basis.kind === 'no-local-document';
  if (!currentDoc && !toldToInstallWholesale) {
    throw new LocalDocUnreadableError('worker-holds-no-document');
  }
  // #117 plan F: the root conflicts THIS family's document already carries, read before anything
  // below can consume the handle, so every outcome can say how many the operation ADDED. A
  // wholesale install starts from nothing of this family's (the resident doc may be another
  // family's), so every conflict it brings is new to this device.
  const conflictsBefore: RootConflictSnapshot =
    currentDoc && !toldToInstallWholesale ? rootConflictSnapshot(currentDoc) : new Map();
  // Seeded from the instruction; the lineage verdict may set it below (an
  // `adopt` or a completed `rebase` both install).
  let installWholesale = toldToInstallWholesale;
  /** The policy asked for a rebase and it could not run. Diagnostic only. */
  let rebaseUnavailable = false;
  /** Why it could not run, when the composer said (C8). Diagnostic only. */
  let conflictKind: 'transactions' | undefined;
  /**
   * ⚠️ A RESTORE IS A LINEAGE EVENT. Set ONLY inside the guarded block, when
   * the verdict was `ours-newer` under `user-file`: a human chose a file whose
   * lineage is OLDER than the document this device held (the pre-compaction
   * safety copy). Adopting it as-is leaves this device on the old lineage, and
   * every peer still holding the newer one reads `ours-newer`, republishes,
   * and undoes the restore within one poll. So the adopted document is stamped
   * with a NEW generation (`nextLineage` of what we held), and peers read
   * `adopt-remote` instead: the propagation the guard was built for.
   *
   * Never a property of the install branch itself, which also serves the
   * first-load adopt: a fresh device minting on its first sync would churn the
   * whole fleet. Never on `conflict x user-file` (a human resolved a concurrent
   * compaction; adopting the chosen id IS the resolution), and never on the
   * `user-file` rebase fallback (`adopt-remote`, a NEWER file: nothing to mint).
   */
  let stampNewGeneration = false;
  /**
   * The migrated remote, computed AT MOST ONCE per merge.
   *
   * ⚠️ `migrateDoc` IS NOT IDEMPOTENT ON ITS INPUT HANDLE. It returns the doc
   * unchanged when nothing is missing, but otherwise emits an `Automerge.change`,
   * which marks the input outdated — so a second call on the same handle throws.
   * Two call sites can be reached in one merge (the rebase target, then the
   * wholesale install on the `user-file` rebase-unavailable fallback), so the
   * migrate is memoised here rather than repeated at each site.
   */
  let migratedRemote: Doc | null = null;
  const migrateRemoteOnce = (): Doc => (migratedRemote ??= migrateDoc(remote));
  let priorLineage: CompactionLineage | null = null;
  // `currentDoc` is non-null here by the assertion above; the check is kept as a
  // type narrowing, not as a second decision.
  if (currentDoc && !toldToInstallWholesale) {
    const lineageCtx = lineageContextFor(basis, currentDoc);
    priorLineage = docLineage(currentDoc);
    // Throws `PodLineageError` on a block; every caller between here and the
    // user dispatches on `isRemoteBlocker` FIRST, before any wrapping.
    const { action: act, verdict } = guardLineage(docLineage(remote), priorLineage, lineageCtx);
    stampNewGeneration = act === 'adopt' && verdict === 'ours-newer' && lineageCtx === 'user-file';
    if (act === 'publish-local') {
      // ⚠️ C1 (data-layer audit 2026-10-03): `ours-newer` is a fact about LINEAGES, not about
      // what the remote holds. A peer can write to the old lineage after the compactor's level
      // check (the backup share sheet, the confirm, a failed publish all widen the window), and
      // publishing here would put the compacted document over those edits for the whole
      // family. When the compaction recorded the heads it was built from, refuse unless every
      // head the remote holds is one of them. Legacy stamps (no `fromHeads`) keep today's path.
      const fromHeads = priorLineage?.fromHeads;
      if (verdict === 'ours-newer' && Array.isArray(fromHeads)) {
        if (remoteMovedPast(remote, fromHeads)) {
          throw lineageBlockError('ours-newer', { remoteMovedAfterCompaction: true });
        }
      }
      // Our document is the newer lineage. Touch NOTHING — not the document,
      // not the cursors, not the cache. The caller keeps its own document and
      // publishes it; it must also NOT commit a Drive baseline for bytes we
      // deliberately did not take.
      return {
        action: 'kept-local',
        heads: headsOf(currentDoc),
        dirty: true,
        changed: false,
        remoteHeads: headsOf(remote),
        ...mergeHealth(conflictsBefore, currentDoc),
      };
    }
    // ⚠️ THE REBASE COMPOSES AND APPLIES BEFORE IT INSTALLS. ONE ASSIGNMENT.
    //
    // Not "adopt, then mutate". Writing `currentDoc = migrateDoc(remote)` and
    // THEN replaying onto it means an `applyMutation` throw leaves the worker
    // holding the adopted-but-un-rebased document, with the peer's unsynced work
    // silently gone and no restore possible to express. Every failure below
    // therefore leaves `currentDoc` untouched by construction rather than by a
    // restore step, and falls back to the SAME block the policy would have
    // raised — so the termini, the latch, the banner and the telemetry are all
    // unchanged. The rebase is additive safety: it must never lose more than
    // blocking would.
    if (act === 'rebase') {
      // Both arms that can reach a rebase carry heads — `no-local-document`
      // never gets here, because it installs before the guard is consulted, and
      // TypeScript has already narrowed it away by this point.
      const baseline = basis.heads;
      // ⚠️ THE MIGRATE IS INSIDE THE GUARD, NOT JUST THE COMPOSE. It used to sit
      // inside `rebaseOntoRemote`'s own try; hoisting it out to fix the
      // double-migrate dead-end also moved it out of that guard, which broke the
      // ordering guarantee this branch exists to provide ("a throw anywhere inside
      // it — the migrate, the compose, the apply — cannot leave the worker holding
      // an adopted-but-un-rebased document"). Caught by that very test. The
      // fallback is identical either way: `null`, which blocks, or adopts under
      // `user-file`.
      let rebased: RebaseResult | null = null;
      if (baseline) {
        try {
          const attempt = rebaseOntoRemote(currentDoc, baseline, migrateRemoteOnce());
          if (attempt && 'blockedBy' in attempt) conflictKind = attempt.blockedBy;
          else rebased = attempt;
        } catch (e) {
          console.warn('[applyAndProject] rebase unavailable — the migrate threw:', e);
        }
      }
      if (rebased) {
        // Captured from the UNMIGRATED remote, exactly as the branches below
        // do: it describes the bytes on Drive, so the replay cannot taint it.
        const driveHeads = headsOf(remote);
        currentDoc = rebased.doc;
        resetDocCursors();
        if (id) docFamilyId = id;
        const heads = headsOf(currentDoc);
        schedulePersist();
        scheduleSnapshotPersist();
        const doc = currentDoc;
        time('automerge.pushProjection', () => pushProjection(doc), {
          perf_entity_count: countEntities(doc),
        });
        return {
          action: 'rebased',
          heads,
          // The replay moved us past the bytes Drive holds, so the caller's
          // existing `if (dirty)` publishes the peer's work onto the new lineage.
          dirty: !headsEqual(driveHeads, heads),
          changed: true,
          remoteHeads: driveHeads,
          replayed: rebased.replayed,
          conflicts: rebased.conflicts,
          counterIncrements: rebased.counterIncrements,
          // Already a full projection above, so this is reporting only.
          ...mergeHealth(conflictsBefore, doc),
        };
      }
      // ⚠️ WHERE THE FALLBACK GOES DEPENDS ON WHO ASKED. For an ordinary poll
      // the honest answer is the block this replaced: the peer keeps its work
      // and is told. But `user-file` means a human has already confirmed
      // "replace what is on this device", so blocking there refuses an
      // instruction they gave — and it is the one path that must never dead
      // end. It adopts instead, exactly as it did before the rebase existed.
      // ⚠️ SAY WHY, AND ONLY WHEN IT IS TRUE. A rebase that could not run is
      // otherwise byte-identical in CloudWatch to a policy block that never
      // attempted one, so "the rebase machinery is broken" and "the guard
      // correctly refused" look the same — and the soak that decides whether to
      // enable compaction cannot be judged. Recorded for a genuine failure
      // only: flagging every user-file adopt would poison the metric with the
      // routine case. The user-facing error is deliberately unchanged.
      //
      // ⚠️ NOT `sink.perf`. This was a 1ms sample, and `perfTiming.record`
      // escalates to telemetry only at/above TELEMETRY_FLOOR_MS (250) — so the
      // one signal the soak depends on never left the device. It rides the two
      // real exits instead: the thrown error, and the outcome of the
      // `user-file` adopt below. `docClient.mergeRemoteEnvelope` logs both.
      rebaseUnavailable = true;
      if (lineageCtx !== 'user-file') {
        throw lineageBlockError('adopt-remote', { rebaseUnavailable: true, conflictKind });
      }
    }
    // `rebase` reaches here only via the `user-file` fallback above.
    installWholesale = act === 'adopt' || act === 'rebase';
  }

  // #65: the heads of EXACTLY the bytes on Drive. Captured here, from the
  // UNMIGRATED decrypted doc (`decryptToDoc` does not migrate — see its doc
  // comment), before `migrateDoc`/`mergeDocs` can move anything. This is the
  // ONLY value the caller may record as the Drive baseline.
  //
  // Do NOT substitute `dirty === false` as the proof: the adopt branch below
  // hardcodes `dirty: false` while `migrateDoc` may have emitted a real change,
  // so the returned `heads` can be strictly AHEAD of Drive. That over-claim is
  // the false-skip #65 exists to prevent.
  const remoteHeads = headsOf(remote);

  // Two projection strategies, keyed on `currentDoc`:
  //  • first-load adopt (no local doc) — every entity is new → a FULL projection is
  //    both correct and cheaper than diffing against an empty doc. Timed, because
  //    the load-vs-projection split matters on the cold-load critical path.
  //  • poll-merge (local doc present) — few entities changed → stream a DELTA
  //    (guarded; falls back to full). Below the telemetry floor, not timed.
  // Do NOT convert other pushProjection callers (initAndLoadCache/loadSnapshot/
  // applyChanges) to deltas without the same diff+fallback guard.
  if (installWholesale) {
    // The adopt lands HERE, as a single assignment from an rvalue that is now
    // fully built: nothing between the decrypt and this line can leave the
    // worker document-less, and `resetDocCursors()` below is the drop's other
    // half. A retry re-runs the whole operation from the decrypt.
    // Compose fully, then install ONCE. The stamp is an `Automerge.change` on
    // the migrated remote, deliberately unlike `compactDoc`'s stamp-into-source:
    // rebuilding here would destroy the history the restore exists to recover.
    // A throw inside the change leaves the old document installed.
    const adopted = migrateRemoteOnce();
    // C10: a RESTORE must not un-remove a member. The chosen file predates the removal, so
    // adopting it as-is brings the member back (row and access) on every device that adopts the
    // new generation. `removedMembers` is write-once and unions, so carry this device's
    // tombstones across and delete the matching rows in the same change as the stamp.
    const priorRemoved = stampNewGeneration ? removedMembersOf(currentDoc) : {};
    let removedCarry: { carried: number; rowsDeleted: number } | null = null;
    currentDoc = stampNewGeneration
      ? Automerge.change(adopted, (d) => {
          removedCarry = carryRemovedMembers(d, priorRemoved);
          (d as { podLineage?: PodLineage | null }).podLineage = nextLineage(priorLineage);
        })
      : adopted;
    resetDocCursors(); // adopted a fresh doc → first persist writes a base
    docFamilyId = id;
    const heads = headsOf(currentDoc);
    schedulePersist();
    scheduleSnapshotPersist();
    const doc = currentDoc;
    time('automerge.pushProjection', () => pushProjection(doc), {
      perf_entity_count: countEntities(doc),
    });
    // `changed: true` — we adopted a document into an empty slot, so every
    // consumer's projection is stale by definition.
    //
    // `dirty` is DERIVED, not hardcoded false (#65 review): `migrateDoc` above is
    // not a no-op — when the remote predates a collection it emits a real
    // `Automerge.change`, so the adopted doc can hold a migration delta Drive has
    // never seen. Claiming `dirty: false` there means the delta is never pushed;
    // it then sits unsynced forever, and #65's guard correctly reports unpushed
    // changes on EVERY open without anything ever repairing it. Comparing against
    // the unmigrated remote's heads answers the real question: did adopting move
    // us past the file? When migrate is a no-op these are equal and the behaviour
    // is exactly as before.
    return {
      action: 'adopted',
      heads,
      dirty: !headsEqual(remoteHeads, heads),
      changed: true,
      remoteHeads,
      // Already a full projection above, so this is reporting only.
      ...mergeHealth(conflictsBefore, doc),
      // Only ever true on the `user-file` fallback: this adopt is standing in
      // for a rebase that could not run, and the soak needs to see that.
      ...(rebaseUnavailable ? { rebaseUnavailable: true as const } : {}),
      ...(conflictKind ? { rebaseConflictKind: conflictKind } : {}),
      ...(removedCarry ? { removedMembers: removedCarry } : {}),
    };
  }

  // Non-null by construction: `installWholesale` is initialised to
  // `!currentDoc`, and the branch above returns. Narrowed explicitly rather
  // than asserted, so a future edit that breaks the invariant is a type error
  // rather than a crash on a merge path.
  const local = currentDoc;
  if (!local) throw new Error('mergeRemoteEnvelope: no document after the install branch');
  // Capture localHeads BEFORE the merge: `merged` contains local's full history,
  // so localHeads is a valid `diff` ancestor of merged.heads (getHeads returns a
  // value snapshot, so it survives the in-place merge that mutates `local`).
  const localHeads = headsOf(local);
  const merged = time('automerge.merge', () => mergeDocs(local, remote));
  currentDoc = merged.doc;
  if (id) docFamilyId = id;
  schedulePersist();
  scheduleSnapshotPersist();
  const health = mergeHealth(conflictsBefore, currentDoc);
  // ⚠️ A NEW ROOT CONFLICT FORCES THE FULL PROJECTION (#117, plan F). When a merge changes
  // which map wins at a collection key, the diff is `put [collection]` (a root-level patch,
  // which `projectionDeltasBetween` skips) plus the winner's entities, and NOTHING for the
  // losing map's entities. Deltas would leave those as phantoms in the projection until a
  // reload. Rare (a mixed-fleet migration race), so the full rebuild costs nothing in practice.
  //
  // Otherwise: projectionDeltasBetween is pure and derives fully (or null) BEFORE pushDeltas
  // streams anything → a derivation failure can never leave a half-updated
  // projection. `?? buildFullProjection` is NULLISH: an empty (but valid) delta
  // set streams nothing rather than triggering a spurious full rebuild.
  const deltas =
    health.rootConflicts.added > 0
      ? null
      : projectionDeltasBetween(currentDoc, localHeads, merged.heads);
  pushDeltas(deltas ?? buildFullProjection(currentDoc));
  // Reuses the same `headsEqual` the persist path uses, against the localHeads
  // captured before the merge — so `changed` means precisely "our doc moved".
  return {
    action: 'merged',
    heads: merged.heads,
    dirty: merged.dirty,
    changed: !headsEqual(localHeads, merged.heads),
    remoteHeads,
    ...health,
  };
}

/** Decrypt + materialize-check a fetched envelope WITHOUT installing it (verify
 * a written/round-tripped payload loads cleanly). Throws `CorruptPayloadError`
 * if not; otherwise `{ok:true}`. Uses the current family key. */
export async function verifyEnvelope(envelope: BeanpodFileV4): Promise<{ ok: true }> {
  const key = requireKey('verifyEnvelope');
  await decryptToDoc(envelope, key); // throws CorruptPayloadError on bad bytes
  return { ok: true };
}

/**
 * Read ONLY the Drive connections out of a fetched envelope. Decrypts, takes the
 * one collection, and throws the document away.
 *
 * ⚠️ THE RETURN TYPE IS THE SAFETY PROPERTY, not a convenience. This runs beside
 * the merge path on a device whose pod is lineage-BLOCKED — the one state in
 * which merging is exactly what must not happen. A sibling that handed back a
 * decrypted `Doc` would be one `mergeDocs` away from becoming the sync path it
 * exists to avoid; one that can only ever yield credentials cannot. Do not
 * generalize this into `readRemoteDoc`.
 *
 * `materializeCollection` is the same function the projection uses, so the
 * values that cross the postMessage boundary are plain and structured-clone-safe
 * (no Automerge proxies). The cast mirrors the projection's: the document is
 * untyped at the entity level, and the collection name is what pins the shape.
 */
export async function readDriveConnections(
  envelope: BeanpodFileV4
): Promise<{ connections: DriveConnection[] }> {
  const key = requireKey('readDriveConnections');
  const doc = await decryptToDoc(envelope, key);
  // `decryptToDoc` does not migrate, so the Counter map may be absent: `foldIndex` reads that as
  // empty, and `driveConnections` has no Counter fields anyway. Passed because the funnel's
  // index is required, never optional.
  return {
    connections: materializeCollection(doc, 'driveConnections', foldIndex(doc)).map(
      ([, entity]) => entity as DriveConnection
    ),
  };
}

/** Serialize + encrypt the current doc → base64 payload (main assembles the
 * envelope + uploads; key material never leaves main for the upload path).
 *
 * Also returns `heads` — the heads of EXACTLY the serialized doc (#65). Captured
 * synchronously from the same `doc` const, BEFORE the `await`: `getHeads`
 * returns a value snapshot, so it survives a later handle-consuming `mutate`,
 * whereas re-reading `currentDoc` after the await could report heads AHEAD of
 * the bytes we uploaded — an over-claim, and precisely the false-skip #65
 * exists to prevent. The caller commits these as the Drive baseline once the
 * write is acked. */
export async function exportEncryptedPayload(): Promise<ExportedPayload> {
  const doc = requireDoc('exportEncryptedPayload');
  const key = requireKey('exportEncryptedPayload');
  const heads = headsOf(doc);
  // Read from the SAME `doc` const the heads come from, so the lineage
  // describes exactly the bytes being exported. Main derives the envelope
  // version from it (`beanpodVersionFor`); it is never carried on the envelope.
  const lineage = docLineage(doc);
  const payload = await time2('automerge.save', () => encryptDocPayload(doc, key));
  return { payload, heads, lineage };
}

// ─── Change-aware transport (Plan B — incremental delta sync) ────────────────

export function getHeads(): { heads: Heads } {
  return { heads: headsOf(requireDoc('getHeads')) };
}

/**
 * Apply changes to the live doc in place, then report whether they LANDED. Plan B
 * MUST NOT assume `applyChanges` threw on a missing dependency — Automerge 3.2.6
 * SILENTLY BUFFERS a change whose causal deps are absent (it neither throws nor
 * advances heads; the change sits invisible until its deps arrive). So the only
 * correct "did it land" signal is `getMissingDeps(doc, []) === []` after applying.
 * On landed → guarded delta projection + persist. On NOT landed → leave the doc
 * (with its buffered changes) but push NOTHING and persist NOTHING: the caller
 * falls back to a whole-doc base adopt, which carries every dep and resolves the
 * buffered changes into a correct, fully-projected state.
 */
function applyChangesInternal(changes: Uint8Array[]): { heads: Heads; landed: boolean } {
  const local = requireDoc('applyChanges');
  const localHeads = headsOf(local);
  const { doc: next } = applyChangesOp(local, changes);
  currentDoc = next;
  const landed = Automerge.getMissingDeps(next, []).length === 0;
  const heads = headsOf(next);
  if (landed) {
    schedulePersist();
    pushDeltas(projectionDeltasBetween(next, localHeads, heads) ?? buildFullProjection(next));
  }
  return { heads, landed };
}

/** Apply plaintext changes (DEV/E2E + inline symmetry). Returns `landed`. */
export function applyChanges(changes: Uint8Array[]): { heads: Heads; landed: boolean } {
  return applyChangesInternal(changes);
}

/** Gather every referenced photoId (runs the collect hooks on the worker doc).
 * Throws `PhotoCollectHookError` if a hook fails → `gcOrphans` aborts the sweep. */
export function collectReferencedPhotoIds(): { ids: string[] } {
  return { ids: Array.from(collectPhotoIds(requireDoc('collectReferencedPhotoIds'))) };
}

// ─── Envelope cache (main owns envelope truth; worker holds a cache copy) ─────

export async function persistEnvelope(envelope: BeanpodFileV4): Promise<void> {
  await cache.persistEnvelope(envelope);
}
export async function readEnvelope(): Promise<{ envelope: BeanpodFileV4 | null }> {
  return { envelope: await cache.loadCachedEnvelope() };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Force an immediate cache persist (backgrounding flush). Cancels the debounce and
 * awaits the single-flight chain so any in-flight persist completes too. */
export async function flush(): Promise<void> {
  cancelPendingPersists();
  await enqueuePersist();
  await enqueueSnapshotPersist(); // leave a fresh fast-paint snapshot on backgrounding
}

/** Drop the current doc but KEEP the family key + cache (replace semantics: the
 * next `mergeRemoteEnvelope` adopts the remote as a fresh doc rather than merging
 * into a stale one). Used when loading a file to REPLACE, not merge. */
export function dropDoc(): void {
  currentDoc = null;
  docFamilyId = null;
  resetDocCursors();
}

/** Drop the in-memory doc (sign-out). Does NOT delete the cache — `clearCache` does that —
 * but DOES close the connection to it: a signed-out tab has no reason to hold one, and
 * holding it is what blocks another tab's delete (#100). Every open site reopens
 * idempotently on a null handle. The main-thread projection is cleared by the caller
 * (`docClient.reset`).
 *
 * ⚠️ C5f: IT FLUSHES FIRST (bounded), unless `clearing` says the data is being deleted
 * anyway. It used to CANCEL the debounced persist, so a keep-data sign-out within ~120 ms of
 * an edit lost that edit from the only durable copy this device had. Either way an in-flight
 * persist is awaited (bounded) before the handle closes (C5g).
 *
 * Synchronous when no cache is open (nothing can be persisted, so there is nothing to wait
 * for), so a caller that does not await still sees the realm torn down on return. */
export function reset(opts?: { clearing?: boolean }): Promise<void> {
  if (!cache.isCacheReady()) {
    teardownRealm();
    return Promise.resolve();
  }
  return settlePersists(!opts?.clearing && docOwnsOpenCache()).then(teardownRealm);
}

function teardownRealm(): void {
  cancelPendingPersists();
  cache.closeCacheDB();
  currentDoc = null;
  familyKey = null;
  docFamilyId = null;
  cachePersistFailed = false;
  // One lifetime, not two: the actor is retained beside the key and dies with it.
  resetDocActor();
  resetDocCursors();
}

/** Sign-out / family-switch: drop the doc AND close-then-delete the cache DB. Clearing, so
 * nothing pending is flushed into a database about to be deleted. */
export async function clearCache(id: string): Promise<CacheClearResult> {
  await reset({ clearing: true });
  return cache.clearCache(id);
}

// ─── E2E snapshot (DEV-only — plaintext doc bytes) ───────────────────────────

/** Load a raw (unencrypted) Automerge binary as the doc. DEV/E2E-only seed path. */
export function loadSnapshot(binary: Uint8Array): { loaded: true } {
  if (!import.meta.env.DEV) throw new Error('loadSnapshot is DEV-only');
  currentDoc = loadDoc(binary);
  resetDocCursors(); // fresh doc → first persist writes a base
  docFamilyId = null;
  pushProjection(currentDoc);
  return { loaded: true };
}

/**
 * Rebuild the document WITHOUT its history, verify it, and install it.
 *
 * `Automerge.from(Automerge.toJS(doc))` is the only way to drop history in
 * Automerge 3.x. It mints brand-new object ids, so the result is a different
 * LINEAGE — see `services/sync/podLineage.ts`.
 *
 * ⚠️ THE CALLER MUST NOT STAMP. This function does it, inside the rebuild, so
 * the verify gate compares the document it actually installs. An earlier version
 * of this line said the caller was responsible — true only while the stamp lived
 * on the envelope; following it now emits two changes where one is allowed. The
 * caller publishes.
 *
 * ⚠️ THREE things here are load-bearing:
 *
 *  1. **Verify before installing.** The source is pure JSON (`foldDoc` folds every
 *     Counter into its absolute first), so `fold -> from` is type-safe by construction — but "by construction" is not good enough
 *     when the output replaces a family's pod. On any difference the OLD doc is
 *     kept and the path of the first difference is thrown (a path, never a
 *     value: this reaches the firehose).
 *  2. **`resetDocCursors()` on install.** The compacted doc shares no ancestry
 *     with the cached one, so a persist that wrote an INCREMENT against it would
 *     produce an unreadable cache. Every other install site does this for the
 *     same reason.
 *  3. **`docInitOpts()` for the actor**, never a locally minted one, or the
 *     compaction would re-introduce the churn the stable actor removed — in the
 *     one document that has just been stripped of its history.
 *
 * Schedules NO persist: the caller flushes explicitly, after it has decided the
 * compaction is going ahead.
 */
export function compactDoc(): {
  beforeBytes: number;
  afterBytes: number;
  changesBefore: number;
  changesAfter: number;
  actorsBefore: number;
} {
  const before = requireDoc('compactDoc');
  // ⚠️ INSIDE the classifier. `saveDoc(before)` is a full serialize of the
  // LARGEST (uncompacted) document — the single biggest allocation here — and
  // it sat outside the try whose entire purpose is to turn an out-of-memory
  // failure into a `PayloadTooLargeError`. A RangeError there reached the
  // firehose unclassified, so the one signal that says "this device cannot
  // compact its own pod" was missing on exactly the devices that produce it.
  let beforeStats: ReturnType<typeof Automerge.stats>;
  let beforeBytes: number;
  try {
    beforeStats = Automerge.stats(before);
    beforeBytes = saveDoc(before).byteLength;
  } catch (e) {
    throw payloadFailure('materialize', e, null, null);
  }

  let compacted: Doc;
  try {
    // #117 Phase 2: the source is FOLDED, never a bare `toJS`. `foldDoc` writes every Counter
    // key into its absolute, empties `counterDeltas` and EXTENDS the `foldedCounters` ledger (the
    // rebase reads it to re-emit only growth since this compaction). A bare `toJS` would carry
    // the map through as live Counters, which the rebuilt history then owns under the
    // compactor's actor; and the verify below would compare Counter instances, not JSON.
    const plain = foldDoc(before);
    // The new identity, written INTO the document — see ADR-036. It travels
    // with the history it describes and cannot drift from it, which is the whole
    // reason this moved off the envelope. `docLineage` normalises the legacy
    // absent case, so a first compaction reads `seq: 1`.
    //
    // ⚠️ STAMPED INTO THE SOURCE, not applied as a second `Automerge.change`
    // afterwards. A separate change would leave the compacted document at TWO
    // changes rather than one, in the tier whose entire point is that the
    // rebuilt document is a single change; and it would force the verify below
    // to run against an unstamped copy, so the check would no longer describe
    // the bytes actually installed.
    // C1: the stamp carries the heads of the document it was built FROM, so a later merge can
    // tell "the remote is the history I compacted" from "a peer wrote after I compacted"
    // (`remoteMovedPast`). Inside the stamp, so it travels with the history it describes.
    const source = {
      ...plain,
      podLineage: { ...nextLineage(docLineage(before)), fromHeads: headsOf(before) },
    };
    compacted = Automerge.from(source, docInitOpts()) as Doc;
    // Proves the rebuild round-tripped EXACTLY — including the stamp, which is
    // the one field we deliberately changed and therefore the one worth
    // confirming landed.
    const differsAt = firstJsonDifference(source, Automerge.toJS(compacted));
    if (differsAt) {
      // The old doc is untouched — we never assigned `currentDoc`.
      //
      // ⚠️ THE PATH IS MASKED BEFORE IT BECOMES A MESSAGE. `firstJsonDifference`
      // promises "a PATH, never a value", and the value half holds — but one
      // collection is keyed by a GOOGLE ACCOUNT EMAIL (`driveConnections`, see
      // `driveConnectionId`), so the path itself can be
      // `driveConnections.someone@example.com.refreshToken`. That message
      // becomes the error's stack, which `logEvent` writes OUTSIDE the
      // allowlisted context and `reportError` pastes into Slack. The
      // collection and the leaf are what a person triaging needs; the id in
      // between never is.
      throw new Error(`compaction changed the document at ${maskEntityIds(differsAt)}`);
    }
    // C9b: the round trip above proves the REBUILD; this proves the FOLD. `foldDoc` rewrites
    // every Counter-backed absolute, so the source is not the document's JSON, and only the
    // materialised view, what every person in the family actually sees, can say the fold was
    // exact. Compared per delta (one per collection, plus settings) so the error names WHERE,
    // never a value; each collection as an id-keyed map, because entity ORDER is not data (the
    // rebuild may enumerate a map in a different order).
    const viewBefore = buildFullProjection(before).map(viewKey);
    const viewAfter = buildFullProjection(compacted).map(viewKey);
    for (let i = 0; i < Math.max(viewBefore.length, viewAfter.length); i++) {
      if (!canonicalEqual(viewBefore[i]?.value, viewAfter[i]?.value)) {
        const where = (viewBefore[i] ?? viewAfter[i])?.where ?? 'unknown';
        throw new Error(`compaction changed the materialised ${where}`);
      }
    }
  } catch (e) {
    // #117 Phase 2: `foldDoc` refused over a newer build's Counter field. Nothing is corrupt
    // and nothing ran out of memory, so it passes UNCLASSIFIED: `payloadFailure` would turn it
    // into a `CorruptPayloadError` ("your data may be damaged"), when the truth is "update the
    // app first". `usePodCompaction` maps the class to that copy.
    if (e instanceof StaleBuildCounterError) throw e;
    // Classified, so an OOM here reads as "this device ran out of memory" with
    // the copy that is already written, rather than "your data is damaged". A
    // compaction costs MORE memory than an open (three copies resident at once),
    // so this is a real possibility on the devices that most want it.
    throw payloadFailure('materialize', e, null, beforeBytes);
  }

  // ⚠️ EVERYTHING THAT CAN THROW HAPPENS BEFORE THE INSTALL.
  //
  // `saveDoc(compacted)` and `Automerge.stats` used to run AFTER
  // `currentDoc = compacted` and outside the try. An OOM in that tail — the
  // likeliest place for one, on exactly the low-memory device this feature
  // targets — rejected the RPC, so `usePodCompaction` reported
  // "rebuild-failed" and told the user nothing had moved, while the worker was
  // left HOLDING the compacted document with its cursors reset and its lineage
  // never stamped. The next persist then wrote the compacted base to cache and
  // the next save uploaded it under the OLD lineage, where every peer reads
  // `same` and CRDT-merges across lineages — undoing the compaction fleet-wide.
  let stats: {
    beforeBytes: number;
    afterBytes: number;
    changesBefore: number;
    changesAfter: number;
    actorsBefore: number;
  };
  try {
    stats = {
      beforeBytes,
      afterBytes: saveDoc(compacted).byteLength,
      changesBefore: beforeStats.numChanges,
      changesAfter: Automerge.stats(compacted).numChanges,
      actorsBefore: (beforeStats as { numActors?: number }).numActors ?? 0,
    };
  } catch (e) {
    // The OLD document is still installed and still current. Nothing moved.
    throw payloadFailure('materialize', e, null, beforeBytes);
  }

  // ⚠️ THE PROJECTION PUSH IS PART OF "CAN THROW", and it was left outside.
  // `pushProjection` builds every collection and structure-clones each chunk
  // across the worker boundary — strictly MORE allocation than the `saveDoc`
  // that was moved into the try, on the same low-memory device. An OOM (or a
  // DataCloneError) there rejected the RPC, so the composable reported
  // "rebuild-failed" and toasted "nothing has changed and your data is safe",
  // while the worker held the COMPACTED document with cursors reset and no
  // lineage stamp — for the next save to publish under the OLD lineage.
  const previous = before; // non-null: `requireDoc('compactDoc')` produced it
  currentDoc = compacted;
  resetDocCursors(); // see (2) above — the next persist MUST write a base
  try {
    pushProjection(compacted);
  } catch (e) {
    // ⚠️ RESTORE, DO NOT RE-PUSH. Retrying the very operation that just threw —
    // on the OOM-prone device this feature targets — throws again, escapes this
    // catch, and replaces the classified `PayloadTooLargeError` with a raw
    // RangeError, so the composable reports "rebuild-failed" with no
    // out-of-memory signal at all. Main's projection is still the OLD one
    // (nothing replaced it), and `firstJsonDifference` already proved the
    // rebuilt document holds identical DATA, so there is nothing to re-push.
    currentDoc = previous;
    resetDocCursors();
    throw payloadFailure('materialize', e, null, beforeBytes);
  }
  return stats;
}

/** One projection delta as an order-blind value for the compaction's view compare (C9b). */
function viewKey(d: ProjectionDelta): { where: string; value: unknown } {
  if (d.kind === 'bulk') return { where: d.collection, value: Object.fromEntries(d.entities) };
  return { where: d.kind, value: d };
}

/** Serialize the doc to a raw (unencrypted) binary. DEV/E2E-only snapshot path. */
export function exportSnapshot(): { binary: Uint8Array } {
  if (!import.meta.env.DEV) throw new Error('exportSnapshot is DEV-only');
  return { binary: saveDoc(requireDoc('exportSnapshot')) };
}

// ─── Dispatch (single method→handler map; shared by worker loop + inline) ────

/** Route one RPC method to its handler. Returns the `{result, delta}` envelope
 * (delta only for `mutate`). Used by BOTH `docWorker` (over the async-FIFO) and
 * the inline fallback executor — one dispatch table, no drift. */
export async function dispatch(method: string, args: unknown): Promise<DispatchReply> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'setKey':
      // ⚠️ AWAITED. Importing raw bytes is async, and a floating promise here would let the
      // rehydrate that follows run against a realm whose key has not landed yet.
      await setKey((a.raw ?? a.key) as CryptoKey | Uint8Array);
      return {};
    case 'compactDoc':
      return { result: compactDoc() };
    case 'setActor':
      setActor((a.actor as string | null) ?? null);
      return {};
    case 'initDoc':
      return { result: initDoc() };
    case 'initAndLoadCache':
      return { result: await initAndLoadCache(a.familyId as string) };
    case 'loadProjectionSnapshot':
      return { result: await loadProjectionSnapshot(a.familyId as string) };
    case 'openCache':
      return { result: await openCache(a.familyId as string) };
    case 'noteRemoteBaseline':
      noteRemoteBaseline(a.payload as string);
      return {};
    case 'mutate':
      return mutate(args as MutationOp);
    case 'mergeRemoteEnvelope':
      return {
        result: await mergeRemoteEnvelope(
          a.envelope as BeanpodFileV4,
          (a.familyId as string | null) ?? null,
          a.basis as LineageBasis
        ),
      };
    case 'exportEncryptedPayload':
      return { result: await exportEncryptedPayload() };
    case 'verifyEnvelope':
      return { result: await verifyEnvelope(a.envelope as BeanpodFileV4) };
    case 'readDriveConnections':
      return { result: await readDriveConnections(a.envelope as BeanpodFileV4) };
    case 'getHeads':
      return { result: getHeads() };
    case 'hasHeads':
      return { result: hasHeads((a.heads as Heads) ?? []) };
    case 'pushProjection':
      return { result: pushFullProjection() };
    case 'applyChanges':
      return { result: applyChanges(a.changes as Uint8Array[]) };
    case 'collectReferencedPhotoIds':
      return { result: collectReferencedPhotoIds() };
    case 'persistEnvelope':
      await persistEnvelope(a.envelope as BeanpodFileV4);
      return {};
    case 'readEnvelope':
      return { result: await readEnvelope() };
    case 'loadSnapshot':
      return { result: loadSnapshot(a.binary as Uint8Array) };
    case 'exportSnapshot':
      return { result: exportSnapshot() };
    case 'flush':
      await flush();
      return {};
    case 'dropDoc':
      dropDoc();
      return {};
    case 'reset':
      await reset({ clearing: a.clearing === true });
      return {};
    case 'clearCache':
      return { result: await clearCache(a.familyId as string) };
    case 'ping':
      // Liveness probe — confirms the worker's message loop is alive. Touches no
      // doc/key state, so it answers even before unlock (docClient.checkWorkerLiveness).
      return { result: { ok: true } };
    default:
      throw new Error(`applyAndProject: unknown method '${method}'`);
  }
}

// ─── Async timing helper (kept below the sync `time` for readability) ────────

async function time2<T>(label: string, fn: () => Promise<T>, ctx?: PerfCtx): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    sink.perf(label, performance.now() - start, ctx);
  }
}

/** Test-only: reset all orchestrator state (does not touch the cache DB). */
export function __resetApplyAndProjectForTesting(): void {
  cancelPendingPersists();
  snapshotInFlight = Promise.resolve();
  currentDoc = null;
  familyKey = null;
  docFamilyId = null;
  cachePersistFailed = false;
  resetDocCursors();
  persistInFlight = Promise.resolve();
  sink = NOOP_SINK;
}

/** Test-only: peek at whether a doc is currently loaded. */
export function __hasDocForTesting(): boolean {
  return currentDoc !== null;
}
