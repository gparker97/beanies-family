/**
 * OAuth proxy client — calls the Lambda at api.beanies.family for token exchange and refresh.
 *
 * Uses the same API Gateway as the registry (VITE_REGISTRY_API_URL), so no new env var needed.
 */

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface OAuthError {
  error: string;
  error_description?: string;
}

function getApiBaseUrl(): string {
  return import.meta.env.VITE_REGISTRY_API_URL ?? '';
}

/**
 * Exchange an authorization code for access + refresh tokens via the Lambda proxy.
 */
export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<TokenResponse> {
  const url = `${getApiBaseUrl()}/oauth/google/token`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
    }),
  });

  const body = await res.json();

  if (!res.ok) {
    const err = body as OAuthError;
    throw new Error(err.error_description ?? err.error ?? 'Token exchange failed');
  }

  return body as TokenResponse;
}

/**
 * Refresh an expired access token using a refresh token via the Lambda proxy.
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<TokenResponse> {
  const url = `${getApiBaseUrl()}/oauth/google/refresh`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: params.refreshToken,
      client_id: params.clientId,
    }),
  });

  const body = await res.json();

  if (!res.ok) {
    const err = body as OAuthError;
    throw new Error(err.error_description ?? err.error ?? 'Token refresh failed');
  }

  return body as TokenResponse;
}
