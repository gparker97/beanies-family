/* global process, Buffer */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeForm,
  stripeRequest,
  findPriceByLookupKey,
  BillingUpstreamError,
  STRIPE_API_VERSION,
  __resetPriceCacheForTests,
} from '../stripeApi.mjs';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

describe('encodeForm', () => {
  it('flattens nested objects and arrays into bracket notation', () => {
    const s = encodeForm({
      ui_mode: 'embedded_page',
      line_items: [{ price: 'price_1', quantity: 1 }],
      metadata: { familyId: 'f-1' },
      subscription_data: { metadata: { familyId: 'f-1' }, billing_mode: { type: 'flexible' } },
      skip: null,
      also: undefined,
      flag: true,
    });
    assert.equal(
      s,
      'ui_mode=embedded_page&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5BfamilyId%5D=f-1&subscription_data%5Bmetadata%5D%5BfamilyId%5D=f-1&subscription_data%5Bbilling_mode%5D%5Btype%5D=flexible&flag=true'
    );
  });
  it('encodes a top-level array as key[i]', () => {
    assert.equal(encodeForm({ lookup_keys: ['a.b'] }), 'lookup_keys%5B0%5D=a.b');
  });
});

describe('stripeRequest', () => {
  const calls = [];
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    calls.length = 0;
    __resetPriceCacheForTests();
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('sends basic auth, the pinned version and a form body on POST', async () => {
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return ok({ id: 'cs_1' });
    };
    const r = await stripeRequest({
      method: 'POST',
      path: '/v1/checkout/sessions',
      params: { mode: 'subscription' },
      action: 'create_checkout_session',
      fetchImpl,
    });
    assert.equal(r.id, 'cs_1');
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, 'mode=subscription');
    assert.equal(calls[0].init.headers['Stripe-Version'], STRIPE_API_VERSION);
    assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(
      calls[0].init.headers.Authorization,
      `Basic ${Buffer.from('sk_test_x:').toString('base64')}`
    );
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  it('puts params in the query on GET', async () => {
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return ok({ data: [] });
    };
    await stripeRequest({
      method: 'GET',
      path: '/v1/prices',
      params: { lookup_keys: ['list.full.year.usd'], active: true },
      action: 'list_prices',
      fetchImpl,
    });
    assert.equal(
      calls[0].url,
      'https://api.stripe.com/v1/prices?lookup_keys%5B0%5D=list.full.year.usd&active=true'
    );
    assert.equal(calls[0].init.body, undefined);
  });

  it('maps a Stripe 4xx to BillingUpstreamError with its code', async () => {
    const fetchImpl = async () =>
      fail(400, { message: 'No such coupon', code: 'resource_missing' });
    await assert.rejects(
      stripeRequest({
        method: 'POST',
        path: '/v1/x',
        params: {},
        action: 'create_checkout_session',
        fetchImpl,
      }),
      (e) =>
        e instanceof BillingUpstreamError &&
        e.httpStatus === 400 &&
        e.stripeCode === 'resource_missing' &&
        e.action === 'create_checkout_session'
    );
  });

  it('maps a network failure and a timeout to httpStatus 0', async () => {
    await assert.rejects(
      stripeRequest({
        method: 'GET',
        path: '/v1/x',
        action: 'a',
        fetchImpl: async () => {
          throw new Error('ECONNRESET');
        },
      }),
      (e) => e instanceof BillingUpstreamError && e.httpStatus === 0 && e.detail === 'ECONNRESET'
    );
    const abort = new Error('x');
    abort.name = 'TimeoutError';
    await assert.rejects(
      stripeRequest({
        method: 'GET',
        path: '/v1/x',
        action: 'a',
        fetchImpl: async () => {
          throw abort;
        },
      }),
      (e) => e.httpStatus === 0 && e.detail === 'timeout'
    );
  });

  it('refuses with a config error when the key is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await assert.rejects(
      stripeRequest({ method: 'GET', path: '/v1/x', action: 'a', fetchImpl: async () => ok({}) }),
      (e) => e instanceof BillingUpstreamError && e.stripeCode === 'config'
    );
  });

  it('memoises a price lookup on a hit only', async () => {
    let n = 0;
    const miss = async () => {
      n += 1;
      return ok({ data: [] });
    };
    assert.equal(await findPriceByLookupKey('list.full.year.usd', { fetchImpl: miss }), null);
    assert.equal(await findPriceByLookupKey('list.full.year.usd', { fetchImpl: miss }), null);
    assert.equal(n, 2, 'a miss is re-checked');
    const hit = async () => {
      n += 1;
      return ok({ data: [{ id: 'price_1' }] });
    };
    assert.equal(
      (await findPriceByLookupKey('list.full.year.usd', { fetchImpl: hit })).id,
      'price_1'
    );
    assert.equal(
      (await findPriceByLookupKey('list.full.year.usd', { fetchImpl: hit })).id,
      'price_1'
    );
    assert.equal(n, 3, 'a hit is cached');
  });
});
