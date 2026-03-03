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

    it('throws clear error when VITE_REGISTRY_API_URL is not configured', async () => {
      vi.stubEnv('VITE_REGISTRY_API_URL', '');

      await expect(
        exchangeCodeForTokens({
          code: 'c',
          codeVerifier: 'v',
          redirectUri: 'https://beanies.family/oauth/callback',
          clientId: 'cid',
        })
      ).rejects.toThrow('VITE_REGISTRY_API_URL is not configured');
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
});
