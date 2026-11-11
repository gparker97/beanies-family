/**
 * Two tiny signals the web updater listens to, kept in a dependency-free module so
 * the publishers (`fileSync.parseBeanpodV4`, `LoginPage.vue`) never import the
 * updater, the router or telemetry.
 *
 * 1. "A newer-version family file was seen" (`signalNewerFileSeen`). One publisher
 *    (`parseBeanpodV4`, the reader every path funnels through) and one subscriber
 *    (`usePwaUpdater`, web only), so a single slot rather than a listener list. No
 *    handler (native, tests) means a no-op.
 * 2. "The login page is sitting idle on its landing view" (`setPreAuthIdle`). Every
 *    login view (family picker, load-pod password, decrypt spinner, create wizard)
 *    lives on `/welcome` with no navigation between them, so the route cannot tell
 *    an idle landing from a half-typed form. `LoginPage` publishes the truth.
 *
 * See `docs/plans/2026-11-11-web-stale-build-and-phone-browser-header.md` (ops repo).
 */

type NewerFileHandler = () => void;

let newerFileHandler: NewerFileHandler | null = null;
let preAuthIdle = false;
let preAuthIdleHandler: (() => void) | null = null;

/** Install (or clear, with `null`) the one newer-file subscriber. */
export function setNewerFileHandler(fn: NewerFileHandler | null): void {
  newerFileHandler = fn;
}

/**
 * Tell the updater a file from a NEWER beanies was seen. Called immediately before
 * `parseBeanpodV4` throws, so it must never throw itself: a throwing handler is
 * caught and reported here, and the caller's real error still propagates.
 */
export function signalNewerFileSeen(): void {
  const handler = newerFileHandler;
  if (!handler) return;
  try {
    handler();
  } catch (e) {
    reportSignalFailure('newer-file', e);
  }
}

/**
 * A contained subscriber failure still reaches the firehose. Lazy import: a static
 * telemetry import would pull diagnosticContext -> syncStore into fileSync's graph
 * (the cycle documented in hardReload.ts).
 */
function reportSignalFailure(signal: 'newer-file' | 'idle', e: unknown): void {
  console.warn(`[appUpdateSignals] ${signal} handler threw (contained):`, e);
  void import('@/services/telemetry')
    .then(({ logEvent }) =>
      logEvent({
        level: 'warn',
        surface: 'pwa-updater',
        message: `${signal} handler threw`,
        context: {
          action: 'signal-failed',
          detail: `signal=${signal}`,
          error_code: e instanceof Error ? e.name : 'unknown',
        },
        error: e,
      })
    )
    .catch((err: unknown) => console.warn('[appUpdateSignals] telemetry skipped:', err));
}

/** Install (or clear, with `null`) the one "landing became idle" subscriber. */
export function setPreAuthIdleHandler(fn: (() => void) | null): void {
  preAuthIdleHandler = fn;
}

/**
 * Published by `LoginPage`: true only while its landing view sits idle.
 *
 * The false -> true edge calls the subscriber. Without it, a stale tab that is found
 * behind at boot (when auth has not initialised and nothing is idle yet) would sit on
 * the landing for a full poll interval before anything asked again: the browser pass
 * of 2026-11-11 caught exactly that. A throwing subscriber is contained, since the
 * caller is a component watcher.
 */
export function setPreAuthIdle(idle: boolean): void {
  const becameIdle = idle && !preAuthIdle;
  preAuthIdle = idle;
  if (!becameIdle || !preAuthIdleHandler) return;
  try {
    preAuthIdleHandler();
  } catch (e) {
    reportSignalFailure('idle', e);
  }
}

export function isPreAuthIdle(): boolean {
  return preAuthIdle;
}
