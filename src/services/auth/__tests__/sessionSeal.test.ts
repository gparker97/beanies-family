/**
 * Session seal (#80).
 *
 * The classification matrix is the point of this suite: `bad-signature` must mean "the
 * key is right and the payload was edited" and nothing else, because that is the only
 * metric that means somebody tampered. Device-secret loss (`key-changed`) and a missing
 * key (`unavailable`) are expected environmental states and must never be confused with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  throwOnGet: false,
}));

vi.mock('@/services/indexeddb/repositories/deviceUnlockRepository', () => ({
  getDeviceSecret: async () => {
    if (store.throwOnGet) throw new Error('registry unavailable');
    return store.record;
  },
  saveDeviceSecret: async (r: Record<string, unknown>) => {
    store.record = r;
  },
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { seal, open, LEGACY_SESSION_SUNSET, __resetSessionKeyCacheForTests } from '../sessionSeal';
import { __resetDeviceSecretCacheForTests } from '../deviceSecret';

const user = { memberId: 'm1', email: 'a@b.c', familyId: 'fam-1', role: 'member' as const };

beforeEach(() => {
  store.record = null;
  store.throwOnGet = false;
  __resetSessionKeyCacheForTests();
  __resetDeviceSecretCacheForTests();
});
afterEach(() => vi.useRealTimers());

describe('sessionSeal', () => {
  it('round-trips a sealed session', async () => {
    const raw = await seal(user);
    expect(raw).toBeTruthy();
    const result = await open(raw!);
    expect(result).toMatchObject({ ok: true, legacy: false });
    expect(result.ok && result.user.memberId).toBe('m1');
  });

  it('rejects an edited payload as bad-signature', async () => {
    const raw = await seal(user);
    const env = JSON.parse(raw!);
    env.p.memberId = 'owner-id'; // the actual attack
    expect(await open(JSON.stringify(env))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects an edited role as bad-signature', async () => {
    const raw = await seal(user);
    const env = JSON.parse(raw!);
    env.p.role = 'owner';
    expect(await open(JSON.stringify(env))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects junk and a truncated envelope as malformed', async () => {
    expect(await open('not json')).toEqual({ ok: false, reason: 'malformed' });
    expect(await open('null')).toEqual({ ok: false, reason: 'malformed' });
    expect(await open(JSON.stringify({ v: 1, k: 'x', t: 'y' }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('reports a regenerated device secret as key-changed, NOT bad-signature', async () => {
    const raw = await seal(user);
    // Simulate an ITP eviction: registry emptied, a fresh secret minted on next use.
    store.record = null;
    __resetSessionKeyCacheForTests();
    __resetDeviceSecretCacheForTests();
    expect(await open(raw!)).toEqual({ ok: false, reason: 'key-changed' });
  });

  it('reports a missing key as unavailable, and does not poison the cache', async () => {
    store.throwOnGet = true;
    expect(await seal(user)).toBeNull();
    // A later call, once storage works, must still succeed — a memoised failure would
    // silently disable sealing for the rest of the page load.
    store.throwOnGet = false;
    expect(await seal(user)).toBeTruthy();
  });

  it('distinguishes unavailable from tampering when opening', async () => {
    const raw = await seal(user);
    store.throwOnGet = true;
    __resetSessionKeyCacheForTests();
    __resetDeviceSecretCacheForTests();
    expect(await open(raw!)).toEqual({ ok: false, reason: 'unavailable' });
  });

  describe('the bounded legacy branch (delete with issue #80-b)', () => {
    it('accepts a bare pre-#80 session BEFORE the sunset', async () => {
      vi.setSystemTime(LEGACY_SESSION_SUNSET - 1000);
      const result = await open(JSON.stringify(user));
      expect(result).toMatchObject({ ok: true, legacy: true });
    });

    it('rejects a bare session AFTER the sunset, so the branch cannot outlive itself', async () => {
      vi.setSystemTime(LEGACY_SESSION_SUNSET + 1000);
      expect(await open(JSON.stringify(user))).toEqual({ ok: false, reason: 'malformed' });
    });

    it('rejects a bare object with no memberId even before the sunset', async () => {
      vi.setSystemTime(LEGACY_SESSION_SUNSET - 1000);
      expect(await open(JSON.stringify({ nope: true }))).toEqual({
        ok: false,
        reason: 'malformed',
      });
    });
  });
});
