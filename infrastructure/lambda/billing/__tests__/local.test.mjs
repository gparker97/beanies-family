import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toLambdaEvent, writeLambdaResult, applyLocalEnv, startLocalServer } from '../local.mjs';

describe('local harness', () => {
  it('translates method, path, query, headers and body into an HTTP API v2 event', () => {
    const ev = toLambdaEvent({
      method: 'post',
      url: '/billing/claim?x=1',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1,v1=a',
        arr: ['a', 'b'],
      },
      body: '{"familyId":"f"}',
    });
    assert.equal(ev.requestContext.http.method, 'POST');
    assert.equal(ev.requestContext.http.path, '/billing/claim');
    assert.equal(ev.rawPath, '/billing/claim');
    assert.equal(ev.rawQueryString, 'x=1');
    assert.deepEqual(ev.queryStringParameters, { x: '1' });
    assert.equal(ev.headers['content-type'], 'application/json');
    assert.equal(ev.headers['stripe-signature'], 't=1,v1=a');
    assert.equal(ev.headers.arr, 'a, b');
    assert.equal(ev.body, '{"familyId":"f"}');
    assert.equal(ev.isBase64Encoded, false);
  });

  it('writes a Lambda result back as status, headers and body', () => {
    const out = {};
    const res = {
      writeHead: (s, h) => {
        out.status = s;
        out.headers = h;
      },
      end: (b) => {
        out.body = b;
      },
    };
    writeLambdaResult(res, {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: '{"code":"x"}',
    });
    assert.deepEqual(out, {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
      body: '{"code":"x"}',
    });
  });

  it('maps the TF env names', () => {
    const env = applyLocalEnv({
      TF_VAR_stripe_secret_key: 'sk_test_1',
      TF_VAR_registry_api_key: 'k',
    });
    assert.equal(env.STRIPE_SECRET_KEY, 'sk_test_1');
    assert.equal(env.BILLING_API_KEY, 'k');
    assert.equal(env.STRIPE_PRE_V1_COUPON, 'PRE_V1_50');
    assert.equal(env.BILLING_TABLE_NAME, '', 'never the prod billing table by default');
    assert.equal(env.BILLING_LOCAL, '1');
  });

  it('round-trips a request through an injected handler over real HTTP', async () => {
    let seen;
    const server = await startLocalServer({
      port: 0,
      handler: async (ev) => {
        seen = ev;
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: ev.requestContext.http.path }),
        };
      },
    });
    const { port } = server.address();
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- loopback, test-only
    const res = await fetch(`http://127.0.0.1:${port}/billing/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=x' },
      body: 'raw',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { path: '/billing/webhook' });
    assert.equal(seen.body, 'raw');
    assert.equal(seen.headers['stripe-signature'], 't=1,v1=x');
    await new Promise((r) => server.close(r));
  });
});
