/**
 * Cross-browser network-error classifier.
 *
 * Browsers throw DIFFERENT messages for the same "the fetch never reached the
 * server" failure:
 *   - Chrome / Edge / Firefox: `TypeError: Failed to fetch` / "NetworkError…"
 *   - Safari / iOS WebKit:      `TypeError: Load failed`   ← no "fetch" substring
 *
 * A narrow `message.includes('fetch')` check (the old `GoogleDriveProvider.write`
 * guard) therefore MISSES every iOS network failure, so the offline-queue
 * fallback was skipped and the user's save was lost instead of retried
 * (2026-06-19, finding 6). This is the single shared classifier used by both
 * `withRetry` and `write()` so the two can never drift again.
 */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|load failed/i.test(msg);
}
