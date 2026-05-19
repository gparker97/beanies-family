/**
 * iOS WebKit's IndexedDB implementation occasionally throws spurious
 * "internal error" rejections — particularly after PWA wake-from-background
 * and during the SW activation window. These are transient: the next
 * attempt typically succeeds. We classify them here so they:
 *
 *   1. Can be retried at the call site (`withIdbRetry`)
 *   2. Don't leak to #beanies-errors as `unhandled-promise-rejection` alerts
 *      when they slip past a catch (matched in `main.ts`'s global handler,
 *      same pattern as `isChunkLoadError`)
 *
 * Distinct from genuine IDB problems (quota exceeded, schema upgrade race,
 * disabled-by-user) — those should still surface so we can fix them.
 *
 * Origin: 2026-05-18 Lafleur iPhone PWA cascade where an iOS-thrown
 * "An internal error was encountered in the Indexed Database server"
 * unhandled-rejection co-occurred with a save-failure-banner critical
 * within ~100 ms.
 */
export function isIdbTransientError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  return (
    /An internal error was encountered in the Indexed Database server/i.test(msg) ||
    // WebKit also names this `UnknownError` on the DOMException. Pair with
    // an IDB hint so we don't swallow unrelated UnknownErrors.
    (name === 'UnknownError' && /indexed|database/i.test(msg)) ||
    // Transactions can self-abort on iOS during SW activation with these
    // shapes — both surfaced as DOMException, both recoverable on retry.
    /Connection to Indexed Database server lost/i.test(msg) ||
    /A mutation operation was attempted on a database that did not allow/i.test(msg)
  );
}

/**
 * Retry-once wrapper for IDB operations that may hit a transient iOS
 * WebKit failure. Permanent errors (quota, schema mismatch, anything
 * `isIdbTransientError` rejects) propagate immediately — no retry.
 *
 * Backoff is a small fixed delay (250 ms) since the failure mode is
 * usually a millisecond-scale internal race; longer waits don't improve
 * success rate and just delay the user.
 *
 * The `label` is for the console log only — it identifies which call site
 * recovered (or didn't) when greg is reading the device console.
 */
export async function withIdbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isIdbTransientError(e)) throw e;
    console.warn(`[idb] ${label} hit transient WebKit error, retrying once:`, e);
    await new Promise((r) => setTimeout(r, 250));
    return fn();
  }
}
