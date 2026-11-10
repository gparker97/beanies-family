import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { PROVIDER_SUBSCRIBE_FAILED_PREFIX, createAlerts, webhookUrl } from '../alerts.mjs';
import {
  CLAIM_STALE_S,
  STORE_UNAVAILABLE_PREFIX,
  deviceSk,
  expiresAtFor,
} from '../alertsStore.mjs';
import { BUDGET_EXHAUSTED_PREFIX } from '../store.mjs';
import { ERROR_CODES, STATUS_FOR_CODE } from '../http.mjs';
import {
  FakeProviderError,
  captureConsole,
  fakeAlertsClient,
  fakeDdb,
  json,
  linesFor,
} from './helpers.mjs';

const NOW = Date.parse('2026-12-10T12:00:00Z');
const NOW_S = Math.floor(NOW / 1000);
const SECRET = 'alert-secret-0123456789abcdef0123456789abcdef';
const HOOK_SECRET = 'hook-secret-0123456789abcdef0123456789abcdef';
const A = 'alerts-test';
const C = 'cache-test';
const ENV = Object.freeze({
  FLIGHT_STATUS_API_KEY: 'test-key',
  FLIGHT_ALERT_TOKEN_SECRET: SECRET,
  CACHE_TABLE: C,
  ALERTS_TABLE: A,
  WEBHOOK_BASE_URL: 'https://api.beanies.family',
  AERODATABOX_WEBHOOK_SECRET: HOOK_SECRET,
  DAILY_PROVIDER_CAP: '75',
  MAX_DEVICES_PER_FLIGHT: '3',
});
const CALLBACK = `https://api.beanies.family/flight-status/webhook/${HOOK_SECRET}`;
const IOS_TOKEN = 'ab'.repeat(32);
const FCM_TOKEN = 'fcm:APA91b' + 'x'.repeat(140);

const logs = captureConsole();

const token = (exp = NOW_S + 3600, secret = SECRET) =>
  `v1.${exp}.${createHmac('sha256', secret).update(`alert:v1:${exp}`).digest('base64url')}`;

function make({ env = {}, provider = fakeAlertsClient(), ddb = fakeDdb(), now = NOW } = {}) {
  const alerts = createAlerts({ provider, env: { ...ENV, ...env }, ddb, now: () => now });
  return { alerts, provider, ddb };
}

function ev(
  body,
  { key = 'test-key', route = 'POST /flight-status/subscribe', ip = '203.0.113.7' } = {}
) {
  return {
    routeKey: route,
    requestContext: { http: { method: 'POST', sourceIp: ip } },
    headers: { origin: 'https://app.beanies.family', ...(key ? { 'x-api-key': key } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

const sub = (over = {}) => ({
  flight: 'sq 318',
  date: '2026-12-13',
  dep: 'SIN',
  arr: 'LHR',
  rev: '2026-12-13|23:05|3|2026-12-14|05:40',
  platform: 'ios',
  lang: 'en',
  token: IOS_TOKEN,
  alert: token(),
  ...over,
});
const unsub = (over = {}) => ({ flight: 'SQ318', date: '2026-12-13', token: IOS_TOKEN, ...over });

function assertCode(res, code) {
  assert.equal(json(res).code, code);
  assert.ok(ERROR_CODES.includes(code));
  assert.equal(res.statusCode, STATUS_FOR_CODE[code].status);
}
const lines = () => linesFor(logs(), 'flight-alerts');

describe('subscribe: the happy paths', () => {
  test('a new number: device put, claim won, one day token, provider subscribed with the secret url, ready', async () => {
    const { alerts, provider, ddb } = make();
    const res = await alerts.subscribe(ev(sub()));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(json(res), { ok: true, provider: 'ready' });
    assert.deepEqual(provider.calls, [['subscribeAlert', 'SQ318', CALLBACK]]);
    const item = ddb.get(A, 'SQ318', deviceSk('2026-12-13', IOS_TOKEN));
    assert.equal(item.sent_rev.S, sub().rev);
    assert.equal(item.dep.S, 'SIN');
    assert.equal(item.arr.S, 'LHR');
    assert.equal(item.expires_at.N, String(expiresAtFor('2026-12-13')));
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'sub-1');
    assert.equal(ddb.get(A, 'SQ318', 'p').claimed_at, undefined);
    assert.equal(ddb.get(C, `g#2026-12-10`).n.N, '1', 'one day token spent');
    const [line] = lines();
    assert.deepEqual(
      [
        line.route,
        line.flight,
        line.date,
        line.platform,
        line.lang,
        line.outcome,
        line.status,
        line.provider,
        line.provider_code,
      ],
      [
        'POST /flight-status/subscribe',
        'SQ318',
        '2026-12-13',
        'ios',
        'en',
        'ok',
        200,
        'ready',
        'created',
      ]
    );
  });

  test('an existing provider id: ready with no claim, no day token, no provider call', async () => {
    const { alerts, provider, ddb } = make();
    await alerts.subscribe(ev(sub()));
    const before = ddb.get(C, 'g#2026-12-10').n.N;
    const res = await alerts.subscribe(
      ev(sub({ platform: 'android', token: FCM_TOKEN, lang: 'zh' }))
    );
    assert.deepEqual(json(res), { ok: true, provider: 'ready' });
    assert.equal(provider.calls.length, 1);
    assert.equal(ddb.get(C, 'g#2026-12-10').n.N, before);
    assert.equal(lines().at(-1).provider, 'ready');
    assert.equal(lines().at(-1).provider_code, null);
  });

  test('re-subscribe (new rev, new token) overwrites sent_rev', async () => {
    const { alerts, ddb } = make();
    await alerts.subscribe(ev(sub()));
    await alerts.subscribe(ev(sub({ rev: 'R2' })));
    assert.equal(ddb.get(A, 'SQ318', deviceSk('2026-12-13', IOS_TOKEN)).sent_rev.S, 'R2');
  });

  test('two concurrent first subscribes: ONE provider call, ready + pending (claim lost keeps the row)', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const provider = fakeAlertsClient({
      subscribeAlert: async () => {
        await gate;
        return { id: 'sub-x' };
      },
    });
    const ddb = fakeDdb();
    const { alerts } = make({ provider, ddb });
    const first = alerts.subscribe(ev(sub()));
    // Let the first reach the provider call before the second starts.
    await new Promise((r) => setTimeout(r, 10));
    const second = await alerts.subscribe(ev(sub({ platform: 'android', token: FCM_TOKEN })));
    release();
    const one = await first;
    assert.deepEqual(json(one), { ok: true, provider: 'ready' });
    assert.deepEqual(json(second), { ok: true, provider: 'pending' });
    assert.equal(provider.calls.length, 1);
    const lost = lines().find((l) => l.platform === 'android');
    assert.deepEqual([lost.provider, lost.provider_code], ['pending', 'claim_lost']);
    assert.ok(ddb.get(A, 'SQ318', deviceSk('2026-12-13', FCM_TOKEN)), 'the loser keeps its row');
    // The client re-asks while unconfirmed: once the winner filled `p`, it answers ready, no new call.
    const reask = await alerts.subscribe(ev(sub({ platform: 'android', token: FCM_TOKEN })));
    assert.deepEqual(json(reask), { ok: true, provider: 'ready' });
    assert.equal(provider.calls.length, 1);
  });

  test('an unfilled claim older than 60 s is re-claimed; one 30 s old is not', async () => {
    const ddb = fakeDdb();
    ddb.seed(A, { pk: 'SQ318', sk: 'p', claimed_at: NOW_S - 30, created_at: NOW_S - 30 });
    const fresh = make({ ddb });
    assert.deepEqual(json(await fresh.alerts.subscribe(ev(sub()))), {
      ok: true,
      provider: 'pending',
    });
    assert.equal(fresh.provider.calls.length, 0);

    ddb.seed(A, {
      pk: 'SQ318',
      sk: 'p',
      claimed_at: NOW_S - CLAIM_STALE_S - 1,
      created_at: NOW_S - 99,
    });
    const stale = make({ ddb });
    assert.deepEqual(json(await stale.alerts.subscribe(ev(sub()))), {
      ok: true,
      provider: 'ready',
    });
    assert.equal(stale.provider.calls.length, 1);
    assert.deepEqual(
      [lines().at(-1).provider, lines().at(-1).provider_code],
      ['ready', 'claim_stale']
    );
  });

  test('no provider cancel and no list call on any subscribe or unsubscribe path', async () => {
    const { alerts, provider } = make();
    await alerts.subscribe(ev(sub()));
    await alerts.unsubscribe(ev(unsub(), { route: 'POST /flight-status/unsubscribe' }));
    await alerts.subscribe(ev(sub()));
    assert.ok(provider.calls.every(([name]) => name === 'subscribeAlert'));
  });
});

describe('subscribe: refusals', () => {
  test('soft key, then the alert token (tampered, expired, malformed, missing), each logged', async () => {
    const { alerts, ddb } = make();
    assertCode(await alerts.subscribe(ev(sub(), { key: 'nope' })), 'unauthorized');
    assertCode(
      await alerts.subscribe(ev(sub({ alert: token(NOW_S + 3600, 'other-secret') }))),
      'alert_token_rejected'
    );
    assertCode(await alerts.subscribe(ev(sub({ alert: token(NOW_S) }))), 'alert_token_rejected');
    assertCode(await alerts.subscribe(ev(sub({ alert: 'v1.x.y' }))), 'alert_token_rejected');
    assertCode(await alerts.subscribe(ev(sub({ alert: undefined }))), 'alert_token_rejected');
    const reasons = linesFor(logs(), '[flight-alerts] alert token rejected').map((l) => l.reason);
    assert.deepEqual(reasons, ['bad_sig', 'expired', 'malformed', 'malformed']);
    assert.deepEqual(ddb.calls, [], 'nothing touched before the token passes');
  });

  test('an unset token secret refuses every subscribe', async () => {
    const { alerts } = make({ env: { FLIGHT_ALERT_TOKEN_SECRET: '' } });
    assertCode(await alerts.subscribe(ev(sub())), 'alert_token_rejected');
  });

  test('body validation: flight, date, platform, token, codes, rev, size', async () => {
    const { alerts } = make();
    assertCode(await alerts.subscribe(ev(sub({ flight: '??' }))), 'bad_flight');
    assertCode(await alerts.subscribe(ev(sub({ date: '2026-02-30' }))), 'bad_date');
    assertCode(await alerts.subscribe(ev(sub({ date: '2030-01-01' }))), 'date_out_of_range');
    assertCode(await alerts.subscribe(ev(sub({ platform: 'web' }))), 'bad_platform');
    assertCode(await alerts.subscribe(ev(sub({ token: 'nothex' }))), 'bad_token');
    assertCode(
      await alerts.subscribe(ev(sub({ platform: 'android', token: 'short' }))),
      'bad_token'
    );
    assertCode(await alerts.subscribe(ev(sub({ dep: 'Singapore' }))), 'bad_codes');
    assertCode(await alerts.subscribe(ev(sub({ arr: 'LH' }))), 'bad_codes');
    assertCode(await alerts.subscribe(ev(sub({ rev: '' }))), 'bad_request');
    assertCode(await alerts.subscribe(ev(sub({ pad: 'x'.repeat(2100) }))), 'too_large');
    assertCode(await alerts.subscribe(ev('{')), 'bad_request');
  });

  test('arr may be omitted (no arrival half); an unknown lang registers en', async () => {
    const { alerts, ddb } = make();
    const res = await alerts.subscribe(ev(sub({ arr: undefined, lang: 'fr' })));
    assert.equal(res.statusCode, 200);
    const item = ddb.get(A, 'SQ318', deviceSk('2026-12-13', IOS_TOKEN));
    assert.equal(item.arr, undefined);
    assert.equal(item.lang.S, 'en');
  });

  test('the per-IP hourly bucket', async () => {
    const { alerts } = make({ env: { IP_LIMIT: '1' } });
    assert.equal((await alerts.subscribe(ev(sub()))).statusCode, 200);
    assertCode(await alerts.subscribe(ev(sub())), 'rate_limited');
  });

  test('the device cap: the 4th device for a flight+date is 409; a known device may re-register', async () => {
    const { alerts } = make();
    for (const t of ['a', 'b', 'c']) {
      assert.equal((await alerts.subscribe(ev(sub({ token: t.repeat(64) })))).statusCode, 200);
    }
    assertCode(await alerts.subscribe(ev(sub({ token: 'd'.repeat(64) }))), 'subscription_full');
    assert.equal(
      (await alerts.subscribe(ev(sub({ token: 'a'.repeat(64), rev: 'R9' })))).statusCode,
      200
    );
    assert.equal(
      (await alerts.subscribe(ev(sub({ token: 'd'.repeat(64), date: '2026-12-14' })))).statusCode,
      200
    );
    assert.equal(lines().find((l) => l.status === 409).outcome, 'subscription_full');
  });

  const deviceRow = (ddb, t = IOS_TOKEN) => ddb.get(A, 'SQ318', deviceSk('2026-12-13', t));
  const failedLine = (code) => {
    const line = lines().at(-1);
    assert.deepEqual(
      [line.provider, line.provider_code, line.outcome, line.code],
      ['failed', code, 'provider_failed', code]
    );
  };

  test('daily budget exhausted: 503 budget_exhausted, the device row is taken back, claim released, p kept, alarmed', async () => {
    const { alerts, provider, ddb } = make({ env: { DAILY_PROVIDER_CAP: '1' } });
    ddb.seed(C, { pk: 'g#2026-12-10', n: 1 });
    assertCode(await alerts.subscribe(ev(sub())), 'budget_exhausted');
    failedLine('budget_exhausted');
    assert.equal(provider.calls.length, 0);
    assert.equal(deviceRow(ddb), undefined, 'no row: the device records nothing (Phase 1 stays)');
    assert.ok(ddb.get(A, 'SQ318', 'p'), 'p kept');
    assert.equal(ddb.get(A, 'SQ318', 'p').claimed_at, undefined, 'claim released');
    assert.ok(logs().error.some((l) => l.startsWith(BUDGET_EXHAUSTED_PREFIX)));
  });

  test('provider failure: the upstream code answered (502), the row taken back, claim released, alarmed; next subscribe retries', async () => {
    let fail = true;
    const provider = fakeAlertsClient({
      subscribeAlert: async () => {
        if (fail) throw new FakeProviderError('upstream_http', 502);
        return { id: 'sub-ok' };
      },
    });
    const { alerts, ddb } = make({ provider });
    const res = await alerts.subscribe(ev(sub()));
    assertCode(res, 'upstream_http');
    assert.equal(res.statusCode, 502);
    failedLine('upstream_http');
    assert.equal(deviceRow(ddb), undefined, 'no row');
    assert.ok(ddb.get(A, 'SQ318', 'p'));
    assert.equal(ddb.get(A, 'SQ318', 'p').claimed_at, undefined);
    assert.ok(
      logs().error.some((l) =>
        l.startsWith(
          `${PROVIDER_SUBSCRIBE_FAILED_PREFIX} source=subscribe flight=SQ318 code=upstream_http http_status=502`
        )
      )
    );
    fail = false;
    assert.deepEqual(json(await alerts.subscribe(ev(sub()))), { ok: true, provider: 'ready' });
    assert.ok(deviceRow(ddb));
  });

  test('an unset webhook secret refuses provider work: 503 alerts_unavailable, no row, no provider call, says so', async () => {
    const { alerts, provider, ddb } = make({ env: { AERODATABOX_WEBHOOK_SECRET: '' } });
    assertCode(await alerts.subscribe(ev(sub())), 'alerts_unavailable');
    failedLine('alerts_unavailable');
    assert.equal(provider.calls.length, 0);
    assert.equal(deviceRow(ddb), undefined);
    assert.ok(logs().error.some((l) => l.includes('reason=webhook_unset')));
  });

  test('store faults before the device item is written are 503 alerts_unavailable with no row (count, put)', async () => {
    for (const op of ['QueryCommand', 'PutItemCommand']) {
      const ddb = fakeDdb();
      ddb.failOn((o, input) => o === op && input.TableName === A);
      const { alerts } = make({ ddb });
      assertCode(await alerts.subscribe(ev(sub())), 'alerts_unavailable');
      assert.equal(deviceRow(ddb), undefined);
      assert.equal(lines().at(-1).outcome, 'store_error');
    }
  });

  test('store faults after the put (get p, claim) take the row back and answer 503 alerts_unavailable', async () => {
    for (const op of ['GetItemCommand', 'UpdateItemCommand']) {
      const ddb = fakeDdb();
      ddb.failOn((o, input) => o === op && input.TableName === A);
      const { alerts, provider } = make({ ddb });
      assertCode(await alerts.subscribe(ev(sub())), 'alerts_unavailable');
      failedLine('alerts_unavailable');
      assert.equal(deviceRow(ddb), undefined, `${op}: no row`);
      assert.equal(provider.calls.length, 0);
    }
  });

  test('a failed take-back still answers the error and says why it matters (alarmed store prefix)', async () => {
    const ddb = fakeDdb();
    ddb.failOn(
      (o, input) => input.TableName === A && (o === 'GetItemCommand' || o === 'DeleteItemCommand')
    );
    const { alerts } = make({ ddb });
    assertCode(await alerts.subscribe(ev(sub())), 'alerts_unavailable');
    failedLine('alerts_unavailable');
    assert.ok(deviceRow(ddb), 'the row could not be deleted');
    assert.ok(
      logs().error.some((l) =>
        l.startsWith(`${STORE_UNAVAILABLE_PREFIX} op=withdraw_device flight=SQ318`)
      )
    );
  });

  test('a fill failure after a successful provider call answers pending and keeps the row (the subscription exists; the sweep adopts)', async () => {
    const ddb = fakeDdb();
    ddb.failOn(
      (o, input) =>
        o === 'UpdateItemCommand' && input.UpdateExpression?.startsWith('SET provider_id')
    );
    const { alerts, provider } = make({ ddb });
    assert.deepEqual(json(await alerts.subscribe(ev(sub()))), { ok: true, provider: 'pending' });
    assert.equal(provider.calls.length, 1);
    assert.ok(deviceRow(ddb), 'row kept');
    assert.deepEqual(
      [lines().at(-1).provider, lines().at(-1).provider_code],
      ['pending', 'fill_failed']
    );
  });
});

describe('unsubscribe', () => {
  const route = { route: 'POST /flight-status/unsubscribe' };

  test('deletes the device, leaves p untouched, needs no alert token; a repeat is a no-op', async () => {
    const { alerts, ddb, provider } = make();
    await alerts.subscribe(ev(sub()));
    const res = await alerts.unsubscribe(ev(unsub(), route));
    assert.deepEqual(json(res), { ok: true });
    assert.equal(ddb.get(A, 'SQ318', deviceSk('2026-12-13', IOS_TOKEN)), undefined);
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'sub-1');
    assert.equal((await alerts.unsubscribe(ev(unsub(), route))).statusCode, 200);
    assert.equal(provider.calls.length, 1, 'only the original subscribe');
    assert.equal(lines().at(-1).provider, 'deleted');
  });

  test('works with an unset alert-token secret, for a past date, and for an FCM token', async () => {
    const { alerts } = make({ env: { FLIGHT_ALERT_TOKEN_SECRET: '' } });
    assert.equal(
      (await alerts.unsubscribe(ev(unsub({ date: '2020-01-01' }), route))).statusCode,
      200
    );
    assert.equal(
      (await alerts.unsubscribe(ev(unsub({ token: FCM_TOKEN }), route))).statusCode,
      200
    );
  });

  test('refusals: key, flight, date, token, rate; store fault 503', async () => {
    const { alerts } = make({ env: { IP_LIMIT: '1' } });
    assertCode(await alerts.unsubscribe(ev(unsub(), { ...route, key: null })), 'unauthorized');
    assertCode(await alerts.unsubscribe(ev(unsub({ flight: '' }), route)), 'bad_flight');
    assertCode(await alerts.unsubscribe(ev(unsub({ date: '13/12/2026' }), route)), 'bad_date');
    assertCode(await alerts.unsubscribe(ev(unsub({ token: '!!' }), route)), 'bad_token');
    assert.equal((await alerts.unsubscribe(ev(unsub(), route))).statusCode, 200);
    assertCode(await alerts.unsubscribe(ev(unsub(), route)), 'rate_limited');
    const ddb = fakeDdb();
    ddb.failOn((o) => o === 'DeleteItemCommand');
    assertCode(await make({ ddb }).alerts.unsubscribe(ev(unsub(), route)), 'alerts_unavailable');
  });
});

describe('privacy', () => {
  test('no log line carries a push token, the alert token, the soft key or the webhook secret', async () => {
    const { alerts } = make();
    await alerts.subscribe(ev(sub()));
    await alerts.subscribe(ev(sub({ platform: 'android', token: FCM_TOKEN })));
    await alerts.unsubscribe(ev(unsub(), { route: 'POST /flight-status/unsubscribe' }));
    const all = [...logs().log, ...logs().warn, ...logs().error].join('\n');
    for (const secret of [IOS_TOKEN, FCM_TOKEN, token(), 'test-key', HOOK_SECRET, '203.0.113.7']) {
      assert.ok(!all.includes(secret), `leaked ${secret.slice(0, 12)}…`);
    }
  });

  test('webhookUrl builds the callback without a doubled slash', () => {
    assert.equal(
      webhookUrl('https://x.example/', 's'),
      'https://x.example/flight-status/webhook/s'
    );
  });
});
