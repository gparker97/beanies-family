import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CLEANUP_HEARTBEAT_PREFIX, ROUTES, createHandler } from '../createHandler.mjs';
import * as index from '../index.mjs';
import { captureConsole, fakeAlertsClient, fakeDdb, fakeSenders, json } from './helpers.mjs';

const NOW = Date.parse('2026-12-10T12:00:00Z');
const HOOK = 'hook-secret-0123456789abcdef0123456789abcdef';
const ENV = Object.freeze({
  FLIGHT_STATUS_API_KEY: 'test-key',
  AERODATABOX_API_KEY: 'provider-key',
  CACHE_TABLE: 'cache-test',
  ALERTS_TABLE: 'alerts-test',
  AERODATABOX_WEBHOOK_SECRET: HOOK,
  WEBHOOK_BASE_URL: 'https://api.beanies.family',
  FLIGHT_ALERT_TOKEN_SECRET: 'alert-secret-0123456789abcdef0123456789abcdef',
});

const logs = captureConsole();

function make() {
  const ddb = fakeDdb();
  const alertsProvider = fakeAlertsClient();
  const proxyCalls = [];
  const handler = createHandler({
    provider: {
      PROVIDER_MODES: ['direct'],
      fetchLegs: async (args) => {
        proxyCalls.push(args);
        return { legs: [], status: 204 };
      },
    },
    env: ENV,
    ddb,
    now: () => NOW,
    alertsProvider,
    senders: fakeSenders(),
  });
  return { handler, ddb, alertsProvider, proxyCalls };
}

const http = (routeKey, body = {}, extra = {}) => ({
  routeKey,
  requestContext: { http: { method: 'POST', sourceIp: '203.0.113.7' } },
  headers: { 'x-api-key': 'test-key' },
  body: JSON.stringify(body),
  ...extra,
});

describe('dispatch', () => {
  test('{ task: "cleanup" } runs the sweep (heartbeat) before any routeKey', async () => {
    const { handler, alertsProvider } = make();
    const out = await handler({ task: 'cleanup' });
    assert.equal(out.ok, true);
    assert.ok(alertsProvider.calls.some(([n]) => n === 'listAlerts'));
    assert.ok(logs().log.some((l) => l.startsWith(CLEANUP_HEARTBEAT_PREFIX)));
  });

  test('an HTTP POST carrying task in its BODY is not the sweep', async () => {
    const { handler, alertsProvider } = make();
    const res = await handler(
      http(ROUTES.proxy, { task: 'cleanup', flight: 'SQ318', date: '2026-12-13' })
    );
    assert.equal(res.statusCode, 200);
    const unknown = await handler(http('POST /flight-status/cleanup', { task: 'cleanup' }));
    assert.equal(unknown.statusCode, 404);
    assert.ok(!alertsProvider.calls.some(([n]) => n === 'listAlerts'));
    assert.ok(!logs().log.some((l) => l.startsWith(CLEANUP_HEARTBEAT_PREFIX)));
  });

  test('each routeKey reaches its module; anything else is 404 not_found', async () => {
    const { handler, proxyCalls } = make();
    await handler(http(ROUTES.proxy, { flight: 'SQ318', date: '2026-12-13' }));
    assert.equal(proxyCalls.length, 1);
    assert.equal(json(await handler(http(ROUTES.subscribe, {}))).code, 'alert_token_rejected');
    assert.equal(json(await handler(http(ROUTES.unsubscribe, {}))).code, 'bad_flight');
    const hook = await handler(http(ROUTES.webhook, {}, { pathParameters: { secret: 'nope' } }));
    assert.equal(json(hook).code, 'webhook_rejected');
    for (const e of [http('GET /flight-status'), http(undefined), {}]) {
      const res = await handler(e);
      assert.equal(res.statusCode, 404);
      assert.equal(json(res).code, 'not_found');
    }
  });

  test('the soft key gates subscribe and unsubscribe, never the webhook', async () => {
    const { handler } = make();
    const noKey = (route, extra) => ({ ...http(route, {}, extra), headers: {} });
    assert.equal(json(await handler(noKey(ROUTES.subscribe))).code, 'unauthorized');
    assert.equal(json(await handler(noKey(ROUTES.unsubscribe))).code, 'unauthorized');
    const hook = await handler(
      noKey(ROUTES.webhook, { pathParameters: { secret: HOOK }, body: '{}' })
    );
    assert.equal(hook.statusCode, 200, 'the path secret is the webhook auth');
  });

  test('OPTIONS answers 204 on any route', async () => {
    const { handler } = make();
    const res = await handler({
      requestContext: { http: { method: 'OPTIONS' } },
      routeKey: ROUTES.subscribe,
    });
    assert.equal(res.statusCode, 204);
  });

  test('index.mjs re-exports the heartbeat prefix the ops alarm test pins', () => {
    assert.equal(index.CLEANUP_HEARTBEAT_PREFIX, '[flight-alerts] cleanup ran');
  });
});
