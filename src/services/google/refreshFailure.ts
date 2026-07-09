/**
 * Single source of truth for "Google has permanently rejected this refresh token".
 *
 * A permanent failure means the refresh token is dead at Google's end and no
 * amount of retrying will revive it — the user must re-consent. It is the
 * signal that licenses a caller to stop hitting the OAuth proxy, clear the
 * stored token, and surface a reconnect prompt. Everything else (network,
 * timeout, 5xx, rate limiting) is transient and must stay retryable.
 *
 * This rule previously lived in two places — `googleAuth.classifySilentRefreshError`
 * and `googleCalendarClient.isPermanentRefreshFailure` — with subtly different
 * matches: one required the full phrase "Token has been expired or revoked",
 * the other the substring "expired or revoked". Google's wording varies across
 * endpoints, so the broader match is the correct one, and one home means one
 * behaviour for Drive and Calendar (which share an OAuth client and therefore
 * die together).
 */

/**
 * Whether an OAuth refresh failure is permanent (the refresh token is revoked
 * or expired) rather than transient.
 *
 * Accepts an `Error`, or a raw message string. Anything else is treated as
 * non-permanent — an unrecognized throw must never be mistaken for a
 * revocation, since that would clear a working token and force re-consent.
 */
export function isPermanentRefreshFailure(errOrMessage: unknown): boolean {
  const message =
    errOrMessage instanceof Error
      ? errOrMessage.message
      : typeof errOrMessage === 'string'
        ? errOrMessage
        : '';
  return message.includes('invalid_grant') || message.includes('expired or revoked');
}
