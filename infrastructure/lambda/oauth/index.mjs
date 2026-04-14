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
  .map((o) => o.trim());

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Allowed redirect URIs (prevent open-redirect attacks).
// Apex stays during the Phase A→C cutover for #167; remove ~30 days after
// the apex cutover ships and the Google OAuth Console apex URI is removed.
const ALLOWED_REDIRECT_URIS = [
  'https://beanies.family/oauth/callback',
  'https://app.beanies.family/oauth/callback',
  'http://localhost:5173/oauth/callback',
  'http://localhost:4173/oauth/callback',
];

const SUPPORTED_PROVIDERS = ['google'];

function getHeaders(event) {
  const origin = event?.headers?.origin || ALLOWED_ORIGINS[0];
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Content-Type': 'application/json',
    ...(allowedOrigin && {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }),
  };
}

function response(statusCode, body, event) {
  return { statusCode, headers: getHeaders(event), body: JSON.stringify(body) };
}

export async function handler(event) {
  const method = event.requestContext?.http?.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return response(204, '', event);
  }

  if (method !== 'POST') {
    return response(405, { error: 'Method not allowed' }, event);
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
  if (!code_verifier) {
    return response(400, { error: 'Missing required field: code_verifier' }, event);
  }
  if (!redirect_uri) {
    return response(400, { error: 'Missing required field: redirect_uri' }, event);
  }
  if (!client_id) return response(400, { error: 'Missing required field: client_id' }, event);

  if (!ALLOWED_REDIRECT_URIS.includes(redirect_uri)) {
    return response(400, { error: 'Invalid redirect_uri' }, event);
  }

  const params = new URLSearchParams({
    code,
    code_verifier,
    redirect_uri,
    client_id,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'authorization_code',
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
