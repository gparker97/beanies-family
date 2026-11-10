import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLEANUP_ABORTED_PREFIX,
  CLEANUP_HEARTBEAT_PREFIX,
  PROVIDER_CANCEL_FAILED_PREFIX,
  createCleanup,
} from '../cleanup.mjs';
import { deviceSk, expiresAtFor } from '../alertsStore.mjs';
import { FakeProviderError, captureConsole, fakeAlertsClient, fakeDdb } from './helpers.mjs';

const NOW = Date.parse('2026-12-12T12:00:00Z');
const NOW_S = Math.floor(NOW / 1000);
const A = 'alerts-test';
const C = 'cache-test';
const HOOK = 'hook-secret-0123456789abcdef0123456789abcdef';
const BASE = 'https://api.beanies.family';
const OWN = `${BASE}/flight-status/webhook/${HOOK}`;
const STALE = `${BASE}/flight-status/webhook/old-secret-0123456789abcdef0123456789`;
const FOREIGN = 'https://webhook.site/abc';
const ENV = Object.freeze({
  ALERTS_TABLE: A,
  CACHE_TABLE: C,
  AERODATABOX_WEBHOOK_SECRET: HOOK,
  WEBHOOK_BASE_URL: BASE,
  DAILY_PROVIDER_CAP: '75',
});

const logs = captureConsole();

function heartbeat() {
  const line = logs().log.find((l) => l.startsWith(CLEANUP_HEARTBEAT_PREFIX));
  return line ? JSON.parse(line.slice(CLEANUP_HEARTBEAT_PREFIX.length + 1)) : null;
}

function seedDevice(ddb, flight, { token = 'a'.repeat(64), date = '2026-12-13', expires } = {}) {
  ddb.seed(A, {
    pk: flight,
    sk: deviceSk(date, token),
    push_token: token,
    platform: 'ios',
    lang: 'en',
    dep: 'SIN',
    sent_rev: 'r',
    created_at: NOW_S - 9,
    expires_at: expires ?? expiresAtFor(date),
  });
}

function make({ ddb = fakeDdb(), provider = fakeAlertsClient(), env = {} } = {}) {
  const cleanup = createCleanup({ provider, env: { ...ENV, ...env }, ddb, now: () => NOW });
  return { cleanup, ddb, provider };
}

describe('cleanup: the two-way reconcile', () => {
  test('adopt: live devices + an own subscription → p gets its id (p missing, or holding another)', async () => {
    const ddb = fakeDdb();
    seedDevice(ddb, 'SQ318');
    seedDevice(ddb, 'BA12');
    ddb.seed(A, { pk: 'BA12', sk: 'p', provider_id: 'gone', created_at: NOW_S - 99 });
    const provider = fakeAlertsClient();
    provider.state.subs = [
      { id: 'own-1', flight: 'SQ318', url: OWN },
      { id: 'own-2', flight: 'BA12', url: OWN },
    ];
    const { cleanup } = make({ ddb, provider });
    const out = await cleanup({ task: 'cleanup' });
    assert.equal(out.ok, true);
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'own-1');
    assert.equal(ddb.get(A, 'BA12', 'p').provider_id.S, 'own-2');
    assert.equal(heartbeat().adopted, 2);
    assert.ok(!provider.calls.some(([n]) => n === 'cancelAlert' || n === 'subscribeAlert'));
  });

  test('subscribe: live devices + no own subscription → claim, day token, subscribe, fill', async () => {
    const ddb = fakeDdb();
    seedDevice(ddb, 'SQ318');
    ddb.seed(A, { pk: 'SQ318', sk: 'p', claimed_at: NOW_S - 600, created_at: NOW_S - 600 }); // a dead claim
    const { cleanup, provider } = make({ ddb });
    await cleanup();
    assert.deepEqual(
      provider.calls.filter(([n]) => n === 'subscribeAlert'),
      [['subscribeAlert', 'SQ318', OWN]]
    );
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'sub-1');
    assert.equal(ddb.get(C, 'g#2026-12-12').n.N, '1');
    assert.equal(heartbeat().subscribed, 1);
  });

  test('cancel when empty: no live devices → p deleted, then every own subscription cancelled', async () => {
    const ddb = fakeDdb();
    seedDevice(ddb, 'SQ318', { expires: NOW_S - 1 });
    ddb.seed(A, { pk: 'SQ318', sk: 'p', provider_id: 'own-1' });
    const provider = fakeAlertsClient();
    provider.state.subs = [{ id: 'own-1', flight: 'SQ318', url: OWN }];
    const { cleanup } = make({ ddb, provider });
    await cleanup();
    assert.equal(ddb.get(A, 'SQ318', 'p'), undefined);
    assert.deepEqual(provider.state.subs, []);
    assert.equal(heartbeat().cancelled, 1);
  });

  test('a subscribe that lands after the Scan (answered ready for this p) keeps p and the subscription', async () => {
    const ddb = fakeDdb();
    seedDevice(ddb, 'SQ318', { expires: NOW_S - 1 });
    ddb.seed(A, { pk: 'SQ318', sk: 'p', provider_id: 'own-1' });
    const provider = fakeAlertsClient({
      // The provider list call runs after the Scan: a device registers meanwhile.
      listAlerts: async () => {
        seedDevice(ddb, 'SQ318', { token: 'b'.repeat(64) });
        return [{ id: 'own-1', flight: 'SQ318', url: OWN }];
      },
    });
    const { cleanup } = make({ ddb, provider });
    await cleanup();
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'own-1');
    assert.ok(!provider.calls.some(([n]) => n === 'cancelAlert'));
    assert.equal(heartbeat().cancelled, 0);
  });

  test('an own "orphan" whose number gained a device and a p after the Scan is NOT cancelled', async () => {
    const ddb = fakeDdb();
    const provider = fakeAlertsClient({
      // A subscribe lands between the Scan and the list call: device put, claim, subscribe, fill.
      listAlerts: async () => {
        seedDevice(ddb, 'SQ318');
        ddb.seed(A, { pk: 'SQ318', sk: 'p', provider_id: 'own-1', created_at: NOW_S });
        return [{ id: 'own-1', flight: 'SQ318', url: OWN }];
      },
    });
    const { cleanup } = make({ ddb, provider });
    await cleanup();
    assert.ok(!provider.calls.some(([n]) => n === 'cancelAlert'), 'own-1 not cancelled');
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'own-1');
    assert.equal(heartbeat().cancelled, 0);
  });

  test('an own "orphan" whose number gained a p (no live device) after the Scan is left to the next sweep', async () => {
    const ddb = fakeDdb();
    const provider = fakeAlertsClient({
      listAlerts: async () => {
        ddb.seed(A, { pk: 'SQ318', sk: 'p', provider_id: 'own-1', created_at: NOW_S });
        return [{ id: 'own-1', flight: 'SQ318', url: OWN }];
      },
    });
    const { cleanup } = make({ ddb, provider });
    await cleanup();
    assert.ok(!provider.calls.some(([n]) => n === 'cancelAlert'));
    assert.ok(
      ddb.get(A, 'SQ318', 'p'),
      'p left for the next sweep (it then deletes p and cancels)'
    );
  });

  test('an own orphan (own url, no p, no devices) is cancelled', async () => {
    const provider = fakeAlertsClient();
    provider.state.subs = [{ id: 'orphan', flight: 'QF1', url: OWN }];
    const { cleanup } = make({ provider });
    await cleanup();
    assert.deepEqual(provider.state.subs, []);
    assert.deepEqual([heartbeat().numbers, heartbeat().own, heartbeat().cancelled], [1, 1, 1]);
  });

  test('duplicate own subscriptions for one number: keep the one p names, cancel the rest', async () => {
    const ddb = fakeDdb();
    seedDevice(ddb, 'SQ318');
    ddb.seed(A, { pk: 'SQ318', sk: 'p', provider_id: 'own-2' });
    const provider = fakeAlertsClient();
    provider.state.subs = [
      { id: 'own-1', flight: 'SQ318', url: OWN },
      { id: 'own-2', flight: 'SQ318', url: OWN },
    ];
    const { cleanup } = make({ ddb, provider });
    await cleanup();
    assert.deepEqual(
      provider.state.subs.map((s) => s.id),
      ['own-2']
    );
    assert.equal(heartbeat().adopted, 0);
  });

  test('a stale-secret url is cancelled and the number re-subscribed under the new url', async () => {
    const ddb = fakeDdb();
    seedDevice(ddb, 'SQ318');
    ddb.seed(A, { pk: 'SQ318', sk: 'p', provider_id: 'old-1' });
    const provider = fakeAlertsClient();
    provider.state.subs = [{ id: 'old-1', flight: 'SQ318', url: STALE }];
    const { cleanup } = make({ ddb, provider });
    await cleanup();
    assert.deepEqual(
      provider.state.subs.map((s) => s.url),
      [OWN]
    );
    assert.equal(ddb.get(A, 'SQ318', 'p').provider_id.S, 'sub-1');
    const hb = heartbeat();
    assert.deepEqual([hb.stale, hb.cancelled, hb.subscribed], [1, 1, 1]);
  });

  test('a foreign url is never touched, only counted', async () => {
    const provider = fakeAlertsClient();
    provider.state.subs = [
      { id: 'f-1', flight: 'SQ318', url: FOREIGN },
      { id: 'f-2', flight: null, url: '' },
    ];
    const { cleanup } = make({ provider });
    await cleanup();
    assert.equal(provider.state.subs.length, 2);
    assert.deepEqual([heartbeat().foreign, heartbeat().cancelled], [2, 0]);
  });

  test('a failed cancel is counted and alarmed; the next sweep retries it', async () => {
    let fail = true;
    const provider = fakeAlertsClient({
      cancelAlert: async (id) => {
        if (fail) throw new FakeProviderError('upstream_unavailable', 503);
        provider.state.subs = provider.state.subs.filter((s) => s.id !== id);
      },
    });
    provider.state.subs = [{ id: 'orphan', flight: 'QF1', url: OWN }];
    const { cleanup } = make({ provider });
    await cleanup();
    assert.equal(heartbeat().cancel_failed, 1);
    assert.ok(
      logs().error.some((l) =>
        l.startsWith(`${PROVIDER_CANCEL_FAILED_PREFIX} flight=QF1 code=upstream_unavailable`)
      )
    );
    fail = false;
    await cleanup();
    assert.deepEqual(provider.state.subs, []);
  });

  test('the r# refill partition is never read as a number', async () => {
    const ddb = fakeDdb();
    ddb.seed(A, { pk: 'r#2026-12-12', sk: 'n', n: 1 });
    const { cleanup } = make({ ddb });
    await cleanup();
    assert.equal(heartbeat().numbers, 0);
  });
});

describe('cleanup: credits and the heartbeat', () => {
  test('the balance is read and refilled under the floor; null seeds it', async () => {
    const provider = fakeAlertsClient();
    provider.state.balance = null;
    const { cleanup } = make({ provider });
    await cleanup();
    assert.ok(provider.calls.some(([n]) => n === 'refillCredits'));
    assert.deepEqual([heartbeat().refilled, heartbeat().credits_remaining], [true, 200]);
  });

  test('the heartbeat is the LAST line, has the fixed field set and never a url', async () => {
    const provider = fakeAlertsClient();
    provider.state.subs = [
      { id: 'o', flight: 'QF1', url: OWN },
      { id: 's', flight: 'QF2', url: STALE },
      { id: 'f', flight: 'QF3', url: FOREIGN },
    ];
    const { cleanup } = make({ provider });
    await cleanup();
    assert.ok(logs().log.at(-1).startsWith(CLEANUP_HEARTBEAT_PREFIX));
    assert.deepEqual(Object.keys(heartbeat()).sort(), [
      'adopted',
      'cancel_failed',
      'cancelled',
      'credits_remaining',
      'foreign',
      'listed',
      'numbers',
      'own',
      'refilled',
      'route',
      'stale',
      'subscribed',
    ]);
    assert.equal(heartbeat().route, 'cleanup');
    const all = [...logs().log, ...logs().warn, ...logs().error].join('\n');
    for (const s of [HOOK, OWN, STALE, FOREIGN, 'old-secret']) assert.ok(!all.includes(s), s);
  });

  test('no heartbeat when a step fails: store scan, provider list, unset webhook config', async () => {
    const ddb = fakeDdb();
    ddb.failOn((op) => op === 'ScanCommand');
    assert.equal((await make({ ddb }).cleanup()).ok, false);
    const listFails = fakeAlertsClient({
      listAlerts: () => {
        throw new FakeProviderError('upstream_auth', 401);
      },
    });
    assert.equal((await make({ provider: listFails }).cleanup()).ok, false);
    assert.equal((await make({ env: { AERODATABOX_WEBHOOK_SECRET: '' } }).cleanup()).ok, false);
    assert.equal(heartbeat(), null);
    assert.equal(logs().error.filter((l) => l.startsWith(CLEANUP_ABORTED_PREFIX)).length, 3);
  });

  test('a reconcile step that throws means no heartbeat (a missing heartbeat, never a false one)', async () => {
    const ddb = fakeDdb();
    seedDevice(ddb, 'SQ318');
    const poisoned = {
      flight: 'SQ318',
      url: OWN,
      get id() {
        throw new TypeError('boom');
      },
    };
    const provider = fakeAlertsClient({ listAlerts: () => [poisoned] });
    const out = await make({ ddb, provider }).cleanup();
    assert.deepEqual(out, { ok: false, reason: 'reconcile_threw' });
    assert.equal(heartbeat(), null);
    assert.ok(
      logs().error.some((l) => l.startsWith(`${CLEANUP_ABORTED_PREFIX} reason=reconcile_threw`))
    );
  });

  test('a balance read failure is logged; the sweep still heartbeats', async () => {
    const provider = fakeAlertsClient({
      getBalance: () => {
        throw new FakeProviderError('upstream_timeout');
      },
    });
    const { cleanup } = make({ provider });
    await cleanup();
    assert.ok(
      logs().error.some((l) => l.startsWith('[flight-alerts] cleanup balance read failed'))
    );
    assert.ok(heartbeat());
  });
});
