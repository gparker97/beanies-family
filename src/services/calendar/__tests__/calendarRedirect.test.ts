import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// P2 — the calendar SIBLING completion (`completeCalendarRedirectAuth`) + the
// thin start wrapper (`startCalendarRedirectAuth`). googleAuth is mocked so this
// stays a fast unit (real key-constant VALUES, a spy for startRedirectAuth) — the
// live start-side + native routing are covered in googleAuth.calendarGrant*.test.

const CALENDAR_CODE_KEY = 'beanies_redirect_auth_code:calendar';
const STATE_KEY = 'beanies_redirect_auth';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

// The single native-aware redirect_uri both the authorize AND the exchange must
// use. calendarAuth imports getRedirectUri from googleAuth (the fix); a
// regression that reintroduces a local `/oauth/callback` copy would make the
// exchange NOT use this sentinel and the assertions below would fail.
const REDIRECT_URI = 'https://beanies.family/oauth/native';

const { startRedirectAuth, isNativeMock } = vi.hoisted(() => ({
  startRedirectAuth: vi.fn(async () => {}),
  isNativeMock: vi.fn(() => false),
}));

vi.mock('@/services/google/googleAuth', () => ({
  startRedirectAuth,
  getRedirectUri: () => REDIRECT_URI,
  REDIRECT_AUTH_CODE_KEY_CALENDAR: 'beanies_redirect_auth_code:calendar',
  REDIRECT_AUTH_KEY: 'beanies_redirect_auth',
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: isNativeMock }));
vi.mock('@/services/google/pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'v'),
  generateCodeChallenge: vi.fn(async () => 'c'),
}));
vi.mock('@/services/google/oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(),
  refreshAccessToken: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

let cal: typeof import('../calendarAuth');

function goodTokens(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'at',
    refresh_token: 'rt',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: `${CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    ...overrides,
  };
}

describe('calendarAuth — redirect transport (P2)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    isNativeMock.mockReturnValue(false); // re-assert web default (resetAllMocks cleared it)
    sessionStorage.clear();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    // fetchEmail's userinfo call.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ email: 'me@example.com' }) }))
    );
    cal = await import('../calendarAuth');
  });
  afterEach(() => {
    cal.__resetCalendarRedirectSettleForTesting();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('startCalendarRedirectAuth', () => {
    it('delegates to startRedirectAuth with grant=calendar + the joined calendar scopes', async () => {
      await cal.startCalendarRedirectAuth('/settings?calResume=connect', 'a@b.com', 'create');
      expect(startRedirectAuth).toHaveBeenCalledWith(
        '/settings?calResume=connect',
        'a@b.com',
        'create',
        expect.objectContaining({
          grant: 'calendar',
          scope: expect.stringContaining(CALENDAR_SCOPE),
        })
      );
    });
  });

  describe('completeCalendarRedirectAuth', () => {
    it('returns null when there is no pending calendar code (the common no-op)', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      const result = await cal.completeCalendarRedirectAuth();
      expect(result).toBeNull();
      expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it('web arm: exchanges WITHOUT a verifier and returns connected + email + scopes', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValue(goodTokens());
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'web-code');

      const result = await cal.completeCalendarRedirectAuth();

      expect(result).toEqual({
        status: 'connected',
        email: 'me@example.com',
        refreshToken: 'rt',
        grantedScopes: expect.arrayContaining([CALENDAR_SCOPE]),
      });
      // No verifier on the web arm (confidential proxy secures the code), and
      // the exchange uses the SHARED native-aware redirect_uri (regression: a
      // local `/oauth/callback` copy is what 400'd every native exchange).
      expect(exchangeCodeForTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'web-code',
          codeVerifier: undefined,
          redirectUri: REDIRECT_URI,
        })
      );
      // One-time code consumed.
      expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBeNull();
    });

    it('native arm: reads the PKCE verifier from a grant=calendar stash and consumes it', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValue(goodTokens());
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'nat-code');
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({ codeVerifier: 'nat-verifier', returnPath: '/settings', grant: 'calendar' })
      );

      isNativeMock.mockReturnValue(true);
      await cal.completeCalendarRedirectAuth();

      // Native sends the verifier AND the shared native redirect_uri — the two
      // sides (authorize + exchange) now agree (was the redirect_uri_mismatch bug).
      expect(exchangeCodeForTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'nat-code',
          codeVerifier: 'nat-verifier',
          redirectUri: REDIRECT_URI,
        })
      );
      // The calendar-owned stash is consumed.
      expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
    });

    it('native arm: aborts with a friendly error (no doomed exchange) when the PKCE verifier is missing', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      isNativeMock.mockReturnValue(true);
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'nat-code-no-verifier');
      // No stash → no verifier. On native this would 400 (challenge sent, no
      // verifier), so we must NOT fire the exchange; fail clearly instead.

      const result = await cal.completeCalendarRedirectAuth();

      expect(exchangeCodeForTokens).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'failed', code: 'exchange_failed' });
      // The one-time code is still consumed (can't be reused).
      expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBeNull();
    });

    it('does NOT consume a Drive stash (grant!=calendar) — leaves it for the Drive completion', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValue(goodTokens());
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'code');
      // A Drive native stash (no grant field).
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({ codeVerifier: 'drive-v', returnPath: '/welcome' })
      );

      await cal.completeCalendarRedirectAuth();

      // Drive stash untouched; exchange ran without the Drive verifier.
      expect(sessionStorage.getItem(STATE_KEY)).not.toBeNull();
      expect(exchangeCodeForTokens).toHaveBeenCalledWith(
        expect.objectContaining({ codeVerifier: undefined })
      );
    });

    it('classifies a missing calendar scope as failed(missing_scope)', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValue(
        goodTokens({ scope: 'https://www.googleapis.com/auth/userinfo.email' })
      );
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'code');
      const result = await cal.completeCalendarRedirectAuth();
      expect(result).toMatchObject({ status: 'failed', code: 'missing_scope' });
    });

    it('classifies a missing refresh token as failed(no_refresh_token)', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValue(
        goodTokens({ refresh_token: undefined })
      );
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'code');
      const result = await cal.completeCalendarRedirectAuth();
      expect(result).toMatchObject({ status: 'failed', code: 'no_refresh_token' });
    });

    it('classifies an exchange throw as failed(exchange_failed) + reports it', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
      const { reportError } = await import('@/utils/errorReporter');
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'code');

      const result = await cal.completeCalendarRedirectAuth();

      expect(result).toMatchObject({ status: 'failed', code: 'exchange_failed' });
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'calendar-redirect-complete' })
      );
    });

    it('is memoized per page load — two calls redeem the one-time code exactly once', async () => {
      const { exchangeCodeForTokens } = await import('@/services/google/oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValue(goodTokens());
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'code');

      const [a, b] = await Promise.all([
        cal.completeCalendarRedirectAuth(),
        cal.completeCalendarRedirectAuth(),
      ]);

      expect(a).toBe(b); // same memoized promise result
      expect(exchangeCodeForTokens).toHaveBeenCalledOnce();
    });
  });
});
