/**
 * Classify an OAuth `error` return from Google, the ONE rule for both transports: the web
 * callback page (`OAuthCallbackPage`, popup / iframe / full-page redirect) and the native deep
 * link (`googleAuth`'s `completeNativeAuthRedirect`, whose bridge forwards Google's query string
 * verbatim, `error_description` included).
 *
 * Google's `access_denied` arrives bare for a plain Cancel/Back on the consent screen. With an
 * `error_description` it is ambiguous: the #128 fixture is a localized plain decline that carries
 * one, and an unverified app's test-user restriction on a personal account arrives the same way.
 * The described form is forwarded as `access_denied: <description>` (the shape `oauthProxy`
 * uses for token errors), so `isUserCancellation`'s exact match rejects it and the generic
 * error path handles it; the create flow files it as `access-denied`
 * (`isOAuthDescribedAccessDenied`). Every other `error` is an error, forwarded unchanged.
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

/**
 * The message the web popup opener throws when the browser refuses `window.open`. One definition
 * shared by the thrower (`googleAuth`) and `isPopupBlocked` below, so the predicate and the
 * message cannot drift apart in two files.
 */
export const POPUP_BLOCKED_MESSAGE = 'Popup blocked — please allow popups for this site';

/**
 * The `name` of the error the popup transport rejects with when Google never posts back inside its
 * hard cap. A literal, never a class name: the prod build minifies, and the create-flow classifier
 * (`createDriveErrors.ts`) reads this name to file the deadline as `timeout` rather than `unknown`.
 */
export const POPUP_AUTH_TIMEOUT_NAME = 'PopupAuthTimeoutError';

/*
 * The OAuth string predicates live together here, one module for the string shapes Google and
 * our own openers produce. `isOAuthPolicyBlock` matches ONLY Google's explicit policy codes, never
 * a described `access_denied`: a description is free text that does not prove a block (the #128
 * fixture is a localized plain decline with one), so no description can turn a decline into
 * "use another account". `classifyCreateDriveFailure` is the ladder that orders them.
 *
 * They are pure string checks with no imports, so a module that classifies OAuth failures can use
 * them without pulling `googleAuth` (and the 49 test files that mock it wholesale) into its graph.
 */

/**
 * Whether a thrown error represents the user backing out of an auth/picker
 * flow (closing the Google account chooser, dismissing the OS file picker,
 * a blocked popup, etc.) rather than a real failure. Callers use this to
 * treat the situation as a quiet "never mind" instead of an error to report.
 *
 * Covers the `AbortError` shape (`showSaveFilePicker` cancellation) by name
 * and the GIS / popup-blocked message shapes by substring.
 *
 * `access_denied` is Google's OAuth error for Cancel/Back on the consent screen:
 * a decision, not a fault (#128). Unmatched, it surfaced as the raw string
 * "access_denied" and paged `#beanies-errors` as critical.
 *
 * ⚠️ ONLY THE BARE CODE IS A CANCEL here, never a message that merely contains it. A described
 * `access_denied` (forwarded by `OAuthCallbackPage` as `access_denied: <description>`, as
 * `oauthProxy` does for token errors) may be an unverified app's test-user restriction, which the
 * join and settings flows must report rather than swallow. The create flow matches that form
 * with `isOAuthDescribedAccessDenied`.
 */
export function isUserCancellation(e: unknown): boolean {
  if ((e as { name?: string } | null)?.name === 'AbortError') return true;
  const msg = e instanceof Error ? e.message : String(e);
  if (/cancel|dismiss|popup_closed|user_cancel/i.test(msg)) return true;
  return msg.trim().toLowerCase() === 'access_denied';
}

/**
 * Whether the browser REFUSED to open the popup, as opposed to the user closing it.
 *
 * ⚠️ A sibling of `isUserCancellation`, which deliberately does NOT match this shape: a browser
 * blocking the popup is not a "never mind", it is a condition the user can actually fix (allow
 * popups) and must therefore be told about. Collapsing the two is why `OAUTH_POPUP_BLOCKED`
 * existed in the join error registry and was emitted by precisely nothing.
 *
 * Matches `POPUP_BLOCKED_MESSAGE` above, which `googleAuth`'s popup opener throws.
 */
export function isPopupBlocked(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /popup blocked/i.test(msg);
}

/** Google's OAuth error codes for a Workspace policy that forbids this app for the account. */
const OAUTH_POLICY_ERROR_CODES: ReadonlySet<string> = new Set([
  'admin_policy_enforced',
  'org_internal',
]);

/**
 * Whether an OAuth failure is a POLICY BLOCK: something the person cannot fix by retrying, only
 * by using another Google account (or by their administrator).
 *
 * Matches exactly `admin_policy_enforced` / `org_internal`, the codes Google returns on a
 * redirect for a Workspace policy. Any `access_denied`, bare or described, does NOT match (see
 * `isOAuthDescribedAccessDenied`).
 */
export function isOAuthPolicyBlock(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).trim();
  return OAUTH_POLICY_ERROR_CODES.has(msg.toLowerCase());
}

/**
 * Whether an OAuth failure is Google's DESCRIBED `access_denied`, the
 * `access_denied: <description>` form `classifyOAuthError` forwards. Never the bare code: that is
 * the person's own Cancel/Back, which `isUserCancellation` owns. The description is free text that
 * does not prove a policy block (the #128 fixture is a localized plain decline with one), so the
 * create flow files this as its own neutral `access-denied`, apart from both.
 */
export function isOAuthDescribedAccessDenied(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).trim().toLowerCase();
  return msg.startsWith('access_denied:');
}
