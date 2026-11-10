import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PUSH_SEND_FAILED_PREFIX, WEBHOOK_REJECTED_PREFIX, createWebhook } from '../webhook.mjs';
import { deviceSk, expiresAtFor } from '../alertsStore.mjs';
import { mapLeg } from '../providers/aerodatabox.mjs';
import { CREDITS_REFILLED_PREFIX } from '../credits.mjs';
import {
  captureConsole,
  fakeAlertsClient,
  fakeDdb,
  fakeSenders,
  json,
  linesFor,
} from './helpers.mjs';

const NOW = Date.parse('2026-12-12T12:00:00Z');
const NOW_S = Math.floor(NOW / 1000);
const A = 'alerts-test';
const HOOK = 'hook-secret-0123456789abcdef0123456789abcdef';
const ENV = Object.freeze({ ALERTS_TABLE: A, AERODATABOX_WEBHOOK_SECRET: HOOK });
const ROUTE = 'POST /flight-status/webhook/{secret}';
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/aerodatabox-sq318.json', import.meta.url))
);
const SQ318 = mapLeg(FIXTURE[0]);
const KNOWN = '2026-12-13|23:05|3|2026-12-14|05:40';
const OLD = '2026-12-13|22:00|3|2026-12-14|05:40';
const IOS = 'ab'.repeat(32);
const AND = 'fcm:' + 'y'.repeat(150);

const logs = captureConsole();
const lines = () => linesFor(logs(), 'flight-alerts-webhook');

function seedFlight(ddb, { provider = true, devices = [] } = {}) {
  if (provider) ddb.seed(A, { pk: 'SQ318', sk: 'p', provider_id: 'sub-1', created_at: NOW_S - 99 });
  for (const d of devices) {
    ddb.seed(A, {
      pk: 'SQ318',
      sk: deviceSk(d.date ?? '2026-12-13', d.token),
      push_token: d.token,
      platform: d.platform ?? 'ios',
      lang: d.lang ?? 'en',
      dep: 'SIN',
      arr: 'LHR',
      sent_rev: d.rev ?? OLD,
      created_at: NOW_S - 50,
      expires_at: d.expires ?? expiresAtFor(d.date ?? '2026-12-13'),
    });
  }
}

function make({
  ddb = fakeDdb(),
  senders = fakeSenders(),
  provider = fakeAlertsClient(),
  env = {},
} = {}) {
  const webhook = createWebhook({
    provider,
    env: { ...ENV, ...env },
    ddb,
    now: () => NOW,
    senders,
  });
  return { webhook, ddb, senders, provider };
}

function ev({ secret = HOOK, legs = [SQ318], id = 'evt-1', credits = 500, body } = {}) {
  return {
    routeKey: ROUTE,
    rawPath: `/flight-status/webhook/${secret}`,
    pathParameters: { secret },
    requestContext: { http: { method: 'POST', sourceIp: '198.51.100.9' } },
    headers: {},
    body:
      body ??
      JSON.stringify({
        __parsed: { eventId: id, flight: 'SQ318', legs, creditsRemaining: credits, attempt: 1 },
      }),
  };
}

describe('webhook: auth and early answers', () => {
  test('a bad or missing path secret is 401, alarmed, and never logs the path', async () => {
    const { webhook, ddb } = make();
    const noParam = { ...ev(), pathParameters: {} };
    for (const e of [ev({ secret: 'wrong' }), ev({ secret: '' }), noParam]) {
      const res = await webhook(e);
      assert.equal(res.statusCode, 401);
      assert.equal(json(res).code, 'webhook_rejected');
    }
    const unset = make({ env: { AERODATABOX_WEBHOOK_SECRET: '' } });
    assert.equal((await unset.webhook(ev())).statusCode, 401, 'an unset secret refuses everyone');
    assert.equal(logs().error.filter((l) => l.startsWith(WEBHOOK_REJECTED_PREFIX)).length, 4);
    assert.deepEqual(ddb.calls, []);
    const all = [...logs().log, ...logs().error].join('\n');
    assert.ok(!all.includes(HOOK) && !all.includes('/flight-status/webhook/wrong'));
    assert.ok(lines().every((l) => l.route === ROUTE));
  });

  test('unparseable → 200 ignored, no store call', async () => {
    const { webhook, ddb } = make();
    const res = await webhook(ev({ body: '{"nope":1}' }));
    assert.deepEqual(
      [res.statusCode, json(res).outcome, json(res).reason],
      [200, 'ignored', 'unparseable']
    );
    assert.equal((await webhook(ev({ body: '{' }))).statusCode, 200);
    assert.deepEqual(ddb.calls, []);
  });

  test('unknown flight (no p) → ignored, nothing sent; no devices → ignored; never a provider call', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { provider: false, devices: [{ token: IOS }] });
    const { webhook, senders, provider } = make({ ddb });
    assert.equal(json(await webhook(ev())).reason, 'unknown_flight');
    const ddb2 = fakeDdb();
    seedFlight(ddb2);
    const second = make({ ddb: ddb2 });
    assert.equal(json(await second.webhook(ev())).reason, 'no_devices');
    assert.equal(senders.sent.length + second.senders.sent.length, 0);
    assert.ok(
      provider.calls.every(([n]) => n === 'refillCredits' || n === 'getBalance') &&
        provider.calls.length === 0
    );
  });

  test('expired devices are not pushed', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS, expires: NOW_S - 1 }] });
    const { webhook, senders } = make({ ddb });
    const res = await webhook(ev());
    assert.equal(json(res).reason, 'no_devices');
    assert.equal(senders.sent.length, 0);
    assert.equal(lines()[0].expired, 1);
  });
});

describe('webhook: the fan-out', () => {
  test('a new revision sends once per device with the composed copy, claims sent_rev, records the event', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS }, { token: AND, platform: 'android', lang: 'zh' }] });
    const { webhook, senders } = make({ ddb });
    const res = await webhook(ev());
    assert.deepEqual([res.statusCode, json(res).outcome], [200, 'sent']);
    assert.equal(senders.sent.length, 2);
    const ios = senders.sent.find((s) => s.platform === 'ios');
    assert.deepEqual(
      {
        title: ios.title,
        body: ios.body,
        data: ios.data,
        collapseId: ios.collapseId,
        expiresAt: ios.expiresAt,
        token: ios.token,
      },
      {
        title: 'beanies.family',
        body: 'SQ318 now leaves at 11:05pm from Terminal 3.',
        data: { kind: 'travel-change', flight: 'SQ318', date: '2026-12-13' },
        collapseId: 'SQ318#2026-12-13',
        expiresAt: expiresAtFor('2026-12-13'),
        token: IOS,
      }
    );
    assert.match(senders.sent.find((s) => s.platform === 'android').body, /现改为/);
    assert.equal(ddb.get(A, 'SQ318', deviceSk('2026-12-13', IOS)).sent_rev.S, KNOWN);
    assert.ok(ddb.get(A, 'SQ318', 'e#evt-1'));
    assert.equal(senders.closed, 1, 'the APNs session is closed in finally');
    const [line] = lines();
    assert.deepEqual([line.sent, line.devices, line.claim_lost, line.send_failed], [2, 2, 0, 0]);
  });

  test('the same revision → ignored/no_change, nothing sent, event recorded', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS, rev: KNOWN }] });
    const { webhook, senders } = make({ ddb });
    const res = await webhook(ev());
    assert.deepEqual([json(res).outcome, json(res).reason], ['ignored', 'no_change']);
    assert.equal(senders.sent.length, 0);
    assert.equal(lines()[0].skipped_same_rev, 1);
  });

  test("no device has a leg in the payload (another day's instance only) → ignored/no_leg", async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS, rev: KNOWN }] });
    const { webhook, senders } = make({ ddb });
    const nextInstance = {
      ...SQ318,
      departure: { ...SQ318.departure, scheduledLocal: '2026-12-14 23:05+08:00' },
    };
    const res = await webhook(ev({ legs: [nextInstance] }));
    assert.deepEqual([json(res).outcome, json(res).reason], ['ignored', 'no_leg']);
    assert.equal(senders.sent.length, 0);
    assert.deepEqual([lines()[0].skipped_no_leg, lines()[0].skipped_same_rev], [1, 0]);
  });

  test('a replayed notification id → replay, no second send', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS }] });
    const { webhook, senders } = make({ ddb });
    await webhook(ev());
    const again = await webhook(ev());
    assert.equal(json(again).outcome, 'replay');
    assert.equal(senders.sent.length, 1);
  });

  test('two concurrent deliveries of one id: one send per device (markSent arbitrates)', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS }] });
    const { webhook, senders } = make({ ddb });
    const [a, b] = await Promise.all([webhook(ev()), webhook(ev())]);
    assert.equal(senders.sent.length, 1);
    assert.deepEqual([a.statusCode, b.statusCode], [200, 200]);
    assert.equal(
      lines().reduce((n, l) => n + l.claim_lost, 0),
      1
    );
  });

  test('a store fault on the claim → 500 and NO replay guard; the retry then sends nothing twice', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS }, { token: AND, platform: 'android' }] });
    let failOnce = true;
    ddb.failOn((op, input) => {
      if (
        op === 'UpdateItemCommand' &&
        input.Key.sk.S === deviceSk('2026-12-13', AND) &&
        failOnce
      ) {
        failOnce = false;
        return true;
      }
      return false;
    });
    const { webhook, senders } = make({ ddb });
    const first = await webhook(ev());
    assert.equal(first.statusCode, 500);
    assert.equal(json(first).code, 'alerts_unavailable');
    assert.equal(ddb.get(A, 'SQ318', 'e#evt-1'), undefined, 'no replay guard after a 500');
    assert.equal(senders.sent.length, 1, 'the claimed device was sent');
    const retry = await webhook(ev());
    assert.equal(retry.statusCode, 200);
    assert.equal(senders.sent.length, 2, 'the retry sends only the unclaimed device');
    assert.deepEqual(senders.sent.map((s) => s.platform).sort(), ['android', 'ios']);
  });

  test('a store fault on the load → 500; on recordEvent → 500', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS }] });
    ddb.failOn((op) => op === 'QueryCommand');
    assert.equal((await make({ ddb }).webhook(ev())).statusCode, 500);
    const ddb2 = fakeDdb();
    seedFlight(ddb2, { devices: [{ token: IOS }] });
    ddb2.failOn((op, input) => op === 'PutItemCommand' && input.Item.sk.S.startsWith('e#'));
    assert.equal((await make({ ddb: ddb2 }).webhook(ev())).statusCode, 500);
  });

  test('an invalid token deletes ONLY that device (no provider call, p untouched); apns_reason logged', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS }, { token: AND, platform: 'android' }] });
    const senders = fakeSenders((platform) =>
      platform === 'ios'
        ? { ok: false, invalidToken: true, status: 400, code: 'BadDeviceToken' }
        : { ok: true }
    );
    const { webhook, provider } = make({ ddb, senders });
    await webhook(ev());
    assert.equal(ddb.get(A, 'SQ318', deviceSk('2026-12-13', IOS)), undefined);
    assert.ok(ddb.get(A, 'SQ318', deviceSk('2026-12-13', AND)));
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'sub-1');
    assert.deepEqual(provider.calls, []);
    const [line] = lines();
    assert.deepEqual(
      [line.invalid_tokens, line.sent, line.apns_reason, line.send_failed],
      [1, 1, 'BadDeviceToken', 0]
    );
    assert.ok(
      !logs().error.some((l) => l.startsWith(PUSH_SEND_FAILED_PREFIX)),
      'an invalid token is info'
    );
  });

  test('a non-token send failure is alarmed, keeps the claim and is not retried', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: AND, platform: 'android' }] });
    const senders = fakeSenders(() => ({
      ok: false,
      invalidToken: false,
      status: 500,
      code: 'INTERNAL',
    }));
    const { webhook } = make({ ddb, senders });
    const res = await webhook(ev());
    assert.equal(res.statusCode, 200);
    assert.ok(
      logs().error.some((l) =>
        l.startsWith(`${PUSH_SEND_FAILED_PREFIX} platform=android flight=SQ318`)
      )
    );
    assert.equal(ddb.get(A, 'SQ318', deviceSk('2026-12-13', AND)).sent_rev.S, KNOWN, 'claim kept');
    assert.equal(lines()[0].send_failed, 1);
  });
});

describe('webhook: credits', () => {
  test('balance under the floor refills once; a payload with NO balance refills nothing; above it nothing', async () => {
    // `null` here is a payload without a balance field (a stray or hand-made POST), not an empty
    // balance: only the sweep's own balance read may treat null as zero.
    for (const [credits, refills] of [
      [50, 1],
      [null, 0],
      [500, 0],
    ]) {
      const ddb = fakeDdb();
      seedFlight(ddb, { devices: [{ token: IOS, rev: KNOWN }] });
      const { webhook, provider } = make({ ddb });
      await webhook(ev({ credits }));
      assert.equal(
        provider.calls.filter(([n]) => n === 'refillCredits').length,
        refills,
        String(credits)
      );
    }
    assert.equal(linesFor(logs(), CREDITS_REFILLED_PREFIX).length, 1);
  });

  test('credits are topped up on ignored answers too (the balance rides every notification)', async () => {
    const { webhook, provider } = make();
    await webhook(ev({ credits: 0 }));
    assert.equal(provider.calls.filter(([n]) => n === 'refillCredits').length, 1);
    assert.equal(lines()[0].reason, 'unknown_flight');
    assert.equal(lines()[0].refilled, true);
  });
});

describe('webhook: privacy', () => {
  test('no push token, secret or raw path in any line', async () => {
    const ddb = fakeDdb();
    seedFlight(ddb, { devices: [{ token: IOS }, { token: AND, platform: 'android' }] });
    await make({ ddb }).webhook(ev());
    const all = [...logs().log, ...logs().warn, ...logs().error].join('\n');
    for (const s of [IOS, AND, HOOK, '198.51.100.9']) assert.ok(!all.includes(s));
  });
});
