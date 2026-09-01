/**
 * The per-device secret is create-on-miss, and #80 put a third consumer on the BOOT path.
 * Two concurrent misses would each mint 32 random bytes and both write — last write wins,
 * and anything sealed with the losing key fails as `key-changed` on the next boot, i.e. an
 * unexplained logout. The in-flight memo is what stops that, so it is pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  getCalls: 0,
  saveCalls: 0,
  throwOnGet: false,
}));

vi.mock('@/services/indexeddb/repositories/deviceUnlockRepository', () => ({
  getDeviceSecret: async () => {
    store.getCalls += 1;
    if (store.throwOnGet) throw new Error('registry unavailable');
    return store.record;
  },
  saveDeviceSecret: async (r: Record<string, unknown>) => {
    store.saveCalls += 1;
    store.record = r;
  },
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { getOrCreateDeviceSecret, __resetDeviceSecretCacheForTests } from '../deviceSecret';

beforeEach(() => {
  store.record = null;
  store.getCalls = 0;
  store.saveCalls = 0;
  store.throwOnGet = false;
  __resetDeviceSecretCacheForTests();
});

describe('deviceSecret', () => {
  it('two concurrent callers on an empty store share ONE secret and write once', async () => {
    const [a, b] = await Promise.all([getOrCreateDeviceSecret(), getOrCreateDeviceSecret()]);
    expect(a.baseKey).toBe(b.baseKey);
    expect(store.saveCalls).toBe(1);
  });

  it('does not cache a failure — a later call retries and succeeds', async () => {
    store.throwOnGet = true;
    await expect(getOrCreateDeviceSecret()).rejects.toThrow('registry unavailable');
    store.throwOnGet = false;
    await expect(getOrCreateDeviceSecret()).resolves.toMatchObject({ kdf: 'hkdf' });
  });

  it('reuses an existing stored key rather than minting a new one', async () => {
    const first = await getOrCreateDeviceSecret();
    __resetDeviceSecretCacheForTests();
    const second = await getOrCreateDeviceSecret();
    expect(store.saveCalls).toBe(1);
    expect(second.baseKey).toBe(first.baseKey);
  });
});
