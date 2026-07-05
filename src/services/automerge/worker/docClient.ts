/**
 * ADR-032 — the main-thread RPC client for the Automerge Web Worker.
 *
 * Owns the worker lifecycle + the typed request/response boundary:
 *   - lazy spawn + `ready` handshake (the worker's WASM top-level-await defers
 *     its message handler, so we wait for `{signal:'ready'}` before sending),
 *   - correlation-id request/response with a per-call timeout; a timed-out
 *     call's late reply is discarded by cid (never resolves a newer promise),
 *   - a worker `delta` is applied to the projection BEFORE the caller's promise
 *     resolves, so read-after-write is race-free,
 *   - worker perf samples are replayed through `perfTiming.record` (one shared
 *     telemetry buffer — the worker can't run the buffer itself),
 *   - failures surface via a single `showToast('error', …, {surface:'doc-worker'})`
 *     — independent of whether the caller awaited — EXCEPT the expected-
 *     degradation class (`CorruptPayloadError`, or a caller that opts out with
 *     `quiet`), which the caller classifies (recovery dispatches on the
 *     reconstructed `instanceof CorruptPayloadError`).
 *
 * Worker-death recovery + the inline fallback executor are seams here and
 * completed in Task #6 (`setInlineExecutor`, `setRehydrator`).
 */
import { withTimeout } from '@/utils/timing';
import { record as recordPerf } from '@/utils/perfTiming';
import { showToast } from '@/composables/useToast';
import { CorruptPayloadError } from '@/types/sync';
import { applyDelta, applyChunk, bumpDocVersion, resetProjection } from '../projection';
import {
  isRpcResponse,
  isWorkerSignal,
  reconstructError,
  DocWorkerError,
  type RpcRequest,
  type RpcResponse,
  type WorkerSignal,
  type ProjectionDelta,
  type MutationOp,
  type Heads,
} from './protocol';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

/** Minimal Worker surface — real `Worker` satisfies it; tests inject a fake. */
export interface DocWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

/** An inline executor runs the SAME op set on the main thread (fallback when the
 * worker can't spawn). Wired in Task #6 from the shared `docOps`/`applyAndProject`. */
export type InlineExecutor = (
  method: string,
  args: unknown
) => Promise<{ result?: unknown; delta?: ProjectionDelta }>;

const READY_TIMEOUT_MS = 10_000;
const DEFAULT_RPC_TIMEOUT_MS = 45_000;

interface Pending {
  resolve: (r: RpcResponse) => void;
  method: string;
}

let worker: DocWorkerLike | null = null;
let readyPromise: Promise<'worker' | 'inline'> | null = null;
let nextCid = 1;
const pending = new Map<number, Pending>();

let workerFactory: () => DocWorkerLike = () =>
  new Worker(new URL('./docWorker.ts', import.meta.url), { type: 'module' }) as DocWorkerLike;
let inlineExecutor: InlineExecutor | null = null;
let mode: 'worker' | 'inline' = 'worker';

// Retained across a worker re-spawn so recovery needs no re-unlock.
let familyKey: CryptoKey | null = null;
let currentFamilyId: string | null = null;
let rehydrator: ((familyId: string) => Promise<void>) | null = null;
let needsRehydrate = false;

/** Notified when the worker's debounced cache persist fails (or recovers) — Task
 * #5 wires this to the persistent "local durability broken" banner. */
let cachePersistFailedHandler: ((failed: boolean) => void) | null = null;

// ─── Configuration seams (production wiring + tests) ─────────────────────────

/** Test/DI: override how the worker is created. */
export function setWorkerFactory(factory: () => DocWorkerLike): void {
  workerFactory = factory;
}
/** Task #6: the main-thread executor used when the worker is unavailable. */
export function setInlineExecutor(exec: InlineExecutor | null): void {
  inlineExecutor = exec;
}
/** Task #6: how to re-hydrate a freshly re-spawned worker from cache. */
export function setRehydrator(fn: ((familyId: string) => Promise<void>) | null): void {
  rehydrator = fn;
}
/** Task #5: observe worker cache-persist failures (durability banner). */
export function setCachePersistFailedHandler(fn: ((failed: boolean) => void) | null): void {
  cachePersistFailedHandler = fn;
}

// ─── Message routing ─────────────────────────────────────────────────────────

function onMessage(data: unknown): void {
  if (isWorkerSignal(data)) return handleSignal(data);
  if (!isRpcResponse(data)) return; // ignore malformed
  const p = pending.get(data.cid);
  if (!p) return; // late reply to a timed-out/cancelled call — discard by cid
  pending.delete(data.cid);
  // Apply the projection delta BEFORE resolving so read-after-write is safe.
  if (data.ok && data.delta) {
    try {
      applyDelta(data.delta);
    } catch (e) {
      console.warn('[docClient] applyDelta failed', e);
    }
  }
  p.resolve(data);
}

function handleSignal(sig: WorkerSignal): void {
  switch (sig.signal) {
    case 'ready':
      break; // resolved via the handshake promise in spawn()
    case 'perf':
      recordPerf(sig.label, sig.durationMs, sig.ctx);
      break;
    case 'log':
      // eslint-disable-next-line no-console
      console[sig.level === 'debug' ? 'log' : sig.level](`[docWorker] ${sig.message}`);
      break;
    case 'projection':
      // A streamed first-load / merge chunk. Apply WITHOUT bumping (the chunks
      // arrive before the triggering RPC's response, so all land before the
      // promise resolves — the load/merge barrier); bump once on the final chunk.
      try {
        applyChunk(sig.delta);
        if (sig.final) bumpDocVersion();
      } catch (e) {
        console.warn('[docClient] applyChunk failed', e);
      }
      break;
    case 'cache-persist-failed':
      cachePersistFailedHandler?.(sig.failed);
      break;
  }
}

function onWorkerError(err: unknown): void {
  const message = err instanceof Error ? err.message : 'worker crashed';
  console.error('[docClient] worker error — rejecting pending + scheduling recovery', err);
  // Reject every in-flight call so awaiting stores get a definite failure.
  for (const [cid, p] of pending) {
    p.resolve({ cid, ok: false, error: { name: 'DocWorkerError', message } });
  }
  pending.clear();
  try {
    worker?.terminate();
  } catch {
    /* already dead */
  }
  worker = null;
  readyPromise = null;
  // Recover lazily on the next request: re-spawn + re-post key + re-hydrate.
  if (currentFamilyId) needsRehydrate = true;
}

// ─── Spawn + handshake ───────────────────────────────────────────────────────

async function spawn(): Promise<'worker' | 'inline'> {
  let w: DocWorkerLike;
  try {
    w = workerFactory();
  } catch (e) {
    console.error('[docClient] worker spawn failed — falling back to inline', e);
    mode = 'inline';
    return 'inline';
  }
  const ready = new Promise<void>((resolve) => {
    w.onmessage = (e) => {
      if (isWorkerSignal(e.data) && (e.data as WorkerSignal).signal === 'ready') resolve();
      onMessage(e.data);
    };
  });
  w.onerror = onWorkerError;
  worker = w;
  try {
    await withTimeout(ready, READY_TIMEOUT_MS, 'worker handshake timed out');
  } catch (e) {
    console.error('[docClient] worker never signalled ready — falling back to inline', e);
    try {
      w.terminate();
    } catch {
      /* noop */
    }
    worker = null;
    mode = 'inline';
    return 'inline';
  }
  mode = 'worker';
  // Re-post the retained key + re-hydrate a freshly re-spawned worker.
  if (familyKey) postRaw({ cid: nextCid++, method: 'setKey', args: { key: familyKey } });
  if (needsRehydrate && currentFamilyId && rehydrator) {
    needsRehydrate = false;
    try {
      await rehydrator(currentFamilyId);
    } catch (e) {
      console.error('[docClient] re-hydrate after respawn failed', e);
    }
  }
  return 'worker';
}

function ensureReady(): Promise<'worker' | 'inline'> {
  if (mode === 'inline') return Promise.resolve('inline');
  if (!readyPromise) readyPromise = spawn();
  return readyPromise;
}

function postRaw(req: RpcRequest): void {
  worker?.postMessage(req);
}

// ─── Core request ────────────────────────────────────────────────────────────

interface RequestOpts {
  /** Suppress the auto-toast; the caller classifies (expected-degradation paths). */
  quiet?: boolean;
  timeoutMs?: number;
}

async function request<T = unknown>(
  method: string,
  args?: unknown,
  opts: RequestOpts = {}
): Promise<T> {
  const via = await ensureReady();
  if (via === 'inline') return inlineRequest<T>(method, args);

  const cid = nextCid++;
  const responsePromise = new Promise<RpcResponse>((resolve) => {
    pending.set(cid, { resolve, method });
  });
  postRaw({ cid, method, args });

  let res: RpcResponse;
  try {
    res = await withTimeout(
      responsePromise,
      opts.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
      `doc-worker '${method}' timed out`
    );
  } catch (timeoutErr) {
    pending.delete(cid); // discard by cid — a late reply now finds no pending entry
    throw surface(timeoutErr, method, opts.quiet);
  }
  if (res.ok) return res.result as T;
  throw surface(reconstructError(res.error, method), method, opts.quiet);
}

/** Turn a failure into a surfaced-or-quiet rejection. Returns the error to throw. */
function surface(err: unknown, method: string, quiet?: boolean): Error {
  const error = err instanceof Error ? err : new DocWorkerError(String(err), method);
  const expected = error instanceof CorruptPayloadError; // recovery dispatches on this
  if (!quiet && !expected) {
    showToast('error', "We couldn't update your data", error.message, {
      surface: 'doc-worker',
      error,
      critical: true,
    });
  }
  return error;
}

async function inlineRequest<T>(method: string, args: unknown): Promise<T> {
  if (!inlineExecutor) {
    throw new DocWorkerError(
      `doc-worker unavailable and no inline fallback for '${method}'`,
      method
    );
  }
  const { result, delta } = await inlineExecutor(method, args);
  if (delta) applyDelta(delta);
  return result as T;
}

// ─── Typed method wrappers (mirror the retired docService/persistence API) ───

/** Post the family key to the worker (once at unlock; re-posted on re-spawn). */
export async function setFamilyKey(key: CryptoKey): Promise<void> {
  familyKey = key;
  await request('setKey', { key });
}

/** Create a fresh empty document (create-family). Pushes the full projection. */
export function initDoc(): Promise<{ loaded: true }> {
  return request('initDoc');
}

/** Init the worker cache + load the cached doc; pushes the full projection. */
export async function initAndLoadCache(familyId: string): Promise<{ loaded: boolean }> {
  currentFamilyId = familyId;
  return request('initAndLoadCache', { familyId });
}

/** Apply a declarative mutation; the response carries the entity + projection delta. */
export function mutate<T = unknown>(op: MutationOp, opts?: RequestOpts): Promise<T> {
  return request<T>('mutate', op, opts);
}

/** Decrypt + merge a fetched remote envelope; returns heads + heads-derived dirty. */
export function mergeRemoteEnvelope(
  envelope: BeanpodFileV4,
  familyId: string | null,
  opts?: RequestOpts
): Promise<{ heads: Heads; dirty: boolean }> {
  return request('mergeRemoteEnvelope', { envelope, familyId }, opts);
}

/** Serialize + encrypt the current doc; main assembles the envelope + uploads. */
export function exportEncryptedPayload(): Promise<{ payload: string }> {
  return request('exportEncryptedPayload');
}

export function getHeads(): Promise<{ heads: Heads }> {
  return request('getHeads');
}

/** Gather every photoId referenced across registered collections (for `gcOrphans`).
 * Pass `{quiet:true}` — a `collect`-hook throw is the fail-safe abort, not a toast. */
export function collectReferencedPhotoIds(opts?: RequestOpts): Promise<{ ids: string[] }> {
  return request('collectReferencedPhotoIds', undefined, opts);
}
export function getChangesSince(heads: Heads): Promise<{ changes: Uint8Array[] }> {
  return request('getChangesSince', { heads });
}
export function applyChanges(changes: Uint8Array[]): Promise<{ heads: Heads }> {
  return request('applyChanges', { changes });
}

/** Re-persist the envelope cache after a main-thread `currentEnvelope` change. */
export function persistEnvelope(envelope: BeanpodFileV4): Promise<void> {
  return request('persistEnvelope', { envelope });
}
export function readEnvelope(): Promise<{ envelope: BeanpodFileV4 | null }> {
  return request('readEnvelope');
}

/** Force an immediate cache persist (backgrounding flush). */
export function flush(): Promise<void> {
  return request('flush');
}
/** Drop the in-memory doc + projection (sign-out); does NOT delete the cache. */
export async function reset(): Promise<void> {
  currentFamilyId = null;
  familyKey = null;
  await request('reset');
  // Clear the main-thread mirror too — a worker-only reset would leave a stale
  // projection readable across a family-switch (cross-session data bleed).
  resetProjection();
}
/** Close + delete the encrypted cache DB (sign-out / family-switch). */
export async function clearCache(familyId: string): Promise<void> {
  await request('clearCache', { familyId });
  resetProjection();
}

/** Test-only: tear down all client state between cases. */
export function __resetDocClientForTesting(): void {
  try {
    worker?.terminate();
  } catch {
    /* noop */
  }
  worker = null;
  readyPromise = null;
  pending.clear();
  nextCid = 1;
  mode = 'worker';
  familyKey = null;
  currentFamilyId = null;
  needsRehydrate = false;
  inlineExecutor = null;
  rehydrator = null;
  cachePersistFailedHandler = null;
}
