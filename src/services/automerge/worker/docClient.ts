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
 *   - failures route through ONE policy (`notifyFailure`): a NON-paging toast
 *     iff a user-action op (`USER_ACTION_METHODS`) is implicated, firehose-only
 *     `reportError` otherwise — EXCEPT the expected-degradation class
 *     (`CorruptPayloadError`, or a caller that opts out with `quiet`), which the
 *     caller classifies (recovery dispatches on the reconstructed
 *     `instanceof CorruptPayloadError`). Nothing here pages Slack — persistent
 *     save failure escalates via the debounced save-failure banner instead,
 *   - RPC deadlines are suspension-aware (`awaitWithSuspensionAwareDeadline`):
 *     time spent hidden/frozen doesn't count toward declaring the worker dead.
 *
 * Worker-death recovery + the inline fallback executor are seams here and
 * completed in Task #6 (`setInlineExecutor`, `setRehydrator`).
 */
import { withTimeout } from '@/utils/timing';
import { deviceActorId } from '@/services/automerge/deviceActor';
import { acquireActorLease, releaseActorLease } from '@/services/automerge/actorLease';
import { wasHiddenSince } from '@/utils/visibilityTracker';
import { record as recordPerf } from '@/utils/perfTiming';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { showToast } from '@/composables/useToast';
import { tr } from '@/services/translation/tr';
import { PayloadLoadError, isRemoteBlocker } from '@/types/sync';
import { deviceMemoryScalar } from '@/utils/diagnostics';
import { getPlatform } from '@/services/sync/capabilities';
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
  type CachePersistFailureDetail,
  type LineageBasis,
} from './protocol';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import type { RemoteBaselineRow } from '@/services/sync/remoteBaseline';
import { bump as bumpOpenCycle } from '@/services/telemetry/openCycle';

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
/**
 * The stable device actor, retained beside the key so there is ONE lifetime.
 *
 * Re-posted on every realm change (respawn, inline fallback), because a realm
 * that never received it mints a random actor per load and the churn resumes
 * silently — the failure is invisible for weeks and only shows up as a slowly
 * growing actor count in the pod.
 */
/**
 * Pin this device's Automerge actor? **NO — and this is deliberate.**
 *
 * ⚠️ THE INVARIANT A PINNED ACTOR NEEDS, WHICH THIS APP CANNOT PROVIDE:
 * a device's local document must NEVER regress below what it has already
 * published under that actor. Three shipped decisions make it regress as a
 * matter of course:
 *
 *   1. the app loads CACHE-FIRST, so a session starts from IndexedDB before
 *      Drive is consulted;
 *   2. the cache persist is DEBOUNCED, and its recovery path deliberately keeps
 *      only a PREFIX when an increment will not replay (`cache.ts`,
 *      `recovered: true`) — so the cached document can sit behind Drive;
 *   3. a worker respawn rehydrates from that same cache.
 *
 * So: open the app, the cached doc is a change or two behind Drive, the user
 * edits before the background merge lands, and that edit reuses a seq Drive
 * already holds under the same actor. Automerge then refuses the merge:
 *
 *   RangeError: error applying changes: duplicate seq 101 found for actor …
 *
 * and the save refuses with it. Reproduced in the field on the first real
 * two-session test, and by probe. It is not an edge case — it is the ordinary
 * path for anyone who edits shortly after opening.
 *
 * Before pinning, every `load()` minted a fresh random actor, so a collision
 * was impossible. That is the behaviour this constant restores.
 *
 * ⚠️ WHAT IS LOST, AND WHY THAT IS THE RIGHT TRADE: only the PREVENTIVE half of
 * #90 Tier 2 — actor-list growth, which is a slow burn measured in months.
 * COMPACTION (the remedial half, and the one that actually gets a large pod
 * onto a low-memory tablet) does not depend on this and is unaffected. A
 * blocked save is immediate; actor growth is not, and compaction resets it.
 *
 * ⚠️ BEFORE TURNING THIS BACK ON, one of these must be true: the cache can
 * never lag Drive, or a collision self-heals by replaying the divergent changes
 * onto a fresh actor (the same rebase machinery Tier 3 needs). Flipping it
 * without one of those reintroduces a save-blocking defect.
 */
const ACTOR_PINNING_ENABLED = false;

let docActor: string | null = null;
let currentFamilyId: string | null = null;
let rehydrator: ((familyId: string) => Promise<void>) | null = null;
let needsRehydrate = false;

// A1: true ONLY while `spawn()` awaits the rehydrator (set/cleared in spawn()'s
// try/finally — toggled NOWHERE else). `readyPromise` deliberately conflates
// "worker ready" with "rehydrate complete" so every OTHER in-flight RPC blocks
// until the doc is reloaded from cache (the read-after-respawn barrier). But the
// rehydrator itself routes back through `requestCore → ensureReady()`, which would
// await that same still-pending `readyPromise` → circular deadlock. This flag lets
// ONLY the rehydrate RPC bypass `ensureReady()` and post directly, keeping every
// other caller blocked. Invariant: a leaked `true` would wedge every future RPC
// into the bypass, so it is confined to spawn()'s try/finally and asserted false
// by the reset-invariant test.
let rehydrating = false;

/** Notified when the worker's debounced cache persist fails (or recovers) — Task
 * #5 wires this to the persistent "local durability broken" banner. */
let cachePersistFailedHandler:
  ((failed: boolean, detail?: CachePersistFailureDetail) => void) | null = null;

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
export function setCachePersistFailedHandler(
  fn: ((failed: boolean, detail?: CachePersistFailureDetail) => void) | null
): void {
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
      cachePersistFailedHandler?.(sig.failed, sig.detail);
      break;
  }
}

/** Tear down a dead/wedged worker so the next `ensureReady()` re-spawns. Drains
 * every in-flight call to a definite (quiet) `WorkerCrashError` rejection,
 * terminates the worker, and (for an active session) flags a rehydrate so the
 * fresh worker reloads the doc from cache before serving reads.
 *
 * Does NOT toast — the toast decision stays with each caller, which has the
 * context: `onWorkerError` (crash: toast iff there were in-flight calls) and the
 * `requestCore` timeout path (sibling/trigger toast per its accounting). Keeping
 * UI policy out of this lifecycle primitive is what lets both paths — and any
 * future one — share it. Idempotent (a second call with no worker is a no-op). */
function recoverDeadWorker(reason: string): void {
  if (mode === 'inline') return; // nothing to recover
  console.error(`[docClient] recovering dead worker — ${reason}`);
  // Reject every in-flight call so awaiting stores get a definite failure. The
  // WorkerCrashError class is `surface()`-quiet, so N drained calls never each
  // toast — the caller fires at most ONE consolidating toast for them.
  for (const [cid, p] of pending) {
    p.resolve({ cid, ok: false, error: { name: 'WorkerCrashError', message: reason } });
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

function onWorkerError(err: unknown): void {
  const message = err instanceof Error ? err.message : 'worker crashed';
  console.error('[docClient] worker error — rejecting pending + scheduling recovery', err);
  // Surface the crash ONCE here (only when calls were actually awaiting — a crash
  // with no in-flight work self-heals on the next request's re-spawn, console-only).
  // Fired BEFORE the drain, since `recoverDeadWorker` empties `pending`. Every
  // drained call rejects with a quiet WorkerCrashError, so N in-flight RPCs → ONE
  // notification: a toast (non-paging) iff a user-action op was awaiting, else a
  // single firehose event (see notifyFailure).
  if (pending.size > 0) {
    notifyFailure(
      err instanceof Error ? err : new DocWorkerError(message),
      [...pending.values()].map((p) => p.method)
    );
  }
  recoverDeadWorker(message);
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
  // ⚠️ ACTOR BEFORE KEY, and both before the rehydrator below: the rehydrator
  // LOADS the document, and an actor arriving after that has pinned nothing.
  if (docActor) {
    try {
      await inlineExecutor('setActor', { actor: docActor });
    } catch (e) {
      console.error('[docClient] inline setActor re-drive failed', e);
    }
  }
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
  // Re-post the retained actor + key, then re-hydrate a freshly re-spawned
  // worker. ⚠️ ACTOR FIRST — the rehydrator below loads the document, so an
  // actor posted after it has pinned nothing.
  if (docActor) postRaw({ cid: nextCid++, method: 'setActor', args: { actor: docActor } });
  if (familyKey) postRaw({ cid: nextCid++, method: 'setKey', args: { key: familyKey } });
  if (needsRehydrate && currentFamilyId && rehydrator) {
    needsRehydrate = false;
    // A1: the rehydrator routes back through requestCore → ensureReady(), which
    // would await this still-pending `readyPromise` → deadlock. `rehydrating`
    // lets its RPCs bypass ensureReady() and post directly. Set here, cleared in
    // `finally` on BOTH the success and throw paths (the invariant the reset test
    // guards) — toggled nowhere else.
    rehydrating = true;
    try {
      await rehydrator(currentFamilyId);
    } catch (e) {
      console.error('[docClient] re-hydrate after respawn failed', e);
    } finally {
      rehydrating = false;
    }
  }
  return 'worker';
}

function ensureReady(): Promise<'worker' | 'inline'> {
  if (mode === 'inline') return Promise.resolve('inline');
  if (!readyPromise) readyPromise = spawn();
  return readyPromise;
}

// ─── Method classification sets ──────────────────────────────────────────────
// Adding a worker method? Decide its membership in each of the five sets below
// explicitly (JSON_SAFE / HEAVY / ENVELOPE / RETRYABLE / USER_ACTION) — the
// axes are orthogonal and change for independent reasons.

// Methods whose `args` carry ONLY plain-JSON doc data (mutation ops, envelopes).
// We deep-plainify these before `postMessage` so a Vue reactive proxy (or any
// non-structured-cloneable wrapper) that slipped in can't crash the clone. NOT
// applied to setKey (CryptoKey) / loadSnapshot / applyChanges,
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
  // A whole-doc rebuild + a whole-doc verify: heavier than a merge, not lighter.
  'compactDoc',
  'mergeRemoteEnvelope',
  'initAndLoadCache',
  'verifyEnvelope',
  'exportEncryptedPayload',
  'applyChanges',
]);

// Of the JSON-safe methods, these carry a `.envelope` whose `encryptedPayload` is
// a large (~2.7 MB) base64 string — a proxy-free primitive Vue never wraps. We
// plainify only the SMALL envelope fields (wrappedKeys/inviteKeys/metadata) so the
// main thread doesn't JSON-round-trip megabytes per call. `mutate` is deliberately
// NOT here — its small entity payload needs full proxy-stripping.
const ENVELOPE_METHODS = new Set(['mergeRemoteEnvelope', 'verifyEnvelope', 'persistEnvelope']);

/**
 * The subset of `ENVELOPE_METHODS` that actually needs the encrypted bytes.
 *
 * NOT `persistEnvelope`: the IndexedDB envelope cache deliberately stores a
 * STRIPPED envelope (it is a key-material carrier — the document comes from the
 * doc cache), so guarding it would reject the very call that keeps cold starts
 * fast. Getting this wrong once already meant no device that joined or resumed
 * a pod ever wrote an envelope row again, silently, because
 * `persistEnvelopeSafely` swallows the throw into a warning.
 */
const PAYLOAD_REQUIRED_METHODS = new Set(['mergeRemoteEnvelope', 'verifyEnvelope']);

/**
 * Reject a stripped envelope before it can reach the doc realm.
 *
 * A long-lived in-memory envelope carries no payload (`withoutPayload`). Passing
 * one to a method that decrypts would yield zero bytes, surface as a
 * `CorruptPayloadError`, and CLEAR THE USER'S CACHE — a silent, data-destroying
 * misuse. Fail loudly instead; this is a developer mistake, not a runtime state.
 *
 * Called from `requestCore`, NOT from `postRaw`: the inline executor never posts
 * a message, so a check living in `postRaw` would protect worker devices and
 * leave inline ones — disproportionately the low-memory devices this whole
 * change is about — completely unguarded.
 */
function assertEnvelopeHasPayload(method: string, args: unknown): void {
  if (!PAYLOAD_REQUIRED_METHODS.has(method)) return;
  const envelope = (args as { envelope?: { encryptedPayload?: unknown } } | null)?.envelope;
  if (!envelope || typeof envelope !== 'object') return;
  const payload = envelope.encryptedPayload;
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new DocWorkerError(
      `'${method}' was given an envelope with no encryptedPayload — a long-lived ` +
        `or cached envelope was passed where freshly-parsed bytes are required.`,
      method
    );
  }
}

// Methods that are safe to transparently re-issue after a worker respawn: pure
// reads, idempotent CRDT merges, idempotent re-persists/teardowns. This is an
// ALLOWLIST, not a denylist, on purpose — a method must be affirmatively known-
// idempotent to auto-retry. `mutate` and `initDoc` are absent (a re-issue could
// double-apply a financial op); any FUTURE method is likewise non-retryable until
// explicitly vetted and added here. Forgetting to add a safe method costs a missed
// auto-heal (visible, recoverable); the opposite default would risk silent data
// corruption. Kept SEPARATE from HEAVY_METHODS/JSON_SAFE_METHODS — retry-safety,
// timeout tier, and clone-safety are orthogonal and change for independent reasons.
const RETRYABLE_METHODS = new Set([
  'initAndLoadCache',
  'loadProjectionSnapshot',
  'openCache',
  'getHeads',
  'applyChanges',
  'exportEncryptedPayload',
  'mergeRemoteEnvelope',
  'verifyEnvelope',
  'flush',
  'dropDoc',
  'reset',
  'clearCache',
  'persistEnvelope',
  'readEnvelope',
  'setKey',
  // Idempotent state post, exactly like `setKey` above: re-issuing it after a
  // respawn sets the same string. NOT in HEAVY / ENVELOPE / USER_ACTION, and
  // deliberately NOT in JSON_SAFE — its arg is a plain string, and that set
  // means "args that could carry a Vue proxy".
  'setActor',
  // ⚠️ `compactDoc` is deliberately ABSENT. A transparent re-issue after a
  // respawn would re-compact a document that has already been replaced, so the
  // second run would verify a compaction against itself and install a doc whose
  // lineage the caller never stamped. Not JSON_SAFE or ENVELOPE either: it
  // takes no arguments.
  'collectReferencedPhotoIds',
  'ping',
]);

// Methods where a USER-VISIBLE edit is in doubt when they fail: the user tapped
// something and their change may not have applied. Only these ever toast — a
// failure of any other (background, self-healable) method is firehose-only via
// `notifyFailure`. Failure-direction of an omission: a missed method degrades to
// firehose-only (invisible to the user but recoverable + observable) — safe.
// Orthogonal to RETRYABLE (retry-safety) and HEAVY (timeout tier); membership
// changes independently.
// `compactDoc` is here because the user pressed a button and their data is in
// doubt if it fails — a silent firehose-only report would be the wrong shape.
const USER_ACTION_METHODS = new Set(['mutate', 'initDoc', 'compactDoc']);

// A liveness ping does no compute, so a live worker answers near-instantly — a
// short ceiling turns a reaped/wedged worker into a fast recovery on resume.
const PING_TIMEOUT_MS = 5_000;

// Suspension-aware deadline bounds (see awaitWithSuspensionAwareDeadline):
// visible-page re-arms are capped; hidden-now re-arms are exempt from the cap
// (an overnight-hidden tab must not burn extensions and reject while hidden)
// but everything is hard-bounded by the absolute wall-clock ceiling.
const MAX_DEADLINE_EXTENSIONS = 3;
const ABSOLUTE_DEADLINE_CEILING_MS = 10 * 60_000;

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
  /** A7: mark this call a pure liveness probe. On timeout it does NOT recover the
   * worker, report telemetry, or auto-retry — it just throws. Used ONLY by the
   * corroboration ping so the *outer* op that triggered it owns the recover+report
   * (with the real method, not 'ping') and the probe can't recurse into another ping. */
  probe?: boolean;
}

/** Send one RPC (worker or inline) and return its `{result, changed}`. Applies the
 * response delta to the projection before resolving (worker: via `handleResponse`;
 * inline: here). The single send/await/surface path shared by `request` (result
 * only) and `requestMutate` (result + the `changed` no-op flag). */
async function requestCore(
  method: string,
  args: unknown,
  opts: RequestOpts,
  attempt = 1
): Promise<{ result: unknown; changed?: boolean }> {
  // A1: the rehydrate RPCs are issued from INSIDE spawn()'s awaited rehydrator, so
  // they must NOT await `ensureReady()` — that awaits the very `readyPromise`
  // spawn() is still resolving → circular deadlock. Bypass the barrier for exactly
  // those calls and post directly (at this point mode==='worker' and worker is
  // non-null — spawn() is past its handshake). Every OTHER caller still blocks on
  // ensureReady() until rehydrate lands (the read-after-respawn barrier).
  // Before EITHER dispatch path, so worker and inline are guarded identically.
  assertEnvelopeHasPayload(method, args);

  const via = rehydrating && mode === 'worker' && worker ? 'worker' : await ensureReady();
  if (via === 'inline') {
    if (!inlineExecutor) {
      throw new DocWorkerError(
        `doc-worker unavailable and no inline fallback for '${method}'`,
        method
      );
    }
    // Route the inline throw through `surface()` as well. Without this the OOM
    // metric would be blind to inline mode — which is the fallback when the
    // worker cannot spawn, i.e. disproportionately the low-end devices this
    // whole change is about. `quiet: true` preserves today's inline behaviour
    // exactly (no toast); only classification and the single report are added.
    try {
      const { result, delta, changed } = await inlineExecutor(method, args);
      if (delta) applyDelta(delta);
      return { result, changed };
    } catch (e) {
      throw surface(e, method, true);
    }
  }

  const cid = nextCid++;
  const responsePromise = new Promise<RpcResponse>((resolve) => {
    pending.set(cid, { resolve, method });
  });
  try {
    postRaw({ cid, method, args });
  } catch (e) {
    // `postMessage` throws synchronously on a non-cloneable argument, and
    // `plainify` can throw on a cyclic one. The pending entry is registered by
    // then and nothing will ever resolve it: it would sit in the map for the
    // life of the session and — for a HEAVY method — keep `extendWhile`
    // extending every other op's deadline indefinitely. Drop it before
    // rethrowing.
    pending.delete(cid);
    throw surface(e, method, opts.quiet);
  }

  // Heavy whole-doc ops get the generous ceiling (HEAVY_METHODS); everything else
  // the tight mutation budget. An explicit opts.timeoutMs still overrides both.
  const timeoutMs =
    opts.timeoutMs ?? (HEAVY_METHODS.has(method) ? HEAVY_RPC_TIMEOUT_MS : DEFAULT_RPC_TIMEOUT_MS);
  // A LIGHT op queued behind a progressing HEAVY op (or a live in-flight `mutate`)
  // in the worker's serial FIFO isn't dead — extend its deadline instead of
  // rejecting. Excludes THIS call's own pending entry (it stays in `pending`
  // across extensions so late replies still resolve). NOT applied to the
  // liveness probe: its whole job is a prompt alive/dead verdict, and it still
  // gets the visibility extensions (a mid-probe backgrounding must not
  // false-confirm death) — only the busy-behind-sibling extension is skipped.
  const extendWhile =
    !opts.probe && !HEAVY_METHODS.has(method)
      ? () =>
          [...pending.entries()].some(
            ([id, p]) => id !== cid && (HEAVY_METHODS.has(p.method) || p.method === 'mutate')
          )
      : undefined;
  let res: RpcResponse;
  try {
    res = await awaitWithSuspensionAwareDeadline(responsePromise, timeoutMs, method, extendWhile);
  } catch (timeoutErr) {
    return handleRpcTimeout(timeoutErr, method, args, opts, attempt, cid);
  }
  if (res.ok) return { result: res.result, changed: res.changed };
  throw surface(reconstructError(res.error, method), method, opts.quiet);
}

/** Await an RPC response with a deadline that doesn't count suspended time.
 *
 * Wall-clock `setTimeout` keeps counting while a backgrounded/frozen page (and
 * its worker) are suspended — on resume the throttled timer fires immediately,
 * false-declaring a healthy worker dead. At each timer fire this loop decides
 * extend-vs-reject:
 *   - page hidden right now            → re-arm (exempt from the extension cap —
 *     an overnight-hidden tab must not burn extensions and reject while hidden);
 *   - page was hidden during the window (incl. armed-while-hidden, detected via
 *     the resume transition) → re-arm, counts toward MAX_DEADLINE_EXTENSIONS;
 *   - `extendWhile()` (light op queued behind heavy/mutate) → re-arm, counts.
 * Everything is hard-bounded by ABSOLUTE_DEADLINE_CEILING_MS from first arm, so
 * a pathological visibility state (e.g. `document.hidden` stuck true) becomes a
 * bounded, observable failure — never an infinitely-pending promise.
 *
 * Extension telemetry is capped per call: first occurrence per reason + one
 * settle summary carrying the total, so an overnight-pending RPC can't emit
 * hundreds of near-identical events.
 *
 * NOTE: `promise` (an RPC responsePromise) only ever RESOLVES — pending entries
 * are resolved (never rejected) even on drain — so a rejection out of this
 * helper is always a deadline rejection. */
async function awaitWithSuspensionAwareDeadline<T>(
  promise: Promise<T>,
  budgetMs: number,
  method: string,
  extendWhile?: () => boolean
): Promise<T> {
  const TIMED_OUT = Symbol('timed-out');
  // Register the lazy visibility listener BEFORE any hidden transition during
  // this wait (wasHiddenSince registers it on first call).
  wasHiddenSince(Date.now());
  const firstArmedAt = Date.now();
  let cappedExtensions = 0;
  let totalExtensions = 0;
  const reasonsLogged = new Set<string>();

  const settleSummary = (): void => {
    if (totalExtensions === 0) return;
    logEvent({
      level: 'info',
      surface: 'doc-worker-recovery',
      message: `doc-worker '${method}' deadline extensions settled (total ${totalExtensions})`,
      context: { recovery_method: method, recovery_attempt: totalExtensions },
    });
  };

  for (;;) {
    const armedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
    });
    let settled: T | typeof TIMED_OUT;
    try {
      settled = await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (settled !== TIMED_OUT) {
      settleSummary();
      return settled;
    }

    // Timer fired — extend or reject.
    if (Date.now() - firstArmedAt >= ABSOLUTE_DEADLINE_CEILING_MS) {
      settleSummary();
      throw new Error(`doc-worker '${method}' exceeded absolute deadline`);
    }
    const hiddenNow = typeof document !== 'undefined' && document.hidden;
    let reason: 'hidden' | 'was-hidden' | 'busy-behind-heavy' | null = null;
    if (hiddenNow) reason = 'hidden';
    else if (wasHiddenSince(armedAt)) reason = 'was-hidden';
    else if (extendWhile?.()) reason = 'busy-behind-heavy';
    if (reason === null || (reason !== 'hidden' && cappedExtensions >= MAX_DEADLINE_EXTENSIONS)) {
      settleSummary();
      throw new Error(`doc-worker '${method}' timed out`);
    }
    if (reason !== 'hidden') cappedExtensions++;
    totalExtensions++;
    if (!reasonsLogged.has(reason)) {
      reasonsLogged.add(reason);
      logEvent({
        level: 'info',
        surface: 'doc-worker-recovery',
        message: `doc-worker '${method}' deadline extended (${reason})`,
        context: { recovery_method: method, recovery_attempt: totalExtensions },
      });
    }
  }
}

/** The ordered timeout-decision ladder, extracted from `requestCore`'s catch so
 * the happy path stays readable. Branch precedence:
 *   1. rehydrating   — reject only this call (recovery mid-spawn would re-enter);
 *   2. probe         — a pure liveness probe never recovers/reports/retries;
 *   3. in-flight backstop — a light op that exhausted its extensions while a
 *      heavy/mutate op is STILL in flight rejects WITHOUT probing: a live worker
 *      mid-WASM can't answer the 5 s ping (serial FIFO), so probing here would
 *      false-confirm death and tear down a progressing heavy op;
 *   4. corroboration — probe the worker; if it answers, the worker is alive-but-
 *      busy → transparently re-issue retryable methods, else reject quietly;
 *   5. teardown      — confirmed dead: recover, report (real method, A9 keys),
 *      then retry-or-reject with drained-sibling-aware notification.
 *
 * A timeout means the worker went silent WITHOUT firing `onerror` (an OS-reaped
 * mobile worker, or a FIFO wedged behind a hung whole-doc op). Nothing else
 * tears it down, so without this the client would re-post to the corpse forever
 * until the user force-quits. */
async function handleRpcTimeout(
  timeoutErr: unknown,
  method: string,
  args: unknown,
  opts: RequestOpts,
  attempt: number,
  cid: number
): Promise<{ result: unknown; changed?: boolean }> {
  pending.delete(cid); // drop THIS call first…

  // A1: a rehydrate RPC that times out must reject ONLY itself. Calling
  // recoverDeadWorker mid-spawn would reset `readyPromise` / tear down the worker
  // we're still rehydrating and re-enter. spawn()'s own catch then logs + continues
  // (a genuinely wedged worker is caught by the next real RPC's normal timeout path).
  if (rehydrating) {
    throw surface(timeoutErr, method, opts.quiet);
  }

  // A7: a pure liveness probe (the corroboration ping below) never recovers, reports,
  // or retries — it just throws so its caller learns "worker dead" and owns the
  // recovery. This is also what stops a probe from recursing into another probe.
  if (opts.probe) {
    throw surface(timeoutErr, method, opts.quiet);
  }

  // A7: before declaring the worker dead, corroborate — UNLESS this IS a ping
  // (`checkWorkerLiveness`'s own probe; a ping timeout is already the death signal,
  // and re-pinging would recurse).
  if (method !== 'ping') {
    // Backstop to the extendWhile deadline extension: a light op that STILL
    // exhausted its extensions behind a heavy/mutate op rejects only itself —
    // see branch 3 in the ladder above. Firehose-only under notifyFailure.
    const heavyStillInFlight = [...pending.values()].some((p) => HEAVY_METHODS.has(p.method));
    const mutateStillInFlight = [...pending.values()].some((p) => p.method === 'mutate');
    if (!HEAVY_METHODS.has(method) && (heavyStillInFlight || mutateStillInFlight)) {
      throw surface(timeoutErr, method, opts.quiet); // reject just this call; leave the worker to finish
    }

    // Corroborate death with a fast liveness PROBE (a ping that never recovers/reports
    // on its own — see `opts.probe` above). If it answers, the worker is alive-but-busy
    // → false positive → transparently re-issue a retryable method on the live worker
    // (same `attempt` escalator as the respawn retry → at most one retry total), else
    // reject only this call, worker untouched. If the probe times out, the worker is
    // confirmed dead → fall through to the shared teardown below (which owns the
    // recover + report with THIS real method, so telemetry isn't reduced to 'ping').
    let pingAnswered = false;
    try {
      await request('ping', undefined, { quiet: true, timeoutMs: PING_TIMEOUT_MS, probe: true });
      pingAnswered = true;
    } catch {
      /* probe timed out → worker confirmed dead → fall through to teardown */
    }
    if (pingAnswered) {
      logEvent({
        level: 'info',
        surface: 'doc-worker-recovery',
        message: `doc-worker '${method}' timed out but a liveness ping answered — worker alive, not torn down`,
        context: { recovery_method: 'liveness-false-positive', recovery_attempt: attempt },
      });
      if (attempt === 1 && RETRYABLE_METHODS.has(method)) {
        return requestCore(method, args, opts, 2); // re-issue on the live worker
      }
      throw surface(timeoutErr, method, opts.quiet);
    }
    // else: fall through to the shared teardown path.
  }

  // Teardown path — reached by a genuine ping timeout (`checkWorkerLiveness`) OR a
  // non-ping op whose corroboration probe confirmed death. Capture the sibling
  // methods BEFORE the drain empties `pending` (they drive toast-vs-firehose
  // classification below), tear the worker down (idempotent), report once with
  // the renamed A9 keys carrying the REAL method, then retry-or-reject.
  const drainedMethods = [...pending.values()].map((p) => p.method);
  recoverDeadWorker(`rpc-timeout:${method}`); // drains siblings (quiet) + tears down → next request re-spawns
  reportError({
    surface: 'doc-worker-recovery',
    message: `doc-worker '${method}' timed out — worker recovered; next request re-spawns a fresh worker`,
    severity: 'warning', // telemetry + console only — never pages, never toasts
    context: {
      recovery_method: method,
      recovery_attempt: attempt,
      lost_siblings: drainedMethods.length > 0,
    },
  });
  if (attempt === 1 && RETRYABLE_METHODS.has(method)) {
    // This idempotent call heals transparently on the fresh worker. But any SIBLING
    // calls just drained can't be re-issued (we don't own their args/idempotency) and
    // a drained WorkerCrashError is quiet — so a concurrently-in-flight `mutate` would
    // otherwise vanish notification-less. Fire the ONE consolidating notification for
    // them (toast iff a user-action op was drained, firehose otherwise); do NOT throw,
    // because THIS call still heals.
    if (drainedMethods.length > 0) {
      notifyFailure(
        timeoutErr instanceof Error ? timeoutErr : new DocWorkerError(String(timeoutErr), method),
        drainedMethods
      );
    }
    return requestCore(method, args, opts, 2); // fresh ensureReady() re-spawns + rehydrates
  }
  // Non-retryable or retry exhausted: one classify-and-notify over the FULL
  // implicated set (this method + drained siblings) — a drained `mutate` behind
  // a failed background op still gets its toast; an all-background set degrades
  // to a single firehose event.
  throw surface(timeoutErr, method, opts.quiet, [method, ...drainedMethods]);
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

/** The single toast-vs-firehose policy for every docClient failure site
 * (`surface()`, `onWorkerError`, drained siblings). Toast — NON-paging — iff a
 * user-action op is implicated (the user's edit is in doubt); otherwise the
 * failure is background + self-healable → firehose-only. Nothing here ever
 * pages Slack: the single `critical` escalation for "data isn't saving" is the
 * debounced save-failure banner (syncStore), which carries real recovery CTAs. */
/**
 * Deliberate-teardown window (sign-out / clear-data). Ops that fail because the doc was
 * just reset are the EXPECTED consequence of the user leaving, not an edit in doubt —
 * toasting "we couldn't update your data" over the welcome gate reads as a scary defect
 * (observed 2026-08-28: an in-flight passkey-enrolment push straddling a sign-out).
 * During the window, user-action failures are downgraded to the firehose path; nothing
 * is swallowed. Cleared by the window elapsing or the next initDoc (a new session).
 */
let quietTeardownUntil = 0;
export function beginQuietTeardown(windowMs = 10_000): void {
  quietTeardownUntil = Date.now() + windowMs;
}

function notifyFailure(error: Error, methods: string[]): void {
  if (Date.now() < quietTeardownUntil) {
    reportError({
      surface: 'doc-worker',
      message: `op(s) '${methods.join(',')}' failed during sign-out teardown (expected drain)`,
      error,
      severity: 'warning', // firehose + console only — never a toast, never pages
    });
    return;
  }
  if (methods.some((m) => USER_ACTION_METHODS.has(m))) {
    // No `critical` flag — never pages. useToast auto-reports error toasts
    // (surface/error) at non-paging severity, so no separate reportError here
    // (it would double-report).
    showToast(
      'error',
      tr('docWorker.updateFailed', "We couldn't update your data"),
      error.message,
      {
        surface: 'doc-worker',
        error,
      }
    );
  } else {
    reportError({
      surface: 'doc-worker',
      message: `background op(s) '${methods.join(',')}' failed — self-heal pending`,
      error,
      severity: 'error', // firehose + console only — never pages
    });
  }
}

/** Turn a failure into a surfaced-or-quiet rejection. Returns the error to throw.
 * `implicatedMethods` widens the toast-vs-firehose classification beyond the
 * failing method itself (terminal teardown passes the drained siblings too). */
function surface(
  err: unknown,
  method: string,
  quiet?: boolean,
  implicatedMethods?: string[]
): Error {
  const error = err instanceof Error ? err : new DocWorkerError(String(err), method);
  // Expected-degradation classes stay quiet: PayloadLoadError (recovery
  // dispatches on it) + WorkerCrashError (already surfaced once at the crash site).
  // ⚠️ `isRemoteBlocker`, not a class list. A `PodLineageError` is now RAISED IN
  // THE WORKER (the guard moved there), so it arrives here too — and without
  // this it would fire a generic report AND toast on top of the one
  // `noteLineageBlocked` already owns. A strict SUPERSET of the old set
  // (`PayloadLoadError implements RemoteBlocker`), so nothing goes quiet.
  const expected = isRemoteBlocker(error) || error instanceof WorkerCrashError;
  if (!quiet && !expected) {
    notifyFailure(error, implicatedMethods ?? [method]);
  }
  // THE single emitter for an out-of-memory pod load. Every worker error and
  // (since the inline branch routes through here too) every inline error passes
  // this function exactly once, so an OOM cannot be reported twice or missed.
  //
  // Not `critical`: no data is lost and the file is intact, so paging a human
  // per occurrence would be noise. The message is CONSTANT per step — the size
  // rides in `perf_doc_bytes` — because `errorReporter` buckets its dedup on
  // (surface, normalizeMessage) and a per-pod byte figure would give every pod
  // its own bucket, defeating the throttle entirely.
  if (error instanceof PayloadLoadError && error.deviceCannotOpen) {
    reportError({
      surface: 'pod-load-memory',
      message: `Automerge ${error.step} ran out of memory loading a pod`,
      error,
      severity: 'error',
      context: {
        action: 'pod-load-oom',
        error_code: error.step,
        perf_doc_bytes: error.payloadBytes ?? undefined,
        os: getPlatform(),
        detail: deviceMemoryScalar() ?? undefined,
      },
    });
  }
  return error;
}

// ─── Typed method wrappers (mirror the retired docService/persistence API) ───

/** Post the family key to the worker (once at unlock; re-posted on re-spawn). */
export async function setFamilyKey(key: CryptoKey, familyId: string): Promise<void> {
  // `familyId` is REQUIRED, on the seam the key already uses. Deriving the actor
  // "beside" this call would mean five main-side call sites, five chances to
  // forget, and five places to remember forever; one required parameter is
  // compiler-enforced and a future sixth caller cannot omit it.
  familyKey = key;
  // ⚠️ ACTOR PINNING IS OFF. See `ACTOR_PINNING_ENABLED` below — it is one
  // constant, and everything it gates (the lease, the derivation, their tests)
  // is intact and ready for the day the invariant it needs actually holds.
  //
  // When on: only the realm holding the lease pins the device actor; every
  // other realm passes no actor and Automerge mints a random one. Neither call
  // throws — an actor-derivation or lease failure must never stop a pod opening.
  docActor =
    ACTOR_PINNING_ENABLED && (await acquireActorLease(familyId))
      ? await deviceActorId(familyId)
      : null;
  // ⚠️ ACTOR BEFORE KEY: every doc-creating op is downstream of the key, so the
  // actor has to be in the realm before any of them can run.
  await request('setActor', { actor: docActor });
  await request('setKey', { key });
}

/**
 * Rebuild the document without its history. See `applyAndProject.compactDoc`.
 *
 * Installs the rebuilt document in the worker but persists NOTHING: the caller
 * decides whether the compaction goes ahead and flushes explicitly, so a failed
 * publish is recoverable rather than half-applied.
 */
export function compactDoc(): Promise<{
  beforeBytes: number;
  afterBytes: number;
  changesBefore: number;
  changesAfter: number;
  actorsBefore: number;
}> {
  return request('compactDoc') as Promise<{
    beforeBytes: number;
    afterBytes: number;
    changesBefore: number;
    changesAfter: number;
    actorsBefore: number;
  }>;
}

/** Create a fresh empty document (create-family). Pushes the full projection. */
export function initDoc(): Promise<{ loaded: true }> {
  // A fresh doc means a fresh session — restore normal toast policy immediately.
  quietTeardownUntil = 0;
  return request('initDoc');
}

/** Init the worker cache + load the cached doc; pushes the full projection. Also
 * returns the open-guard baseline row (#61) read in the SAME round-trip, so the
 * cache and the baseline that describes it can never be read out of step (C5). */
export async function initAndLoadCache(
  familyId: string
): Promise<{ loaded: boolean; remoteBaseline: RemoteBaselineRow | null }> {
  currentFamilyId = familyId;
  const res = await request<{ loaded: boolean; remoteBaseline: RemoteBaselineRow | null }>(
    'initAndLoadCache',
    { familyId }
  );
  // Count only a reconstruction that actually HAPPENED. Counting the
  // `automerge.cacheLoad` perf label instead would over-count, because `time2`
  // emits from a `finally` — so a cache MISS (which does zero Automerge work) and
  // a failed load both look like reconstructions, and path1b's miss-then-adopt
  // would report rec=2 for one real rebuild. Routing through `request` covers the
  // inline-fallback realm as well as the worker.
  if (res.loaded) bumpOpenCycle('reconstruction');
  return res;
}

/**
 * Display-only FAST-PAINT path: push the persisted projection snapshot (if present +
 * shape-compatible) so the UI paints in <1s, WITHOUT rebuilding the Automerge doc.
 * The streamed chunks are applied by the existing `projection` signal handler and
 * `docVersion` bumps on the final one — identical to `initAndLoadCache`'s push. Any
 * failure resolves `{ hit: false, reason }` (never throws); the caller falls back to
 * the authoritative rebuild. Installs no doc — the rebuild owns the source of truth.
 */
export async function loadProjectionSnapshot(
  familyId: string
): Promise<{ hit: boolean; reason?: string }> {
  currentFamilyId = familyId;
  return request('loadProjectionSnapshot', { familyId });
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
/**
 * The house detached-call idiom (#61 C5a): run a promise the caller doesn't
 * await, attach a `.catch` so a rejection can't become an unhandled promise
 * rejection, and `reportError` it — critical because in INLINE mode a failed RPC
 * never routes through `surface()` (no toast), so this is the ONLY signal there.
 * ONE place to fix so there is never a second naked `void call().catch(...)`.
 */
function fireAndForget(
  run: () => Promise<unknown>,
  surface: string,
  message: string,
  severity: 'warning' | 'error'
): void {
  void run().catch((e) => {
    reportError({ surface, message, error: e, severity });
  });
}

/** Fire-and-forget a mutation whose result the caller doesn't await. */
export function fireAndForgetMutate(op: MutationOp): void {
  fireAndForget(
    () => mutate(op),
    'doc-mutate-fire-forget',
    `fire-and-forget mutate '${op.op}' failed`,
    'error'
  );
}

/**
 * Learn a remote baseline in the worker (#61). Fire-and-forget: a lost baseline
 * costs one extra Drive read next open (the safe direction), so `severity:
 * 'warning'`.
 *
 * NOT added to RETRYABLE_METHODS / ENVELOPE_METHODS / HEAVY_METHODS /
 * USER_ACTION_METHODS, deliberately (C17):
 *  - not retryable: a respawned worker has no `currentDoc` and rebuilds from a
 *    cache that may be BEHIND this revision; re-issuing would seed a baseline
 *    against a doc not yet containing it (the C10 stale-forever bug, via auto-heal).
 *  - not envelope: it carries a bare opaque baseline string, no envelope.
 *  - not heavy: a variable set, not a megabyte payload.
 *  - not user-action: no user edit is in doubt; a failure is firehose-only.
 */
export function noteRemoteBaseline(payload: string): void {
  fireAndForget(
    () => request('noteRemoteBaseline', { payload }),
    'doc-baseline-fire-forget',
    'fire-and-forget noteRemoteBaseline failed',
    'warning'
  );
}

/**
 * Decrypt + merge a fetched remote envelope. Returns heads plus two distinct
 * heads-derived booleans: `dirty` (local holds changes to push BACK to the file)
 * and `changed` (our doc moved, so consumers' projections are stale). See the
 * worker-side doc-comment — conflating them causes either a lost upload or a
 * pointless ~21-store re-projection.
 */
export async function mergeRemoteEnvelope(
  envelope: BeanpodFileV4,
  familyId: string | null,
  /**
   * ⚠️ REQUIRED. What this caller can prove about its OWN document — the worker
   * owns the lineage decision and cannot make it without this. There is no
   * default, because a default is a decision nobody made, and the boolean it
   * replaced (`adopt`) was a second entry point that could be forgotten.
   */
  basis: LineageBasis,
  opts?: RequestOpts
): Promise<{
  action: 'merged' | 'adopted' | 'kept-local';
  heads: Heads;
  dirty: boolean;
  changed: boolean;
  remoteHeads: Heads;
}> {
  const res = await request<{
    action: 'merged' | 'adopted' | 'kept-local';
    heads: Heads;
    dirty: boolean;
    changed: boolean;
    remoteHeads: Heads;
  }>('mergeRemoteEnvelope', { envelope, familyId, basis }, opts);
  // Resolved ⇒ the remote was decrypted and Automerge-loaded. A throw (corrupt
  // payload, worker timeout) is NOT a reconstruction and must not be counted.
  bumpOpenCycle('reconstruction');
  return res;
}

/** Serialize + encrypt the current doc; main assembles the envelope + uploads.
 * `heads` are the heads of exactly the serialized doc (#65) — commit them as the
 * Drive baseline once the write is acked. */
export function exportEncryptedPayload(): Promise<{ payload: string; heads: Heads }> {
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

/** Current doc heads. Also the canonical read-RPC probe the worker-death/recovery
 * test-suite drives (`docClient.test.ts`).
 *
 * Production caller since #65: `syncService`'s open-guard, which asks whether our
 * doc holds changes Drive never received. That caller MUST pass `{quiet: true}` —
 * it classifies the failure itself (`heads-probe-failed`) and a second
 * `doc-worker` report for one benign, self-healing degradation would be noise on
 * a paging-adjacent surface. */
export function getHeads(opts?: RequestOpts): Promise<{ heads: Heads }> {
  return request('getHeads', undefined, opts);
}

/** Gather every photoId referenced across registered collections (for `gcOrphans`).
 * Pass `{quiet:true}` — a `collect`-hook throw is the fail-safe abort, not a toast. */
export function collectReferencedPhotoIds(opts?: RequestOpts): Promise<{ ids: string[] }> {
  return request('collectReferencedPhotoIds', undefined, opts);
}
export function applyChanges(changes: Uint8Array[]): Promise<{ heads: Heads; landed: boolean }> {
  return request('applyChanges', { changes });
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

/** Probe worker liveness; recover if it doesn't answer promptly. A no-op unless
 * we're in worker mode, a worker is actually spawned, AND there's an active session
 * (`currentFamilyId` set) — so it never spawns a worker just to ping, and never fires
 * signed-out or in tests without a worker. Called on foreground (`visibilitychange`
 * → visible) so a backgrounded mobile PWA whose worker the OS reaped self-heals on
 * resume instead of stranding the user's first tap on a 45 s timeout. */
export async function checkWorkerLiveness(): Promise<void> {
  if (mode === 'inline' || !worker || !currentFamilyId) return;
  try {
    await request('ping', undefined, { quiet: true, timeoutMs: PING_TIMEOUT_MS });
  } catch (err) {
    // A ping timeout already ran recoverDeadWorker AND telemetered the recovery
    // (severity 'warning') inside requestCore, so we do NOT re-report it here (that
    // would double-count). A non-timeout probe failure isn't expected (dispatch
    // 'ping' can't throw), but log it so it can never be fully silent.
    console.warn('[docClient] liveness probe failed — worker recovered on next request', err);
  }
}
/** Drop the current doc but keep the key + cache (replace-load: the next merge
 * adopts remote fresh). Does NOT clear the projection (the merge repopulates it). */
export function dropDoc(): Promise<void> {
  return request('dropDoc');
}

/** Drop the in-memory doc + projection (sign-out); does NOT delete the cache. */
export async function reset(): Promise<void> {
  // reset() during the quiet window is the teardown itself; nothing to change here —
  // the next initDoc (below) re-arms normal toast policy.
  currentFamilyId = null;
  familyKey = null;
  docActor = null;
  releaseActorLease();
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
  docActor = null;
  releaseActorLease();
  currentFamilyId = null;
  needsRehydrate = false;
  rehydrating = false;
  inlineExecutor = null;
  rehydrator = null;
  cachePersistFailedHandler = null;
  localChangeHandler = null;
}
