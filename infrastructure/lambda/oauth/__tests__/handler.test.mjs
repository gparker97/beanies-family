/* global process */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Store original fetch
const originalFetch = globalThis.fetch;

// Helper to build API Gateway v2 event
function makeEvent({
  method = 'POST',
  path = '/oauth/google/token',
  body = {},
  origin = 'https://beanies.family',
} = {}) {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: { origin },
    body: JSON.stringify(body),
  };
}

function parseResponse(result) {
  return {
    ...result,
    parsedBody: typeof result.body === 'string' ? JSON.parse(result.body) : result.body,
  };
}

describe('OAuth Lambda handler', () => {
  let handler;

  beforeEach(async () => {
    // Set env vars before importing
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.CORS_ORIGIN = 'https://beanies.family,http://localhost:5173';

    // Fresh import each test (dynamic import with cache bust)
    const mod = await import(`../index.mjs?t=${Date.now()}-${Math.random()}`);
    handler = mod.handler;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.CORS_ORIGIN;
  });

  describe('method validation', () => {
    it('returns 405 for GET requests', async () => {
      const event = makeEvent({ method: 'GET' });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 405);
      assert.equal(res.parsedBody.error, 'Method not allowed');
    });

    it('returns 204 for OPTIONS preflight', async () => {
      const event = makeEvent({ method: 'OPTIONS' });
      const res = await handler(event);
      assert.equal(res.statusCode, 204);
    });
  });

  describe('provider validation', () => {
    it('returns 400 for unsupported provider', async () => {
      const event = makeEvent({ path: '/oauth/dropbox/token' });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /Unsupported provider/);
    });

    it('returns 400 for unsupported action', async () => {
      const event = makeEvent({ path: '/oauth/google/revoke' });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /Unsupported action/);
    });

    it('returns 400 for invalid path', async () => {
      const event = makeEvent({ path: '/invalid' });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
    });
  });

  describe('POST /oauth/google/token', () => {
    it('returns 400 when code is missing', async () => {
      const event = makeEvent({
        body: {
          code_verifier: 'v',
          redirect_uri: 'https://beanies.family/oauth/callback',
          client_id: 'cid',
        },
      });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /code/);
    });

    it('returns 400 when code_verifier is missing', async () => {
      const event = makeEvent({
        body: {
          code: 'c',
          redirect_uri: 'https://beanies.family/oauth/callback',
          client_id: 'cid',
        },
      });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /code_verifier/);
    });

    it('returns 400 when redirect_uri is missing', async () => {
      const event = makeEvent({
        body: { code: 'c', code_verifier: 'v', client_id: 'cid' },
      });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /redirect_uri/);
    });

    it('returns 400 when client_id is missing', async () => {
      const event = makeEvent({
        body: {
          code: 'c',
          code_verifier: 'v',
          redirect_uri: 'https://beanies.family/oauth/callback',
        },
      });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /client_id/);
    });

    it('returns 400 for disallowed redirect_uri', async () => {
      const event = makeEvent({
        body: {
          code: 'c',
          code_verifier: 'v',
          redirect_uri: 'https://evil.com/callback',
          client_id: 'cid',
        },
      });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /redirect_uri/);
    });

    it('exchanges code for tokens via Google', async () => {
      const mockTokenResponse = {
        access_token: 'ya29.access',
        refresh_token: '1//refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'drive.file userinfo.email',
      };

      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => mockTokenResponse,
      }));

      const event = makeEvent({
        body: {
          code: 'auth-code-123',
          code_verifier: 'verifier-abc',
          redirect_uri: 'https://beanies.family/oauth/callback',
          client_id: 'my-client-id',
        },
      });

      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.access_token, 'ya29.access');
      assert.equal(res.parsedBody.refresh_token, '1//refresh');

      // Verify fetch was called with correct params
      const fetchCall = globalThis.fetch.mock.calls[0];
      assert.equal(fetchCall.arguments[0], 'https://oauth2.googleapis.com/token');
      const fetchBody = fetchCall.arguments[1].body;
      assert.ok(fetchBody.includes('client_secret=test-secret'));
      assert.ok(fetchBody.includes('code=auth-code-123'));
      assert.ok(fetchBody.includes('code_verifier=verifier-abc'));
      assert.ok(fetchBody.includes('grant_type=authorization_code'));
    });

    it('forwards Google error responses', async () => {
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'Code expired' }),
      }));

      const event = makeEvent({
        body: {
          code: 'expired-code',
          code_verifier: 'v',
          redirect_uri: 'https://beanies.family/oauth/callback',
          client_id: 'cid',
        },
      });

      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.equal(res.parsedBody.error, 'invalid_grant');
    });
  });

  describe('POST /oauth/google/refresh', () => {
    it('returns 400 when refresh_token is missing', async () => {
      const event = makeEvent({
        path: '/oauth/google/refresh',
        body: { client_id: 'cid' },
      });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /refresh_token/);
    });

    it('returns 400 when client_id is missing', async () => {
      const event = makeEvent({
        path: '/oauth/google/refresh',
        body: { refresh_token: 'rt' },
      });
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /client_id/);
    });

    it('refreshes access token via Google', async () => {
      const mockRefreshResponse = {
        access_token: 'ya29.new-access',
        expires_in: 3600,
        token_type: 'Bearer',
      };

      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => mockRefreshResponse,
      }));

      const event = makeEvent({
        path: '/oauth/google/refresh',
        body: {
          refresh_token: '1//my-refresh-token',
          client_id: 'my-client-id',
        },
      });

      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.access_token, 'ya29.new-access');

      // Verify fetch was called correctly
      const fetchCall = globalThis.fetch.mock.calls[0];
      const fetchBody = fetchCall.arguments[1].body;
      assert.ok(fetchBody.includes('grant_type=refresh_token'));
      assert.ok(fetchBody.includes('client_secret=test-secret'));
      assert.ok(fetchBody.includes('refresh_token=1%2F%2Fmy-refresh-token'));
    });

    it('forwards Google error on invalid refresh token', async () => {
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'Token revoked' }),
      }));

      const event = makeEvent({
        path: '/oauth/google/refresh',
        body: { refresh_token: 'revoked-token', client_id: 'cid' },
      });

      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.equal(res.parsedBody.error, 'invalid_grant');
    });
  });

  describe('CORS', () => {
    it('sets correct CORS headers for allowed origin', async () => {
      const event = makeEvent({ method: 'OPTIONS', origin: 'https://beanies.family' });
      const res = await handler(event);
      assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://beanies.family');
      assert.ok(res.headers['Access-Control-Allow-Methods'].includes('POST'));
    });

    it('sets correct CORS headers for localhost', async () => {
      const event = makeEvent({ method: 'OPTIONS', origin: 'http://localhost:5173' });
      const res = await handler(event);
      assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
    });

    it('omits CORS headers for disallowed origin', async () => {
      const event = makeEvent({ method: 'OPTIONS', origin: 'https://evil.com' });
      const res = await handler(event);
      assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
    });
  });

  describe('error handling', () => {
    it('returns 400 for invalid JSON body', async () => {
      const event = {
        rawPath: '/oauth/google/token',
        requestContext: { http: { method: 'POST' } },
        headers: { origin: 'https://beanies.family' },
        body: 'not-json',
      };
      const res = parseResponse(await handler(event));
      assert.equal(res.statusCode, 400);
      assert.match(res.parsedBody.error, /Invalid JSON/);
    });
  });
});
