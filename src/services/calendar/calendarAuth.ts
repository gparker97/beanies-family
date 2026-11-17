// Multi-account Google Calendar OAuth (#32 Layer 1).
//
// COMPOSES the low-level primitives (`pkce`, `oauthProxy`, `shouldUseRedirectAuth`)
// — it deliberately does NOT reuse `googleAuth`'s Drive flow: that module is a
// single-account singleton whose scope, redirect slot, and in-memory token sink
// are all Drive-bound. Connecting a calendar must NEVER disturb the Drive session,
// so this layer owns its own auth URL, its own PKCE state, and routes the resulting
// refresh token to the CalendarConnection record (Layer 2), never to googleAuth.
//
// TRANSPORT SCOPE:
//   - Desktop (popup-capable) browsers: full consent flow here (popup).
//   - Redirect surfaces (iOS / installed PWA / native, i.e. shouldUseRedirectAuth()):
//     go through the SHARED redirect transport (P2). We share the START side of
//     googleAuth's redirect flow (`startRedirectAuth({grant:'calendar'})` — a
//     `grant` arg + calendar scopes, Drive default unchanged) and SIBLING the
//     COMPLETION side here (`completeCalendarRedirectAuth`, reading a
//     grant-namespaced code key and committing to a CalendarConnection, never the
//     Drive token). A full-page redirect makes only one grant's code pending at a
//     time, so the two code keys can never co-populate — isolation is structural.
//     Connections are still FAMILY-WIDE: a connect on any device syncs everywhere.

import { generateCodeVerifier, generateCodeChallenge } from '@/services/google/pkce';
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  type TokenResponse,
} from '@/services/google/oauthProxy';
import {
  startRedirectAuth,
  getRedirectUri,
  openOAuthPopup,
  REDIRECT_AUTH_CODE_KEY_CALENDAR,
  REDIRECT_AUTH_KEY,
} from '@/services/google/googleAuth';
import { isNative } from '@/services/sync/capabilities';
import type { RedirectMode } from '@/services/google/redirectState';
import { reportError } from '@/utils/errorReporter';
import { useTranslationStore } from '@/stores/translationStore';

/** Translate a key, falling back to English if Pinia isn't ready (this runs during
 * OAuth flows where the store is normally initialized, but never throw over copy). */
function tr(key: string, fallback: string): string {
  try {
    return useTranslationStore().t(key as never) || fallback;
  } catch {
    return fallback;
  }
}
const CONNECT_RETRY_FALLBACK =
  'We couldn’t finish connecting your calendar. Please tap Connect and try again.';
const connectRetryMsg = (): string => tr('calendar.error.connectRetry', CONNECT_RETRY_FALLBACK);

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** Calendar consent scopes. `userinfo.email` (non-sensitive) lets us label the connection. */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

/** The one scope without which the feature cannot function — validated post-consent. */
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

/**
 * Which Google grant a calendar consent asks for (view-only calendars, plan
 * 2026-11-17).
 *
 *  - `sync`: push beanies' own events to a calendar the account owns. Today's
 *    scopes, byte-identical, and the default everywhere, so every existing call
 *    site keeps asking for exactly what it asked for before.
 *  - `view`: read events on calendars someone else owns and has shared with the
 *    account. `calendar.events.readonly` is the narrowest scope that can, and it is
 *    NOT a superset of `calendar.events.owned` (it cannot write), so a view consent
 *    never doubles as a sync consent and the reverse.
 *
 * ⚠️ Production must not request `view` until Google has verified the scope (an
 * unverified sensitive scope shows the warning screen and counts against the
 * 100-user cap). Only the view store asks for it, and only with `viewOnlyCalendars`
 * on (committed off until Google approves the scope).
 *
 * No `include_granted_scopes` for either kind: each grant stays independent of
 * Drive and of the other kind.
 */
export type CalendarGrantKind = 'sync' | 'view';

/** Scopes for a view-only consent. `userinfo.email` labels the account, as for sync. */
export const VIEW_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

interface CalendarGrantSpec {
  /** Every scope the consent asks for. */
  scopes: readonly string[];
  /** The one scope the grant is useless without; its absence is `missing_scope`. */
  required: string;
  /** The `missing_scope` failure text for this kind. */
  missingScopeMessage: string;
}

/** The scope table. One row per grant kind; the single source for consent URLs and checks. */
export const CALENDAR_GRANTS: Readonly<Record<CalendarGrantKind, CalendarGrantSpec>> = {
  sync: {
    scopes: CALENDAR_SCOPES,
    required: REQUIRED_SCOPE,
    missingScopeMessage:
      'Calendar access wasn’t granted. Please allow beanies to manage its own events when prompted.',
  },
  view: {
    scopes: VIEW_CALENDAR_SCOPES,
    required: 'https://www.googleapis.com/auth/calendar.events.readonly',
    missingScopeMessage:
      'Calendar access wasn’t granted. Please allow beanies to see the events on your calendars when prompted.',
  },
};

/**
 * Grant-namespaced sessionStorage key for a pending CALENDAR redirect code (P2).
 * Written by OAuthCallbackPage (web bounce) / the native deep-link handler, read +
 * cleared by `completeCalendarRedirectAuth`. Defined in googleAuth alongside the
 * Drive key (single source of truth) and re-exported here as the calendar layer's
 * public name — a Drive code and a calendar code can never share a slot.
 */
export const CALENDAR_REDIRECT_CODE_KEY = REDIRECT_AUTH_CODE_KEY_CALENDAR;

const POPUP_AUTH_TIMEOUT_MS = 120_000;

export type CalendarAuthErrorCode =
  | 'not_configured' // VITE_GOOGLE_CLIENT_ID missing
  | 'popup_blocked' // browser blocked the consent window
  | 'cancelled' // user closed the window / declined
  | 'missing_scope' // granular consent dropped calendar.events.owned
  | 'no_refresh_token' // no offline access granted (should not happen with prompt=consent)
  | 'exchange_failed' // token exchange / network error
  | 'account_mismatch'; // re-consented as a DIFFERENT Google account than the connection holds

export interface CalendarConnectSuccess {
  status: 'connected';
  email: string | null;
  refreshToken: string;
  grantedScopes: string[];
}
export interface CalendarConnectFailure {
  status: 'failed';
  code: CalendarAuthErrorCode;
  message: string;
}
/**
 * The consent flow handed off to a full-page/system-browser redirect (P2). The
 * page is navigating away (web) or the system browser is open (native); there is
 * no synchronous result — completion resumes post-redirect via
 * `completeCalendarRedirectAuth` + the store's resume. Callers must treat this as
 * "in flight": no success toast, no error toast.
 */
export interface CalendarConnectRedirecting {
  status: 'redirecting';
}
export type CalendarConnectResult =
  CalendarConnectSuccess | CalendarConnectFailure | CalendarConnectRedirecting;

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

// `getRedirectUri` is imported from googleAuth (native-aware, single source of
// truth) — this layer used to duplicate a web-only variant that resolved to
// `/oauth/callback` on native while the authorize request (delegated to
// googleAuth.startRedirectAuth) used `/oauth/native`, so every native calendar
// token exchange 400'd (`redirect_uri_mismatch`). See ADR-029.

function buildCalendarAuthUrl(
  clientId: string,
  codeChallenge: string,
  loginHint?: string,
  kind: CalendarGrantKind = 'sync'
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: CALENDAR_GRANTS[kind].scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token; also lets the user pick the account
    // NOTE: no include_granted_scopes — keep the calendar grant independent of Drive.
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Navigate the popup to the auth URL and resolve with the authorization code. */
function waitForCode(popup: Window, url: string): Promise<string> {
  popup.location.href = url;
  return new Promise((resolve, reject) => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'oauth-callback') return;
      cleanup();
      if (event.data.error) return reject(new Error(`cancelled:${event.data.error}`));
      if (event.data.code) return resolve(event.data.code as string);
      reject(new Error('cancelled:no_code'));
    }
    const poll = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('cancelled:closed'));
      }
    }, 500);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('cancelled:timeout'));
    }, POPUP_AUTH_TIMEOUT_MS);
    function cleanup() {
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
      clearTimeout(timeout);
      if (!popup.closed) popup.close();
    }
    window.addEventListener('message', onMessage);
  });
}

/** Best-effort account email via userinfo (own fetch — never touches googleAuth's Drive email cache). */
async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

const fail = (code: CalendarAuthErrorCode, message: string): CalendarConnectFailure => ({
  status: 'failed',
  code,
  message,
});

/**
 * Turn a redeemed token response into a result for one grant kind. Shared by the
 * popup and the redirect completion so both decide `missing_scope` the same way:
 * against the KIND's required scope (a sync consent lacking `events.owned`, or a
 * view consent lacking `events.readonly`), checked before the refresh token, as
 * before. Never throws (`fetchEmail` is best-effort).
 */
async function finishConsent(
  tokens: TokenResponse,
  kind: CalendarGrantKind
): Promise<CalendarConnectSuccess | CalendarConnectFailure> {
  const grant = CALENDAR_GRANTS[kind];
  const grantedScopes = tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [];
  if (!grantedScopes.includes(grant.required)) {
    return fail('missing_scope', grant.missingScopeMessage);
  }
  if (!tokens.refresh_token) {
    return fail(
      'no_refresh_token',
      'Google didn’t grant offline access. Please try connecting again.'
    );
  }
  const email = await fetchEmail(tokens.access_token);
  return { status: 'connected', email, refreshToken: tokens.refresh_token, grantedScopes };
}

/**
 * Run the calendar consent flow for one Google account. Returns the refresh token
 * + granted scopes for the caller to persist into a CalendarConnection (Layer 5),
 * or a structured failure. Never throws — every failure is classified.
 *
 * `kind` picks the grant (default `'sync'`, today's scopes); see `CalendarGrantKind`.
 */
export async function connectGoogleCalendar(
  opts: { loginHint?: string; kind?: CalendarGrantKind } = {}
): Promise<CalendarConnectResult> {
  const kind = opts.kind ?? 'sync';
  // POPUP transport only. Redirect surfaces (PWA/iOS/native) go through
  // `startCalendarRedirectAuth` + `completeCalendarRedirectAuth` instead — the
  // store gates on `shouldUseRedirectAuth()` and never calls this there (P2).
  const clientId = getClientId();
  if (!clientId) {
    return fail('not_configured', 'Google Client ID not configured (VITE_GOOGLE_CLIENT_ID).');
  }

  // Open the popup synchronously, before any await, so the browser keeps the gesture. The shared
  // opener logs a block (with the activation state) and records nothing; the failure shape is ours.
  const popup = openOAuthPopup('beanies-calendar-oauth');
  if (!popup) {
    return fail('popup_blocked', 'The sign-in window was blocked. Allow pop-ups and try again.');
  }

  try {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const url = buildCalendarAuthUrl(clientId, codeChallenge, opts.loginHint, kind);

    const code = await waitForCode(popup, url);

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier,
      redirectUri: getRedirectUri(),
      clientId,
    });

    return await finishConsent(tokens, kind);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('cancelled:')) {
      return fail('cancelled', 'Calendar connection was cancelled.');
    }
    // Breadcrumb the raw provider error; show the user friendly, actionable copy.
    reportError({
      surface: 'calendar-popup-connect',
      severity: 'warning',
      message: `Calendar popup code exchange failed: ${msg}`,
      error: e instanceof Error ? e : new Error(msg),
    });
    return fail('exchange_failed', connectRetryMsg());
  }
}

/**
 * Mint a short-lived access token from a connection's refresh token. Thin wrapper
 * over the OAuth proxy so the calendar layer owns its auth surface. Returns the raw
 * `TokenResponse` so the caller (Layer 4 TokenProvider) can read a rotated
 * `refresh_token` (when present) and write it back to the connection — never silent.
 */
export function refreshCalendarToken(refreshToken: string): Promise<TokenResponse> {
  return refreshAccessToken({ refreshToken, clientId: getClientId() });
}

// ─── Redirect transport (P2 — PWA / iOS / native connect + reconnect) ─────────
//
// The SHARED start side lives in googleAuth (`startRedirectAuth` with a `grant`
// arg + calendar scopes). This SIBLING completion reads the grant-namespaced
// calendar code key and returns a CalendarConnectResult — pure auth, no CRDT
// knowledge (the store commits, mirroring the popup path). See the file header.

/**
 * Begin a calendar redirect-auth flow on a redirect surface. Web navigates away
 * (this never resolves); native opens the system browser and resolves (the
 * deep-link handler routes completion back). `mode` is a calendar-appropriate
 * routing tag ('create' for a fresh connect, 'reconnect' for an existing one) —
 * behaviourally inert (the `grant='calendar'` discriminator does the real
 * routing), it just keeps the required redirect-state field honest.
 *
 * The real intent (connect vs which connection to reconnect) rides in
 * `returnPath` (a `calResume` query the store builds), so no secret and no
 * connection id ever touches the OAuth `state`.
 *
 * `kind` picks the scopes (default `'sync'`). Both kinds share the `'calendar'`
 * redirect grant (one code slot): the kind decides what is ASKED for here and what
 * is REQUIRED at completion, nothing about the transport.
 */
export function startCalendarRedirectAuth(
  returnPath: string,
  loginHint: string | undefined,
  mode: RedirectMode,
  kind: CalendarGrantKind = 'sync'
): Promise<void> {
  return startRedirectAuth(returnPath, loginHint, mode, {
    grant: 'calendar',
    scope: CALENDAR_GRANTS[kind].scopes.join(' '),
  });
}

/** What redeeming the pending redirect code produced, before any per-kind check. */
type RedirectExchange = { tokens: TokenResponse } | CalendarConnectFailure;

// Per-page-load memo of the one-time code EXCHANGE. REJECT/RESOLVE-STICKY BY
// DESIGN: the code is removed on entry, so a failed exchange is unrecoverable
// without a fresh redirect (= a new page load, which resets this module state).
// Mirrors googleAuth's `redirectSettlePromise`.
//
// The exchange is memoized separately from the per-kind result so the code is
// redeemed exactly once whatever kind each caller passes, and each kind's
// `missing_scope` check runs against that kind's required scope rather than
// whichever caller happened to arrive first.
let calendarExchangePromise: Promise<RedirectExchange | null> | null = null;
const calendarSettlePromises = new Map<CalendarGrantKind, Promise<CalendarConnectResult | null>>();

/**
 * Complete a pending calendar redirect: redeem the grant-namespaced code and
 * return a CalendarConnectResult for the store to commit (create/update a
 * CalendarConnection). Returns `null` when there is NO pending calendar code
 * (the common no-op — e.g. a Drive redirect, or the user declined and no code
 * was stashed). Never throws — every failure is a classified `CalendarConnectFailure`.
 *
 * Memoized per page load so a boot check + a reactive resume redeem the one-time
 * code exactly once. Two exchange arms mirror the Drive completion:
 *  - NATIVE: the shared redirect stash carries `{grant:'calendar', codeVerifier}`
 *    → exchange WITH the PKCE verifier.
 *  - WEB (iOS/PWA): no stash → exchange WITHOUT a verifier (the confidential
 *    proxy secures the code via client_secret; ADR-026).
 *
 * `kind` (default `'sync'`) is the grant the redirect was started for; the granted
 * scopes are checked against that kind's required scope.
 */
export function completeCalendarRedirectAuth(
  kind: CalendarGrantKind = 'sync'
): Promise<CalendarConnectResult | null> {
  let settled = calendarSettlePromises.get(kind);
  if (!settled) {
    if (!calendarExchangePromise) calendarExchangePromise = redeemCalendarRedirectCode();
    settled = calendarExchangePromise.then((exchange) => {
      if (!exchange) return null;
      if ('status' in exchange) return exchange; // classified failure, kind-independent
      return finishConsent(exchange.tokens, kind);
    });
    calendarSettlePromises.set(kind, settled);
  }
  return settled;
}

async function redeemCalendarRedirectCode(): Promise<RedirectExchange | null> {
  let code: string | null = null;
  try {
    code = sessionStorage.getItem(CALENDAR_REDIRECT_CODE_KEY);
  } catch (e) {
    console.warn('[calendarAuth] could not read pending calendar redirect code', e);
    return null;
  }
  if (!code) return null; // no pending calendar redirect — the common no-op

  // Consume immediately so a re-entrant call (boot + reactive resume) can't
  // redeem the same one-time code twice.
  try {
    sessionStorage.removeItem(CALENDAR_REDIRECT_CODE_KEY);
  } catch {
    // best-effort; the memo already guards double-redemption within a page load
  }

  // Native PKCE verifier rides in the shared stash tagged grant='calendar'. Web
  // has no stash (no verifier). Only consume the stash when it is OURS (calendar)
  // — never disturb a Drive stash.
  let codeVerifier: string | undefined;
  try {
    const stashJson = sessionStorage.getItem(REDIRECT_AUTH_KEY);
    if (stashJson) {
      const stash = JSON.parse(stashJson) as { grant?: string; codeVerifier?: string };
      if (stash?.grant === 'calendar' && typeof stash.codeVerifier === 'string') {
        codeVerifier = stash.codeVerifier;
        sessionStorage.removeItem(REDIRECT_AUTH_KEY);
      }
    }
  } catch (e) {
    // A corrupt/foreign stash must not strand the user — fall through to the
    // no-verifier exchange (the confidential proxy still secures the code).
    console.warn(
      '[calendarAuth] calendar redirect stash unreadable; exchanging without verifier',
      e
    );
  }

  const clientId = getClientId();
  if (!clientId) {
    return fail('not_configured', 'Google Client ID not configured (VITE_GOOGLE_CLIENT_ID).');
  }

  // On native the authorize request always includes a PKCE challenge, so the
  // exchange MUST send the matching verifier. If the stash was lost, exchanging
  // without it is doomed (Google 400s) — fail clearly and ask for a fresh
  // consent rather than firing a request we know will fail with a raw error.
  // (Web/iOS/PWA legitimately exchange without a verifier via the confidential
  // proxy, so this guard is native-only.)
  if (isNative() && !codeVerifier) {
    reportError({
      surface: 'calendar-redirect-complete',
      severity: 'warning',
      message: 'Calendar native exchange aborted: PKCE verifier missing from redirect stash',
    });
    return fail('exchange_failed', connectRetryMsg());
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier,
      redirectUri: getRedirectUri(),
      clientId,
    });
    return { tokens };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A redirect that returned a code but failed to exchange is a real recovery
    // failure — surface it (the store shows the error), and breadcrumb it.
    reportError({
      surface: 'calendar-redirect-complete',
      severity: 'warning',
      message: `Calendar redirect code exchange failed: ${msg}`,
      error: e instanceof Error ? e : new Error(msg),
    });
    // Friendly, actionable user copy — the raw provider error (e.g. "Token
    // exchange failed: Bad Request") is captured in the breadcrumb above, not
    // shown to the user.
    return fail('exchange_failed', connectRetryMsg());
  }
}

/** Test-only — reset the calendar redirect-settle memo. Production never calls this. */
export function __resetCalendarRedirectSettleForTesting(): void {
  calendarExchangePromise = null;
  calendarSettlePromises.clear();
}
