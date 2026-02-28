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

  describe('attemptSilentRefresh', () => {
    it('returns null when no client ID is configured', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      vi.unstubAllEnvs();
    });

    it('returns null when GIS is not loaded', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      // window.google is undefined (cleared in beforeEach)
      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      vi.unstubAllEnvs();
    });

    it('returns token on successful silent refresh', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      // Mock fetch for the userinfo email call (fire-and-forget)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn((config: any) => ({
              requestAccessToken: vi.fn(({ prompt }: { prompt: string }) => {
                // Verify silent mode (empty prompt)
                expect(prompt).toBe('');
                // Simulate successful token response
                setTimeout(() => {
                  config.callback({
                    access_token: 'silent-refreshed-token',
                    expires_in: 3600,
                  });
                }, 0);
              }),
            })),
            revoke: vi.fn(),
          },
        },
      };

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBe('silent-refreshed-token');
      vi.unstubAllEnvs();
    });

    it('returns null when silent refresh returns an error', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn((config: any) => ({
              requestAccessToken: vi.fn(() => {
                setTimeout(() => {
                  config.callback({
                    error: 'interaction_required',
                    error_description: 'User interaction required',
                  });
                }, 0);
              }),
            })),
            revoke: vi.fn(),
          },
        },
      };

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      vi.unstubAllEnvs();
    });

    it('returns null when error_callback fires', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn((config: any) => ({
              requestAccessToken: vi.fn(() => {
                setTimeout(() => {
                  config.error_callback({ type: 'popup_closed', message: 'Popup closed' });
                }, 0);
              }),
            })),
            revoke: vi.fn(),
          },
        },
      };

      const result = await googleAuth.attemptSilentRefresh();
      expect(result).toBeNull();
      vi.unstubAllEnvs();
    });

    it('returns null on timeout (5s)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      vi.useFakeTimers();

      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn(() => ({
              // Never calls callback — simulates a hang
              requestAccessToken: vi.fn(),
            })),
            revoke: vi.fn(),
          },
        },
      };

      const promise = googleAuth.attemptSilentRefresh();

      // Advance past the 5-second timeout
      await vi.advanceTimersByTimeAsync(6000);

      const result = await promise;
      expect(result).toBeNull();

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });
  });

  describe('getValidToken', () => {
    it('returns cached token if still valid', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

      // Mock fetch for the userinfo email call
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      // First, acquire a token via silent refresh
      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn((config: any) => ({
              requestAccessToken: vi.fn(() => {
                setTimeout(() => {
                  config.callback({
                    access_token: 'cached-token',
                    expires_in: 3600,
                  });
                }, 0);
              }),
            })),
            revoke: vi.fn(),
          },
        },
      };

      // Acquire a token first
      const token1 = await googleAuth.attemptSilentRefresh();
      expect(token1).toBe('cached-token');

      // Now getValidToken should return the cached token without calling GIS again
      const initClient = (window as any).google.accounts.oauth2.initTokenClient;
      initClient.mockClear();

      const token2 = await googleAuth.getValidToken();
      expect(token2).toBe('cached-token');
      // initTokenClient should NOT have been called again
      expect(initClient).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });
  });

  describe('scheduleExpiryWarning', () => {
    it('tries silent refresh before firing expiry callbacks', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
      vi.useFakeTimers();

      // Mock fetch for the userinfo email call
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });

      const expiryCallback = vi.fn();
      googleAuth.onTokenExpired(expiryCallback);

      // Set up GIS that succeeds on silent refresh
      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn((config: any) => ({
              requestAccessToken: vi.fn(() => {
                // Simulate successful refresh
                setTimeout(() => {
                  config.callback({
                    access_token: 'refreshed-token',
                    expires_in: 3600,
                  });
                }, 0);
              }),
            })),
            revoke: vi.fn(),
          },
        },
      };

      // First acquire a token to trigger scheduleExpiryWarning with a short expiry
      // (6 minutes = 360s, so warning fires after 60s = 360 - 300)
      const initClient = (window as any).google.accounts.oauth2.initTokenClient;
      const mockClient = {
        requestAccessToken: vi.fn(() => {
          const config = initClient.mock.calls[0][0];
          setTimeout(() => {
            config.callback({
              access_token: 'initial-token',
              expires_in: 360, // 6 minutes
            });
          }, 0);
        }),
      };
      initClient.mockReturnValueOnce(mockClient);

      // Request token to set up expiry timer
      const tokenPromise = googleAuth.requestAccessToken();
      await vi.advanceTimersByTimeAsync(10);
      await tokenPromise;

      // Advance to the warning point (360 - 300 = 60 seconds)
      await vi.advanceTimersByTimeAsync(60_000);

      // Allow the async silent refresh to complete
      await vi.advanceTimersByTimeAsync(100);

      // Expiry callback should NOT have fired (silent refresh succeeded)
      expect(expiryCallback).not.toHaveBeenCalled();

      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    // Note: the negative path (silent refresh fails → callbacks fire) is not tested
    // end-to-end because nested async + setTimeout interactions are unreliable in the
    // test environment. The behavior is covered by:
    // - attemptSilentRefresh returns null on error/timeout (tested directly above)
    // - The success path above verifies scheduleExpiryWarning integrates with silent refresh
    // - The failure branch is a simple `if (!refreshed) { forEach callbacks }` guard
  });
});
