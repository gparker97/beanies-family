/**
 * Reading a Google API error body, and telling a THROTTLE from a REFUSAL.
 *
 * Shared by the two Google clients — `services/calendar/googleCalendarClient.ts`
 * and `services/google/driveService.ts` — because both hit the same trap and only
 * one of them had been fixed.
 *
 * ⚠️ The trap: Google answers rate limiting with **403**, not 429. The status
 * alone cannot separate "you are going too fast" from "you may not do this", and
 * getting it wrong is not cosmetic:
 *  • Calendar classified it `forbidden`, which is terminal — so a throttled push
 *    skipped its backoff retries, parked the connection as broken, and paged
 *    Slack for a condition that heals itself and offers the user no action.
 *  • Drive maps 403 to `DriveFileNotFoundError`, so a throttle read as "this file
 *    does not exist" — which flips healthy photos to "missing" app-wide and tells
 *    a family they lack permission to their own `.beanpod`.
 *
 * Only the `reason` string in the error body separates them, which is why it must
 * be read BEFORE the status is classified.
 */

/** Per-user burst limits. Transient, and worth a short backoff retry. */
export const GOOGLE_USER_RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  // Drive's sharing-specific throttle. `useEnsurePhotosPublic` calls
  // `permissions.create` once per photo in a loop, so this is the throttle this
  // app earns most easily — and it was being counted as "someone else's file",
  // which silently left the remaining photos without their public link.
  'sharingRateLimitExceeded',
]);

/**
 * Project-level allowance — the whole app's, not this user's.
 *
 * Still a throttle, so it must never read as a permission failure, but NOT worth
 * retrying: a day's quota cannot return inside a two-second backoff, so the extra
 * attempts are guaranteed-futile requests fired at an allowance that is already
 * exhausted, from every device at once. Google's own guidance is to back off on
 * the per-user reasons and not to retry `dailyLimitExceeded`.
 */
export const GOOGLE_PROJECT_QUOTA_REASONS: ReadonlySet<string> = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
]);

/** Any throttle — per-user or project-level. The test for "this is not a refusal". */
export function isGoogleThrottleReason(reason: string | undefined): boolean {
  return (
    reason !== undefined &&
    (GOOGLE_USER_RATE_LIMIT_REASONS.has(reason) || GOOGLE_PROJECT_QUOTA_REASONS.has(reason))
  );
}

/** A throttle that backing off can actually clear. */
export function isGoogleRetryableThrottleReason(reason: string | undefined): boolean {
  return reason !== undefined && GOOGLE_USER_RATE_LIMIT_REASONS.has(reason);
}

export interface GoogleErrorBody {
  /** e.g. `rateLimitExceeded`, `insufficientPermissions`. The load-bearing field. */
  reason?: string;
  /** Google's human message, e.g. "Rate Limit Exceeded". */
  message?: string;
  /** `reason: message`, or whichever half exists. Empty when neither does. */
  detail: string;
}

/**
 * Pull `reason` + `message` out of a parsed Google error body.
 *
 * Takes the already-parsed JSON rather than the Response on purpose: the two
 * callers have different timeout policies for reading a body (the calendar client
 * bounds it, because its read sits in front of a token re-mint), and that concern
 * belongs at the call site. This function is about SHAPE only — total, and never
 * throws, so a caller can hand it anything it managed to parse.
 */
export function extractGoogleError(body: unknown): GoogleErrorBody {
  const error = (body as { error?: { message?: unknown; errors?: unknown } } | null)?.error;
  const first = Array.isArray(error?.errors)
    ? (error.errors[0] as { reason?: unknown } | undefined)
    : undefined;
  const reason = typeof first?.reason === 'string' ? first.reason : undefined;
  const message = typeof error?.message === 'string' ? error.message : undefined;
  return { reason, message, detail: [reason, message].filter(Boolean).join(': ') };
}
