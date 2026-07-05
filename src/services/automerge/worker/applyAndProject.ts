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
import type { FamilyDocument } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import {
  migrateDoc,
  saveDoc,
  applyMutation,
  mergeDocs,
  getHeads as headsOf,
  getChangesSince as changesSince,
  applyChanges as applyChangesOp,
  decryptToDoc,
  encryptDocPayload,
  buildFullProjection,
} from './docOps';
import * as cache from './cache';
import type { MutationOp, ProjectionDelta, Heads } from './protocol';

type Doc = Automerge.Doc<FamilyDocument>;
type PerfCtx = Record<string, number>;

/** How the orchestrator reaches the main thread. Posts signals in the worker;
 * applies to the projection directly in the inline adapter (Task #6). */
export interface WorkerSink {
  /** Stream one projection chunk. `final` on the last chunk → main bumps once. */
  pushChunk(delta: ProjectionDelta, final: boolean): void;
  /** Relay a heavy-op timing sample (replayed through main-thread telemetry). */
  perf(label: string, durationMs: number, ctx?: PerfCtx): void;
  /** The debounced cache persist failed (or recovered) → durability banner. */
  cachePersistFailed(failed: boolean): void;
}

const NOOP_SINK: WorkerSink = { pushChunk() {}, perf() {}, cachePersistFailed() {} };

/** Entities per streamed chunk. A big collection is sliced so each `postMessage`
 * is a bounded main-thread task rather than one giant structured clone. */
const PROJECTION_CHUNK = 1000;
/** Cache-persist coalesce window. Short (off-thread now), non-zero (whole-doc save). */
const PERSIST_DEBOUNCE_MS = 120;

// ─── Module state (one instance per realm — worker OR inline main) ───────────

let currentDoc: Doc | null = null;
let familyKey: CryptoKey | null = null;
let sink: WorkerSink = NOOP_SINK;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let cachePersistFailed = false;

/** Wire the sink once (worker startup / inline adapter init). */
export function configure(nextSink: WorkerSink): void {
  sink = nextSink;
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
    void persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** Serialize + encrypt + write the current doc to cache. Surfaces failure to the
 * durability banner (does not throw — it runs detached from any RPC). */
async function persistNow(): Promise<void> {
  if (!currentDoc || !familyKey || !cache.isCacheReady()) return;
  try {
    const doc = currentDoc;
    const key = familyKey;
    const start = performance.now();
    const binary = saveDoc(doc);
    sink.perf('automerge.save', performance.now() - start, { perf_doc_bytes: binary.byteLength });
    await cache.persistDocBinary(key, binary);
    if (cachePersistFailed) {
      cachePersistFailed = false;
      sink.cachePersistFailed(false);
    }
  } catch (e) {
    // A durable-cache write failure is the "local durability broken" signal —
    // surface it (persistent banner on main), don't swallow it.
    cachePersistFailed = true;
    sink.cachePersistFailed(true);

    console.error('[applyAndProject] cache persist failed', e);
  }
}

// ─── Projection push (chunked) ───────────────────────────────────────────────

/** Push the full projection for `doc`, slicing large collections so no single
 * main-thread receive is a long task. Always emits ≥1 delta, so `final` lands. */
function pushProjection(doc: Doc): void {
  const chunks: ProjectionDelta[] = [];
  for (const delta of buildFullProjection(doc)) {
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
export async function initAndLoadCache(id: string): Promise<{ loaded: boolean }> {
  await cache.initPersistenceDB(id);
  const key = requireKey('initAndLoadCache');
  let loaded: Doc | null;
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
  currentDoc = migrateDoc(loaded);
  pushProjection(currentDoc);
  return { loaded: true };
}

/** Apply a declarative mutation; schedule a cache persist. The delta rides the
 * response (applied to the projection before the caller's promise resolves). */
export function mutate(op: MutationOp): { result: unknown; delta: ProjectionDelta } {
  const doc = requireDoc('mutate');
  const { doc: next, result, delta } = applyMutation(doc, op);
  currentDoc = next;
  schedulePersist();
  return { result, delta };
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

  let dirty: boolean;
  let heads: Heads;
  if (!currentDoc) {
    // No local doc yet (remote-first load) — adopt the remote as-is. Nothing
    // local to push back, so not dirty.
    currentDoc = migrateDoc(remote);
    dirty = false;
    heads = headsOf(currentDoc);
  } else {
    const local = currentDoc;
    const merged = time('automerge.mergeClone', () => mergeDocs(local, remote));
    currentDoc = merged.doc;
    dirty = merged.dirty;
    heads = merged.heads;
  }

  void id; // familyId is tracked inside `cache`; kept in the signature for the wire contract
  schedulePersist();
  pushProjection(currentDoc);
  return { heads, dirty };
}

/** Serialize + encrypt the current doc → base64 payload (main assembles the
 * envelope + uploads; key material never leaves main for the upload path). */
export async function exportEncryptedPayload(): Promise<{ payload: string }> {
  const doc = requireDoc('exportEncryptedPayload');
  const key = requireKey('exportEncryptedPayload');
  const payload = await time2('automerge.save', () => encryptDocPayload(doc, key));
  return { payload };
}

// ─── Change-aware hooks (unused by Plan A transport; wired for Plan B) ────────

export function getHeads(): { heads: Heads } {
  return { heads: headsOf(requireDoc('getHeads')) };
}
export function getChangesSince(heads: Heads): { changes: Uint8Array[] } {
  return { changes: changesSince(requireDoc('getChangesSince'), heads) };
}
export function applyChanges(changes: Uint8Array[]): { heads: Heads } {
  const { doc, heads } = applyChangesOp(requireDoc('applyChanges'), changes);
  currentDoc = doc;
  schedulePersist();
  pushProjection(doc);
  return { heads };
}

// ─── Envelope cache (main owns envelope truth; worker holds a cache copy) ─────

export async function persistEnvelope(envelope: BeanpodFileV4): Promise<void> {
  await cache.persistEnvelope(envelope);
}
export async function readEnvelope(): Promise<{ envelope: BeanpodFileV4 | null }> {
  return { envelope: await cache.loadCachedEnvelope() };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Force an immediate cache persist (backgrounding flush). Cancels the debounce. */
export async function flush(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistNow();
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
}

/** Sign-out / family-switch: drop the doc AND close-then-delete the cache DB. */
export async function clearCache(id: string): Promise<void> {
  reset();
  await cache.clearCache(id);
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
  sink = NOOP_SINK;
}

/** Test-only: peek at whether a doc is currently loaded. */
export function __hasDocForTesting(): boolean {
  return currentDoc !== null;
}
