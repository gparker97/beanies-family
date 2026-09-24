// @vitest-environment node
/**
 * #100: "sign out and clear data" in one tab must actually delete the cache when
 * another beanies tab is open on the same family.
 *
 * Each tab has its own worker and its own connection to `beanies-automerge-<id>`.
 * Before #100 nothing answered the `versionchange` that another tab's
 * `deleteDatabase` raises, so the delete stayed blocked forever: the encrypted
 * cache survived, and every later open queued behind the pending delete and timed
 * out. These pin both halves with two REAL connections under fake-indexeddb, which
 * delivers `versionchange` to other open connections exactly as a browser does.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import {
  initPersistenceDB,
  isCacheReady,
  clearCache,
  closeCacheDB,
  setCacheReleasedListener,
  __resetCacheForTesting,
  CACHE_DELETE_TIMEOUT_MS,
} from '../cache';

const FAMILY = 'fam-release';
const DB_NAME = `beanies-automerge-${FAMILY}`;

/** Another tab's connection. `release` decides whether it answers `versionchange`. */
async function peerConnection(release: boolean): Promise<IDBPDatabase> {
  const peer = await openDB(DB_NAME, 1, {
    blocking() {
      if (release) peer.close();
    },
  });
  return peer;
}

async function databaseExists(name: string): Promise<boolean> {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === name);
}

describe('cache release (#100)', () => {
  let listener: ReturnType<typeof vi.fn<(reason: 'deleted' | 'upgrade') => void>>;

  beforeEach(() => {
    __resetCacheForTesting();
    listener = vi.fn<(reason: 'deleted' | 'upgrade') => void>();
    setCacheReleasedListener(listener);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    __resetCacheForTesting();
    vi.restoreAllMocks();
    await deleteDB(DB_NAME);
  });

  it('a delete from another tab releases THIS connection, and the delete completes', async () => {
    await initPersistenceDB(FAMILY);
    expect(isCacheReady()).toBe(true);

    // Tab A deletes. Before #100 this promise never settled.
    await deleteDB(DB_NAME);

    expect(isCacheReady()).toBe(false);
    expect(listener).toHaveBeenCalledWith('deleted');
    expect(await databaseExists(DB_NAME)).toBe(false);
  });

  it('KNOWN LIMIT (greg, 2026-09-24): nothing refuses a reopen after a release', async () => {
    // Deliberately accepted: a refusal was built and reviewed three times and never held.
    // A reopen here recreates an empty encrypted cache; the other tab's clear removed the
    // key, and the evicted tab's teardown logs `cache-present-after-eviction`. This test
    // pins the documented behaviour so a future change to it is a decision, not a drift.
    await initPersistenceDB(FAMILY);
    await deleteDB(DB_NAME);
    await initPersistenceDB(FAMILY);
    expect(isCacheReady()).toBe(true);
  });

  it('our own delete succeeds when the other tab releases', async () => {
    await initPersistenceDB(FAMILY);
    const peer = await peerConnection(true);

    await expect(clearCache(FAMILY)).resolves.toEqual({ deleted: true });
    expect(isCacheReady()).toBe(false);
    expect(await databaseExists(DB_NAME)).toBe(false);
    peer.close();
  });

  it('our own delete is NOT reported clean while a frozen tab still holds the cache', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await initPersistenceDB(FAMILY);
      const frozen = await peerConnection(false);

      const clearing = clearCache(FAMILY);
      await vi.advanceTimersByTimeAsync(CACHE_DELETE_TIMEOUT_MS);
      await expect(clearing).resolves.toEqual({ deleted: false });

      // The frozen tab thaws and closes: the queued delete then finishes on its own.
      frozen.close();
      await vi.waitFor(async () => expect(await databaseExists(DB_NAME)).toBe(false));
    } finally {
      vi.useRealTimers();
    }
  });

  it('our own delete never fires our own release (no self-eviction)', async () => {
    await initPersistenceDB(FAMILY);
    await clearCache(FAMILY);
    expect(listener).not.toHaveBeenCalled();
  });

  it('after a close and reopen, the NEW handle is the one released, exactly once', async () => {
    // The closure handle belongs to each open. After a session-ending close and a
    // reopen, the delete must release the live connection once. (A late open that
    // lands after a timed-out open is closed on arrival by `initPersistenceDB`'s
    // orphan-close, pinned in cache.openTimeout.test.ts, before it can hear anything.)
    await initPersistenceDB(FAMILY);
    closeCacheDB();
    await initPersistenceDB(FAMILY);
    expect(isCacheReady()).toBe(true);

    await deleteDB(DB_NAME);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isCacheReady()).toBe(false);
  });
});
