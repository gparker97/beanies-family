/**
 * Well-known benign browser-platform signals that are NOT app faults and carry
 * no user impact — they must not page #beanies-errors. Kept deliberately narrow
 * (exact known strings only) so a real error can never hide behind this filter.
 * Mirrors the `isChunkLoadError` (`hardReload.ts`) / `isIdbTransientError`
 * (`idbTransient.ts`) allowlist predicates matched in `main.ts`'s global handlers.
 *
 * Currently: the ResizeObserver "loop" notifications the spec emits when observer
 * callbacks can't settle before the next paint (fires on iOS Safari + Chromium;
 * no fault, no impact). Reached #beanies-errors as an `unhandled-error` critical
 * because the synchronous `window.error` handler had no filter (2026-07-07).
 *
 * Accepts an Error, a raw message string, or any unknown reason — the synchronous
 * `error` event carries the signal in `event.message` (its `event.error` is
 * frequently null for ResizeObserver). The `unknown` signature is also the single
 * extension point if a future benign browser signal ever arrives via a promise
 * rejection.
 */
const BENIGN_BROWSER_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
] as const;

export function isBenignBrowserError(errOrMessage: unknown): boolean {
  const msg =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage instanceof Error
        ? errOrMessage.message
        : '';
  return BENIGN_BROWSER_MESSAGES.some((m) => msg.includes(m));
}
