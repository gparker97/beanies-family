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

  describe('onTokenExpired', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = googleAuth.onTokenExpired(callback);
      expect(typeof unsub).toBe('function');
      unsub();
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
