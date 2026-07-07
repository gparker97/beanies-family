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
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { CorruptPayloadError } from '@/types/sync';
import { applyDelta, applyChunk, bumpDocVersion, resetProjection } from '../projection';
import {
  isRpcResponse,
  isWorkerSignal,
  reconstructError,
  DocWorkerError,
  WorkerCrashError,
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
) => Promise<{ result?: unknown; delta?: ProjectionDelta; changed?: boolean }>;

const READY_TIMEOUT_MS = 10_000;
const DEFAULT_RPC_TIMEOUT_MS = 45_000;
// Whole-doc load/save/merge ops run off-thread (the UI stays responsive), but on
// iOS Safari/JSC the WASM Automerge.load/merge floor can legitimately take tens of
// seconds on a large deep-history doc — so they get a generous stuck-worker ceiling
// instead of the 45 s mutation budget (which was killing a slow-but-progressing
// first load → the "doc-worker … timed out" lockout). Still BOUNDED: a genuinely
// hung worker surfaces a classified error at the ceiling.
// See docs/plans/2026-07-06-worker-ios-large-doc-load.md.
const HEAVY_RPC_TIMEOUT_MS = 120_000;

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

/** Notified after every successful local `mutate` — syncService maps it to a
 * debounced Drive save (replaces the old `onDocPersistNeeded` fan-out; the worker
 * owns the cache persist internally, so this only drives the remote upload). */
let localChangeHandler: (() => void) | null = null;

// ─── Configuration seams (production wiring + tests) ─────────────────────────

/** Test/DI: override how the worker is created. */
export function setWorkerFactory(factory: () => DocWorkerLike): void {
  workerFactory = factory;
}
/** Task #6: the main-thread executor used when the worker is unavailable. */
export function setInlineExecutor(exec: InlineExecutor | null): void {
  inlineExecutor = exec;
}
/** Force the inline path (the `docWorker` kill-switch off, or a test harness).
 * Requires `setInlineExecutor` first. Skips ever spawning a worker. */
export function forceInlineMode(): void {
  mode = 'inline';
  readyPromise = Promise.resolve('inline');
}
/** Task #6: how to re-hydrate a freshly re-spawned worker from cache. */
export function setRehydrator(fn: ((familyId: string) => Promise<void>) | null): void {
  rehydrator = fn;
}
/** Task #5: observe worker cache-persist failures (durability banner). */
export function setCachePersistFailedHandler(fn: ((failed: boolean) => void) | null): void {
  cachePersistFailedHandler = fn;
}
/** Task #5: called after every successful local mutate (→ debounced Drive save). */
export function setLocalChangeHandler(fn: (() => void) | null): void {
  localChangeHandler = fn;
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
      // Post-cutover the projection is the sole main-thread read model — a delta
      // that fails to apply after a successful mutate silently diverges the UI
      // from the worker's doc, so this must telemeter, not just console.warn.
      reportError({
        surface: 'doc-worker-projection',
        message: 'applyDelta failed — projection may be stale',
        error: e,
        severity: 'error',
      });
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
        reportError({
          surface: 'doc-worker-projection',
          message: 'applyChunk failed — projection may be stale',
          error: e,
          severity: 'error',
        });
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
  // Surface the crash ONCE here (only when calls were actually awaiting — a crash
  // with no in-flight work self-heals on the next request's re-spawn). Every
  // drained pending call below rejects with WorkerCrashError, which `surface()`
  // classifies as expected → quiet: N in-flight RPCs produce ONE toast, not N.
  if (pending.size > 0) {
    showToast('error', "We couldn't update your data", message, {
      surface: 'doc-worker',
      error: err instanceof Error ? err : new DocWorkerError(message),
      critical: true,
    });
  }
  // Reject every in-flight call so awaiting stores get a definite failure.
  for (const [cid, p] of pending) {
    p.resolve({ cid, ok: false, error: { name: 'WorkerCrashError', message } });
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

/** Enter inline mode + re-drive the inline realm from retained state. Critical
 * for the mid-session fall-through: the DEAD worker received `setKey`/the doc,
 * but the inline `applyAndProject` realm never did — without re-driving, every
 * crypto op throws `family key not set`. (First-unlock inline is already covered
 * by the normal setFamilyKey→request('setKey') flow; guard the key re-post
 * to the retained key so we don't double-post on that path.) */
async function enterInlineMode(): Promise<void> {
  mode = 'inline';
  if (!inlineExecutor) return; // not wired yet (bootstrap pending / tests)
  if (familyKey) {
    try {
      await inlineExecutor('setKey', { key: familyKey });
    } catch (e) {
      console.error('[docClient] inline setKey re-drive failed', e);
    }
  }
  if (needsRehydrate && currentFamilyId && rehydrator) {
    needsRehydrate = false;
    try {
      await rehydrator(currentFamilyId);
    } catch (e) {
      console.error('[docClient] inline re-hydrate failed', e);
    }
  }
}

async function spawn(): Promise<'worker' | 'inline'> {
  let w: DocWorkerLike;
  try {
    w = workerFactory();
  } catch (e) {
    console.error('[docClient] worker spawn failed — falling back to inline', e);
    await enterInlineMode();
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
    await enterInlineMode();
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

// Methods whose `args` carry ONLY plain-JSON doc data (mutation ops, envelopes).
// We deep-plainify these before `postMessage` so a Vue reactive proxy (or any
// non-structured-cloneable wrapper) that slipped in can't crash the clone. NOT
// applied to setKey (CryptoKey) / loadSnapshot / getChangesSince / applyChanges,
// whose args carry a CryptoKey or Uint8Array that must survive intact and are
// already clone-safe. Inline mode skips postMessage entirely, so this is
// worker-mode-only hardening.
const JSON_SAFE_METHODS = new Set([
  'mutate',
  'mergeRemoteEnvelope',
  'verifyEnvelope',
  'persistEnvelope',
]);

// Whole-doc load/save/merge ops → the generous HEAVY_RPC_TIMEOUT_MS ceiling
// (see the constant). Kept as ONE Set (not threaded per call site) so adding a
// new whole-doc op is a single line here — it can't silently fall back to the
// tight 45 s budget and re-introduce the iOS large-doc lockout.
const HEAVY_METHODS = new Set([
  'mergeRemoteEnvelope',
  'initAndLoadCache',
  'verifyEnvelope',
  'exportEncryptedPayload',
  // Plan B incremental transport — a large first chunk / catch-up apply must get
  // the generous ceiling too, not the tight 45 s mutation budget.
  'applyRemoteChunks',
  'exportIncrementalPayload',
  'applyChanges',
  'getChangesSince',
]);

// Of the JSON-safe methods, these carry a `.envelope` whose `encryptedPayload` is
// a large (~2.7 MB) base64 string — a proxy-free primitive Vue never wraps. We
// plainify only the SMALL envelope fields (wrappedKeys/inviteKeys/metadata) so the
// main thread doesn't JSON-round-trip megabytes per call. `mutate` is deliberately
// NOT here — its small entity payload needs full proxy-stripping.
const ENVELOPE_METHODS = new Set(['mergeRemoteEnvelope', 'verifyEnvelope', 'persistEnvelope']);

const plainify = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function postRaw(req: RpcRequest): void {
  let args = req.args;
  if (args != null && JSON_SAFE_METHODS.has(req.method)) {
    const envelope = (args as { envelope?: Record<string, unknown> }).envelope;
    if (ENVELOPE_METHODS.has(req.method) && envelope && typeof envelope === 'object') {
      const { encryptedPayload, ...rest } = envelope;
      args = { ...(args as object), envelope: { ...(plainify(rest) as object), encryptedPayload } };
    } else {
      args = plainify(args);
    }
  }
  worker?.postMessage({ ...req, args });
}

// ─── Core request ────────────────────────────────────────────────────────────

interface RequestOpts {
  /** Suppress the auto-toast; the caller classifies (expected-degradation paths). */
  quiet?: boolean;
  timeoutMs?: number;
}

/** Send one RPC (worker or inline) and return its `{result, changed}`. Applies the
 * response delta to the projection before resolving (worker: via `handleResponse`;
 * inline: here). The single send/await/surface path shared by `request` (result
 * only) and `requestMutate` (result + the `changed` no-op flag). */
async function requestCore(
  method: string,
  args: unknown,
  opts: RequestOpts
): Promise<{ result: unknown; changed?: boolean }> {
  const via = await ensureReady();
  if (via === 'inline') {
    if (!inlineExecutor) {
      throw new DocWorkerError(
        `doc-worker unavailable and no inline fallback for '${method}'`,
        method
      );
    }
    const { result, delta, changed } = await inlineExecutor(method, args);
    if (delta) applyDelta(delta);
    return { result, changed };
  }

  const cid = nextCid++;
  const responsePromise = new Promise<RpcResponse>((resolve) => {
    pending.set(cid, { resolve, method });
  });
  postRaw({ cid, method, args });

  // Heavy whole-doc ops get the generous ceiling (HEAVY_METHODS); everything else
  // the tight mutation budget. An explicit opts.timeoutMs still overrides both.
  const timeoutMs =
    opts.timeoutMs ?? (HEAVY_METHODS.has(method) ? HEAVY_RPC_TIMEOUT_MS : DEFAULT_RPC_TIMEOUT_MS);
  let res: RpcResponse;
  try {
    res = await withTimeout(responsePromise, timeoutMs, `doc-worker '${method}' timed out`);
  } catch (timeoutErr) {
    pending.delete(cid); // discard by cid — a late reply now finds no pending entry
    throw surface(timeoutErr, method, opts.quiet);
  }
  if (res.ok) return { result: res.result, changed: res.changed };
  throw surface(reconstructError(res.error, method), method, opts.quiet);
}

async function request<T = unknown>(
  method: string,
  args?: unknown,
  opts: RequestOpts = {}
): Promise<T> {
  return (await requestCore(method, args, opts)).result as T;
}

/** `mutate`-only variant that also returns the worker's `changed` flag (default
 * `true` when absent) so the caller can skip the Drive-save trigger on a no-op. */
async function requestMutate<T>(
  op: MutationOp,
  opts: RequestOpts = {}
): Promise<{ result: T; changed: boolean }> {
  const { result, changed } = await requestCore('mutate', op, opts);
  return { result: result as T, changed: changed ?? true };
}

/** Turn a failure into a surfaced-or-quiet rejection. Returns the error to throw. */
function surface(err: unknown, method: string, quiet?: boolean): Error {
  const error = err instanceof Error ? err : new DocWorkerError(String(err), method);
  // Expected-degradation classes stay quiet: CorruptPayloadError (recovery
  // dispatches on it) + WorkerCrashError (already surfaced once at the crash site).
  const expected = error instanceof CorruptPayloadError || error instanceof WorkerCrashError;
  if (!quiet && !expected) {
    showToast('error', "We couldn't update your data", error.message, {
      surface: 'doc-worker',
      error,
      critical: true,
    });
  }
  return error;
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

/** Open the family's cache DB WITHOUT loading a cached doc (create-family — the
 * fresh owner doc is already installed; loading a stale cache row would clobber
 * it). Sets `currentFamilyId` so a worker-death rehydrate targets this family. */
export async function openCache(familyId: string): Promise<{ loaded: false }> {
  currentFamilyId = familyId;
  return request('openCache', { familyId });
}

/** Apply a declarative mutation; the response carries the entity + projection
 * delta. Fires the local-change handler (→ Drive save) after a write that actually
 * CHANGED the doc — a no-op (skipped `onMissing:'skip'` / a named op that wrote
 * nothing) leaves heads unchanged and schedules no save/persist (F10). */
export async function mutate<T = unknown>(op: MutationOp, opts?: RequestOpts): Promise<T> {
  const { result, changed } = await requestMutate<T>(op, opts);
  if (changed) localChangeHandler?.();
  return result;
}

/** Fire-and-forget a mutation whose result the caller doesn't await. Attaches a
 * `.catch` so a rejection can't become an unhandled promise rejection, and
 * `reportError`s it — critical because in INLINE mode a failed `mutate` never
 * routes through `surface()` (no toast), so this is the ONLY signal there. In
 * worker mode `surface()` has already toasted; the errorReporter bucket dedups. */
export function fireAndForgetMutate(op: MutationOp): void {
  void mutate(op).catch((e) => {
    reportError({
      surface: 'doc-mutate-fire-forget',
      message: `fire-and-forget mutate '${op.op}' failed`,
      error: e,
      severity: 'error',
    });
  });
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

/** Verify a fetched/round-tripped envelope decrypts + materializes (no install).
 * Rejects with `CorruptPayloadError` if not. Pass `{quiet}` on classify-locally paths. */
export function verifyEnvelope(envelope: BeanpodFileV4, opts?: RequestOpts): Promise<{ ok: true }> {
  return request('verifyEnvelope', { envelope }, opts);
}

/** DEV/E2E-only: load a raw (unencrypted) Automerge binary as the doc. */
export function loadSnapshot(binary: Uint8Array): Promise<{ loaded: true }> {
  return request('loadSnapshot', { binary });
}
/** DEV/E2E-only: serialize the doc to a raw (unencrypted) binary. */
export function exportSnapshot(): Promise<{ binary: Uint8Array }> {
  return request('exportSnapshot');
}

export function getHeads(): Promise<{ heads: Heads }> {
  return request('getHeads');
}

/** This device's stable Automerge actor id (names its own change-log chunks). */
export function getActorId(): Promise<{ actorId: string }> {
  return request('getActorId');
}

/** Gather every photoId referenced across registered collections (for `gcOrphans`).
 * Pass `{quiet:true}` — a `collect`-hook throw is the fail-safe abort, not a toast. */
export function collectReferencedPhotoIds(opts?: RequestOpts): Promise<{ ids: string[] }> {
  return request('collectReferencedPhotoIds', undefined, opts);
}
export function getChangesSince(heads: Heads): Promise<{ changes: Uint8Array[] }> {
  return request('getChangesSince', { heads });
}
export function applyChanges(changes: Uint8Array[]): Promise<{ heads: Heads; landed: boolean }> {
  return request('applyChanges', { changes });
}

/** Plan B publish: export local changes since `sinceHeads` as an encrypted,
 * self-describing `.beanchanges` chunk body (base64) for the caller to `writeAux`. */
export function exportIncrementalPayload(sinceHeads: Heads): Promise<{ payload: string }> {
  return request('exportIncrementalPayload', { sinceHeads });
}

/** Plan B poll: decrypt + apply a batch of remote `.beanchanges` chunk ciphertexts.
 * `landed:false` means a chunk's causal deps are absent (silently buffered) — the
 * caller MUST fall back to a whole-doc base adopt. `dirty` (landed only) drives the
 * re-publish decision. */
export function applyRemoteChunks(
  payloads: string[]
): Promise<{ heads: Heads; landed: boolean; dirty: boolean }> {
  return request('applyRemoteChunks', { payloads });
}

/** Re-persist the envelope cache after a main-thread `currentEnvelope` change.
 * Envelope-cache persistence is a degradation (a cold-start unlock convenience),
 * not a critical write — pass `{quiet:true}` so a failure doesn't fire the
 * misleading critical "We couldn't update your data" toast; the caller classifies
 * + logs it instead (see `syncService.persistEnvelopeSafely`). */
export function persistEnvelope(envelope: BeanpodFileV4, opts?: RequestOpts): Promise<void> {
  return request('persistEnvelope', { envelope }, opts);
}
export function readEnvelope(): Promise<{ envelope: BeanpodFileV4 | null }> {
  return request('readEnvelope');
}

/** Force an immediate cache persist (backgrounding flush). */
export function flush(): Promise<void> {
  return request('flush');
}
/** Drop the current doc but keep the key + cache (replace-load: the next merge
 * adopts remote fresh). Does NOT clear the projection (the merge repopulates it). */
export function dropDoc(): Promise<void> {
  return request('dropDoc');
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
  localChangeHandler = null;
}
