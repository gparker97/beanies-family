/**
 * OAuth proxy client — calls the Lambda for Google OAuth code exchange and token refresh.
 *
 * Resolves the proxy base URL from a permissive resolver: prefers `VITE_OAUTH_PROXY_URL`
 * (the OAuth-specific var, used when self-hosters run their own OAuth Lambda separate
 * from a registry), falling back to `VITE_REGISTRY_API_URL` (the cloud convention,
 * where one Lambda backs both OAuth and the registry on the same API Gateway).
 *
 * Both env vars are first-class. Neither is deprecated — they exist for sustained
 * reasons: OAuth and the registry are semantically distinct services that *can* run
 * on the same host but don't *have* to. Cloud sets only `VITE_REGISTRY_API_URL`;
 * Path-B self-hosters typically set only `VITE_OAUTH_PROXY_URL`.
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

// Match features.ts ok() — empty/whitespace strings are treated as unset so a
// blank `VITE_OAUTH_PROXY_URL=` in .env.local correctly falls back to the
// registry URL instead of throwing.
const ok = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function getApiBaseUrl(): string {
  const proxy = import.meta.env.VITE_OAUTH_PROXY_URL;
  const registry = import.meta.env.VITE_REGISTRY_API_URL;
  if (ok(proxy)) return proxy;
  if (ok(registry)) return registry;
  throw new Error(
    'OAuth proxy not configured. Set VITE_OAUTH_PROXY_URL (preferred) or VITE_REGISTRY_API_URL in your .env.local. See docs/SELF_HOSTING.md.'
  );
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
