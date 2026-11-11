import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

// A controllable `openDB`: each call returns a promise the test settles by hand.
const opens = vi.hoisted(() => ({
  pending: [] as Array<{ resolve: (db: unknown) => void; reject: (e: unknown) => void }>,
}));
vi.mock('idb', () => ({
  openDB: vi.fn(
    () =>
      new Promise((resolve, reject) => {
        opens.pending.push({ resolve, reject });
      })
  ),
}));

import { openDB } from 'idb';
import { storageStalled, clearStorageStall } from '@/utils/storageStall';

const fakeDb = () => ({ close: vi.fn() });

async function freshModule() {
  vi.resetModules();
  return import('../registryDatabase');
}

describe('getRegistryDatabase: stall handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    opens.pending.length = 0;
    vi.mocked(openDB).mockClear();
    logEvent.mockClear();
    clearStorageStall();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('single-flight: concurrent callers share one open', async () => {
    const { getRegistryDatabase } = await freshModule();
    const a = getRegistryDatabase();
    const b = getRegistryDatabase();
    expect(openDB).toHaveBeenCalledTimes(1);
    const db = fakeDb();
    opens.pending[0]!.resolve(db);
    expect(await a).toBe(db);
    expect(await b).toBe(db);
    // The stall module is re-imported with the module graph; assert via the fresh instance.
    const { storageStalled: flag } = await import('@/utils/storageStall');
    expect(flag.value).toBe(false);
  });

  it('raises the stall flag after 5s pending, and lowers it when the open succeeds', async () => {
    const { getRegistryDatabase } = await freshModule();
    const { storageStalled: flag } = await import('@/utils/storageStall');
    const p = getRegistryDatabase();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(flag.value).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(flag.value).toBe(true);
    opens.pending[0]!.resolve(fakeDb());
    await p;
    expect(flag.value).toBe(false);
  });

  it('rejects after 15s blocked, then FAILS FAST instead of waiting 15s per caller', async () => {
    const { getRegistryDatabase, REGISTRY_FAIL_FAST_MS } = await freshModule();
    const { storageStalled: flag } = await import('@/utils/storageStall');
    const first = getRegistryDatabase();
    const firstOutcome = first.then(
      () => 'resolved',
      (e: Error) => e.name
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await firstOutcome).toBe('RegistryBlockedError');
    expect(flag.value).toBe(true);

    // Every later caller inside the window is refused at once; no new open is started.
    await expect(getRegistryDatabase()).rejects.toMatchObject({ name: 'RegistryBlockedError' });
    await expect(getRegistryDatabase()).rejects.toMatchObject({ name: 'RegistryBlockedError' });
    expect(openDB).toHaveBeenCalledTimes(1);

    // Past the window a new attempt is allowed.
    await vi.advanceTimersByTimeAsync(REGISTRY_FAIL_FAST_MS);
    void getRegistryDatabase().catch(() => {});
    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it('recovers when the blocked open finally resolves: adopts the connection, lowers the flag', async () => {
    const { getRegistryDatabase } = await freshModule();
    const { storageStalled: flag } = await import('@/utils/storageStall');
    const first = getRegistryDatabase().catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await first).toBe('RegistryBlockedError');

    const db = fakeDb();
    opens.pending[0]!.resolve(db); // the other tab closed
    await vi.advanceTimersByTimeAsync(0);
    expect(flag.value).toBe(false);
    expect(await getRegistryDatabase()).toBe(db); // no fail-fast, no new open
    expect(openDB).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'registry_open_recovered' })
      )
    );
  });

  it('a slow open that is NOT blocked past 15s... is still reported as blocked (the timer is the only signal)', async () => {
    // Documents the existing contract: idb exposes no reliable "blocked" signal on Safari,
    // so 5s pending is treated as blocked and 15s as the bound.
    const { getRegistryDatabase } = await freshModule();
    const p = getRegistryDatabase().catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toBe('RegistryBlockedError');
  });

  it('an ordinary open failure propagates and does not arm the fail-fast window', async () => {
    const { getRegistryDatabase } = await freshModule();
    const p = getRegistryDatabase();
    opens.pending[0]!.reject(new DOMException('denied', 'SecurityError'));
    await expect(p).rejects.toMatchObject({ name: 'SecurityError' });
    void getRegistryDatabase().catch(() => {});
    expect(openDB).toHaveBeenCalledTimes(2);
  });
});

// Keep the top-level import referenced for type-checking of the module under test's contract.
void storageStalled;
