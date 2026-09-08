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

/**
 * Whether an OAuth refresh failure is a REJECTION by Google (a 4xx from the
 * proxy) as opposed to the proxy itself failing (a 5xx) or the network dropping.
 *
 * Distinct from `isPermanentRefreshFailure` in both directions:
 *   - a permanent failure (`invalid_grant`) is already handled earlier and never
 *     reaches the escalation counter, so this is NOT a superset of it;
 *   - a 5xx is explicitly NOT a rejection. Per this module's header, "everything
 *     else (network, timeout, 5xx, rate limiting) is transient and must stay
 *     retryable", and treating a proxy outage as a rejection is what made the
 *     reconnect prompt fire for causes the user could do nothing about.
 *
 * Depends on `oauthProxy` including `HTTP <status>` in the thrown message. That
 * coupling is deliberate and commented at the throw site; without it this
 * predicate is false for every real rejection and escalation silently stops.
 */
export function isRefreshRejection(errOrMessage: unknown): boolean {
  const message =
    errOrMessage instanceof Error
      ? errOrMessage.message
      : typeof errOrMessage === 'string'
        ? errOrMessage
        : '';
  return /HTTP 4\d\d/.test(message);
}
