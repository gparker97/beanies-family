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
import { COLLECTION_NAMES, type FamilyDocument } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import {
  migrateDoc,
  loadDoc,
  saveDoc,
  applyMutation,
  mergeDocs,
  getHeads as headsOf,
  getChangesSince as changesSince,
  applyChanges as applyChangesOp,
  decryptToDoc,
  encryptDocPayload,
  encryptChunk,
  decryptChunk,
  buildFullProjection,
  projectionDeltasBetween,
  frameChanges,
  registerNamedOp,
} from './docOps';
import { attachPhotoNamedHandler, collectReferencedPhotoIds as collectPhotoIds } from './photoOps';
import * as cache from './cache';
import type { MutationOp, ProjectionDelta, Heads, CachePersistFailureDetail } from './protocol';

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
}

const NOOP_SINK: WorkerSink = { pushChunk() {}, perf() {}, cachePersistFailed() {} };

/** Entities per streamed chunk. A big collection is sliced so each `postMessage`
 * is a bounded main-thread task rather than one giant structured clone. */
const PROJECTION_CHUNK = 1000;
/** Cache-persist coalesce window. Short (off-thread now, incremental) — a safety
 * valve, not zero (batches a rapid burst of mutations into one increment write). */
const PERSIST_DEBOUNCE_MS = 120;
/** Re-compact (rewrite a fresh whole-doc base, clearing increments) once this many
 * increments sit on top of the base — bounds both cache size and cold-reload cost. */
const INCREMENT_COMPACTION_THRESHOLD = 200;

// ─── Module state (one instance per realm — worker OR inline main) ───────────

let currentDoc: Doc | null = null;
let familyKey: CryptoKey | null = null;
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

/** Wire the sink once (worker startup / inline adapter init). Also registers the
 * photo attach/collect family here (not at module load) so it can't hit a
 * docOps `namedRegistry` TDZ under a circular import — configure runs after all
 * modules have finished loading, in whichever realm (worker OR inline). */
export function configure(nextSink: WorkerSink): void {
  sink = nextSink;
  registerNamedOp('attachPhotoToEntity', attachPhotoNamedHandler);
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

/** Clear the durability banner after a successful write. */
function markPersistOk(): void {
  if (cachePersistFailed) {
    cachePersistFailed = false;
    sink.cachePersistFailed(false);
  }
}

/** Write a fresh whole-doc BASE (clears increments, resets seq) and advance the
 * cursor. Used for the first persist of a doc, after adopt/replace, on recovery,
 * and for re-compaction. `doc` is the entry snapshot — stable across the await even
 * if a concurrent `reset()`/replace nulls or swaps `currentDoc`. */
async function writeBase(key: CryptoKey, doc: Doc): Promise<void> {
  const captureHeads = headsOf(doc);
  const start = performance.now();
  const binary = saveDoc(doc);
  sink.perf('automerge.saveBase', performance.now() - start, { perf_doc_bytes: binary.byteLength });
  await cache.persistDocBinary(key, binary);
  if (currentDoc === doc) lastPersistedHeads = captureHeads;
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
 * capture. The `currentDoc === doc` guard drops a stale cursor advance if the doc
 * was replaced/reset mid-write.
 */
async function persistOnce(): Promise<void> {
  if (!currentDoc || !familyKey || !cache.isCacheReady()) return;
  const doc = currentDoc;
  const key = familyKey;
  // Track which write is in flight so the failure signal can carry `kind` — MUST be
  // explicit, not inferred from lastPersistedHeads (the re-compaction writeBase below
  // runs with a non-null lastPersistedHeads and would be mislabeled 'increment').
  let writeKind: 'base' | 'increment' = 'base';
  try {
    if (lastPersistedHeads === null) {
      writeKind = 'base';
      await writeBase(key, doc);
    } else {
      const captureHeads = headsOf(doc);
      const changes = changesSince(doc, lastPersistedHeads);
      if (changes.length === 0) {
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
      if (currentDoc === doc) lastPersistedHeads = captureHeads;
      if (cache.incrementCount() >= INCREMENT_COMPACTION_THRESHOLD) {
        writeKind = 'base';
        await writeBase(key, doc); // re-compaction: fresh base drops the increments
      }
    }
    markPersistOk();
  } catch (e) {
    // A durable-cache write failure is the "local durability broken" signal —
    // surface it (persistent banner on main + telemetry), don't swallow it.
    // `lastPersistedHeads` is NOT advanced on failure → the delta is re-captured
    // next tick. The console.error is the worker's only local channel (it can't
    // reach logEvent/reportError) — keep it; the signal carries triage detail.
    cachePersistFailed = true;
    const errorName = e instanceof Error ? e.name : 'UnknownError';
    sink.cachePersistFailed(true, { kind: writeKind, errorName });
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

/** Post the family key (once at unlock; re-posted on re-spawn). */
export function setKey(key: CryptoKey): void {
  familyKey = key;
}

/** Create a fresh empty document (create-family). Pushes the full projection. */
export function initDoc(): { loaded: true } {
  currentDoc = migrateDoc(Automerge.init<FamilyDocument>());
  lastPersistedHeads = null; // fresh doc → first persist writes a base
  pushProjection(currentDoc);
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
  await cache.initPersistenceDB(id);
  return { loaded: false };
}

export async function initAndLoadCache(id: string): Promise<{ loaded: boolean }> {
  await cache.initPersistenceDB(id);
  const key = requireKey('initAndLoadCache');
  let loaded: { doc: Doc; recovered: boolean } | null;
  try {
    loaded = await time2('automerge.cacheLoad', () => cache.loadCachedDoc(key, id));
  } catch (e) {
    // Corrupt cache: clear it so a fresh Drive load can re-seed a clean cache,
    // then rethrow so the caller (and telemetry) sees the CorruptPayloadError.
    await cache.clearCache(id).catch(() => {});
    await cache.initPersistenceDB(id);
    throw e;
  }
  if (!loaded) return { loaded: false };
  // Capture the reconstructed heads BEFORE migrate (which consumes the handle). A
  // migrate delta, if any, then persists as an increment on the next tick; the
  // cursor is DERIVED here from the reconstructed doc, never a stored value.
  const preHeads = headsOf(loaded.doc);
  currentDoc = migrateDoc(loaded.doc);
  if (loaded.recovered) {
    // A corrupt increment was skipped on load — rewrite a clean base to drop the
    // corrupt tail rows (base-write clears all increments).
    lastPersistedHeads = null;
    void enqueuePersist();
  } else {
    lastPersistedHeads = preHeads;
  }
  const doc = currentDoc;
  time('automerge.pushProjection', () => pushProjection(doc), {
    perf_entity_count: countEntities(doc),
  });
  return { loaded: true };
}

/** Compare two Automerge heads (deterministic sorted change-hash arrays). */
function headsEqual(a: Heads, b: Heads): boolean {
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

/** Apply a declarative mutation; schedule a cache persist ONLY if the doc actually
 * changed. The delta rides the response (applied to the projection before the
 * caller's promise resolves). `changed:false` for a no-op (skipped `onMissing`, or
 * a named op that wrote nothing) → no cache persist here, and the caller skips the
 * Drive save (F10). */
export function mutate(op: MutationOp): {
  result: unknown;
  delta: ProjectionDelta;
  changed: boolean;
} {
  const doc = requireDoc('mutate');
  const before = headsOf(doc);
  const { doc: next, result, delta } = applyMutation(doc, op);
  const changed = !headsEqual(before, headsOf(next));
  currentDoc = next;
  if (changed) schedulePersist();
  return { result, delta, changed };
}

/**
 * Decrypt a fetched remote envelope and CRDT-merge it into the local doc.
 * Returns heads + heads-derived `dirty` (did the merge leave local changes the
 * converged doc must push back?). Pushes the full merged projection (chunked);
 * the caller resolves only after the final chunk → post-merge readers (e.g.
 * dedup) see the complete set. Persists the merged doc to cache.
 */
export async function mergeRemoteEnvelope(
  envelope: BeanpodFileV4,
  id: string | null
): Promise<{ heads: Heads; dirty: boolean }> {
  const key = requireKey('mergeRemoteEnvelope');
  const remote = await time2('automerge.remoteLoad', () => decryptToDoc(envelope, key), {
    perf_doc_bytes: envelope.encryptedPayload.length,
  });

  void id; // familyId is tracked inside `cache`; kept in the signature for the wire contract

  // Two projection strategies, keyed on `currentDoc`:
  //  • first-load adopt (no local doc) — every entity is new → a FULL projection is
  //    both correct and cheaper than diffing against an empty doc. Timed, because
  //    the load-vs-projection split matters on the cold-load critical path.
  //  • poll-merge (local doc present) — few entities changed → stream a DELTA
  //    (guarded; falls back to full). Below the telemetry floor, not timed.
  // Do NOT convert other pushProjection callers (initAndLoadCache/loadSnapshot/
  // applyChanges) to deltas without the same diff+fallback guard.
  if (!currentDoc) {
    currentDoc = migrateDoc(remote);
    lastPersistedHeads = null; // adopted a fresh doc → first persist writes a base
    const heads = headsOf(currentDoc);
    schedulePersist();
    const doc = currentDoc;
    time('automerge.pushProjection', () => pushProjection(doc), {
      perf_entity_count: countEntities(doc),
    });
    return { heads, dirty: false };
  }

  const local = currentDoc;
  // Capture localHeads BEFORE the merge: `merged` contains local's full history,
  // so localHeads is a valid `diff` ancestor of merged.heads (getHeads returns a
  // value snapshot, so it survives the in-place merge that mutates `local`).
  const localHeads = headsOf(local);
  const merged = time('automerge.merge', () => mergeDocs(local, remote));
  currentDoc = merged.doc;
  schedulePersist();
  // projectionDeltasBetween is pure and derives fully (or null) BEFORE pushDeltas
  // streams anything → a derivation failure can never leave a half-updated
  // projection. `?? buildFullProjection` is NULLISH: an empty (but valid) delta
  // set streams nothing rather than triggering a spurious full rebuild.
  const deltas = projectionDeltasBetween(currentDoc, localHeads, merged.heads);
  pushDeltas(deltas ?? buildFullProjection(currentDoc));
  return { heads: merged.heads, dirty: merged.dirty };
}

/** Decrypt + materialize-check a fetched envelope WITHOUT installing it (verify
 * a written/round-tripped payload loads cleanly). Throws `CorruptPayloadError`
 * if not; otherwise `{ok:true}`. Uses the current family key. */
export async function verifyEnvelope(envelope: BeanpodFileV4): Promise<{ ok: true }> {
  const key = requireKey('verifyEnvelope');
  await decryptToDoc(envelope, key); // throws CorruptPayloadError on bad bytes
  return { ok: true };
}

/** Serialize + encrypt the current doc → base64 payload (main assembles the
 * envelope + uploads; key material never leaves main for the upload path). */
export async function exportEncryptedPayload(): Promise<{ payload: string }> {
  const doc = requireDoc('exportEncryptedPayload');
  const key = requireKey('exportEncryptedPayload');
  const payload = await time2('automerge.save', () => encryptDocPayload(doc, key));
  return { payload };
}

// ─── Change-aware transport (Plan B — incremental delta sync) ────────────────

export function getHeads(): { heads: Heads } {
  return { heads: headsOf(requireDoc('getHeads')) };
}

/** This device's stable Automerge actor id — used to name its own change-log
 * chunks (`changes/<actorId>-<seq>.beanchanges`). Stable per device since Layer 1
 * merges in place (one actor per device, no per-poll actor churn). */
export function getActorId(): { actorId: string } {
  return { actorId: Automerge.getActorId(requireDoc('getActorId')) };
}
export function getChangesSince(heads: Heads): { changes: Uint8Array[] } {
  return { changes: changesSince(requireDoc('getChangesSince'), heads) };
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

/**
 * Export the local changes since `sinceHeads` as an encrypted, self-describing
 * `.beanchanges` chunk (Plan B publish). Crypto stays in the worker — main gets
 * only ciphertext to upload. `frontierHeads` lets any reader apply idempotently
 * and derive `dirty` without a shared manifest.
 */
export async function exportIncrementalPayload(sinceHeads: Heads): Promise<{ payload: string }> {
  const doc = requireDoc('exportIncrementalPayload');
  const key = requireKey('exportIncrementalPayload');
  const chunk = { frontierHeads: headsOf(doc), changes: changesSince(doc, sinceHeads) };
  const payload = await time2('automerge.saveIncremental', () => encryptChunk(chunk, key));
  return { payload };
}

/**
 * Decrypt + apply a batch of remote `.beanchanges` chunk ciphertexts (Plan B poll).
 * All chunks apply in ONE `applyChanges` so intra-batch deps resolve in a single
 * pass. Returns `landed` (see `applyChangesInternal`) and, only when landed,
 * `dirty` = did the merged doc advance beyond the remote frontier (local carried
 * unsynced changes → the caller re-publishes). A non-landed batch returns
 * `dirty:false` and the caller reconciles via the whole-doc base.
 */
export async function applyRemoteChunks(
  payloads: string[]
): Promise<{ heads: Heads; landed: boolean; dirty: boolean }> {
  requireDoc('applyRemoteChunks');
  const key = requireKey('applyRemoteChunks');
  // Split from the whole-doc `automerge.remoteLoad` (base adopt at :355) so the
  // delta-chunk decrypt is distinguishable in CloudWatch — see #44 instrumentation.
  const chunks = await time2('automerge.remoteChunkDecrypt', () =>
    Promise.all(payloads.map((p) => decryptChunk(p, key)))
  );
  const allChanges: Uint8Array[] = [];
  const remoteFrontier: Heads = [];
  for (const c of chunks) {
    allChanges.push(...c.changes);
    remoteFrontier.push(...c.frontierHeads);
  }
  const { heads, landed } = applyChangesInternal(allChanges);
  if (!landed) return { heads, landed, dirty: false };
  // Landed → every remote frontier hash is materialized, so getChangesSince is safe.
  const dirty = changesSince(requireDoc('applyRemoteChunks'), remoteFrontier).length > 0;
  return { heads, landed, dirty };
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
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await enqueuePersist();
}

/** Drop the current doc but KEEP the family key + cache (replace semantics: the
 * next `mergeRemoteEnvelope` adopts the remote as a fresh doc rather than merging
 * into a stale one). Used when loading a file to REPLACE, not merge. */
export function dropDoc(): void {
  currentDoc = null;
  lastPersistedHeads = null;
}

/** Drop the in-memory doc + cancel the debounce (sign-out). Does NOT delete the
 * cache — `clearCache` does that. The main-thread projection is cleared by the
 * caller (`docClient.reset`). */
export function reset(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  currentDoc = null;
  familyKey = null;
  cachePersistFailed = false;
  lastPersistedHeads = null;
}

/** Sign-out / family-switch: drop the doc AND close-then-delete the cache DB. */
export async function clearCache(id: string): Promise<void> {
  reset();
  await cache.clearCache(id);
}

// ─── E2E snapshot (DEV-only — plaintext doc bytes) ───────────────────────────

/** Load a raw (unencrypted) Automerge binary as the doc. DEV/E2E-only seed path. */
export function loadSnapshot(binary: Uint8Array): { loaded: true } {
  if (!import.meta.env.DEV) throw new Error('loadSnapshot is DEV-only');
  currentDoc = loadDoc(binary);
  lastPersistedHeads = null; // fresh doc → first persist writes a base
  pushProjection(currentDoc);
  return { loaded: true };
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
export async function dispatch(
  method: string,
  args: unknown
): Promise<{ result?: unknown; delta?: unknown; changed?: boolean }> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'setKey':
      setKey(a.key as CryptoKey);
      return {};
    case 'initDoc':
      return { result: initDoc() };
    case 'initAndLoadCache':
      return { result: await initAndLoadCache(a.familyId as string) };
    case 'openCache':
      return { result: await openCache(a.familyId as string) };
    case 'mutate': {
      const { result, delta, changed } = mutate(args as MutationOp);
      return { result, delta, changed };
    }
    case 'mergeRemoteEnvelope':
      return {
        result: await mergeRemoteEnvelope(
          a.envelope as BeanpodFileV4,
          (a.familyId as string | null) ?? null
        ),
      };
    case 'exportEncryptedPayload':
      return { result: await exportEncryptedPayload() };
    case 'verifyEnvelope':
      return { result: await verifyEnvelope(a.envelope as BeanpodFileV4) };
    case 'getHeads':
      return { result: getHeads() };
    case 'getActorId':
      return { result: getActorId() };
    case 'getChangesSince':
      return { result: getChangesSince(a.heads as Heads) };
    case 'applyChanges':
      return { result: applyChanges(a.changes as Uint8Array[]) };
    case 'exportIncrementalPayload':
      return { result: await exportIncrementalPayload(a.sinceHeads as Heads) };
    case 'applyRemoteChunks':
      return { result: await applyRemoteChunks(a.payloads as string[]) };
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
      reset();
      return {};
    case 'clearCache':
      await clearCache(a.familyId as string);
      return {};
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
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  currentDoc = null;
  familyKey = null;
  cachePersistFailed = false;
  lastPersistedHeads = null;
  persistInFlight = Promise.resolve();
  sink = NOOP_SINK;
}

/** Test-only: peek at whether a doc is currently loaded. */
export function __hasDocForTesting(): boolean {
  return currentDoc !== null;
}
