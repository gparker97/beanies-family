// Multi-account Google Calendar OAuth (#32 Layer 1).
//
// COMPOSES the low-level primitives (`pkce`, `oauthProxy`, `shouldUseRedirectAuth`)
// — it deliberately does NOT reuse `googleAuth`'s Drive flow: that module is a
// single-account singleton whose scope, redirect slot, and in-memory token sink
// are all Drive-bound. Connecting a calendar must NEVER disturb the Drive session,
// so this layer owns its own auth URL, its own PKCE state, and routes the resulting
// refresh token to the CalendarConnection record (Layer 2), never to googleAuth.
//
// V1 TRANSPORT SCOPE (deliberate — see #32 plan, Layer 1):
//   - Desktop (popup-capable) browsers: full consent flow here.
//   - Redirect surfaces (iOS / installed PWA / native, i.e. shouldUseRedirectAuth()):
//     connect is DEFERRED. OAuth redirect uses ONE Drive-bound sessionStorage slot
//     + the shared OAuthCallbackPage; multiplexing a calendar redirect through them
//     risks the live Drive auth, so v1 returns `redirect_unsupported`. This is not a
//     dead-end: connections are FAMILY-WIDE and the token lives in the shared
//     .beanpod, so a one-time connect on any desktop browser makes the calendar sync
//     on ALL the family's devices (the reconcile engine runs everywhere off the
//     shared token). Redirect-surface connect is a tracked follow-up.

import { generateCodeVerifier, generateCodeChallenge } from '@/services/google/pkce';
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  type TokenResponse,
} from '@/services/google/oauthProxy';
import { shouldUseRedirectAuth } from '@/services/google/googleAuth';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** Calendar consent scopes. `userinfo.email` (non-sensitive) lets us label the connection. */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

/** The one scope without which the feature cannot function — validated post-consent. */
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

const POPUP_AUTH_TIMEOUT_MS = 120_000;

export type CalendarAuthErrorCode =
  | 'not_configured' // VITE_GOOGLE_CLIENT_ID missing
  | 'popup_blocked' // browser blocked the consent window
  | 'cancelled' // user closed the window / declined
  | 'missing_scope' // granular consent dropped calendar.events.owned
  | 'no_refresh_token' // no offline access granted (should not happen with prompt=consent)
  | 'exchange_failed' // token exchange / network error
  | 'redirect_unsupported'; // this surface can't connect in v1 (see header)

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
export type CalendarConnectResult = CalendarConnectSuccess | CalendarConnectFailure;

/** Whether the current surface can run the connect flow (false on redirect surfaces). */
export function isCalendarConnectSupported(): boolean {
  return !shouldUseRedirectAuth();
}

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

function getRedirectUri(): string {
  return `${window.location.origin}/oauth/callback`;
}

/** Open a centered blank popup synchronously (must precede any await to keep the user-gesture). */
function openBlankPopup(): Window | null {
  const width = 500;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  return window.open(
    'about:blank',
    'beanies-calendar-oauth',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );
}

function buildCalendarAuthUrl(clientId: string, codeChallenge: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: CALENDAR_SCOPES.join(' '),
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
 * Run the calendar consent flow for one Google account. Returns the refresh token
 * + granted scopes for the caller to persist into a CalendarConnection (Layer 5),
 * or a structured failure. Never throws — every failure is classified.
 */
export async function connectGoogleCalendar(
  opts: { loginHint?: string } = {}
): Promise<CalendarConnectResult> {
  if (shouldUseRedirectAuth()) {
    return fail(
      'redirect_unsupported',
      'Connecting a calendar is available in a desktop browser. Once connected it syncs on all your devices.'
    );
  }

  const clientId = getClientId();
  if (!clientId) {
    return fail('not_configured', 'Google Client ID not configured (VITE_GOOGLE_CLIENT_ID).');
  }

  // Open the popup synchronously, before any await, so the browser keeps the gesture.
  const popup = openBlankPopup();
  if (!popup) {
    return fail('popup_blocked', 'The sign-in window was blocked. Allow pop-ups and try again.');
  }

  try {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const url = buildCalendarAuthUrl(clientId, codeChallenge, opts.loginHint);

    const code = await waitForCode(popup, url);

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier,
      redirectUri: getRedirectUri(),
      clientId,
    });

    const grantedScopes = tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [];
    if (!grantedScopes.includes(REQUIRED_SCOPE)) {
      return fail(
        'missing_scope',
        'Calendar access wasn’t granted. Please allow beanies to manage its own events when prompted.'
      );
    }
    if (!tokens.refresh_token) {
      return fail(
        'no_refresh_token',
        'Google didn’t grant offline access. Please try connecting again.'
      );
    }

    const email = await fetchEmail(tokens.access_token);
    return { status: 'connected', email, refreshToken: tokens.refresh_token, grantedScopes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('cancelled:')) {
      return fail('cancelled', 'Calendar connection was cancelled.');
    }
    return fail('exchange_failed', `Could not complete the calendar connection: ${msg}`);
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
