import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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

// Reset module state between tests
let googleAuth: typeof import('../googleAuth');

describe('googleAuth (PKCE)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // Gate the wake listener's install-time fire by default. The wake
    // listener (installed during `initializeAuth`) proactively refreshes
    // when the tab is visible AND a refresh token is present — that's
    // the right *production* behavior, but in tests it consumes mock
    // implementations before the test's explicit `attemptSilentRefresh`
    // call. Tests that specifically exercise the wake path set hidden
    // back to false and dispatch `visibilitychange`.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
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
      maxTouchPoints?: number;
      standaloneMq?: boolean;
      iosStandalone?: boolean;
    }) {
      const { ua = '', maxTouchPoints = 0, standaloneMq = false, iosStandalone = false } = opts;
      Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
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

    it('returns false for iOS regular Safari (non-standalone)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(false);
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

    it('returns false for desktop Chrome (no standalone signal)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(false);
    });

    it('returns false for iPad regular Safari (non-standalone)', () => {
      stubEnv({
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        maxTouchPoints: 5, // iPadOS 13+ reports as Mac with touch points
      });
      expect(googleAuth.shouldUseRedirectAuth()).toBe(false);
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

  describe('initializeAuth', () => {
    it('loads stored refresh token from IndexedDB', async () => {
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );

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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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

    it('returns null after retrying when transient failure persists (3 attempts with stepped backoff)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
      await googleAuth.initializeAuth('family-123');

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Three transient-error throws — covers all three attempts.
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      // Three attempts total (initial + two retries with 1.5s and 3s
      // backoff), then give up.
      expect(refreshFn).toHaveBeenCalledTimes(3);

      vi.unstubAllEnvs();
    }, 10_000);

    it('fires onTokenPermanentlyExpired immediately on invalid_grant — but NOT on a single retry-exhausted transient failure', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;

      // ONE retry-exhausted transient failure → counter = 1 (below the
      // escalation threshold of 3). Permanent callback should NOT fire.
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      await googleAuth.attemptSilentRefresh();
      expect(permanentSpy).not.toHaveBeenCalled();

      // invalid_grant → permanent callback SHOULD fire immediately, no
      // counter waiting. Re-prime in-memory refreshToken via initializeAuth
      // for a clean slate (the transient path above leaves it intact).
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
      await googleAuth.initializeAuth('family-123');
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: invalid_grant');
      });
      await googleAuth.attemptSilentRefresh();
      expect(permanentSpy).toHaveBeenCalledTimes(1);

      vi.unstubAllEnvs();
    }, 10_000);

    it('escalates to onTokenPermanentlyExpired after N consecutive retry-exhausted failures', async () => {
      // Models the bug greg hit: silent refresh kept failing for transient
      // reasons (proxy hiccup, mobile-network jitter) without ever getting
      // classified as `invalid_grant`. The auth-transient classification
      // suppressed all UI signals and the user had to discover the dead
      // state manually via Settings. The escalation threshold turns a
      // streak of soft failures into the same permanent-failure signal.
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Queue 12 transient throws — 4 attempts × 3 retries each. `Once`
      // variants don't leak past their consumed call; `mockImplementation`
      // (without Once) would persist to subsequent tests since vi.mock
      // factory state isn't reset by `vi.restoreAllMocks` / `resetModules`.
      const queueTransientThrow = () =>
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });
      for (let i = 0; i < 12; i++) queueTransientThrow();

      // Use vi.useFakeTimers to skip the 1.5s + 3s backoff between retries;
      // otherwise this test would take ~14 real seconds.
      vi.useFakeTimers();

      // Calls 1 + 2 — counter goes 1, 2. No callback yet.
      for (let i = 0; i < 2; i++) {
        const p = googleAuth.attemptSilentRefresh();
        await vi.advanceTimersByTimeAsync(5000); // backoff is 1.5+3s; bounded so the ~55min auto-refresh timer (set on success) doesn't also fire
        expect(await p).toBeNull();
        expect(permanentSpy).not.toHaveBeenCalled();
      }

      // Call 3 — counter = 3, threshold crossed, callback fires exactly once.
      const p3 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p3).toBeNull();
      expect(permanentSpy).toHaveBeenCalledTimes(1);

      // Call 4 — counter = 4, past threshold (`===` check). Should NOT fire
      // again; subscribers are idempotent but we still avoid noisy re-fires.
      const p4 = googleAuth.attemptSilentRefresh();
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p4).toBeNull();
      expect(permanentSpy).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it('resets the consecutive-failure counter on a successful refresh', async () => {
      // Two failures, then a success, then two more failures should NOT
      // trip the escalation threshold — the counter must reset on success
      // so a recovered transient blip doesn't permanently sit at N-1 and
      // promote the next single failure to a banner.
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
      await googleAuth.initializeAuth('family-123');

      const permanentSpy = vi.fn();
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Use Once-variants so the override doesn't leak past this test —
      // `mockImplementation` (without Once) persists across `resetModules`
      // and pollutes downstream tests in this file.
      const queueTransientThrow = () =>
        refreshFn.mockImplementationOnce(() => {
          throw new Error('Token refresh failed: network error');
        });

      vi.useFakeTimers();

      // Two retry-exhausted failures (counter = 2). 6 throws cover both.
      for (let i = 0; i < 6; i++) queueTransientThrow();
      for (let i = 0; i < 2; i++) {
        const p = googleAuth.attemptSilentRefresh();
        await vi.advanceTimersByTimeAsync(5000); // backoff is 1.5+3s; bounded so the ~55min auto-refresh timer (set on success) doesn't also fire
        await p;
      }
      expect(permanentSpy).not.toHaveBeenCalled();

      // One successful refresh — counter resets to 0. Queue is empty, so
      // the next call falls through to the factory's default success impl.
      const ok = await googleAuth.attemptSilentRefresh();
      expect(ok).toBe('mock-refreshed-token');

      // Two more retry-exhausted failures. Counter is now 2 again, NOT 4.
      // Permanent callback must still not have fired.
      for (let i = 0; i < 6; i++) queueTransientThrow();
      for (let i = 0; i < 2; i++) {
        const p = googleAuth.attemptSilentRefresh();
        await vi.advanceTimersByTimeAsync(5000);
        await p;
      }
      expect(permanentSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });
  });

  describe('getValidTokenSilent (banner-firing contract)', () => {
    it('throws TokenExpiredError WITHOUT firing onTokenExpired on transient failure', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
      await googleAuth.initializeAuth('family-123');

      const expirySpy = vi.fn();
      const permanentSpy = vi.fn();
      googleAuth.onTokenExpired(expirySpy);
      googleAuth.onTokenPermanentlyExpired(permanentSpy);

      const { refreshAccessToken } = await import('../oauthProxy');
      const refreshFn = refreshAccessToken as ReturnType<typeof vi.fn>;
      // Three Once-mocks cover all three retry attempts. Subsequent tests
      // see the original factory-default impl restored.
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });
      refreshFn.mockImplementationOnce(() => {
        throw new Error('Token refresh failed: network error');
      });

      await expect(googleAuth.getValidTokenSilent()).rejects.toThrow('expired');
      // Neither registry fires — transient failures don't surface the banner.
      expect(expirySpy).not.toHaveBeenCalled();
      expect(permanentSpy).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    }, 10_000);

    it('fires onTokenPermanentlyExpired when silent refresh hits invalid_grant', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
      await googleAuth.initializeAuth('family-B');

      await googleAuth.clearGoogleSessionState();

      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('family-B');
      expect(clearGoogleRefreshToken).toHaveBeenCalledWith('__pending__');

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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );

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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'stored-refresh-token'
      );

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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce('rt');
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

      // Simulate a pending token stored during login-page OAuth
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'pending-refresh-token'
      );

      await googleAuth.migratePendingRefreshToken('family-456');

      // Should read from the pending key
      expect(getGoogleRefreshToken).toHaveBeenCalledWith('__pending__');
      // Should store under the family key
      expect(storeGoogleRefreshToken).toHaveBeenCalledWith('family-456', 'pending-refresh-token');
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
});
