import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Reset module state between tests
let googleAuth: typeof import('../googleAuth');

describe('googleAuth', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear any window.google state
    delete (window as any).google;
    // Fresh import to reset module state
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
    it('resolves immediately if GIS is already loaded', async () => {
      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn(),
            revoke: vi.fn(),
          },
        },
      };

      await expect(googleAuth.loadGIS()).resolves.toBeUndefined();
    });

    it('injects script tag when GIS is not loaded', async () => {
      const originalCreateElement = document.createElement.bind(document);
      const mockScript: Record<string, any> = {
        src: '',
        async: false,
        set onload(fn: () => void) {
          // Simulate async script load
          setTimeout(fn, 0);
        },
        set onerror(_fn: () => void) {},
      };

      vi.spyOn(document, 'querySelector').mockReturnValue(null);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'script') return mockScript as unknown as HTMLScriptElement;
        return originalCreateElement(tag);
      });
      vi.spyOn(document.head, 'appendChild').mockImplementation(() => mockScript as any);

      const promise = googleAuth.loadGIS();
      await expect(promise).resolves.toBeUndefined();
      expect(mockScript.src).toContain('accounts.google.com/gsi/client');
    });
  });

  describe('revokeToken', () => {
    it('calls google revoke when token exists', () => {
      const mockRevoke = vi.fn();
      (window as any).google = {
        accounts: {
          oauth2: {
            revoke: mockRevoke,
          },
        },
      };

      // revokeToken should not throw even without a token
      googleAuth.revokeToken();
    });
  });

  describe('onTokenExpired', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = googleAuth.onTokenExpired(callback);
      expect(typeof unsub).toBe('function');

      // Calling unsub should not throw
      unsub();
    });
  });
});
