/* global process, Buffer */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handler as rawHandler, parseLookupKey, subscriptionAttrs, ROUTES } from '../index.mjs';
import { __setDdbClientForTests } from '../ddb.mjs';

// The handler takes ONE argument (the runtime passes `context` second); DynamoDB is injected
// through the module seam, exactly as prod resolves it.
const handler = (event, ddb) => {
  __setDdbClientForTests(ddb ?? null);
  return rawHandler(event);
};
import { computeSignature } from '../webhookSignature.mjs';
import { __resetPriceCacheForTests, STRIPE_API_VERSION } from '../stripeApi.mjs';

const API_KEY = 'reg-key';
const FAMILY = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const BILLING = 'billing-table';
const REGISTRY = 'registry-table';
const REGISTRY_DEV = 'registry-dev-table';
const WHSEC = 'whsec_test';
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalError = console.error;

// ── A tiny DynamoDB double: two tables of unmarshalled rows, UpdateItem SET applied ───────────
class GetItemCommand {
  constructor(input) {
    this.kind = 'get';
    this.input = input;
  }
}
class UpdateItemCommand {
  constructor(input) {
    this.kind = 'update';
    this.input = input;
  }
}
function fakeDdb({ registry = {}, registryDev = {}, billing = {}, updateThrows = null } = {}) {
  const tables = { [REGISTRY]: registry, [REGISTRY_DEV]: registryDev, [BILLING]: billing };
  const calls = [];
  const marshal = (row) =>
    row &&
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === 'number' ? { N: String(v) } : { S: String(v) },
      ])
    );
  return {
    calls,
    tables,
    ddb: {
      commands: { GetItemCommand, UpdateItemCommand },
      async send(cmd) {
        calls.push(cmd);
        const table = tables[cmd.input.TableName];
        const id = cmd.input.Key.familyId.S;
        if (cmd.kind === 'get') return { Item: marshal(table?.[id]) };
        if (updateThrows) throw updateThrows;
        assert.match(
          cmd.input.UpdateExpression,
          /^SET |^REMOVE /,
          'every write is an UpdateItem SET/REMOVE'
        );
        // The one condition this Lambda uses: the atomic token mint.
        if (
          cmd.input.ConditionExpression &&
          table[id]?.tokenClaimedAt &&
          table[id]?.claimedSubscriptionId ===
            cmd.input.ExpressionAttributeValues[':claimedSubscriptionId']?.S
        ) {
          const e = new Error('The conditional request failed');
          e.name = 'ConditionalCheckFailedException';
          throw e;
        }
        const row = (table[id] ??= { familyId: id });
        const removed = new Set(
          (cmd.input.UpdateExpression.match(/REMOVE ([^]*)$/)?.[1] ?? '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        );
        for (const [alias, name] of Object.entries(cmd.input.ExpressionAttributeNames)) {
          if (removed.has(alias)) {
            delete row[name];
            continue;
          }
          const v = cmd.input.ExpressionAttributeValues?.[`:${alias.slice(1)}`];
          if (!v) continue; // a name used only by the condition expression
          row[name] = 'N' in v ? Number(v.N) : v.S;
        }
        return {};
      },
    },
  };
}

// ── Stripe fetch double keyed by method+path prefix ─────────────────────────
function fakeStripe(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({
      method: init.method,
      path: u.pathname,
      query: u.search,
      body: init.body,
      headers: init.headers,
    });
    for (const [key, respond] of Object.entries(routes)) {
      const [m, p] = key.split(' ');
      if (init.method === m && u.pathname.startsWith(p)) {
        const r = typeof respond === 'function' ? respond({ url: u, init }) : respond;
        if (r instanceof Error) throw r;
        // `{ status: <number>, body }` is an HTTP envelope; anything else is a 200 JSON body
        // (a subscription object has its own string `status`, hence the typeof check).
        const wrapped = r && typeof r === 'object' && typeof r.status === 'number' && 'body' in r;
        const status = wrapped ? r.status : 200;
        return { ok: status < 300, status, json: async () => (wrapped ? r.body : r) };
      }
    }
    // The session-metadata stamp is a bookkeeping call every checkout makes; fakes that do not
    // care about it get a plain 200.
    if (init.method === 'POST' && /^\/v1\/checkout\/sessions\/cs_/.test(u.pathname)) {
      return { ok: true, status: 200, json: async () => ({ id: 'cs_stamped' }) };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { message: `no fake for ${init.method} ${u.pathname}` } }),
    };
  };
  return calls;
}

const evt = ({
  path,
  body,
  headers = {},
  method = 'POST',
  origin = 'https://app.beanies.family',
  base64 = false,
}) => ({
  requestContext: { http: { method, path } },
  headers: { origin, ...headers },
  body: body === undefined ? '{}' : typeof body === 'string' ? body : JSON.stringify(body),
  isBase64Encoded: base64,
});
const keyed = { 'x-api-key': API_KEY };
const json = (res) => JSON.parse(res.body);

const SUB = (over = {}) => ({
  id: 'sub_1',
  status: 'active',
  customer: 'cus_1',
  metadata: { familyId: FAMILY },
  cancel_at_period_end: false,
  cancel_at: null,
  items: {
    data: [
      {
        current_period_end: 1_900_000_000,
        price: { id: 'price_1', lookup_key: 'list.full.year.usd' },
      },
    ],
  },
  ...over,
});

let logs;
describe('billing Lambda handler', () => {
  beforeEach(() => {
    process.env.BILLING_API_KEY = API_KEY;
    process.env.BILLING_TABLE_NAME = BILLING;
    process.env.REGISTRY_TABLE_NAME = REGISTRY;
    process.env.REGISTRY_DEV_TABLE_NAME = REGISTRY_DEV;
    process.env.STRIPE_SECRET_KEY = 'sk_test_1';
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRE_V1_COUPON = 'PRE_V1_50';
    process.env.CORS_ORIGINS = 'https://app.beanies.family,https://beanies.family';
    delete process.env.DEV_ORIGINS;
    logs = [];
    console.log = (...a) => logs.push(a.map(String).join(' '));
    console.error = () => {};
    __resetPriceCacheForTests();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    for (const k of [
      'BILLING_API_KEY',
      'BILLING_TABLE_NAME',
      'REGISTRY_TABLE_NAME',
      'REGISTRY_DEV_TABLE_NAME',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRE_V1_COUPON',
      'CORS_ORIGINS',
      'DEV_ORIGINS',
    ])
      delete process.env[k];
  });
  const decisions = (msg) =>
    logs
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l))
      .filter((l) => l.msg === msg);

  describe('plumbing', () => {
    it('answers OPTIONS 204 and non-POST 405', async () => {
      assert.equal((await handler(evt({ path: ROUTES.claim, method: 'OPTIONS' }))).statusCode, 204);
      assert.equal((await handler(evt({ path: ROUTES.claim, method: 'GET' }))).statusCode, 405);
    });
    it('refuses the three client routes without the key, and fails closed when the key is unset', async () => {
      for (const path of [ROUTES.checkout, ROUTES.claim, ROUTES.portal]) {
        assert.equal((await handler(evt({ path, body: {} }))).statusCode, 401, path);
      }
      delete process.env.BILLING_API_KEY;
      assert.equal((await handler(evt({ path: ROUTES.claim, headers: keyed }))).statusCode, 401);
    });
    it('404s an unknown path and 400s bad JSON', async () => {
      assert.equal((await handler(evt({ path: '/billing/nope', headers: keyed }))).statusCode, 404);
      assert.equal(
        (await handler(evt({ path: ROUTES.claim, headers: keyed, body: '{' }))).statusCode,
        400
      );
    });
    it('echoes an allowed origin and falls back to the first for others', async () => {
      const a = await handler(
        evt({ path: ROUTES.claim, method: 'OPTIONS', origin: 'https://beanies.family' })
      );
      assert.equal(a.headers['Access-Control-Allow-Origin'], 'https://beanies.family');
      const b = await handler(
        evt({ path: ROUTES.claim, method: 'OPTIONS', origin: 'https://evil.example' })
      );
      assert.equal(b.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
    });
  });

  describe('POST /billing/checkout-session', () => {
    const good = { familyId: FAMILY, plan: 'full', interval: 'year', currency: 'usd' };
    it('validates the body vocabulary and basic-is-yearly', async () => {
      const { ddb } = fakeDdb();
      for (const bad of [
        { ...good, plan: 'gold' },
        { ...good, interval: 'week' },
        { ...good, currency: 'eur' },
        { ...good, familyId: 'x' },
        { ...good, plan: 'basic', interval: 'month' },
      ]) {
        const r = await handler(evt({ path: ROUTES.checkout, headers: keyed, body: bad }), ddb);
        assert.equal(r.statusCode, 400, JSON.stringify(bad));
      }
    });
    it('refuses a dev origin ONLY with a live key; a sandbox key lets localhost check out against the DEV registry', async () => {
      // Sandbox key (the default in beforeEach): localhost is allowed and the family is looked up
      // in the dev registry table, where localhost families register.
      const t = fakeDdb({
        registryDev: { [FAMILY]: { familyId: FAMILY, ownerEmail: 'dev@x.test' } },
      });
      const calls = fakeStripe({
        'GET /v1/prices': { data: [{ id: 'price_1' }] },
        'POST /v1/checkout/sessions': { id: 'cs_1', client_secret: 'cs_1_secret_abc' },
      });
      const r = await handler(
        evt({ path: ROUTES.checkout, headers: keyed, body: good, origin: 'http://localhost:5173' }),
        t.ddb
      );
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(
        new URLSearchParams(calls.find((c) => c.path === '/v1/checkout/sessions').body).get(
          'customer_email'
        ),
        'dev@x.test'
      );

      // Live key: refused before any lookup.
      process.env.STRIPE_SECRET_KEY = 'sk_live_1';
      const live = await handler(
        evt({ path: ROUTES.checkout, headers: keyed, body: good, origin: 'http://localhost:5173' }),
        t.ddb
      );
      assert.equal(live.statusCode, 403);
      assert.equal(json(live).code, 'dev_origin');
      assert.equal(decisions('checkout_refused')[0].reason, 'dev_origin');
      // A restricted live key is a live key too.
      process.env.STRIPE_SECRET_KEY = 'rk_live_1';
      const rk = await handler(
        evt({ path: ROUTES.checkout, headers: keyed, body: good, origin: 'http://localhost:5173' }),
        t.ddb
      );
      assert.equal(json(rk).code, 'dev_origin');
    });
    it('404s an unknown or tombstoned family and 409s an already-subscribed one', async () => {
      const t = fakeDdb({ registry: { [FAMILY]: { familyId: FAMILY, deletedAt: '2026-01-01' } } });
      assert.equal(
        (await handler(evt({ path: ROUTES.checkout, headers: keyed, body: good }), t.ddb))
          .statusCode,
        404
      );
      const s = fakeDdb({
        registry: { [FAMILY]: { familyId: FAMILY } },
        billing: { [FAMILY]: { familyId: FAMILY, status: 'past_due' } },
      });
      const r = await handler(evt({ path: ROUTES.checkout, headers: keyed, body: good }), s.ddb);
      assert.equal(r.statusCode, 409);
      assert.equal(json(r).code, 'already_subscribed');
    });
    it('creates an embedded_page session with the list price, family metadata and customer_email', async () => {
      const t = fakeDdb({ registry: { [FAMILY]: { familyId: FAMILY, ownerEmail: 'o@x.test' } } });
      const calls = fakeStripe({
        'GET /v1/prices': ({ url }) => {
          assert.equal(url.searchParams.get('lookup_keys[0]'), 'list.full.year.usd');
          return { data: [{ id: 'price_list' }] };
        },
        'POST /v1/checkout/sessions/': ({ init }) => {
          const p = new URLSearchParams(init.body);
          assert.equal(
            p.get('metadata[secretHash]'),
            sha('cs_1_secret_abc'),
            'the claim proof is stamped on the session'
          );
          assert.equal(p.get('metadata[familyId]'), FAMILY);
          return { id: 'cs_1' };
        },
        'POST /v1/checkout/sessions': { id: 'cs_1', client_secret: 'cs_1_secret_abc' },
      });
      const r = await handler(
        evt({ path: ROUTES.checkout, headers: keyed, body: { ...good, theme: 'dark' } }),
        t.ddb
      );
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual(json(r), { sessionId: 'cs_1', clientSecret: 'cs_1_secret_abc' });
      const create = calls.find((c) => c.path === '/v1/checkout/sessions');
      const p = new URLSearchParams(create.body);
      assert.equal(p.get('ui_mode'), 'embedded_page');
      assert.equal(p.get('redirect_on_completion'), 'never');
      assert.equal(p.get('mode'), 'subscription');
      assert.equal(p.get('client_reference_id'), FAMILY);
      assert.equal(p.get('line_items[0][price]'), 'price_list');
      assert.equal(p.get('line_items[0][quantity]'), '1');
      assert.equal(p.get('metadata[familyId]'), FAMILY);
      assert.equal(p.get('subscription_data[metadata][familyId]'), FAMILY);
      assert.equal(p.get('subscription_data[billing_mode][type]'), 'flexible');
      assert.equal(p.get('customer_email'), 'o@x.test');
      assert.equal(p.get('customer'), null);
      assert.equal(p.get('discounts[0][coupon]'), null);
      assert.equal(p.get('branding_settings[background_color]'), '#1e2a36');
      assert.equal(p.get('return_url'), null);
      assert.equal(create.headers['Stripe-Version'], STRIPE_API_VERSION);
      const d = decisions('checkout_session_created')[0];
      assert.equal(d.family_id_hash, sha(FAMILY));
      assert.equal(d.cohort, null);
      assert.equal(d.theme, 'dark');
    });
    it('pre_v1 adds the coupon; first_ten uses its own lookup key; an existing customer is reused', async () => {
      const t = fakeDdb({
        registry: {
          [FAMILY]: { familyId: FAMILY, ownerEmail: 'o@x.test' },
          [OTHER]: { familyId: OTHER },
        },
        billing: {
          [FAMILY]: {
            familyId: FAMILY,
            cohort: 'pre_v1',
            stripeCustomerId: 'cus_9',
            status: 'canceled',
          },
          [OTHER]: { familyId: OTHER, cohort: 'first_ten' },
        },
      });
      const keys = [];
      const calls = fakeStripe({
        'GET /v1/prices': ({ url }) => {
          keys.push(url.searchParams.get('lookup_keys[0]'));
          return { data: [{ id: `price_${keys.length}` }] };
        },
        'POST /v1/checkout/sessions': { id: 'cs_2', client_secret: 's' },
      });
      const r1 = await handler(
        evt({ path: ROUTES.checkout, headers: keyed, body: { ...good, plan: 'basic' } }),
        t.ddb
      );
      assert.equal(r1.statusCode, 200, r1.body);
      let p = new URLSearchParams(
        calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1).body
      );
      assert.equal(p.get('discounts[0][coupon]'), 'PRE_V1_50');
      assert.equal(p.get('customer'), 'cus_9');
      assert.equal(p.get('customer_email'), null);
      assert.equal(keys[0], 'pre_v1.basic.year.usd');

      const r2 = await handler(
        evt({
          path: ROUTES.checkout,
          headers: keyed,
          body: { ...good, familyId: OTHER, interval: 'month', currency: 'sgd' },
        }),
        t.ddb
      );
      assert.equal(r2.statusCode, 200, r2.body);
      p = new URLSearchParams(calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1).body);
      assert.equal(p.get('discounts[0][coupon]'), null);
      assert.equal(keys[1], 'first_ten.full.month.sgd');
    });
    it('a missing Price is 502 price_missing with the key in the log; a missing coupon is 502 coupon_unset', async () => {
      const t = fakeDdb({
        registry: { [FAMILY]: { familyId: FAMILY } },
        billing: { [FAMILY]: { familyId: FAMILY, cohort: 'pre_v1' } },
      });
      fakeStripe({ 'GET /v1/prices': { data: [] } });
      const r = await handler(evt({ path: ROUTES.checkout, headers: keyed, body: good }), t.ddb);
      assert.equal(r.statusCode, 502);
      assert.equal(json(r).code, 'price_missing');
      assert.equal(decisions('checkout_refused')[0].reason, 'price_missing');
      __resetPriceCacheForTests();
      fakeStripe({ 'GET /v1/prices': { data: [{ id: 'p' }] } });
      delete process.env.STRIPE_PRE_V1_COUPON;
      const r2 = await handler(evt({ path: ROUTES.checkout, headers: keyed, body: good }), t.ddb);
      assert.equal(json(r2).code, 'coupon_unset');
    });
    it('a Stripe failure is 502 billing_upstream and logs the action', async () => {
      const t = fakeDdb({ registry: { [FAMILY]: { familyId: FAMILY } } });
      fakeStripe({ 'GET /v1/prices': { status: 500, body: { error: { message: 'boom' } } } });
      const r = await handler(evt({ path: ROUTES.checkout, headers: keyed, body: good }), t.ddb);
      assert.equal(r.statusCode, 502);
      assert.equal(json(r).code, 'billing_upstream');
      const d = decisions('billing_upstream_error')[0];
      assert.equal(d.action, 'list_prices');
      assert.equal(d.http_status, 500);
    });
    it('a store failure is 500 billing_store, never a raw error', async () => {
      const ddb = {
        commands: { GetItemCommand, UpdateItemCommand },
        send: async () => {
          throw new Error('ddb down');
        },
      };
      const r = await handler(evt({ path: ROUTES.checkout, headers: keyed, body: good }), ddb);
      assert.equal(r.statusCode, 500);
      assert.equal(json(r).code, 'billing_store');
    });
  });

  describe('POST /billing/claim', () => {
    const body = { familyId: FAMILY, sessionId: 'cs_1', clientSecret: 'cs_1_secret_abc' };
    const session = (over = {}) => ({
      id: 'cs_1',
      client_secret: 'cs_1_secret_abc',
      client_reference_id: FAMILY,
      status: 'complete',
      subscription: 'sub_1',
      customer: 'cus_1',
      ...over,
    });

    it('validates the body', async () => {
      const { ddb } = fakeDdb();
      for (const bad of [
        { ...body, sessionId: 'evil' },
        { ...body, clientSecret: '' },
        { ...body, familyId: 'x' },
      ]) {
        assert.equal(
          (await handler(evt({ path: ROUTES.claim, headers: keyed, body: bad }), ddb)).statusCode,
          400
        );
      }
    });
    it('refuses a foreign session (secret or family mismatch) with 403 mismatch and touches nothing', async () => {
      const t = fakeDdb();
      fakeStripe({ 'GET /v1/checkout/sessions/': session({ client_reference_id: OTHER }) });
      const r = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.equal(r.statusCode, 403);
      assert.equal(json(r).code, 'mismatch');
      fakeStripe({ 'GET /v1/checkout/sessions/': session({ client_secret: 'cs_1_secret_zzz' }) });
      assert.equal(
        (await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb)).statusCode,
        403
      );
      assert.equal(
        t.calls.filter((c) => c.kind === 'update').length,
        0,
        'a refused claim writes nothing'
      );
    });
    it('accepts a completed session that no longer echoes client_secret when the secret hashes to the one stamped on it', async () => {
      const t = fakeDdb();
      fakeStripe({
        'GET /v1/checkout/sessions/': session({
          client_secret: null,
          metadata: { familyId: FAMILY, secretHash: sha('cs_1_secret_abc') },
        }),
        'GET /v1/subscriptions/': SUB(),
      });
      const r = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.equal(r.statusCode, 200, r.body);
      assert.ok(json(r).planToken);
      const bad = await handler(
        evt({
          path: ROUTES.claim,
          headers: keyed,
          body: { ...body, clientSecret: 'cs_other_secret_x' },
        }),
        t.ddb
      );
      assert.equal(bad.statusCode, 403, 'a secret that is not the one we issued is refused');
      const noHash = fakeDdb();
      fakeStripe({ 'GET /v1/checkout/sessions/': session({ client_secret: null }) });
      const r2 = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), noHash.ddb);
      assert.equal(r2.statusCode, 403, 'a session id alone (no stamped hash) cannot claim');
    });

    it('an unknown session id is 403 mismatch, not a Stripe outage', async () => {
      const t = fakeDdb();
      fakeStripe({
        'GET /v1/checkout/sessions/': {
          status: 404,
          body: { error: { message: 'No such checkout.session', code: 'resource_missing' } },
        },
      });
      const r = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.equal(r.statusCode, 403);
      assert.equal(json(r).code, 'mismatch');
      assert.equal(decisions('claim_refused')[0].reason, 'unknown_session');
      assert.equal(decisions('billing_upstream_error').length, 0);
    });

    it('a family that subscribes again after a lapse gets a fresh token for the new subscription', async () => {
      const t = fakeDdb({
        billing: {
          [FAMILY]: {
            familyId: FAMILY,
            planTokenHash: 'old',
            tokenClaimedAt: '2026-01-01T00:00:00Z',
            claimedSubscriptionId: 'sub_old',
            status: 'canceled',
          },
        },
      });
      fakeStripe({ 'GET /v1/checkout/sessions/': session(), 'GET /v1/subscriptions/': SUB() });
      const r = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.equal(r.statusCode, 200, r.body);
      assert.ok(json(r).planToken, 'a new subscription mints again');
      assert.equal(t.tables[BILLING][FAMILY].claimedSubscriptionId, 'sub_1');
      assert.notEqual(t.tables[BILLING][FAMILY].planTokenHash, 'old');
    });

    it('two concurrent claims mint exactly one token (atomic compare-and-set)', async () => {
      const t = fakeDdb();
      fakeStripe({ 'GET /v1/checkout/sessions/': session(), 'GET /v1/subscriptions/': SUB() });
      const [a, b] = await Promise.all([
        handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb),
        handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb),
      ]);
      const tokens = [json(a).planToken, json(b).planToken].filter(Boolean);
      assert.equal(tokens.length, 1, 'exactly one of the two gets a token');
      assert.equal(
        t.tables[BILLING][FAMILY].planTokenHash,
        sha(tokens[0]),
        'and it is the one on the row'
      );
    });

    it('409s an incomplete session', async () => {
      const t = fakeDdb();
      fakeStripe({ 'GET /v1/checkout/sessions/': session({ status: 'open' }) });
      const r = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.equal(r.statusCode, 409);
      assert.equal(json(r).code, 'not_complete');
    });
    it('lands the subscription, issues the token once, stores only its hash, and preserves the cohort', async () => {
      const t = fakeDdb({
        billing: {
          [FAMILY]: { familyId: FAMILY, cohort: 'pre_v1', trialEndsAt: '2026-12-01T00:00:00Z' },
        },
      });
      fakeStripe({ 'GET /v1/checkout/sessions/': session(), 'GET /v1/subscriptions/': SUB() });
      const r = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.equal(r.statusCode, 200, r.body);
      const { planToken } = json(r);
      assert.match(planToken, /^[A-Za-z0-9_-]{43}$/);
      const row = t.tables[BILLING][FAMILY];
      assert.equal(row.planTokenHash, sha(planToken));
      assert.ok(row.tokenClaimedAt);
      assert.equal(row.cohort, 'pre_v1', 'the script’s attributes survive');
      assert.equal(row.trialEndsAt, '2026-12-01T00:00:00Z');
      assert.equal(row.status, 'active');
      assert.equal(row.plan, 'full');
      assert.equal(row.interval, 'year');
      assert.equal(row.currency, 'usd');
      assert.equal(row.stripeCustomerId, 'cus_1');
      assert.equal(row.stripeSubscriptionId, 'sub_1');
      assert.equal(row.currentPeriodEnd, '2030-03-17T17:46:40.000Z');
      assert.equal(decisions('claim_ok')[0].detail, 'token_issued');
      assert.ok(!logs.some((l) => l.includes(planToken)), 'the token is never logged');

      const again = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.deepEqual(json(again), {});
      assert.equal(
        t.tables[BILLING][FAMILY].planTokenHash,
        sha(planToken),
        'a second claim does not rotate the token'
      );
      assert.equal(decisions('claim_ok')[1].detail, 'already_claimed');
    });
    it('a store failure after payment is 500 with the claim_failed line', async () => {
      const t = fakeDdb({ updateThrows: new Error('ddb') });
      fakeStripe({ 'GET /v1/checkout/sessions/': session(), 'GET /v1/subscriptions/': SUB() });
      const r = await handler(evt({ path: ROUTES.claim, headers: keyed, body }), t.ddb);
      assert.equal(r.statusCode, 500);
      assert.equal(decisions('claim_failed').length, 1);
    });
  });

  describe('POST /billing/portal-session', () => {
    const token = 'A'.repeat(43);
    it('refuses a bad or missing token with 403, and a family with no customer with 409', async () => {
      const t = fakeDdb({ billing: { [FAMILY]: { familyId: FAMILY, planTokenHash: sha(token) } } });
      let r = await handler(
        evt({
          path: ROUTES.portal,
          headers: keyed,
          body: { familyId: FAMILY, planToken: 'B'.repeat(43) },
        }),
        t.ddb
      );
      assert.equal(r.statusCode, 403);
      assert.equal(json(r).code, 'bad_token');
      r = await handler(
        evt({ path: ROUTES.portal, headers: keyed, body: { familyId: OTHER, planToken: token } }),
        t.ddb
      );
      assert.equal(r.statusCode, 403, 'a forged familyId cannot open another family’s portal');
      r = await handler(
        evt({ path: ROUTES.portal, headers: keyed, body: { familyId: FAMILY, planToken: token } }),
        t.ddb
      );
      assert.equal(r.statusCode, 409);
      assert.equal(json(r).code, 'no_customer');
      assert.equal(
        (
          await handler(
            evt({
              path: ROUTES.portal,
              headers: keyed,
              body: { familyId: FAMILY, planToken: 'short' },
            }),
            t.ddb
          )
        ).statusCode,
        400
      );
    });
    it('creates a portal session for the customer with a return_url on the calling origin', async () => {
      const t = fakeDdb({
        billing: {
          [FAMILY]: { familyId: FAMILY, planTokenHash: sha(token), stripeCustomerId: 'cus_1' },
        },
      });
      const calls = fakeStripe({
        'POST /v1/billing_portal/sessions': {
          url: 'https://billing.stripe.com/p/session?secret=x',
        },
      });
      const r = await handler(
        evt({
          path: ROUTES.portal,
          headers: keyed,
          body: { familyId: FAMILY, planToken: token },
          origin: 'https://beanies.family',
        }),
        t.ddb
      );
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(json(r).url, 'https://billing.stripe.com/p/session?secret=x');
      const p = new URLSearchParams(calls[0].body);
      assert.equal(p.get('customer'), 'cus_1');
      assert.equal(p.get('return_url'), 'https://beanies.family/settings/plan');
      assert.equal(decisions('portal_session_created').length, 1);
    });
  });

  describe('POST /billing/webhook', () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = (payload, { secret = WHSEC, t = now, base64 = false } = {}) => {
      const raw = JSON.stringify(payload);
      const sig = computeSignature(secret, t, raw);
      return evt({
        path: ROUTES.webhook,
        body: base64 ? Buffer.from(raw, 'utf8').toString('base64') : raw,
        base64,
        headers: { 'stripe-signature': `t=${t},v1=${sig}` },
        origin: undefined,
      });
    };
    const event = (type, object) => ({ id: 'evt_1', type, data: { object } });

    it('needs no x-api-key, and 400s a bad signature without reading the body', async () => {
      const t = fakeDdb();
      fakeStripe({});
      const r = await handler(
        signed(event('customer.subscription.updated', SUB()), { secret: 'whsec_wrong' }),
        t.ddb
      );
      assert.equal(r.statusCode, 400);
      assert.equal(json(r).code, 'bad_signature');
      assert.equal(decisions('webhook_signature_failed')[0].reason, 'mismatch');
      assert.equal(t.calls.length, 0);
    });
    it('500s when the secret is unset (misconfiguration must page, not silently 400)', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const r = await handler(signed(event('customer.subscription.updated', SUB())), fakeDdb().ddb);
      assert.equal(r.statusCode, 500);
      assert.equal(json(r).code, 'webhook_secret_unset');
    });
    it('verifies a base64-encoded body on its decoded bytes', async () => {
      const t = fakeDdb();
      fakeStripe({ 'GET /v1/subscriptions/': SUB() });
      const r = await handler(
        signed(event('customer.subscription.created', SUB()), { base64: true }),
        t.ddb
      );
      assert.equal(r.statusCode, 200, r.body);
    });
    it('ignores unknown types and events without metadata.familyId with 200', async () => {
      const t = fakeDdb();
      fakeStripe({});
      let r = await handler(signed(event('invoice.paid', { id: 'in_1' })), t.ddb);
      assert.equal(r.statusCode, 200);
      assert.equal(decisions('webhook_ignored')[0].reason, 'unknown_type');
      r = await handler(
        signed(event('customer.subscription.updated', SUB({ metadata: {} }))),
        t.ddb
      );
      assert.equal(r.statusCode, 200);
      assert.equal(decisions('webhook_ignored')[1].reason, 'no_family_id');
      assert.equal(t.calls.length, 0);
    });
    it('writes the RETRIEVED state, not the event snapshot, so a stale created cannot overwrite an updated', async () => {
      const t = fakeDdb({
        billing: { [FAMILY]: { familyId: FAMILY, cohort: 'first_ten', planTokenHash: 'h' } },
      });
      // Stripe's current truth says `unpaid` on the year plan; the late event claims `incomplete`.
      fakeStripe({ 'GET /v1/subscriptions/': SUB({ status: 'unpaid' }) });
      const r = await handler(
        signed(event('customer.subscription.created', SUB({ status: 'incomplete' }))),
        t.ddb
      );
      assert.equal(r.statusCode, 200, r.body);
      const row = t.tables[BILLING][FAMILY];
      assert.equal(row.status, 'unpaid');
      assert.equal(row.cohort, 'first_ten', 'the script’s attribute survives');
      assert.equal(row.planTokenHash, 'h', 'the claim’s attribute survives');
      const d = decisions('webhook_applied')[0];
      assert.equal(d.kind, 'customer.subscription.created');
      assert.equal(d.status, 'unpaid');
      assert.equal(d.plan, 'full');
      assert.equal(decisions('webhook_received').length, 1);
    });
    it('a retried event for an OLD subscription never overwrites the current one', async () => {
      const t = fakeDdb({
        billing: {
          [FAMILY]: {
            familyId: FAMILY,
            stripeSubscriptionId: 'sub_new',
            status: 'active',
            plan: 'full',
          },
        },
      });
      fakeStripe({ 'GET /v1/subscriptions/': SUB({ id: 'sub_old', status: 'canceled' }) });
      const r = await handler(
        signed(event('customer.subscription.deleted', SUB({ id: 'sub_old', status: 'canceled' }))),
        t.ddb
      );
      assert.equal(r.statusCode, 200);
      assert.equal(json(r).ignored, 'superseded_subscription');
      assert.equal(t.tables[BILLING][FAMILY].status, 'active', 'the current subscription survives');
      assert.equal(t.tables[BILLING][FAMILY].stripeSubscriptionId, 'sub_new');
      assert.equal(decisions('webhook_ignored')[0].reason, 'superseded_subscription');
      // A NEW subscription for a family with an old row is applied (it supersedes the row).
      fakeStripe({ 'GET /v1/subscriptions/': SUB({ id: 'sub_newer', status: 'active' }) });
      await handler(
        signed(event('customer.subscription.created', SUB({ id: 'sub_newer' }))),
        t.ddb
      );
      assert.equal(t.tables[BILLING][FAMILY].stripeSubscriptionId, 'sub_newer');
    });

    it('a cancel-at-period-end lands cancelAt; undoing it REMOVES cancelAt; deleted lands canceled', async () => {
      const t = fakeDdb();
      fakeStripe({ 'GET /v1/subscriptions/': SUB({ cancel_at: 1_900_000_000 }) });
      await handler(signed(event('customer.subscription.updated', SUB())), t.ddb);
      assert.equal(t.tables[BILLING][FAMILY].status, 'active');
      assert.equal(t.tables[BILLING][FAMILY].cancelAt, '2030-03-17T17:46:40.000Z');
      // Classic billing mode: cancel_at_period_end → the item's period end.
      fakeStripe({ 'GET /v1/subscriptions/': SUB({ cancel_at_period_end: true }) });
      await handler(signed(event('customer.subscription.updated', SUB())), t.ddb);
      assert.equal(t.tables[BILLING][FAMILY].cancelAt, '2030-03-17T17:46:40.000Z');
      // The family changed its mind in the portal: the attribute is gone, not stale.
      fakeStripe({ 'GET /v1/subscriptions/': SUB() });
      await handler(signed(event('customer.subscription.updated', SUB())), t.ddb);
      assert.equal(t.tables[BILLING][FAMILY].cancelAt, undefined);
      assert.equal(t.tables[BILLING][FAMILY].status, 'active');
      fakeStripe({
        'GET /v1/subscriptions/': SUB({ status: 'canceled', cancel_at: 1_900_000_000 }),
      });
      await handler(
        signed(event('customer.subscription.deleted', SUB({ status: 'canceled' }))),
        t.ddb
      );
      assert.equal(t.tables[BILLING][FAMILY].status, 'canceled');
    });
    it('500s (so Stripe retries) when the retrieve or the write fails, with the alarmed prefix', async () => {
      const errors = [];
      console.error = (...a) => errors.push(a.map(String).join(' '));
      let t = fakeDdb();
      fakeStripe({
        'GET /v1/subscriptions/': { status: 503, body: { error: { message: 'down' } } },
      });
      let r = await handler(signed(event('customer.subscription.updated', SUB())), t.ddb);
      assert.equal(r.statusCode, 500);
      assert.equal(decisions('webhook_apply_failed')[0].action, 'retrieve_subscription');
      assert.ok(errors.some((e) => e.startsWith('[billing] webhook_apply_failed')));

      t = fakeDdb({ updateThrows: new Error('ddb') });
      fakeStripe({ 'GET /v1/subscriptions/': SUB() });
      r = await handler(signed(event('customer.subscription.updated', SUB())), t.ddb);
      assert.equal(r.statusCode, 500);
      assert.equal(decisions('webhook_apply_failed')[1].action, 'ddb_update');
    });
  });

  describe('pure helpers', () => {
    it('parseLookupKey accepts the four-part vocabulary and nothing else', () => {
      assert.deepEqual(parseLookupKey('list.full.month.usd'), {
        cohort: null,
        plan: 'full',
        interval: 'month',
        currency: 'usd',
      });
      assert.deepEqual(parseLookupKey('first_ten.basic.year.sgd'), {
        cohort: 'first_ten',
        plan: 'basic',
        interval: 'year',
        currency: 'sgd',
      });
      for (const bad of [
        'gold.full.year.usd',
        'list.full.year',
        'list.full.year.usd.x',
        'list.full.week.usd',
        undefined,
        7,
      ])
        assert.equal(parseLookupKey(bad), null, String(bad));
    });
    it('subscriptionAttrs reads current_period_end from the item and tolerates a malformed price', () => {
      const a = subscriptionAttrs(
        SUB({
          customer: { id: 'cus_obj' },
          items: { data: [{ current_period_end: 0, price: { lookup_key: 'nonsense' } }] },
        }),
        new Date('2026-10-01T00:00:00Z')
      );
      assert.equal(a.plan, null);
      assert.equal(a.currentPeriodEnd, '1970-01-01T00:00:00.000Z');
      assert.equal(a.stripeCustomerId, 'cus_obj');
      assert.equal(a.updatedAt, '2026-10-01T00:00:00.000Z');
      assert.equal(subscriptionAttrs({ id: 's', status: 'active' }).currentPeriodEnd, null);
    });
  });
});
