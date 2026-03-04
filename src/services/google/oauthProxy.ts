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
  const url = import.meta.env.VITE_REGISTRY_API_URL;
  if (!url) {
    throw new Error('VITE_REGISTRY_API_URL is not configured. Add it to your .env.local file.');
  }
  return url;
}

/**
 * Safely parse JSON from a fetch response, returning null if the body is
 * empty or not valid JSON (e.g. HTML error page, 502 gateway timeout).
 */
async function safeJsonParse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
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

  let body: unknown;
  try {
    body = await safeJsonParse(res);
  } catch {
    throw new Error('Token exchange failed');
  }

  if (!res.ok) {
    const err = (body ?? {}) as OAuthError;
    const detail = err.error_description ?? err.error ?? 'unknown';
    console.warn(`[oauthProxy] Token exchange failed: HTTP ${res.status} — ${detail}`);
    throw new Error(`Token exchange failed: ${detail}`);
  }

  if (!body) {
    throw new Error('Token exchange failed: empty response');
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

  let body: unknown;
  try {
    body = await safeJsonParse(res);
  } catch {
    throw new Error('Token refresh failed');
  }

  if (!res.ok) {
    const err = (body ?? {}) as OAuthError;
    const detail = err.error_description ?? err.error ?? 'unknown';
    console.warn(`[oauthProxy] Token refresh failed: HTTP ${res.status} — ${detail}`);
    throw new Error(`Token refresh failed: ${detail}`);
  }

  if (!body) {
    throw new Error('Token refresh failed: empty response');
  }

  return body as TokenResponse;
}
