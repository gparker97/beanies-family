// ─── Visibility tracker (module-scope, lazy-registered) ─────────────────────
//
// Tracks `document.visibilityState` transitions so wake-time diagnostics can
// report "how long was the page hidden before this failure" — the iOS PWA
// wake path and Chrome desktop wake-from-sleep are both suspect surfaces,
// and we can't diagnose them without knowing whether the failure fired right
// after a wake or during a long-foreground session.
//
// Lazy-registered (on first call to `getHiddenDurationMs`) so importing this
// module doesn't add a visibilitychange listener at module-load time —
// unrelated tests assert listener counts and would break otherwise.
//
// Consumed by:
//   - `syncStore.ts` cold-start-reconnect-escalation context
//   - `silentRefreshAlertContext.ts` shared alert-context builder (which the
//     `offline-queue-flush` path uses via `reportFlushFailure`)

const visibilityTracker = {
  lastHiddenAt: null as number | null,
  lastVisibleAt: typeof document !== 'undefined' ? Date.now() : null,
  listenerRegistered: false,
};

function ensureVisibilityListener(): void {
  if (visibilityTracker.listenerRegistered) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.visibilityState === 'hidden') {
      visibilityTracker.lastHiddenAt = now;
    } else {
      visibilityTracker.lastVisibleAt = now;
    }
  });
  visibilityTracker.listenerRegistered = true;
}

/** ms the page was last hidden before becoming visible, or null if never
 *  hidden this session. Used as a wake-time diagnostic on auth/sync failures. */
export function getHiddenDurationMs(): number | null {
  ensureVisibilityListener();
  const { lastHiddenAt, lastVisibleAt } = visibilityTracker;
  if (lastHiddenAt === null || lastVisibleAt === null) return null;
  if (lastVisibleAt < lastHiddenAt) return null; // page is still hidden — n/a
  return lastVisibleAt - lastHiddenAt;
}
