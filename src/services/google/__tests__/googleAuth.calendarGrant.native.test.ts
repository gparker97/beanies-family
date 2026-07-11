import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// P2 — calendar grant on the NATIVE (Capacitor) deep-link arm. Proves the native
// deep-link handler routes completion by the stash's grant: a calendar redirect
// stashes its code under the calendar key and navigates (the returnPath resume
// runs the exchange + CRDT commit), and NEVER runs the Drive token exchange. A
// Drive redirect is unchanged (still exchanges inline).

vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-verifier'),
  generateCodeChallenge: vi.fn(async () => 'mock-challenge'),
}));
vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({
    access_token: 'tok',
    refresh_token: 'rt',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'drive.file userinfo.email',
  })),
  refreshAccessToken: vi.fn(),
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  storeGoogleRefreshToken: vi.fn(async () => {}),
  getGoogleRefreshToken: vi.fn(async () => null),
  clearGoogleRefreshToken: vi.fn(async () => {}),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => null) }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));

const { browserOpen, browserClose, addListener } = vi.hoisted(() => ({
  browserOpen: vi.fn(),
  browserClose: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen, close: browserClose } }));
vi.mock('@capacitor/app', () => ({ App: { addListener } }));

const NATIVE_REDIRECT = 'https://beanies.family/oauth/native';
const STATE_KEY = 'beanies_redirect_auth';
const DRIVE_CODE_KEY = 'beanies_redirect_auth_code';
const CALENDAR_CODE_KEY = 'beanies_redirect_auth_code:calendar';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

let googleAuth: typeof import('../googleAuth');

describe('googleAuth — calendar grant (native deep-link routing)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    browserOpen.mockResolvedValue(undefined);
    browserClose.mockResolvedValue(undefined);
    addListener.mockResolvedValue({ remove: vi.fn(async () => {}) });
    sessionStorage.clear();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    googleAuth = await import('../googleAuth');
  });
  afterEach(() => {
    googleAuth.__resetNativeAuthForTesting();
    vi.unstubAllEnvs();
  });

  it('startRedirectAuth({grant:calendar}) stashes grant + returnPath and opens with calendar scope', async () => {
    await googleAuth.startRedirectAuth('/settings?calResume=connect', 'a@b.com', 'create', {
      grant: 'calendar',
      scope: CALENDAR_SCOPE,
    });
    expect(browserOpen).toHaveBeenCalledOnce();
    const url = new URL((browserOpen.mock.calls[0][0] as { url: string }).url);
    expect(url.searchParams.get('scope')).toContain(CALENDAR_SCOPE);

    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
    expect(stored.grant).toBe('calendar');
    expect(stored.returnPath).toBe('/settings?calResume=connect');
    expect(stored.codeVerifier).toBeTruthy(); // native keeps PKCE
  });

  it('a Drive stash omits the grant field (byte-compatible with pre-P2)', async () => {
    await googleAuth.startRedirectAuth('/welcome?resume=setup', 'a@b.com', 'create');
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);
    expect(stored.grant).toBeUndefined();
  });

  it('deep-link for a CALENDAR grant: stashes the code under the calendar key, does NOT exchange, navigates, and leaves the verifier stash', async () => {
    // Start a calendar redirect so the stash carries grant + a csrf state.
    await googleAuth.startRedirectAuth('/settings?calResume=connect', 'a@b.com', 'create', {
      grant: 'calendar',
      scope: CALENDAR_SCOPE,
    });
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);

    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=CAL_CODE&state=${stored.state}`,
      onComplete
    );

    // Routed to calendar: code parked under the calendar key, Drive key empty.
    expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBe('CAL_CODE');
    expect(sessionStorage.getItem(DRIVE_CODE_KEY)).toBeNull();
    // No Drive token exchange happened in the handler (the resume does it).
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    // Navigated to the returnPath so the resume can complete.
    expect(onComplete).toHaveBeenCalledWith('/settings?calResume=connect');
    // The verifier stash is left in place for completeCalendarRedirectAuth.
    expect(sessionStorage.getItem(STATE_KEY)).not.toBeNull();
  });

  it('deep-link for a DRIVE grant still exchanges inline (unchanged)', async () => {
    await googleAuth.startRedirectAuth('/welcome?resume=setup', 'a@b.com', 'create');
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY)!);

    const { exchangeCodeForTokens } = await import('../oauthProxy');
    const onComplete = vi.fn();
    await googleAuth.handleNativeAuthRedirect(
      `${NATIVE_REDIRECT}?code=DRIVE_CODE&state=${stored.state}`,
      onComplete
    );

    expect(exchangeCodeForTokens).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBeNull();
    expect(onComplete).toHaveBeenCalledWith('/welcome?resume=setup');
  });
});
