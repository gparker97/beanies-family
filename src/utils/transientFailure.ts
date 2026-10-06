/**
 * The single transient-failure classifier for Drive retry and queue decisions.
 *
 * `classifyTransientFailure` is the ONLY source for "should this be retried",
 * "should this write be queued" and "should this read failure be queued". Three
 * drifting copies of that decision used to disagree about 408 (the provider's
 * retry retried it, its write path hard-failed it, the read path counted it),
 * and that disagreement is how a slow uplink became a critical "can't save"
 * alarm (#127). Add a class here and to `TRANSIENT_FAILURES`, never a fourth
 * predicate at a call site.
 *
 * Classes:
 *   - `timeout`: OUR sized Drive deadline fired (`DriveTimeoutError`, duck-typed
 *     on `.timedOut === true`), or the PLATFORM's own deadline fired first:
 *     iOS aborts a request at its ~60 s default and the rejected `fetch` carries
 *     `The request timed out.` with no HTTP status.
 *   - `server`: Google answered 5xx, or a genuine HTTP 408 from Google.
 *   - `network`: the request never reached the server (browser and iOS
 *     URLSession offline / DNS / cannot-connect messages).
 *
 * Deliberately NOT transient: 429 and 403-throttle (`isGoogleThrottleReason`).
 * They keep their existing no-retry behaviour; a `'throttle'` class is a
 * follow-up, and adding it to `TRANSIENT_FAILURES` makes every
 * `Record<TransientFailure, …>` (retry budget, queue reason, requeue outcome)
 * a compile error until its policy is chosen.
 *
 * Duck-typed on `.status` / `.timedOut`, never `instanceof` a Drive error class:
 * ~20 test files mock `driveService` with hand-written factories that define
 * only `DriveApiError(message, status)`, and the classifier must behave the same
 * against those as against the real classes. An HTTP error (numeric `.status`)
 * is classified by status alone, so its message can never be misread as a
 * network failure.
 */

/**
 * Cross-browser network-error message match.
 *
 * Browsers throw DIFFERENT messages for the same "the fetch never reached the
 * server" failure:
 *   - Chrome / Edge / Firefox: `TypeError: Failed to fetch` / "NetworkError…"
 *   - Safari / iOS WebKit:      `TypeError: Load failed`   ← no "fetch" substring
 *
 * A narrow `message.includes('fetch')` check (the old `GoogleDriveProvider.write`
 * guard) therefore MISSES every iOS network failure, so the offline-queue
 * fallback was skipped and the user's save was lost instead of retried
 * (2026-06-19, finding 6).
 */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|load failed/i.test(msg);
}

/** Every transient class, in one list. `offlineQueue`'s queue reasons are built from it. */
export const TRANSIENT_FAILURES = ['timeout', 'server', 'network'] as const;
export type TransientFailure = (typeof TRANSIENT_FAILURES)[number];

/** iOS URLSession messages that mean "never reached the server" but match none of `isNetworkError`'s words. */
const IOS_URLSESSION_NETWORK =
  /appears to be offline|could not be found|could not connect to the server/i;

/**
 * Classify a failure as a transient class, or `null` when it is not transient
 * (retrying or queueing it would not help, so it must surface).
 *
 * With a numeric `.status` (an HTTP answer, or our own `DriveTimeoutError`):
 * `timedOut === true` → `timeout`; 5xx or 408 → `server`; anything else → `null`.
 *
 * With no status (a rejected `fetch`):
 *   - `TypeError` whose message says "timed out" → `timeout` (the platform's own
 *     deadline). Limited to `TypeError` because only a rejected `fetch` can be a
 *     platform timeout: the codebase throws plain `Error`s that say "timed out"
 *     (doc-worker RPCs, the cache open, the OAuth proxy) and those must stay
 *     `null`. Tested first, because `The request timed out.` matches none of the
 *     network words.
 *   - `isNetworkError`, or a `TypeError` with an iOS URLSession offline / DNS /
 *     cannot-connect message → `network`. The `isNetworkError` arm is not gated
 *     on `TypeError`, matching what the provider's write path always did.
 */
export function classifyTransientFailure(e: unknown): TransientFailure | null {
  const status = (e as { status?: unknown } | null | undefined)?.status;
  if (typeof status === 'number') {
    if ((e as { timedOut?: unknown }).timedOut === true) return 'timeout';
    return status >= 500 || status === 408 ? 'server' : null;
  }
  if (e instanceof TypeError && /timed out/i.test(e.message)) return 'timeout';
  if (isNetworkError(e) || (e instanceof TypeError && IOS_URLSESSION_NETWORK.test(e.message))) {
    return 'network';
  }
  return null;
}
