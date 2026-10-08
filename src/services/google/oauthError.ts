/**
 * Classify an OAuth `error` return from Google, the ONE rule for both transports: the web
 * callback page (`OAuthCallbackPage`, popup / iframe / full-page redirect) and the native deep
 * link (`googleAuth`'s `completeNativeAuthRedirect`, whose bridge forwards Google's query string
 * verbatim, `error_description` included).
 *
 * Google's `access_denied` is a user DECLINE (Cancel/Back on the consent screen) only when it
 * arrives bare. With an `error_description` it is a policy block (an admin-blocked third-party
 * app, an unverified app's test-user restriction): not a cancel, and retrying will not help.
 * The described form is forwarded as `access_denied: <description>` (the shape `oauthProxy`
 * uses for token errors), so `isUserCancellation`'s exact match rejects it and the generic
 * error path handles it. Every other `error` is an error, forwarded unchanged.
 *
 * Returns null when there is no `error` at all.
 */

/** Cap on the forwarded `error_description`: attacker-controllable, and it can reach logs and UI. */
export const MAX_OAUTH_ERROR_DESCRIPTION = 200;

export interface ClassifiedOAuthError {
  /** The error string to forward: `access_denied`, `access_denied: <desc>`, or the raw error. */
  message: string;
  /** `declined`: the person said no (a bare `access_denied`). `error`: anything else. */
  kind: 'declined' | 'error';
}

export function classifyOAuthError(
  error: string | null,
  description: string | null
): ClassifiedOAuthError | null {
  if (!error) return null;
  if (error !== 'access_denied') return { message: error, kind: 'error' };
  const desc = description?.trim().slice(0, MAX_OAUTH_ERROR_DESCRIPTION) ?? '';
  if (!desc) return { message: error, kind: 'declined' };
  return { message: `access_denied: ${desc}`, kind: 'error' };
}
