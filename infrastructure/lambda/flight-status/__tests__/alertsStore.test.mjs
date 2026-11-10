import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAIM_STALE_S,
  STORE_UNAVAILABLE_PREFIX,
  createAlertsStore,
  dateOfSk,
  deviceSk,
  expiresAtFor,
  refillKey,
} from '../alertsStore.mjs';
import { hash } from '../ddb.mjs';
import { captureConsole, fakeDdb } from './helpers.mjs';

const T = 'alerts-test';
const NOW_S = Math.floor(Date.parse('2026-12-10T12:00:00Z') / 1000);
const logs = captureConsole();

const device = (over = {}) => ({
  push_token: 'a'.repeat(64),
  platform: 'ios',
  lang: 'en',
  dep: 'SIN',
  arr: 'LHR',
  sent_rev: 'r1',
  created_at: NOW_S,
  expires_at: expiresAtFor('2026-12-13'),
  ...over,
});

function make(opts) {
  const ddb = fakeDdb(opts);
  return { ddb, store: createAlertsStore({ table: T, ddb }) };
}

describe('grammar', () => {
  test('device sk hashes the token; the TTL rule is date 00:00Z + 72 h; refill is its own partition', () => {
    const sk = deviceSk('2026-12-13', 'tok');
    assert.equal(sk, `d#2026-12-13#${hash('tok')}`);
    assert.ok(!sk.includes('tok#') && !sk.endsWith('tok'));
    assert.equal(dateOfSk(sk), '2026-12-13');
    assert.equal(expiresAtFor('2026-12-13'), Date.parse('2026-12-16T00:00:00Z') / 1000);
    assert.deepEqual(refillKey('2026-12-10'), { pk: 'r#2026-12-10', sk: 'n' });
  });
});

describe('devices', () => {
  test('putDevice overwrites (sent_rev included); deleteDevice is idempotent', async () => {
    const { ddb, store } = make();
    const sk = deviceSk('2026-12-13', 'a'.repeat(64));
    assert.deepEqual(await store.putDevice('SQ318', sk, device()), { ok: true });
    await store.putDevice('SQ318', sk, device({ sent_rev: 'r2', lang: 'zh' }));
    const item = ddb.get(T, 'SQ318', sk);
    assert.equal(item.sent_rev.S, 'r2');
    assert.equal(item.lang.S, 'zh');
    assert.deepEqual(await store.hasDevice('SQ318', sk), { ok: true, exists: true });
    assert.deepEqual(await store.deleteDevice('SQ318', sk), { ok: true });
    assert.deepEqual(await store.deleteDevice('SQ318', sk), { ok: true });
    assert.deepEqual(await store.hasDevice('SQ318', sk), { ok: true, exists: false });
  });

  test('arr is optional', async () => {
    const { ddb, store } = make();
    const sk = deviceSk('2026-12-13', 'b'.repeat(64));
    await store.putDevice('SQ318', sk, device({ arr: undefined }));
    assert.equal(ddb.get(T, 'SQ318', sk).arr, undefined);
  });

  test('loadFlight: ONE partition Query; expired devices dropped and counted; provider and events', async () => {
    const { ddb, store } = make({ pageSize: 2 });
    ddb.seed(T, { pk: 'SQ318', sk: 'p', provider_id: 'sub-1', created_at: NOW_S });
    ddb.seed(T, { pk: 'SQ318', sk: 'e#evt-1', expires_at: NOW_S + 10 });
    await store.putDevice('SQ318', deviceSk('2026-12-13', 'a'.repeat(64)), device());
    await store.putDevice(
      'SQ318',
      deviceSk('2026-12-01', 'c'.repeat(64)),
      device({ expires_at: NOW_S - 1 })
    );
    ddb.seed(T, { pk: 'SQ319', sk: 'p', provider_id: 'other' });
    const out = await store.loadFlight('SQ318', NOW_S);
    assert.equal(out.ok, true);
    assert.equal(out.provider.providerId, 'sub-1');
    assert.equal(out.devices.length, 1);
    assert.equal(out.devices[0].date, '2026-12-13');
    assert.equal(out.devices[0].sent_rev, 'r1');
    assert.equal(out.expired, 1);
    assert.deepEqual([...out.eventIds], ['evt-1']);
    assert.ok(ddb.ops().every((op) => op === 'PutItemCommand' || op === 'QueryCommand'));
    assert.ok(
      ddb.ops().filter((o) => o === 'QueryCommand').length >= 2,
      'follows LastEvaluatedKey'
    );
  });

  test('countDevices: Select COUNT over one date, live only', async () => {
    const { store } = make();
    await store.putDevice('SQ318', deviceSk('2026-12-13', 'a'.repeat(64)), device());
    await store.putDevice('SQ318', deviceSk('2026-12-13', 'b'.repeat(64)), device());
    await store.putDevice('SQ318', deviceSk('2026-12-14', 'c'.repeat(64)), device());
    await store.putDevice(
      'SQ318',
      deviceSk('2026-12-13', 'd'.repeat(64)),
      device({ expires_at: NOW_S })
    );
    assert.deepEqual(await store.countDevices('SQ318', '2026-12-13', NOW_S), {
      ok: true,
      count: 2,
    });
  });
});

describe('provider item', () => {
  test('claim creates p; a second claim loses; fill sets the id and drops the claim', async () => {
    const { ddb, store } = make();
    assert.deepEqual(await store.claimProvider('SQ318', NOW_S), {
      ok: true,
      won: true,
      stale: false,
    });
    assert.equal(ddb.get(T, 'SQ318', 'p').claimed_at.N, String(NOW_S));
    assert.deepEqual(await store.claimProvider('SQ318', NOW_S + 5), {
      ok: true,
      won: false,
      stale: false,
    });
    await store.fillProvider('SQ318', 'sub-1', NOW_S + 6);
    const p = (await store.getProvider('SQ318')).provider;
    assert.deepEqual(p, { providerId: 'sub-1', claimedAt: null, createdAt: NOW_S });
    assert.equal(
      (await store.claimProvider('SQ318', NOW_S + 999)).won,
      false,
      'an id blocks every claim'
    );
  });

  test('a stale claim (older than 60 s) is re-claimable; a fresh one is not', async () => {
    const { store } = make();
    await store.claimProvider('SQ318', NOW_S);
    assert.equal((await store.claimProvider('SQ318', NOW_S + 30)).won, false);
    assert.deepEqual(await store.claimProvider('SQ318', NOW_S + CLAIM_STALE_S + 1), {
      ok: true,
      won: true,
      stale: true,
    });
  });

  test('releaseClaim keeps p; on a missing p it is a no-op that creates nothing', async () => {
    const { ddb, store } = make();
    await store.claimProvider('SQ318', NOW_S);
    assert.deepEqual(await store.releaseClaim('SQ318'), { ok: true });
    assert.ok(ddb.get(T, 'SQ318', 'p'));
    assert.equal(ddb.get(T, 'SQ318', 'p').claimed_at, undefined);
    assert.equal(
      (await store.claimProvider('SQ318', NOW_S + 1)).won,
      true,
      'claimable again at once'
    );
    assert.deepEqual(await store.releaseClaim('ZZ1'), { ok: true });
    assert.equal(ddb.get(T, 'ZZ1', 'p'), undefined);
  });

  test('fillProvider creates p for a bare number (sweep adoption); deleteProvider removes it', async () => {
    const { ddb, store } = make();
    await store.fillProvider('SQ318', 'sub-9', NOW_S);
    assert.equal(ddb.get(T, 'SQ318', 'p').provider_id.S, 'sub-9');
    await store.deleteProvider('SQ318');
    assert.deepEqual(await store.getProvider('SQ318'), { ok: true, provider: null });
  });
});

describe('webhook and sweep primitives', () => {
  test('markSent claims once: the old value must still be there', async () => {
    const { store } = make();
    const sk = deviceSk('2026-12-13', 'a'.repeat(64));
    await store.putDevice('SQ318', sk, device());
    assert.deepEqual(await store.markSent('SQ318', sk, 'r1', 'r2'), { ok: true, claimed: true });
    assert.deepEqual(await store.markSent('SQ318', sk, 'r1', 'r2'), { ok: true, claimed: false });
    assert.deepEqual(await store.markSent('SQ318', 'd#2026-12-13#gone', 'r1', 'r2'), {
      ok: true,
      claimed: false,
    });
  });

  test('recordEvent writes a 24 h guard', async () => {
    const { ddb, store } = make();
    await store.recordEvent('SQ318', 'evt-1', NOW_S);
    assert.equal(ddb.get(T, 'SQ318', 'e#evt-1').expires_at.N, String(NOW_S + 86_400));
  });

  test('scanAll follows LastEvaluatedKey and never projects the push token', async () => {
    const { ddb, store } = make({ pageSize: 1 });
    await store.putDevice('SQ318', deviceSk('2026-12-13', 'a'.repeat(64)), device());
    ddb.seed(T, { pk: 'SQ318', sk: 'p', provider_id: 'sub-1' });
    ddb.seed(T, { pk: 'r#2026-12-10', sk: 'n', n: 1 });
    const out = await store.scanAll();
    assert.equal(out.items.length, 3);
    assert.ok(
      ddb.calls
        .filter((c) => c.op === 'ScanCommand')
        .every((c) => !c.input.ProjectionExpression.includes('push_token'))
    );
    assert.ok(out.items.every((i) => !('push_token' in i)));
  });

  test('takeRefillToken: allowed up to the cap, then refused, in the global r# partition', async () => {
    const { ddb, store } = make();
    assert.deepEqual(await store.takeRefillToken('2026-12-10', 2), { ok: true, allowed: true });
    assert.deepEqual(await store.takeRefillToken('2026-12-10', 2), { ok: true, allowed: true });
    assert.deepEqual(await store.takeRefillToken('2026-12-10', 2), { ok: true, allowed: false });
    assert.equal(ddb.get(T, 'r#2026-12-10', 'n').n.N, '2');
    assert.deepEqual(await store.takeRefillToken('2026-12-11', 2), { ok: true, allowed: true });
  });
});

describe('fail closed', () => {
  test('every function: a store fault → { ok: false } and ONE alarmed line naming table + action', async () => {
    const { ddb, store } = make();
    ddb.failOn(() => true);
    const sk = deviceSk('2026-12-13', 'a'.repeat(64));
    const calls = {
      putDevice: () => store.putDevice('SQ318', sk, device()),
      deleteDevice: () => store.deleteDevice('SQ318', sk),
      hasDevice: () => store.hasDevice('SQ318', sk),
      loadFlight: () => store.loadFlight('SQ318', NOW_S),
      countDevices: () => store.countDevices('SQ318', '2026-12-13', NOW_S),
      getProvider: () => store.getProvider('SQ318'),
      claimProvider: () => store.claimProvider('SQ318', NOW_S),
      fillProvider: () => store.fillProvider('SQ318', 'x', NOW_S),
      releaseClaim: () => store.releaseClaim('SQ318'),
      deleteProvider: () => store.deleteProvider('SQ318'),
      scanAll: () => store.scanAll(),
      recordEvent: () => store.recordEvent('SQ318', 'e', NOW_S),
      markSent: () => store.markSent('SQ318', sk, 'a', 'b'),
      takeRefillToken: () => store.takeRefillToken('2026-12-10', 2),
    };
    for (const [name, call] of Object.entries(calls)) {
      const before = logs().error.length;
      const out = await call();
      assert.equal(out.ok, false, name);
      assert.equal(out.error, 'ServiceUnavailable', name);
      const lines = logs().error.slice(before);
      assert.equal(lines.length, 1, name);
      assert.ok(lines[0].startsWith(STORE_UNAVAILABLE_PREFIX), name);
      assert.match(lines[0], new RegExp(`${T}.*dynamodb:\\w+`), name);
    }
  });

  test('unset table: every call is { ok: false, error: table_unset } and says so', async () => {
    const store = createAlertsStore({ table: '', ddb: fakeDdb() });
    assert.deepEqual(await store.getProvider('SQ318'), { ok: false, error: 'table_unset' });
    assert.ok(
      logs().error[0].startsWith(`${STORE_UNAVAILABLE_PREFIX} op=get_provider reason=table_unset`)
    );
  });
});
