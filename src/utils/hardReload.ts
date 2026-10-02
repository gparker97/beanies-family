import type { LogEventInput } from '@/services/telemetry';

/**
 * Upper bound on `hardReload()`'s SW/cache cleanup. Every await in it
 * (`getRegistration`, `update`, `unregister`, `caches.delete`) is a browser call
 * with no timeout of its own, and while a chunk recovery is in flight App.vue's
 * init watchdog and spinner dismissal stand down (`isChunkRecoveryInProgress`),
 * so a hung SW call would otherwise leave "counting beans" up forever. Past the
 * deadline the page is replaced regardless; the cleanup is best-effort anyway.
 */
export const HARD_RELOAD_CLEANUP_DEADLINE_MS = 8000;

/**
 * Hard-reload primitive that actively defeats stale service-worker caches.
 *
 * The PWA precaches `index.html` and the hashed JS/CSS chunk filenames
 * (workbox `globPatterns`). With `registerType: 'prompt'`, the SW only
 * activates a new version after the user accepts the update banner.
 * In the gap between deploy and accept, every navigation that triggers
 * a route's lazy `import()` looks up a chunk filename that no longer
 * exists on the server (filenames are content-hashed) and the import
 * promise rejects with `Failed to fetch dynamically imported module`.
 *
 * `window.location.reload()` is NOT enough to recover: the SW intercepts
 * the navigation, returns the same cached `index.html`, and the user
 * lands right back on the broken state. We have to evict the precache
 * AND tell the SW to update before navigating, otherwise the same dead
 * chunk URLs come back.
 *
 * This is the recovery primitive shared by:
 *   - `router.onError` (auto-recovery on chunk fetch failure)
 *   - `vite:preloadError` window listener (modulepreload failure)
 *   - The error-overlay "Reload" button in `App.vue`
 *   - The "Sign Out & Clear Data" path
 *   - The "new version ready" action toast from the header refresh icon
 *
 * Loop protection for the auto-recovery paths lives in
 * `startChunkRecovery` / `tryRecoverChunkLoad` below: a bounded attempt
 * counter (cleared after a confirmed successful boot) plus an in-progress
 * flag, so if the new HTML *also* fails (e.g. network down) we surface the
 * error overlay instead of looping.
 */
export async function hardReload(): Promise<void> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    deadlineTimer = setTimeout(() => resolve('deadline'), HARD_RELOAD_CLEANUP_DEADLINE_MS);
  });
  try {
    const outcome = await Promise.race([evictServiceWorkerAndCaches(), deadline]);
    if (outcome === 'deadline') {
      console.warn(
        `[hardReload] SW/cache cleanup exceeded ${HARD_RELOAD_CLEANUP_DEADLINE_MS}ms, reloading anyway`
      );
    }
  } catch (e) {
    console.warn('[hardReload] cache/SW cleanup failed, reloading anyway:', e);
  } finally {
    clearTimeout(deadlineTimer);
  }
  // `replace` (not assign) so the broken state isn't a back-button trap.
  // `pathname + search` re-hits the same route with a fresh fetch chain.
  // It can throw (a sandboxed frame, some WebViews); rethrown so the caller
  // learns the page is NOT about to be replaced (see `startChunkRecovery`).
  try {
    window.location.replace(window.location.pathname + window.location.search);
  } catch (e) {
    console.error('[hardReload] location.replace failed, page not reloaded:', e);
    throw e;
  }
}

/** The SW update/unregister + Cache Storage eviction half of `hardReload()`. */
async function evictServiceWorkerAndCaches(): Promise<'done'> {
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      try {
        await reg.update();
      } catch (e) {
        console.warn('[hardReload] SW update failed (transient):', e);
      }
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      // Aggressive: unregister so the next nav bypasses the SW intercept
      // entirely. The SW re-registers on the fresh load via `registerSW`
      // in main.ts (offline support comes back within ~1 second). This is
      // the only thing that reliably breaks iOS Safari's stale-precache
      // loop when registerType: 'prompt' has held a new SW in waiting
      // limbo — `update()` + `SKIP_WAITING` are no-ops there, and
      // workbox's NavigationRoute can still serve stale `index.html`
      // even after `caches.delete(all)`. `hardReload()` is only ever
      // called from recovery paths (router.onError, vite:preloadError,
      // App.vue init catch, the user-Reload button) — never on a healthy
      // path — so the brief offline gap is always an acceptable trade.
      try {
        await reg.unregister();
      } catch (e) {
        console.warn('[hardReload] SW unregister failed (continuing):', e);
      }
    }
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  return 'done';
}

/**
 * Match the various module-load error shapes produced by Vite + browsers
 * when a hashed chunk filename has rotated (post-deploy stale-SW gap).
 *
 * Covers:
 *   - Chrome/Edge: "Failed to fetch dynamically imported module"
 *   - Firefox: "error loading dynamically imported module"
 *   - Safari: "Importing a module script failed"
 *   - Vue Router fallback: "Couldn't resolve component "<name>" at "<path>""
 *     fires when the route's lazy `import()` resolves to something that
 *     isn't a valid module (e.g., CloudFront serves the SPA's 404 HTML
 *     in place of the rotated chunk filename — import() succeeds but
 *     the module has no `default` export, so Vue Router's resolver
 *     throws). Same root cause, different observable error shape.
 *     Caught live 2026-05-04 from a stale tab three deploys behind HEAD.
 *   - Destructure-of-null TypeError: when the dynamic `import()` resolves
 *     to `null` (rather than throwing one of the shapes above), every
 *     downstream `const { foo } = await import(...)` throws this. Observed
 *     live 2026-05-10 from greg's iPhone PWA mid-update — the SW served a
 *     response for the rotated chunk URL that parsed as a null module
 *     instead of a fetch failure, so `vite:preloadError` didn't fire and
 *     the App.vue init catch saw a generic TypeError. The destructure
 *     site (`App.vue:499` for `registerGoogleAccountAssertion`) named the
 *     property in the message — distinctive enough to recognize without
 *     swallowing real null-deref bugs.
 *
 *     iOS Safari uses a different preposition for the same symptom — its
 *     wording is "Cannot destructure property 'X' from null or undefined
 *     value" (greg's iPhone 14, 2026-05-13). The previous regex only
 *     matched the "as it is null|undefined" V8/Firefox shape, so the
 *     recovery never fired for iOS-Safari users and they got stuck in a
 *     reload loop. The single permissive pattern below now matches any
 *     phrasing of "Cannot destructure … (null|undefined)" — current and
 *     future — without swallowing unrelated null-derefs (those say
 *     "Cannot read properties of null", "null is not an object
 *     (evaluating …)", "X is null", etc.).
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Couldn't resolve component .+ at /i.test(msg) ||
    // Any destructure-of-(null|undefined) shape — V8/Node/Firefox/modern
    // WebKit ("as it is null"), iOS Safari ("from null or undefined
    // value"), and future browser phrasings. The "Cannot destructure"
    // prefix + bounded `[^.]*` (one sentence) keep this from matching
    // legit non-chunk null-derefs.
    /Cannot destructure[^.]*\b(?:null|undefined)\b/i.test(msg)
  );
}

/**
 * sessionStorage *counter* the chunk-load recovery paths increment before
 * invoking `hardReload()` — bounds the recovery loop to N attempts so a
 * persistently-broken state can't reload forever. Read + incremented only by
 * `startChunkRecovery` below (every recovery path goes through it). Cleared
 * by the overlay's "Reload" button and by `App.vue`'s post-init health check
 * (after a confirmed successful boot, NOT just any `afterEach`: that fires on
 * the initial nav before App.vue's onMounted error has a chance to throw,
 * defeating the bound).
 *
 * Name kept as "Flag" for backwards-compat with sessionStorage entries
 * from prior builds (where it was 0/1). Old "1" parses to numeric 1, so
 * a tab carrying the old value just starts at attempt 1 of N — graceful.
 */
export const CHUNK_RELOAD_FLAG = 'chunkReloadAttempted';

/**
 * In-memory mirror of the chunk-reload attempt counter.
 *
 * `sessionStorage` is the primary store (survives the `location.replace` chain
 * in the same tab). But on devices where Web Storage THROWS on access — the
 * iPhone onboarding blocker, 2026-06-20 — a bare `sessionStorage.getItem` in the
 * recovery branch threw and was swallowed, silently skipping BOTH `hardReload()`
 * AND the `app.chunkRecoveryFailed` Slack page. This module-level mirror keeps
 * the counter usable when storage throws, so recovery still escalates and still
 * pages. Reset by a full document load (same lifetime as the persisted value).
 *
 * Shape mirrors `errorReporter`'s `getStoredFiredAt`/`setStoredFiredAt`: prefer
 * storage, fall back to memory, never throw, warn on degrade.
 */
let chunkAttemptsMemory = 0;

/** Current attempt count — `max(persisted, in-memory)`, never throws. */
export function readChunkAttempts(): number {
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_FLAG);
    if (raw != null) {
      const parsed = parseInt(raw, 10) || 0;
      return Math.max(parsed, chunkAttemptsMemory);
    }
  } catch (e) {
    console.warn('[hardReload] chunk counter read failed — using memory fallback', e);
  }
  return chunkAttemptsMemory;
}

/** Persist the attempt count (memory always; storage best-effort). */
export function writeChunkAttempts(n: number): void {
  chunkAttemptsMemory = n;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(n));
  } catch (e) {
    console.warn('[hardReload] chunk counter persist failed — memory fallback only', e);
  }
}

/** Clear the attempt counter on both stores (called on successful boot). */
export function resetChunkAttempts(): void {
  // No-op mid-recovery: a recovery `hardReload()` may still be awaiting SW/cache
  // cleanup when App.vue's boot health check passes, and resetting then would
  // refund the attempt it just spent and turn the bounded budget into a loop.
  if (recoveryInProgress) return;
  chunkAttemptsMemory = 0;
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
  } catch (e) {
    console.warn('[hardReload] chunk counter reset failed', e);
  }
}

/**
 * Silent-recovery budget for chunk-load failures: up to this many
 * `hardReload()` attempts per tab before the failure is surfaced (iOS Safari's
 * SW lifecycle legitimately needs 2 sometimes). Shared by `router.onError`,
 * the `vite:preloadError` listener in `main.ts`, `App.vue`'s init catch and
 * `tryRecoverChunkLoad` below, so every path spends the same counter against
 * the same ceiling.
 */
export const CHUNK_RELOAD_MAX_ATTEMPTS = 3;

/**
 * True from the moment a chunk-recovery `hardReload()` is started until the page
 * is replaced (a full document load resets module state). Owned here, not by any
 * one caller, so every path that triggers recovery (the translation store,
 * `router.onError`, `vite:preloadError`, App.vue's init catch) is visible to the
 * paths that must stand down while it runs: App.vue's init watchdog and its
 * `finally` (keep the "counting beans" spinner up instead of painting the
 * stalled overlay), and `resetChunkAttempts()` (no refund of the attempt).
 */
let recoveryInProgress = false;

/** The `exhausted` event fires once per tab, not on every failure after it. */
let exhaustedReported = false;

/** Whether a chunk-recovery reload is already swapping the page. */
export function isChunkRecoveryInProgress(): boolean {
  return recoveryInProgress;
}

/**
 * The shared "attempts < max -> increment -> hardReload" step, WITHOUT error
 * classification. For callers whose trigger is itself the chunk-failure signal
 * (the `vite:preloadError` event, whose payload can be a CSS-preload error that
 * `isChunkLoadError` does not match). Everyone else uses `tryRecoverChunkLoad`.
 *
 * Returns `true` when a recovery reload is running (started now, or already in
 * flight: a second failure from the same stale bundle neither spends another
 * attempt nor starts a second `hardReload()`), `false` when the budget is spent
 * and the caller should surface the failure.
 */
export function startChunkRecovery(err?: unknown): boolean {
  if (recoveryInProgress) return true;
  const attempts = readChunkAttempts();
  if (attempts >= CHUNK_RELOAD_MAX_ATTEMPTS) {
    if (!exhaustedReported) {
      exhaustedReported = true;
      void emitChunkRecoveryEvent({
        level: 'error',
        surface: 'chunk-recovery',
        message: 'chunk recovery exhausted',
        context: { action: 'exhausted' },
      });
    }
    return false;
  }
  const attempt = attempts + 1;
  writeChunkAttempts(attempt);
  recoveryInProgress = true;
  console.warn(
    `[hardReload] chunk-load symptom, hardReload attempt ${attempt}/${CHUNK_RELOAD_MAX_ATTEMPTS}:`,
    err
  );
  // Reload only after the event is queued: on a browser with no SW and no Cache
  // Storage, `hardReload()` replaces the page without awaiting anything, and the
  // event would be lost. `flush` sends it before the page goes.
  void emitChunkRecoveryEvent({
    level: 'warn',
    surface: 'chunk-recovery',
    message: `hardReload attempt ${attempt}/${CHUNK_RELOAD_MAX_ATTEMPTS}`,
    context: { action: 'reload' },
    flush: true,
  })
    .then(() => hardReload())
    .catch((e: unknown) => {
      // The page is NOT being replaced. Clear the flag, or it would disable
      // `resetChunkAttempts`, App.vue's watchdog and its spinner dismissal for
      // the rest of the tab's life. The spent attempt stays spent.
      recoveryInProgress = false;
      console.error('[hardReload] chunk-recovery reload could not start:', e);
      void emitChunkRecoveryEvent({
        level: 'error',
        surface: 'chunk-recovery',
        message: 'hard reload could not start',
        context: { action: 'failed', error_code: e instanceof Error ? e.name : 'unknown' },
      });
    });
  return true;
}

/**
 * Firehose event for the chunk-recovery step. Never rejects.
 *
 * Imported lazily because a static import is a cycle: `@/services/telemetry`
 * reaches back to this module via diagnosticContext -> syncStore ->
 * translationStore. The telemetry module is already in the main bundle
 * (`main.ts` -> `errorReporter`), so this resolves from the module map without
 * fetching a chunk, which matters on exactly the stale-bundle path that runs it.
 */
function emitChunkRecoveryEvent(input: LogEventInput): Promise<void> {
  return import('@/services/telemetry')
    .then(({ logEvent }) => logEvent(input))
    .catch((e) => console.warn('[hardReload] chunk-recovery telemetry skipped:', e));
}

/**
 * `startChunkRecovery` for a caught error: only a chunk-load symptom (per
 * `isChunkLoadError`) is recovered. Returns `true` when a recovery reload is
 * running (the caller should stop handling the error: the page is about to be
 * replaced), `false` when the error is not a chunk-load symptom or the budget is
 * exhausted (the caller reports it as a real failure).
 */
export function tryRecoverChunkLoad(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;
  return startChunkRecovery(err);
}

/**
 * Test-only: clear the in-progress flag and the attempt counter. Module state
 * otherwise only resets on a full document load, which tests never do.
 */
export function __resetChunkRecoveryStateForTests(): void {
  recoveryInProgress = false;
  exhaustedReported = false;
  resetChunkAttempts();
}
