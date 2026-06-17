import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
// Pure helper — safe to import statically (no module state, unaffected by the
// resetModules dance the suite below uses).
import { isUserCancellation } from '../googleAuth';

// Mock dependencies before importing the module
vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-code-verifier-abc123'),
  generateCodeChallenge: vi.fn(async () => 'mock-code-challenge-xyz789'),
}));

vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'drive.file userinfo.email',
  })),
  refreshAccessToken: vi.fn(async () => ({
    access_token: 'mock-refreshed-token',
    expires_in: 3600,
    token_type: 'Bearer',
  })),
}));

vi.mock('@/services/sync/fileHandleStore', () => ({
  storeGoogleRefreshToken: vi.fn(async () => {}),
  getGoogleRefreshToken: vi.fn(async () => null),
  clearGoogleRefreshToken: vi.fn(async () => {}),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => null),
}));

// Telemetry + error reporter — googleAuth fires these from the auth-init rescue
// and the no-refresh-token guard; mock so we can assert without the real queue.
vi.mock('@/services/telemetry', () => ({
  logEvent: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

// Reset module state between tests
let googleAuth: typeof import('../googleAuth');

describe('googleAuth (PKCE)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    // Clear the persisted silent-refresh failure counter — sessionStorage
    // survives `vi.resetModules()` (it's host state, not module state),
    // and a leftover counter from an earlier test would hit the new
    // (lower) escalation threshold unexpectedly.
    try {
      sessionStorage.removeItem('beanies_silent_refresh_failures');
    } catch {
      // Some test runners don't expose sessionStorage; harmless.
    }
    // Gate the wake listener's install-time fire by default. The wake
    // listener (installed during `initializeAuth`) proactively refreshes
    // when the tab is visible AND a refresh token is present — that's
    // the right *production* behavior, but in tests it consumes mock
    // implementations before the test's explicit `attemptSilentRefresh`
    // call. Tests that specifically exercise the wake path set hidden
    // back to false and dispatch `visibilitychange`.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    // Re-prime the default mock factories now that resetAllMocks above
    // wiped them. Tests that need different behavior layer Once-variants
    // on top.
    const { exchangeCodeForTokens, refreshAccessToken } = await import('../oauthProxy');
    (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'drive.file userinfo.email',
    }));
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      access_token: 'mock-refreshed-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }));
    // Fresh import to reset module-level state
    googleAuth = await import('../googleAuth');
  });

  afterEach(() => {
    // Remove the wake listener BEFORE the next test's `vi.resetModules()`
    // discards the module — otherwise stale listeners from prior modules
    // accumulate on `document` and trigger spurious refresh calls.
    googleAuth?.__resetWakeListenerForTesting?.();
    // Restore real timers in case a test set fake timers and exited before
    // restoring them (assertion failure mid-test). Without this, subsequent
    // tests that use real setTimeout hang forever.
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('isGoogleAuthConfigured', () => {
    it('returns true when VITE_GOOGLE_CLIENT_ID is set', () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
      expect(googleAuth.isGoogleAuthConfigured()).toBe(true);
      vi.unstubAllEnvs();
    });

    it('returns false when VITE_GOOGLE_CLIENT_ID is empty', () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
      expect(googleAuth.isGoogleAuthConfigured()).toBe(false);
      vi.unstubAllEnvs();
    });
  });

  describe('shouldUseRedirectAuth', () => {
    // Helpers to stub navigator + window for each platform/standalone permutation.
    // The function reads navigator.standalone (legacy iOS), matchMedia('display-mode: standalone'),
    // and (in the JSDoc-removed UA branch) navigator.userAgent. We stub all of them so a stray
    // jsdom default doesn't sneak in.
    function stubEnv(opts: {
      ua?: string;
      platform?: string;
      maxTouchPoints?: number;
      standaloneMq?: boolean;
      iosStandalone?: boolean;
    }) {
      const {
        ua = '',
        platform = '',
        maxTouchPoints = 0,
        standaloneMq = false,
        iosStandalone = false,
      } = opts;
      Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
      Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
      Object.defineProperty(window.navigator, 'maxTouchPoints', {
        value: maxTouchPoints,
        configurable: true,
      });
      Object.defineProperty(window.navigator, 'standalone', {
        value: iosStandalone,
        configurable: true,
      });
      const matchMediaMock = vi.fn().mockImplementation((q: string) => ({
        matches: q === '(display-mode: standalone)' ? standaloneMq : false,
        media: q,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));
      Object.defineProperty(window, 'matchMedia', {
        value: matchMediaMock,
        configurable: true,
      });
    }

    it('returns true for iOS regular Safari (popup/new-tab OAuth is fragile there)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    });

    it('returns true for Chrome on iOS (CriOS UA — still WebKit under the hood)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    });

    it('returns true for iOS standalone PWA (legacy navigator.standalone flag)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        maxTouchPoints: 5,
        iosStandalone: true,
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    });

    it('returns true for Android Chrome standalone PWA (display-mode media query)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
        standaloneMq: true,
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    });

    it('returns false for desktop Chrome on a real Mac (no touch, no standalone signal)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(false);
    });

    it('returns true for iPadOS 13+ Safari (reports as Mac, but has a touchscreen)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5, // iPadOS 13+ reports as Mac with touch points
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(true);
    });
  });

  describe('isTokenValid', () => {
    it('returns false when no token is set', () => {
      expect(googleAuth.isTokenValid()).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('returns null when no valid token', () => {
      expect(googleAuth.getAccessToken()).toBeNull();
    });
  });

  describe('loadGIS', () => {
    it('is a no-op (backward compatibility)', async () => {
      await expect(googleAuth.loadGIS()).resolves.toBeUndefined();
    });
  });

  describe('refresh-token persistence fix (2026-05-20)', () => {
    it('startRedirectAuth always builds a prompt=consent + access_type=offline URL', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
      let capturedHref = '';
      const hrefSpy = vi.spyOn(window.location, 'href', 'set').mockImplementation((v: string) => {
        capturedHref = v;
      });
      await googleAuth.startRedirectAuth('/welcome?resume=setup', 'a@b.com');
      expect(capturedHref).toContain('prompt=consent');
      expect(capturedHref).toContain('access_type=offline');
      expect(capturedHref).not.toContain('prompt=select_account');
      hrefSpy.mockRestore();
      vi.unstubAllEnvs();
    });

    it('initializeAuth rescues a __pending__ token into the family key when the family key is empty', async () => {
      const fhs = await import('@/services/sync/fileHandleStore');
      (fhs.getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockImplementation(
        async (key: string) =>
          key === '__pending__' ? { token: 'pending-tok', issuedAt: 123 } : null
      );
      await googleAuth.initializeAuth('fam-1');
      expect(fhs.storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'pending-tok', {
        issuedAt: 123,
      });
      expect(fhs.clearGoogleRefreshToken).toHaveBeenCalledWith('__pending__');
      const { logEvent } = await import('@/services/telemetry');
      expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', surface: 'auth-init' })
      );
    });

    it('initializeAuth does NOT rescue/clobber when the family key already holds a token', async () => {
      const fhs = await import('@/services/sync/fileHandleStore');
      (fhs.getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockImplementation(
        async (key: string) =>
          key === '__pending__'
            ? { token: 'pending-tok', issuedAt: 1 }
            : { token: 'family-tok', issuedAt: 2 }
      );
      await googleAuth.initializeAuth('fam-1');
      expect(fhs.storeGoogleRefreshToken).not.toHaveBeenCalled();
      expect(fhs.clearGoogleRefreshToken).not.toHaveBeenCalled();
    });

    it('migratePendingRefreshToken refuses to clobber a good family token (returns false)', async () => {
      const fhs = await import('@/services/sync/fileHandleStore');
      (fhs.getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockImplementation(
        async (key: string) =>
          key === '__pending__'
            ? { token: 'pending-tok', issuedAt: 1 }
            : { token: 'family-tok', issuedAt: 2 }
      );
      const migrated = await googleAuth.migratePendingRefreshToken('fam-1');
      expect(migrated).toBe(false);
      expect(fhs.storeGoogleRefreshToken).not.toHaveBeenCalled();
    });

    it('reports auth-no-refresh-token when redirect auth returns no refresh token', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
      const { exchangeCodeForTokens } = await import('../oauthProxy');
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
        access_token: 'at-only',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'drive.file userinfo.email',
        // no refresh_token
      }));
      sessionStorage.setItem('beanies_redirect_auth_code', 'code-123');
      sessionStorage.setItem(
        'beanies_redirect_auth',
        JSON.stringify({ codeVerifier: 'v', returnPath: '/welcome' })
      );
      await googleAuth.completeRedirectAuth();
      const { reportError } = await import('@/utils/errorReporter');
      expect(vi.mocked(reportError)).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'auth-no-refresh-token', severity: 'warning' })
      );
      vi.unstubAllEnvs();
    });
  });

  describe('initializeAuth', () => {
    it('loads stored refresh token from IndexedDB', async () => {
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });

      await googleAuth.initializeAuth('family-123');

      expect(getGoogleRefreshToken).toHaveBeenCalledWith('family-123');
    });

    it('handles no stored token gracefully', async () => {
      await expect(googleAuth.initializeAuth('family-123')).resolves.toBeUndefined();
    });
  });

  describe('attemptSilentRefresh', () => {
    it('returns null when no client ID is configured', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      vi.unstubAllEnvs();
    });

    it('returns null when no refresh token is available', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      // No initializeAuth called, so no refresh token
      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      vi.unstubAllEnvs();
    });

    it('returns new access token on successful refresh', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      // Mock fetch for userinfo email call
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      // Load a refresh token
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBe('mock-refreshed-token');

      vi.unstubAllEnvs();
    });

    it('deduplicates concurrent calls', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');

      // Fire two concurrent calls
      const p1 = googleAuth.attemptSilentRefresh();
      const p2 = googleAuth.attemptSilentRefresh();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('mock-refreshed-token');
      expect(r2).toBe('mock-refreshed-token');

      // refreshAccessToken should only have been called once
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);

      vi.unstubAllEnvs();
    });

    it('allows a new call after the first completes', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');

      // First call
      await googleAuth.attemptSilentRefresh();
      // Second call after completion
      await googleAuth.attemptSilentRefresh();

      expect(refreshAccessToken).toHaveBeenCalledTimes(2);

      vi.unstubAllEnvs();
    });

    it('recovers refresh token from IndexedDB when in-memory token is lost', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      // Simulate: initializeAuth was NOT called (page reload race condition),
      // but getActiveFamilyId returns a valid family ID and IndexedDB has the token.
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      (getActiveFamilyId as ReturnType<typeof vi.fn>).mockReturnValue('family-abc');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'recovered-refresh-token'
      );

      // Call attemptSilentRefresh WITHOUT calling initializeAuth first
      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBe('mock-refreshed-token');

      // Verify it loaded the token from IndexedDB using the active family ID
      expect(getGoogleRefreshToken).toHaveBeenCalledWith('family-abc');

      vi.unstubAllEnvs();
    });

    it('returns null when no family ID and no refresh token available', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      (getActiveFamilyId as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();

      vi.unstubAllEnvs();
    });

    it('returns null and clears token on invalid_grant error', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { refreshAccessToken } = await import('../oauthProxy');
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('invalid_grant')
      );

      const { getGoogleRefreshToken, clearGoogleRefreshToken } =
        await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'expired-refresh-token'
      );
      await googleAuth.initializeAuth('family-123');

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('family-123');

      vi.unstubAllEnvs();
    });
  });

  describe('hasRefreshToken', () => {
    it('returns false when no refresh token loaded', () => {
      expect(googleAuth.hasRefreshToken()).toBe(false);
    });

    it('returns true after initializeAuth loads a stored token', async () => {
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');
      expect(googleAuth.hasRefreshToken()).toBe(true);
    });

    it('returns false after revokeToken clears state', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');
      expect(googleAuth.hasRefreshToken()).toBe(true);

      await googleAuth.revokeToken();
      expect(googleAuth.hasRefreshToken()).toBe(false);

      vi.unstubAllEnvs();
    });
  });

  describe('getValidToken', () => {
    it('attempts silent refresh when no cached token', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      // Mock fetch for userinfo email call
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      // Set up refresh token
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const token = await googleAuth.getValidToken();
      expect(token).toBe('mock-refreshed-token');

      // Now the token should be cached
      expect(googleAuth.isTokenValid()).toBe(true);
      expect(googleAuth.getAccessToken()).toBe('mock-refreshed-token');

      vi.unstubAllEnvs();
    });

    it('retries once on transient failure and succeeds on the second attempt', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Queue two implementations: first throws transient, second resolves.
      // The default factory impl remains in place for tests that follow.
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      refreshFn.mockImplementationOnce(async () => ({
        access_token: 'mock-refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }));

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBe('mock-refreshed-token');
      expect(refreshFn).toHaveBeenCalledTimes(2);

      vi.unstubAllEnvs();
    }, 5_000);

    it('does NOT retry when refresh token is permanently invalid', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // invalid_grant means the refresh token has been revoked — retrying is
      // pointless and would just delay the inevitable banner. Use Once so
      // the default factory impl remains for subsequent tests.
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: invalid_grant');
      });

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      expect(refreshFn).toHaveBeenCalledTimes(1);

      vi.unstubAllEnvs();
    });

    it('returns null after retrying when transient failure persists (5 attempts with stepped backoff)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Five transient-error throws — covers all five attempts (initial + 4
      // retries at 1.5s/3s/6s/12s backoff, 22.5s total). 2026-05-20 widened
      // from 3 to survive Chrome Windows wake-from-sleep network race.
      for (let i = 0; i < 5; i++) {
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      }

      // Fake timers — 22.5s of real-time backoff would exceed any reasonable
      // test timeout. Pattern matches the escalation test below.
      vi.useFakeTimers();
      const promise = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      const result = await promise;
      vi.useRealTimers();

      expect(result).toBeNull();
      expect(refreshFn).toHaveBeenCalledTimes(5);

      vi.unstubAllEnvs();
    });

    it('retry-loop cumulative backoff is exactly 1.5 + 3 + 6 + 12 = 22.5s', async () => {
      // Regression guard for A1 (2026-05-20). If anyone changes RETRY_BACKOFF_MS
      // the cumulative wait should shift visibly. Asserts the loop sleeps
      // BETWEEN attempts, not after the last one — a 4th sleep after attempt 5
      // would be a bug.
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      for (let i = 0; i < 5; i++) {
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      }

      vi.useFakeTimers();
      const promise = googleAuth.attemptSilentRefresh();

      // After 22_499ms, the promise must NOT yet have resolved — the 12s
      // backoff before attempt 5 hasn't completed. Asserting via a microtask
      // pulse keeps the wait deterministic.
      await vi.advanceTimersByTimeAsync(22_499);
      // refreshFn should have been called <= 4 times so far (attempt 5 is
      // still mid-sleep at 22_499ms).
      expect(refreshFn.mock.calls.length).toBeLessThan(5);

      // One more ms ticks the final backoff over → attempt 5 fires and the
      // loop exits.
      await vi.advanceTimersByTimeAsync(1);
      const result = await promise;
      expect(result).toBeNull();
      expect(refreshFn).toHaveBeenCalledTimes(5);

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it('MAX_ATTEMPTS cap is at most 5 (cap-protection invariant)', async () => {
      // Pass 3 §17 / Pass 4 §A2 invariant: extending RETRY_BACKOFF_MS past 4
      // entries would silently lift the cap into multi-minute "stuck UI"
      // territory. Cap test catches a future maintainer expanding the array.
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Queue MANY transient throws — the cap is what stops the loop, not
      // running out of stubs. We assert refreshFn was called no more than
      // 5 times.
      for (let i = 0; i < 20; i++) {
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      }

      vi.useFakeTimers();
      const promise = googleAuth.attemptSilentRefresh();
      // Advance far past any reasonable cumulative backoff so the cap is
      // what stops us, not a remaining backoff.
      await vi.advanceTimersByTimeAsync(120_000);
      await promise;
      vi.useRealTimers();

      expect(refreshFn.mock.calls.length).toBeLessThanOrEqual(5);
      vi.unstubAllEnvs();
    });

    it('fires onTokenPermanentlyExpired immediately on invalid_grant — but NOT on a single retry-exhausted transient failure', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;

      // Fake timers — 22.5s of stepped backoff per attemptSilentRefresh call.
      vi.useFakeTimers();

      // ONE retry-exhausted transient failure → counter = 1 (below the
      // escalation threshold of 2). Permanent callback should NOT fire.
      // Five throws cover the initial + 4 retries at 1.5/3/6/12s.
      for (let i = 0; i < 5; i++) {
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      }
      const p1 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      await p1;
      expect(permanentSpy).not.toHaveBeenCalled();

      // invalid_grant → permanent callback SHOULD fire immediately, no
      // counter waiting. Re-prime in-memory refreshToken via initializeAuth
      // for a clean slate (the transient path above leaves it intact).
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: invalid_grant');
      });
      await googleAuth.attemptSilentRefresh();
      expect(permanentSpy).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it('escalates to onTokenPermanentlyExpired after N consecutive retry-exhausted failures', async () => {
      // Models the bug greg hit: silent refresh kept failing for transient
      // reasons (proxy hiccup, mobile-network jitter) without ever getting
      // classified as `invalid_grant`. The auth-transient classification
      // suppressed all UI signals and the user had to discover the dead
      // state manually via Settings. The escalation threshold turns a
      // streak of soft failures into the same permanent-failure signal.
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Queue 15 transient throws — 3 attemptSilentRefresh calls × 5 retries
      // each (1 initial + 4 retries at 1.5s/3s/6s/12s). We exercise
      // 1 sub-threshold call + 1 threshold-crossing call + 1 past-threshold
      // call. `Once` variants don't leak past their consumed call.
      const queueTransientThrow = () =>
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      for (let i = 0; i < 15; i++) queueTransientThrow();

      // Use vi.useFakeTimers to skip the 1.5s/3s/6s/12s backoff between
      // retries; otherwise each attempt would take ~22.5 real seconds.
      vi.useFakeTimers();

      // Call 1 — counter goes 0 → 1. Below threshold (2). No callback yet.
      const p1 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      expect(await p1).toBeNull();
      expect(permanentSpy).not.toHaveBeenCalled();

      // Call 2 — counter = 2, threshold crossed (>= 2), callback fires once.
      const p2 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      expect(await p2).toBeNull();
      expect(permanentSpy).toHaveBeenCalledTimes(1);

      // Call 3 — counter = 3, still past threshold. With `>=` semantics the
      // callback DOES fire again on each subsequent failure; subscribers are
      // idempotent (the syncStore subscriber just sets a ref to true).
      const p3 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      expect(await p3).toBeNull();
      expect(permanentSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it('resets the consecutive-failure counter on a successful refresh', async () => {
      // One failure (sub-threshold under threshold = 2), success, then one
      // more failure should NOT trip escalation — the counter must reset
      // on success so a recovered transient blip doesn't permanently sit
      // at N-1 and promote the next single failure to a banner.
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Use Once-variants so the override doesn't leak past this test.
      const queueTransientThrow = () =>
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });

      vi.useFakeTimers();

      // One retry-exhausted failure (counter = 1, below threshold). 5 throws
      // cover the 5-attempt sequence (1 initial + 4 retries).
      for (let i = 0; i < 5; i++) queueTransientThrow();
      const p1 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      await p1;
      expect(permanentSpy).not.toHaveBeenCalled();

      // One successful refresh — counter resets to 0. Queue is empty, so
      // the next call falls through to the factory's default success impl.
      const ok = await googleAuth.attemptSilentRefresh();
      expect(ok).toBe('mock-refreshed-token');

      // One more retry-exhausted failure. Counter is now 1 again, NOT 2.
      // Permanent callback must still not have fired.
      for (let i = 0; i < 5; i++) queueTransientThrow();
      const p2 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      await p2;
      expect(permanentSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });
  });

  describe('getValidTokenSilent (banner-firing contract)', () => {
    it('throws TokenExpiredError WITHOUT firing onTokenExpired on transient failure', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const expirySpy = vi.fn();
      const permanentSpy = vi.fn();
      googleAuth.onTokenExpired(expirySpy);
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Five Once-mocks cover all five retry attempts (1 initial + 4 retries
      // at 1.5s/3s/6s/12s, 22.5s total). 2026-05-20 widened from 3 to
      // survive Windows wake-from-sleep. Subsequent tests see the original
      // factory-default impl restored.
      for (let i = 0; i < 5; i++) {
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      }

      // Fake timers — 22.5s of real backoff would exceed any test timeout.
      vi.useFakeTimers();
      const failingCall = expect(googleAuth.getValidTokenSilent()).rejects.toThrow('expired');
      await vi.advanceTimersByTimeAsync(22_500);
      await failingCall;
      vi.useRealTimers();

      // Neither registry fires — transient failures don't surface the banner.
      expect(expirySpy).not.toHaveBeenCalled();
      expect(permanentSpy).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it('fires onTokenPermanentlyExpired when silent refresh hits invalid_grant', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: invalid_grant');
      });

      await expect(googleAuth.getValidTokenSilent()).rejects.toThrow('expired');
      expect(permanentSpy).toHaveBeenCalledTimes(1);

      vi.unstubAllEnvs();
    });
  });

  describe('revokeToken', () => {
    it('calls Google revoke endpoint and clears refresh token', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken, clearGoogleRefreshToken } =
        await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      // Acquire a token first (via silent refresh)
      await googleAuth.attemptSilentRefresh();

      // Revoke it
      await googleAuth.revokeToken();

      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('family-123');
      // Token should be cleared
      expect(googleAuth.isTokenValid()).toBe(false);
      expect(googleAuth.getAccessToken()).toBeNull();

      vi.unstubAllEnvs();
    });
  });

  describe('clearGoogleSessionState', () => {
    it('wipes in-memory token state (accessToken, refreshToken, email, currentFamilyId)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-A');
      await googleAuth.attemptSilentRefresh();

      expect(googleAuth.isTokenValid()).toBe(true);
      expect(googleAuth.hasRefreshToken()).toBe(true);
      googleAuth.setGoogleAccountEmail('a@example.com');
      expect(googleAuth.getGoogleAccountEmail()).toBe('a@example.com');

      await googleAuth.clearGoogleSessionState();

      expect(googleAuth.isTokenValid()).toBe(false);
      expect(googleAuth.getAccessToken()).toBeNull();
      expect(googleAuth.hasRefreshToken()).toBe(false);
      expect(googleAuth.getGoogleAccountEmail()).toBeNull();

      vi.unstubAllEnvs();
    });

    it('clears refresh tokens for both current family AND the __pending__ key', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

      const { getGoogleRefreshToken, clearGoogleRefreshToken } =
        await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-B');

      await googleAuth.clearGoogleSessionState();

      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('family-B');
      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('__pending__');

      vi.unstubAllEnvs();
    });

    it('preserveRefreshToken keeps the active family token but still clears __pending__', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

      const { getGoogleRefreshToken, clearGoogleRefreshToken } =
        await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-D');

      await googleAuth.clearGoogleSessionState({ preserveRefreshToken: true });

      // Active family's token is preserved (trusted-device silent reconnect)…
      expect(clearGoogleRefreshToken).not.toHaveBeenCalledWith('family-D');
      // …but the transient pending slot is always cleared.
      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('__pending__');

      vi.unstubAllEnvs();
    });

    it('preserveRefreshToken does not fire the network revoke (grant must survive)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'a@example.com' }) }); // userinfo
      globalThis.fetch = fetchMock;

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-E');
      await googleAuth.attemptSilentRefresh();

      const callsBefore = fetchMock.mock.calls.length;
      await googleAuth.clearGoogleSessionState({ preserveRefreshToken: true });

      // No additional fetch (the revoke endpoint) should have been hit.
      expect(fetchMock.mock.calls.length).toBe(callsBefore);

      vi.unstubAllEnvs();
    });

    it('fires best-effort revoke fetch but does not throw on network error', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'a@example.com' }) }) // userinfo
        .mockRejectedValue(new Error('network down')); // revoke
      globalThis.fetch = fetchMock;

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-C');
      await googleAuth.attemptSilentRefresh();

      // Should not throw
      await expect(googleAuth.clearGoogleSessionState()).resolves.toBeUndefined();

      vi.unstubAllEnvs();
    });

    it('is idempotent — safe to call when no session is active', async () => {
      // No prior auth — module is fresh
      await expect(googleAuth.clearGoogleSessionState()).resolves.toBeUndefined();
      // Calling again should also work
      await expect(googleAuth.clearGoogleSessionState()).resolves.toBeUndefined();
    });

    it('still clears local state even if refresh-token IDB clear rejects', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'a@example.com' }),
      });

      const { getGoogleRefreshToken, clearGoogleRefreshToken } =
        await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      // Both clear calls reject (current family + __pending__) — Promise.allSettled
      // should still resolve successfully.
      (clearGoogleRefreshToken as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('idb unavailable'))
        .mockRejectedValueOnce(new Error('idb unavailable'));
      await googleAuth.initializeAuth('family-D');
      await googleAuth.attemptSilentRefresh();

      await googleAuth.clearGoogleSessionState();

      // Local state cleared regardless of IDB failure
      expect(googleAuth.isTokenValid()).toBe(false);
      expect(googleAuth.hasRefreshToken()).toBe(false);

      vi.unstubAllEnvs();
    });
  });

  describe('onTokenExpired', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = googleAuth.onTokenExpired(callback);
      expect(typeof unsub).toBe('function');
      unsub();
    });
  });

  describe('onTokenPermanentlyExpired', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = googleAuth.onTokenPermanentlyExpired(callback);
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('removes the subscription when unsub is called', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const cb = vi.fn();
      const unsub = googleAuth.onTokenPermanentlyExpired(cb);
      unsub();

      const { refreshAccessToken } = await import('../oauthProxy');
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('Token refresh failed: invalid_grant');
      });
      await googleAuth.attemptSilentRefresh();
      expect(cb).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });
  });

  describe('installAuthWakeListener (visibility-change proactive refresh)', () => {
    it('refreshes silently when tab becomes visible AND token expires within 2 min', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      refreshFn.mockResolvedValueOnce({
        access_token: 'fresh-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      // beforeEach set document.hidden = true → install-time fire gated.
      await googleAuth.initializeAuth('family-123');
      await new Promise((r) => setTimeout(r, 0));
      expect(refreshFn).not.toHaveBeenCalled();

      // Tab becomes visible. expiresAt is 0 (never set), so the listener
      // sees the token as "expiring within 2 min" and fires a refresh.
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));

      expect(refreshFn).toHaveBeenCalledTimes(1);

      vi.unstubAllEnvs();
    });

    it('does NOT refresh when tab is hidden', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;

      // beforeEach already set document.hidden = true.
      await googleAuth.initializeAuth('family-123');
      await new Promise((r) => setTimeout(r, 0));

      // Dispatch visibilitychange with hidden=true — gate suppresses.
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));

      expect(refreshFn).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it('does NOT refresh when no refresh token is loaded (cold start, no prior auth)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      // Default mock returns null — no refresh token in storage.
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;

      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      await googleAuth.initializeAuth('family-123');
      await new Promise((r) => setTimeout(r, 0));

      // No refresh token → wake listener short-circuits.
      expect(refreshFn).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    // 2026-05-08: silent-refresh-regression fix added three more wake events
    // alongside `visibilitychange`. Each should funnel through the same
    // `refreshIfStale` callback (deduplicated via `pendingSilentRefresh`).
    const extraWakeEvents: Array<['focus' | 'pageshow' | 'online', EventTarget]> = [
      ['focus', window],
      ['pageshow', window],
      ['online', window],
    ];

    for (const [eventName, target] of extraWakeEvents) {
      it(`refreshes silently on \`${eventName}\` when token expires within window`, async () => {
        vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ email: 'test@example.com' }),
        });

        const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
        (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          token: 'stored-refresh-token',
          issuedAt: null,
        });
        const { refreshAccessToken } = await import('../oauthProxy');
        const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
        refreshFn.mockResolvedValueOnce({
          access_token: 'fresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        });

        await googleAuth.initializeAuth('family-123');
        await new Promise((r) => setTimeout(r, 0));
        expect(refreshFn).not.toHaveBeenCalled();

        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        target.dispatchEvent(new Event(eventName));
        await new Promise((r) => setTimeout(r, 0));

        expect(refreshFn).toHaveBeenCalledTimes(1);

        vi.unstubAllEnvs();
      });
    }
  });

  // 2026-05-08: silent-refresh-regression fix — counter is now backed by
  // sessionStorage so reload-loops accumulate failures correctly. The
  // counter is also defensive against sessionStorage being unavailable
  // (private browsing, quota exhaustion) — falls back to in-memory.
  describe('counter persistence across simulated reload', () => {
    it('reads the persisted counter on module init', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      // Pre-populate sessionStorage as if a previous tab session left
      // the counter at 1 (one prior retry-exhausted failure).
      sessionStorage.setItem('beanies_silent_refresh_failures', '1');

      // Force a fresh import so the module-init `loadFailureCounter`
      // call sees the pre-populated value.
      vi.resetModules();
      googleAuth = await import('../googleAuth');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // 5 throws → one retry-exhausted failure → counter goes 1 → 2,
      // crosses threshold of 2, escalation fires. 2026-05-20 widened the
      // backoff to 5 attempts (1 initial + 4 retries at 1.5s/3s/6s/12s).
      for (let i = 0; i < 5; i++) {
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      }

      vi.useFakeTimers();
      const p = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(22_500);
      await p;
      vi.useRealTimers();

      expect(permanentSpy).toHaveBeenCalledTimes(1);
      // Persisted value reflects the new counter.
      expect(sessionStorage.getItem('beanies_silent_refresh_failures')).toBe('2');

      vi.unstubAllEnvs();
    });

    it('persists counter resets on successful acquisition', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      sessionStorage.setItem('beanies_silent_refresh_failures', '5');

      vi.resetModules();
      googleAuth = await import('../googleAuth');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'stored-refresh-token',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      // The default factory mock returns a successful refresh.
      await googleAuth.attemptSilentRefresh();

      expect(sessionStorage.getItem('beanies_silent_refresh_failures')).toBe('0');

      vi.unstubAllEnvs();
    });

    it('falls back to in-memory counting when sessionStorage throws on read', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const getItemSpy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
        throw new Error('sessionStorage disabled');
      });

      try {
        vi.resetModules();
        // Module init triggers `loadFailureCounter` → `sessionStorage.getItem`
        // → throws → caught by warnStorageOnce → console.warn fires.
        await import('../googleAuth');

        // Find the relevant warn (other warns may have fired during init).
        const sessionStorageWarns = consoleWarnSpy.mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('sessionStorage read failed')
        );
        expect(sessionStorageWarns.length).toBe(1);
      } finally {
        getItemSpy.mockRestore();
        consoleWarnSpy.mockRestore();
      }

      vi.unstubAllEnvs();
    });
  });

  // 2026-05-08: pre-existing silent failure fix — IDB rejection during
  // refresh-token recovery used to throw past the wake listener's catch
  // boundary, preventing the counter from ever incrementing.
  describe('performSilentRefresh — IDB-read failure recovery', () => {
    it('continues cleanly when getGoogleRefreshToken rejects (no in-memory token)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      (getActiveFamilyId as ReturnType<typeof vi.fn>).mockReturnValue('family-123');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('IDB schema upgrade in progress')
      );

      // No in-memory refreshToken — initializeAuth wasn't called, simulating
      // a wake-time refresh attempt before module init completed.
      const result = await googleAuth.attemptSilentRefresh();

      // Returns null cleanly — no throw past the function.
      expect(result).toBeNull();

      vi.unstubAllEnvs();
    });
  });

  describe('onTokenAcquired', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = googleAuth.onTokenAcquired(callback);
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('passes interactive=false from a silent refresh', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'silent@example.com' }),
      });

      const subscriber = vi.fn();
      googleAuth.onTokenAcquired(subscriber);

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-int-silent');

      await googleAuth.attemptSilentRefresh();
      await new Promise((r) => setTimeout(r, 10));

      expect(subscriber).toHaveBeenCalledWith('silent@example.com', 'mock-refreshed-token', false);

      vi.unstubAllEnvs();
    });

    it('fires after a successful silent refresh with the resolved email', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'silent@example.com' }),
      });

      const subscriber = vi.fn();
      googleAuth.onTokenAcquired(subscriber);

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-X');

      await googleAuth.attemptSilentRefresh();
      // notifyTokenAcquired is fire-and-forget — wait for the microtask + fetch
      await new Promise((r) => setTimeout(r, 10));

      expect(subscriber).toHaveBeenCalledWith('silent@example.com', 'mock-refreshed-token', false);

      vi.unstubAllEnvs();
    });

    it('continues firing remaining callbacks if one throws', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'a@example.com' }),
      });

      const bad = vi.fn(() => {
        throw new Error('subscriber boom');
      });
      const good = vi.fn();
      googleAuth.onTokenAcquired(bad);
      googleAuth.onTokenAcquired(good);

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-Y');
      await googleAuth.attemptSilentRefresh();
      await new Promise((r) => setTimeout(r, 10));

      expect(bad).toHaveBeenCalled();
      expect(good).toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it('unsubscribed callbacks are not invoked', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'a@example.com' }),
      });

      const subscriber = vi.fn();
      const unsub = googleAuth.onTokenAcquired(subscriber);
      unsub();

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-Z');
      await googleAuth.attemptSilentRefresh();
      await new Promise((r) => setTimeout(r, 10));

      expect(subscriber).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });
  });

  describe('migratePendingRefreshToken', () => {
    it('moves pending refresh token to family-scoped key', async () => {
      const { getGoogleRefreshToken, storeGoogleRefreshToken, clearGoogleRefreshToken } =
        await import('@/services/sync/fileHandleStore');

      // Simulate a pending token stored during login-page OAuth. New shape:
      // the reader returns StoredRefreshToken; bare-string legacy entries
      // come back as { token, issuedAt: null }. migratePendingRefreshToken
      // forwards `issuedAt` literally — including null.
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'pending-refresh-token',
        issuedAt: null,
      });

      await googleAuth.migratePendingRefreshToken('family-456');

      // Should read from the pending key
      expect(getGoogleRefreshToken).toHaveBeenCalledWith('__pending__');
      // Should store under the family key, carrying issuedAt forward (null
      // here — never coerced to Date.now() for a legacy pending entry).
      expect(storeGoogleRefreshToken).toHaveBeenCalledWith('family-456', 'pending-refresh-token', {
        issuedAt: null,
      });
      // Should clear the pending key
      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('__pending__');
    });

    it('does nothing when no pending token exists', async () => {
      const { storeGoogleRefreshToken, clearGoogleRefreshToken } =
        await import('@/services/sync/fileHandleStore');

      await googleAuth.migratePendingRefreshToken('family-456');

      // getGoogleRefreshToken returns null by default, so no migration
      expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
      expect(clearGoogleRefreshToken).not.toHaveBeenCalled();
    });

    it('enables silent refresh after migration', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      // Mock fetch for userinfo email call
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      // First call: migratePendingRefreshToken reads the pending token
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'pending-refresh-token'
      );

      await googleAuth.migratePendingRefreshToken('family-456');

      // Now silent refresh should work (in-memory refreshToken was set)
      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBe('mock-refreshed-token');

      vi.unstubAllEnvs();
    });
  });

  describe('email caching', () => {
    it('caches and returns Google account email', () => {
      expect(googleAuth.getGoogleAccountEmail()).toBeNull();
      googleAuth.setGoogleAccountEmail('test@example.com');
      expect(googleAuth.getGoogleAccountEmail()).toBe('test@example.com');
    });
  });

  describe('session-epoch guard (post-sign-out zombie tokens)', () => {
    const CLIENT = 'cid.apps.googleusercontent.com';

    beforeEach(() => {
      // isSessionStillCurrent fires a best-effort revoke fetch; mock it so the
      // discard path doesn't hit the network.
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    });

    it('completeRedirectAuth: a sign-out mid-exchange discards the token (no commit, no notify)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
      const acquired = vi.fn();
      googleAuth.onTokenAcquired(acquired);

      const { exchangeCodeForTokens } = await import('../oauthProxy');
      // Simulate the user signing out WHILE the code exchange is in flight.
      (exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        await googleAuth.clearGoogleSessionState();
        return {
          access_token: 'late-token',
          refresh_token: 'late-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'drive.file userinfo.email',
        };
      });
      sessionStorage.setItem('beanies_redirect_auth_code', 'code-123');
      sessionStorage.setItem(
        'beanies_redirect_auth',
        JSON.stringify({ codeVerifier: 'v', returnPath: '/welcome' })
      );

      const result = await googleAuth.completeRedirectAuth();

      expect(result).toBeNull();
      expect(googleAuth.getAccessToken()).toBeNull();
      expect(acquired).not.toHaveBeenCalled();
      const { logEvent } = await import('@/services/telemetry');
      expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'auth-epoch-discard' })
      );
      vi.unstubAllEnvs();
    });

    it('completeRedirectAuth: no teardown → token commits as today', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ email: 'a@b.com' }) });
      sessionStorage.setItem('beanies_redirect_auth_code', 'code-456');
      sessionStorage.setItem(
        'beanies_redirect_auth',
        JSON.stringify({ codeVerifier: 'v', returnPath: '/welcome' })
      );

      const result = await googleAuth.completeRedirectAuth();

      expect(result).toBe('mock-access-token');
      expect(googleAuth.getAccessToken()).toBe('mock-access-token');
      vi.unstubAllEnvs();
    });

    it('completeRedirectAuth: a sign-out DURING the refresh-token persist rolls back (no on-disk zombie)', async () => {
      // A1/A2 — the persist-ordering TOCTOU. The pre-commit guard passes (epoch
      // current at exchange time), then the sign-out interleaves while the IDB write
      // is in flight. The post-persist re-check must roll back: clear the just-written
      // token and null in-memory, so no refresh token survives for the dead session.
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
      const acquired = vi.fn();
      googleAuth.onTokenAcquired(acquired);

      const fhs = await import('@/services/sync/fileHandleStore');
      (fhs.storeGoogleRefreshToken as ReturnType<typeof vi.fn>).mockClear();
      (fhs.clearGoogleRefreshToken as ReturnType<typeof vi.fn>).mockClear();
      // Sign out WHILE the refresh token is being persisted (db.put in flight).
      (fhs.storeGoogleRefreshToken as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        await googleAuth.clearGoogleSessionState();
      });

      sessionStorage.setItem('beanies_redirect_auth_code', 'code-pp');
      sessionStorage.setItem(
        'beanies_redirect_auth',
        JSON.stringify({ codeVerifier: 'v', returnPath: '/welcome' })
      );

      const result = await googleAuth.completeRedirectAuth();

      expect(result).toBeNull();
      expect(googleAuth.getAccessToken()).toBeNull();
      expect(acquired).not.toHaveBeenCalled();
      // Rollback cleared the just-written token and emitted the post-persist discard log.
      expect(fhs.clearGoogleRefreshToken).toHaveBeenCalled();
      const { logEvent } = await import('@/services/telemetry');
      expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'auth-epoch-discard',
          message: expect.stringContaining('post-persist rollback'),
        })
      );
      vi.unstubAllEnvs();
    });

    it('attemptSilentRefresh: a sign-out mid-refresh discards the token', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
      const acquired = vi.fn();
      googleAuth.onTokenAcquired(acquired);
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        token: 'rt',
        issuedAt: null,
      });
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        await googleAuth.clearGoogleSessionState();
        return { access_token: 'late', expires_in: 3600, token_type: 'Bearer' };
      });

      const result = await googleAuth.attemptSilentRefresh();

      expect(result).toBeNull();
      expect(googleAuth.getAccessToken()).toBeNull();
      expect(acquired).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('clearGoogleSessionState clears the redirect-intent sessionStorage keys', async () => {
      sessionStorage.setItem('beanies_redirect_auth_code', 'code-x');
      sessionStorage.setItem('beanies_redirect_auth', '{"codeVerifier":"v"}');
      await googleAuth.clearGoogleSessionState();
      expect(sessionStorage.getItem('beanies_redirect_auth_code')).toBeNull();
      expect(sessionStorage.getItem('beanies_redirect_auth')).toBeNull();
    });

    it('notifyTokenAcquired backstop: a stale expectedEpoch logs an error and fires no subscriber', async () => {
      const acquired = vi.fn();
      googleAuth.onTokenAcquired(acquired);
      // A stale expectedEpoch models a future seam committing without its guard.
      await googleAuth.__notifyTokenAcquiredForTesting(
        'leaked',
        false,
        googleAuth.getSessionEpoch() + 1
      );
      expect(acquired).not.toHaveBeenCalled();
      const { logEvent } = await import('@/services/telemetry');
      expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'auth-epoch-leak', level: 'error' })
      );
    });
  });
});

describe('isUserCancellation', () => {
  it('treats an AbortError (file-picker cancel) as a cancellation', () => {
    const e = new Error('The user aborted a request.');
    e.name = 'AbortError';
    expect(isUserCancellation(e)).toBe(true);
  });

  it('treats popup-closed / dismiss / user_cancel messages as cancellations', () => {
    expect(isUserCancellation(new Error('popup_closed_by_user'))).toBe(true);
    expect(isUserCancellation(new Error('User cancelled the flow'))).toBe(true);
    expect(isUserCancellation(new Error('Account chooser dismissed'))).toBe(true);
    expect(isUserCancellation('user_cancel')).toBe(true);
  });

  it('does not treat genuine failures as cancellations', () => {
    expect(isUserCancellation(new Error('Network request failed'))).toBe(false);
    expect(isUserCancellation(new Error('403 Forbidden'))).toBe(false);
    expect(isUserCancellation(null)).toBe(false);
    expect(isUserCancellation(undefined)).toBe(false);
  });
});
