import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ALERT_MAX_DELIVERY_RETRIES,
  createAlertsClient,
  parseWebhook,
} from '../providers/aerodatabox.mjs';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/aerodatabox-sq318.json', import.meta.url))
);

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const key = `${init.method} ${new URL(url).pathname}`;
    const r = routes[key] ?? { status: 404 };
    if (r.throw) throw new Error(r.throw);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers ?? {},
    });
  };
  return { impl, calls };
}

describe('parseWebhook', () => {
  const notification = {
    id: '6f1d1a3e-0000-4000-8000-000000000001',
    flights: FIXTURE,
    subscription: {
      id: 'sub-1',
      isActive: true,
      subject: { type: 'FlightByNumber', id: 'SQ 318' },
      subscriber: { type: 'WebHook', id: 'https://x/secret' },
    },
    balance: { creditsRemaining: 188 },
    deliveryAttempt: { seqNo: 2, costCredits: 1 },
    timestampUtc: '2026-12-13 09:12Z',
  };

  test('the FlightNotificationContract → id, subject number, mapped legs, balance, attempt', () => {
    const out = parseWebhook(notification);
    assert.equal(out.eventId, notification.id);
    assert.equal(out.flight, 'SQ318');
    assert.equal(out.legs.length, 1);
    assert.equal(out.legs[0].departure.iata, 'SIN');
    assert.equal(out.creditsRemaining, 188);
    assert.equal(out.attempt, 2);
    assert.ok(
      !JSON.stringify(out).includes('secret'),
      'the subscriber url never leaves the parser'
    );
  });

  test('no balance → null; no subject → the first item number', () => {
    const out = parseWebhook({ ...notification, balance: undefined, subscription: undefined });
    assert.equal(out.creditsRemaining, null);
    assert.equal(out.flight, 'SQ318');
  });

  test('unparseable shapes → null', () => {
    for (const b of [
      null,
      [],
      {},
      { id: 'x' },
      { ...notification, id: '' },
      { ...notification, id: 'a/b' },
      { ...notification, flights: 'no' },
      { ...notification, subscription: undefined, flights: [{ number: '???' }] },
    ]) {
      assert.equal(parseWebhook(b), null, JSON.stringify(b).slice(0, 60));
    }
  });
});

describe('createAlertsClient', () => {
  test('subscribeAlert posts the callback url with one delivery retry and returns the id', async () => {
    const f = fakeFetch({
      'POST /subscriptions/webhook/FlightByNumber/SQ318': { status: 200, body: { id: 'sub-9' } },
    });
    const client = createAlertsClient({ apiKey: 'k', mode: 'rapidapi', fetchImpl: f.impl });
    assert.deepEqual(await client.subscribeAlert('SQ318', 'https://cb/x'), { id: 'sub-9' });
    assert.deepEqual(JSON.parse(f.calls[0].init.body), {
      url: 'https://cb/x',
      maxDeliveryRetries: ALERT_MAX_DELIVERY_RETRIES,
    });
    assert.equal(f.calls[0].init.headers['X-RapidAPI-Key'], 'k');
    assert.ok(
      !f.calls[0].url.includes('k&') && !f.calls[0].url.includes('=k'),
      'key only in a header'
    );
  });

  test('listAlerts reads the webhook url from subscriber.id and normalises the subject number', async () => {
    const f = fakeFetch({
      'GET /subscriptions/webhook': {
        status: 200,
        body: [
          {
            id: 'a',
            subject: { type: 'FlightByNumber', id: 'SQ 318' },
            subscriber: { type: 'WebHook', id: 'https://own/x' },
          },
          {
            id: 'b',
            subject: { type: 'FlightByAirportIcao', id: 'WSSS' },
            subscriber: { type: 'WebHook', id: 'https://other' },
          },
          { id: 'c', subject: { type: 'FlightByNumber', id: 'BA12' }, url: 'https://top-level' },
        ],
      },
    });
    const list = await createAlertsClient({ apiKey: 'k', fetchImpl: f.impl }).listAlerts();
    assert.deepEqual(list, [
      { id: 'a', flight: 'SQ318', url: 'https://own/x' },
      { id: 'b', flight: null, url: 'https://other' },
      { id: 'c', flight: 'BA12', url: 'https://top-level' },
    ]);
    const empty = fakeFetch({ 'GET /subscriptions/webhook': { status: 204 } });
    assert.deepEqual(
      await createAlertsClient({ apiKey: 'k', fetchImpl: empty.impl }).listAlerts(),
      []
    );
  });

  test('balance: a number, or null for the empty answer before the first refill', async () => {
    const f = fakeFetch({
      'GET /subscriptions/balance': { status: 200, body: { creditsRemaining: 42 } },
    });
    assert.equal(await createAlertsClient({ apiKey: 'k', fetchImpl: f.impl }).getBalance(), 42);
    const empty = fakeFetch({ 'GET /subscriptions/balance': { status: 200 } });
    assert.equal(
      await createAlertsClient({ apiKey: 'k', fetchImpl: empty.impl }).getBalance(),
      null
    );
  });

  test('refillCredits returns the new balance and the unit quota', async () => {
    const f = fakeFetch({
      'POST /subscriptions/balance/refill': {
        status: 200,
        body: { creditsRemaining: 200 },
        headers: {
          'x-ratelimit-api-units-remaining': '4800',
          'x-ratelimit-api-units-limit': '5000',
        },
      },
    });
    const out = await createAlertsClient({
      apiKey: 'k',
      mode: 'rapidapi',
      fetchImpl: f.impl,
    }).refillCredits(200);
    assert.deepEqual(out, { creditsRemaining: 200, quota: { limit: 5000, remaining: 4800 } });
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { credits: 200 });
  });

  test('cancelAlert: a 404 counts as done; other failures throw ProviderError', async () => {
    const gone = fakeFetch({});
    await createAlertsClient({ apiKey: 'k', fetchImpl: gone.impl }).cancelAlert('x');
    const down = fakeFetch({ 'DELETE /subscriptions/webhook/x': { status: 503 } });
    await assert.rejects(
      createAlertsClient({ apiKey: 'k', fetchImpl: down.impl }).cancelAlert('x'),
      {
        name: 'ProviderError',
        code: 'upstream_unavailable',
        httpStatus: 503,
      }
    );
  });

  test('an unset key is upstream_auth before any network; a network error is upstream_network', async () => {
    const f = fakeFetch({});
    await assert.rejects(createAlertsClient({ apiKey: '', fetchImpl: f.impl }).getBalance(), {
      code: 'upstream_auth',
    });
    assert.equal(f.calls.length, 0);
    const net = fakeFetch({ 'GET /subscriptions/balance': { throw: 'ECONNRESET' } });
    await assert.rejects(createAlertsClient({ apiKey: 'k', fetchImpl: net.impl }).getBalance(), {
      code: 'upstream_network',
    });
  });

  test('a subscribe answer without an id is upstream_http', async () => {
    const f = fakeFetch({ 'POST /subscriptions/webhook/FlightByNumber/SQ318': { status: 204 } });
    await assert.rejects(
      createAlertsClient({ apiKey: 'k', fetchImpl: f.impl }).subscribeAlert('SQ318', 'u'),
      { code: 'upstream_http' }
    );
  });
});
