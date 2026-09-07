/**
 * The cache open that could never return, and the delete that lied about it.
 *
 * ⚠️ THE HANG THIS PINS locked a real person out of their own family. An
 * `openDB` queued behind a still-pending `deleteDatabase` fires NO event: the
 * `blocked` callback only fires for a version change, and this DB is opened at
 * version 1 forever. So the promise simply never settled and the sign-in
 * spinner span until the RPC ceiling tore the worker down, three times over,
 * for about six minutes.
 *
 * ⚠️ `vi.mock('idb')` lives in THIS file and not in `cache.test.ts`, which
 * imports the real `openDB` and needs it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// The happy-path case reaches `maxIncSeq`, which uses the real `IDBKeyRange`.
// `idb` is mocked here, the global is not.
import 'fake-indexeddb/auto';

const idb = vi.hoisted(() => ({ openDB: vi.fn() }));
vi.mock('idb', () => idb);

import { initPersistenceDB, clearCache, isCacheReady, CACHE_OPEN_TIMEOUT_MS } from '../cache';

/** A handle that records whether anyone ever closed it. */
function fakeDb() {
  return {
    close: vi.fn(),
    getAllKeys: vi.fn(async () => []),
    objectStoreNames: { contains: () => true },
  };
}

describe('initPersistenceDB, when the open is queued behind a pending delete', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('gives up instead of waiting forever', async () => {
    idb.openDB.mockReturnValueOnce(new Promise(() => {})); // never settles, like the real thing
    const opening = initPersistenceDB('fam-1');
    const assertion = expect(opening).rejects.toThrow(/cache open timed out/);
    await vi.advanceTimersByTimeAsync(CACHE_OPEN_TIMEOUT_MS);
    await assertion;
  });

  it('names the database and the cause, so a device console is enough to triage', async () => {
    idb.openDB.mockReturnValueOnce(new Promise(() => {}));
    const opening = initPersistenceDB('fam-1');
    const assertion = expect(opening).rejects.toThrow(
      /beanies-automerge-fam-1 is queued behind another connection or a pending delete/
    );
    await vi.advanceTimersByTimeAsync(CACHE_OPEN_TIMEOUT_MS);
    await assertion;
  });

  it('leaves the cache NOT ready, so nothing writes to a database we do not hold', async () => {
    idb.openDB.mockReturnValueOnce(new Promise(() => {}));
    const opening = initPersistenceDB('fam-1');
    const assertion = expect(opening).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(CACHE_OPEN_TIMEOUT_MS);
    await assertion;
    expect(isCacheReady()).toBe(false);
  });

  it('CLOSES a connection that arrives after we stopped waiting', async () => {
    // ⚠️ THE HAZARD THE TIMEOUT CREATES. `withTimeout` stops waiting; it cannot
    // cancel the request. An orphan connection nobody holds blocks every future
    // `deleteDatabase` on this name — the privacy invariant in cache.ts's
    // header — which would be a worse failure than the hang it replaced.
    const late = fakeDb();
    let settle!: (v: unknown) => void;
    idb.openDB.mockReturnValueOnce(new Promise((r) => (settle = r)));

    const opening = initPersistenceDB('fam-1');
    const assertion = expect(opening).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(CACHE_OPEN_TIMEOUT_MS);
    await assertion;

    settle(late); // the open finally lands, long after nobody is listening
    await Promise.resolve();
    await Promise.resolve();
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(isCacheReady()).toBe(false);
  });

  it('is a normal open when the database answers in time', async () => {
    const db = fakeDb();
    idb.openDB.mockResolvedValueOnce(db);
    await initPersistenceDB('fam-2');
    expect(isCacheReady()).toBe(true);
    expect(db.close).not.toHaveBeenCalled();
  });
});

describe('clearCache', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a BLOCKED delete as not deleted', async () => {
    // The other half of the hang, and a privacy fact in its own right: the
    // encrypted cache is still on disk after a sign-out that said otherwise.
    const request: Record<string, unknown> = {};
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => {
        queueMicrotask(() => (request.onblocked as () => void)());
        return request;
      },
    });
    await expect(clearCache('fam-3')).resolves.toEqual({ deleted: false });
    vi.unstubAllGlobals();
  });

  it('reports a successful delete as deleted', async () => {
    const request: Record<string, unknown> = {};
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => {
        queueMicrotask(() => (request.onsuccess as () => void)());
        return request;
      },
    });
    await expect(clearCache('fam-4')).resolves.toEqual({ deleted: true });
    vi.unstubAllGlobals();
  });
});
