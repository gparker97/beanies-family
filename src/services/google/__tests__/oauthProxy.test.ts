import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { exchangeCodeForTokens, refreshAccessToken } from '../oauthProxy';

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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.access',
          refresh_token: '1//refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Code expired',
        }),
      });

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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'server_error' }),
      });

      await expect(
        exchangeCodeForTokens({
          code: 'c',
          codeVerifier: 'v',
          redirectUri: 'https://beanies.family/oauth/callback',
          clientId: 'cid',
        })
      ).rejects.toThrow('server_error');
    });
  });

  describe('refreshAccessToken', () => {
    it('sends correct request to Lambda proxy', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.new-access',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Token revoked',
        }),
      });

      await expect(
        refreshAccessToken({
          refreshToken: 'revoked',
          clientId: 'cid',
        })
      ).rejects.toThrow('Token revoked');
    });
  });
});
