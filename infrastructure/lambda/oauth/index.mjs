/* global process */

/**
 * OAuth Token Exchange Lambda — stateless proxy for Authorization Code + PKCE.
 *
 * Keeps client_secret server-side while the SPA handles PKCE code_verifier.
 * Provider-agnostic design — start with Google, extensible to others later.
 *
 * Routes:
 *   POST /oauth/{provider}/token   — exchange auth code for tokens
 *   POST /oauth/{provider}/refresh — refresh an expired access token
 */

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Native apps (Capacitor) redirect to a fixed verified App Link / Universal
// Link — e.g. `https://beanies.family/oauth/native` — NOT `<origin>/oauth/callback`.
// The WebView origin (`https://localhost`) is not the redirect host, so the
// derivation below can't produce these. Allow them explicitly via the optional
// NATIVE_REDIRECT_URIS env (comma-separated). Unset ⇒ web-only, unchanged for
// self-hosters without a native app. See ADR-029.
const NATIVE_REDIRECT_URIS = (process.env.NATIVE_REDIRECT_URIS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Allowed redirect URIs: the per-origin `<origin>/oauth/callback` web convention
// (hardcoded route in src/router/ — one env var is the single source of truth so
// self-hosters never edit code) PLUS any explicit native App Link redirects.
const ALLOWED_REDIRECT_URIS = new Set([
  ...ALLOWED_ORIGINS.map((origin) => `${origin.replace(/\/+$/, '')}/oauth/callback`),
  ...NATIVE_REDIRECT_URIS,
]);

const SUPPORTED_PROVIDERS = ['google'];

function getHeaders(event) {
  const origin = event?.headers?.origin;
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(allowedOrigin && {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    }),
  };
}

function response(statusCode, body, event) {
  return { statusCode, headers: getHeaders(event), body: JSON.stringify(body) };
}

export async function handler(event) {
  const method = event.requestContext?.http?.method;
  const origin = event?.headers?.origin;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return response(204, '', event);
  }

  if (method !== 'POST') {
    return response(405, { error: 'Method not allowed' }, event);
  }

  // Defense-in-depth: reject browser POSTs from non-allowlisted origins.
  // Browser CORS only blocks the response read, not the request itself —
  // an attacker page could otherwise have the proxy execute a request
  // server-side. No Origin header (curl, server-to-server) is allowed.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return response(403, { error: 'forbidden_origin' }, event);
  }

  // Extract provider and action from path: /oauth/{provider}/{action}
  const rawPath = event.rawPath || '';
  const pathParts = rawPath.split('/').filter(Boolean);
  // Expected: ['oauth', '{provider}', '{action}']
  if (pathParts.length < 3 || pathParts[0] !== 'oauth') {
    return response(400, { error: 'Invalid path' }, event);
  }

  const provider = pathParts[1];
  const action = pathParts[2];

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return response(400, { error: `Unsupported provider: ${provider}` }, event);
  }

  if (!['token', 'refresh'].includes(action)) {
    return response(400, { error: `Unsupported action: ${action}` }, event);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Invalid JSON body' }, event);
  }

  try {
    if (action === 'token') {
      return await handleTokenExchange(body, event);
    }
    if (action === 'refresh') {
      return await handleTokenRefresh(body, event);
    }
  } catch (err) {
    console.error('OAuth proxy error:', err);
    return response(500, { error: 'Internal server error' }, event);
  }
}

/**
 * Exchange authorization code for tokens.
 * Adds client_secret to the request before forwarding to Google.
 */
async function handleTokenExchange(body, event) {
  const { code, code_verifier, redirect_uri, client_id } = body;

  if (!code) return response(400, { error: 'Missing required field: code' }, event);
  // `code_verifier` is OPTIONAL because THIS proxy is a confidential client
  // (adds `client_secret` below) — an intercepted code is useless without the
  // secret, so PKCE is defense-in-depth, not load-bearing, here. The iOS web
  // redirect omits it (its verifier can't survive WebKit bounce-tracking
  // storage clearing); native + legacy still send it. Do NOT relax any other
  // field — and if a public-client path is ever added, it MUST send + we MUST
  // require PKCE on that path. See ADR-026 amendment (2026-06-20).
  if (!redirect_uri) {
    return response(400, { error: 'Missing required field: redirect_uri' }, event);
  }
  if (!client_id) return response(400, { error: 'Missing required field: client_id' }, event);

  if (!ALLOWED_REDIRECT_URIS.has(redirect_uri)) {
    return response(400, { error: 'Invalid redirect_uri' }, event);
  }

  const params = new URLSearchParams({
    code,
    redirect_uri,
    client_id,
    // ALWAYS attached — "optional verifier" must never be misread as "optional secret".
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'authorization_code',
  });
  // Forward the PKCE verifier only when the client sent one.
  if (code_verifier) params.set('code_verifier', code_verifier);

  const googleRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const googleBody = await googleRes.json();

  if (!googleRes.ok) {
    return response(googleRes.status, googleBody, event);
  }

  return response(200, googleBody, event);
}

/**
 * Refresh an expired access token using a refresh token.
 */
async function handleTokenRefresh(body, event) {
  const { refresh_token, client_id } = body;

  if (!refresh_token)
    return response(400, { error: 'Missing required field: refresh_token' }, event);
  if (!client_id) return response(400, { error: 'Missing required field: client_id' }, event);

  const params = new URLSearchParams({
    refresh_token,
    client_id,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const googleRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const googleBody = await googleRes.json();

  if (!googleRes.ok) {
    return response(googleRes.status, googleBody, event);
  }

  return response(200, googleBody, event);
}
