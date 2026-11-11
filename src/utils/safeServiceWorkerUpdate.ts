/**
 * Fire-and-forget service-worker update that never produces an unhandled
 * promise rejection.
 *
 * `registration.update()` rejects on any transient fetch failure of `sw.js`
 * — patchy mobile signal, momentary CDN hiccup, mid-deploy cache
 * invalidation. The currently-installed service worker keeps serving fine;
 * the next update attempt will succeed. There is nothing actionable for us
 * to do beyond logging.
 *
 * Without this wrapper, every transient failure floats up to the global
 * `unhandledrejection` listener in `main.ts` and fires a `#beanies-errors`
 * Slack message, which is pure noise (zero user impact, no actionable fix,
 * happens routinely on mobile networks).
 *
 * The rejection is caught + classified + logged with a `[serviceWorker]`
 * prefix and the Error object so devs retain debugging visibility, but it
 * is intentionally NOT promoted to an error report. Per the project's
 * no-silent-failures rule: this is the "non-critical → console only with
 * documented fallback" case.
 *
 * @param registration  the active ServiceWorkerRegistration
 * @param source        short label for the call site (used in the log line)
 * @param onError       optional extra sink for the rejection (the web updater logs it
 *                      to the firehose as `sw-update-failed`). Default: console only.
 *                      A throwing sink is contained, so this still never rejects.
 */
export function safeServiceWorkerUpdate(
  registration: ServiceWorkerRegistration,
  source: string,
  onError?: (err: unknown) => void
): void {
  registration.update().catch((err: unknown) => {
    console.warn(`[serviceWorker] update from ${source} failed (transient):`, err);
    if (!onError) return;
    try {
      onError(err);
    } catch (sinkErr) {
      console.warn(`[serviceWorker] onError sink for ${source} threw:`, sinkErr);
    }
  });
}
