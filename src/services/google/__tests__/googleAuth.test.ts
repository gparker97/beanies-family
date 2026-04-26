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
    // Fresh import to reset module-level state
    googleAuth = await import('../googleAuth');
  });

  afterEach(() => {
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
