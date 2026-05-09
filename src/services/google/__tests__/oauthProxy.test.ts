import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { exchangeCodeForTokens, refreshAccessToken } from '../oauthProxy';

/** Helper: create a mock Response with text() method (used by safeJsonParse). */
function mockResponse(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    text: async () => (body === null ? '' : JSON.stringify(body)),
  };
}

describe('oauthProxy', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv('VITE_REGISTRY_API_URL', 'https://api.beanies.family');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe('exchangeCodeForTokens', () => {
    it('sends correct request to Lambda proxy', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(true, {
          access_token: 'ya29.access',
          refresh_token: '1//refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );

      const result = await exchangeCodeForTokens({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'https://beanies.family/oauth/callback',
        clientId: 'my-client-id',
      });

      expect(result.access_token).toBe('ya29.access');
      expect(result.refresh_token).toBe('1//refresh');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.beanies.family/oauth/google/token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            code: 'auth-code',
            code_verifier: 'verifier',
            redirect_uri: 'https://beanies.family/oauth/callback',
            client_id: 'my-client-id',
          }),
        })
      );
    });

    it('throws on error response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(false, {
          error: 'invalid_grant',
          error_description: 'Code expired',
        })
      );

      await expect(
        exchangeCodeForTokens({
          code: 'expired',
          codeVerifier: 'v',
          redirectUri: 'https://beanies.family/oauth/callback',
          clientId: 'cid',
        })
      ).rejects.toThrow('Code expired');
    });

    it('throws generic error when no description', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(false, { error: 'server_error' }));

      await expect(
        exchangeCodeForTokens({
          code: 'c',
          codeVerifier: 'v',
          redirectUri: 'https://beanies.family/oauth/callback',
          clientId: 'cid',
        })
      ).rejects.toThrow('server_error');
    });

    it('handles empty response body without raw JSON parse error', async () => {
      // Reproduces the real bug: Lambda proxy returns empty body (e.g. 502, timeout)
      // → res.json() throws "Unexpected end of JSON input" which leaks to the user.
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '',
      });

      await expect(
        exchangeCodeForTokens({
          code: 'c',
          codeVerifier: 'v',
          redirectUri: 'https://beanies.family/oauth/callback',
          clientId: 'cid',
        })
      ).rejects.toThrow('Token exchange failed');
      // Must NOT throw "Unexpected end of JSON input" — that's a raw leak
    });

    it('handles HTML error page response without raw JSON parse error', async () => {
      // Lambda/API Gateway can return HTML error pages (e.g. 503 Service Unavailable)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => '<html><body>Service Unavailable</body></html>',
      });

      await expect(
        exchangeCodeForTokens({
          code: 'c',
          codeVerifier: 'v',
          redirectUri: 'https://beanies.family/oauth/callback',
          clientId: 'cid',
        })
      ).rejects.toThrow('Token exchange failed');
    });

    it('prefers VITE_OAUTH_PROXY_URL when both env vars are set', async () => {
      vi.stubEnv('VITE_OAUTH_PROXY_URL', 'https://oauth.example.com');
      vi.stubEnv('VITE_REGISTRY_API_URL', 'https://registry.example.com');

      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(true, {
          access_token: 'ya29.access',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );

      await exchangeCodeForTokens({
        code: 'c',
        codeVerifier: 'v',
        redirectUri: 'https://beanies.family/oauth/callback',
        clientId: 'cid',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://oauth.example.com/oauth/google/token',
        expect.any(Object)
      );
    });

    it('falls back to VITE_REGISTRY_API_URL when only registry is set (cloud regression sentinel)', async () => {
      // Cloud's .env.local sets only VITE_REGISTRY_API_URL — if this test ever
      // fails, cloud Drive sign-in is broken. Do not delete or weaken.
      vi.stubEnv('VITE_OAUTH_PROXY_URL', '');
      vi.stubEnv('VITE_REGISTRY_API_URL', 'https://api.beanies.family');

      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(true, {
          access_token: 'ya29.access',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );

      await exchangeCodeForTokens({
        code: 'c',
        codeVerifier: 'v',
        redirectUri: 'https://beanies.family/oauth/callback',
        clientId: 'cid',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.beanies.family/oauth/google/token',
        expect.any(Object)
      );
    });

    it('throws clear error when neither OAuth proxy nor registry URL is configured', async () => {
      vi.stubEnv('VITE_OAUTH_PROXY_URL', '');
      vi.stubEnv('VITE_REGISTRY_API_URL', '');

      await expect(
        exchangeCodeForTokens({
          code: 'c',
          codeVerifier: 'v',
          redirectUri: 'https://beanies.family/oauth/callback',
          clientId: 'cid',
        })
      ).rejects.toThrow('OAuth proxy not configured');
    });
  });

  describe('refreshAccessToken', () => {
    it('sends correct request to Lambda proxy', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(true, {
          access_token: 'ya29.new-access',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );

      const result = await refreshAccessToken({
        refreshToken: '1//my-refresh',
        clientId: 'my-client-id',
      });

      expect(result.access_token).toBe('ya29.new-access');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.beanies.family/oauth/google/refresh',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            refresh_token: '1//my-refresh',
            client_id: 'my-client-id',
          }),
        })
      );
    });

    it('throws on error response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(false, {
          error: 'invalid_grant',
          error_description: 'Token revoked',
        })
      );

      await expect(
        refreshAccessToken({
          refreshToken: 'revoked',
          clientId: 'cid',
        })
      ).rejects.toThrow('Token revoked');
    });

    it('handles empty response body without raw JSON parse error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '',
      });

      await expect(
        refreshAccessToken({
          refreshToken: 'r',
          clientId: 'cid',
        })
      ).rejects.toThrow('Token refresh failed');
    });
  });

  // Network timeout — iOS Safari over flaky cellular / Wi-Fi handover can let
  // fetch() hang silently for minutes. Without these timeouts, a single hung
  // fetch wedges silent refresh (via pendingSilentRefresh dedupe) AND wedges
  // app init (completeRedirectAuth -> exchangeCodeForTokens). Both paths now
  // fail fast with an error message containing "silent refresh failed" so
  // the sync-store classifier routes the failure through the auth-transient
  // → reconnect-banner path.
  describe('fetch timeout', () => {
    /**
     * Build a fetch mock that holds the request open until the test's abort
     * signal fires. Rejection is pre-attached with a no-op .catch so that
     * vitest's unhandled-rejection tracker doesn't fire when the abort
     * settles after the awaiting expect() has already observed it.
     */
    function makeHangingFetch(): typeof fetch {
      return vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        const promise = new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
        promise.catch(() => {});
        return promise;
      }) as unknown as typeof fetch;
    }

    it('aborts exchangeCodeForTokens after the timeout and throws a transient-classified error', async () => {
      vi.useFakeTimers();
      globalThis.fetch = makeHangingFetch();

      const promise = exchangeCodeForTokens({
        code: 'c',
        codeVerifier: 'v',
        redirectUri: 'https://beanies.family/oauth/callback',
        clientId: 'cid',
      });
      // Pre-attach a tap so the rejection is consumed before fake-timer advance
      // triggers the abort. The expect().rejects below still observes it.
      const observed = expect(promise).rejects.toThrow(/timed out.*silent refresh failed/);

      // Advance past the 15s timeout
      await vi.advanceTimersByTimeAsync(15_001);

      await observed;
      vi.useRealTimers();
    });

    it('aborts refreshAccessToken after the timeout and throws a transient-classified error', async () => {
      vi.useFakeTimers();
      globalThis.fetch = makeHangingFetch();

      const promise = refreshAccessToken({
        refreshToken: 'r',
        clientId: 'cid',
      });
      // Message MUST contain "silent refresh failed" so the sync store's
      // isAuthTransientSyncError regex (/silent refresh failed/i in
      // syncStore.ts) classifies this as auth-transient and surfaces the
      // reconnect banner via the cold-start escalation path.
      const observed = expect(promise).rejects.toThrow(/silent refresh failed/i);

      await vi.advanceTimersByTimeAsync(15_001);

      await observed;
      vi.useRealTimers();
    });

    it('does NOT add an extra delay on the happy path (no spurious timeouts)', async () => {
      // Sanity: a fast successful fetch should not be slowed by the timeout
      // wrapper. Verifies that the timer is properly cleared on success.
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(true, {
          access_token: 'ya29.access',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );

      const start = Date.now();
      const result = await refreshAccessToken({
        refreshToken: 'r',
        clientId: 'cid',
      });
      const elapsed = Date.now() - start;

      expect(result.access_token).toBe('ya29.access');
      // Generous bound — happy path should be sub-100ms in vitest
      expect(elapsed).toBeLessThan(1_000);
    });
  });
});
