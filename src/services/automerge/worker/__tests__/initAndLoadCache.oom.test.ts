// @vitest-environment node
/**
 * An out-of-memory failure must NEVER delete the local cache.
 *
 * `initAndLoadCache` clears the cache when the cached doc will not load, so a
 * clean re-seed can happen. That is right for genuine corruption and actively
 * harmful for an OOM: the cached bytes are fine, deleting them cannot help, and
 * the retry re-downloads and fails identically — having destroyed the one copy
 * that might have loaded after a reload freed memory.
 *
 * Both directions are asserted, because the regression risk runs both ways: an
 * over-broad classifier would stop clearing for REAL corruption and break its
 * self-healing.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CorruptPayloadError, PayloadTooLargeError, CacheInitError } from '@/types/sync';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';

const loadHook = vi.hoisted(() => ({ err: null as null | Error }));

// `cache.loadCachedDoc` is the call `initAndLoadCache` wraps; make it throw the
// class under test. Everything else in the module stays real, so the branch we
// are pinning is the production one.
vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache')>();
  return {
    ...actual,
    // ⚠️ MUST answer the real shape. `reseedCacheAfterCorruption` reads
    // `result?.deleted` to decide whether re-opening is safe; a mock resolving
    // `undefined` used to make the helper skip the re-open silently, which is the
    // safe direction but not what these tests are describing.
    clearCache: vi.fn(async () => ({ deleted: true })),
    initPersistenceDB: vi.fn(async () => {}),
    loadCachedDoc: vi.fn(async () => {
      if (loadHook.err) throw loadHook.err;
      return null;
    }),
  };
});

const cache = await import('../cache');
const {
  configure,
  setKey,
  initAndLoadCache,
  initDoc,
  openCache,
  __hasDocForTesting,
  __resetApplyAndProjectForTesting,
} = await import('../applyAndProject');

const FAMILY_ID = 'fam-oom';

const cachePersistFailed = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  loadHook.err = null;
  __resetApplyAndProjectForTesting();
  configure({
    pushChunk: () => {},
    perf: () => {},
    cachePersistFailed,
    cacheReleased: () => {},
  });
  setKey(await generateFamilyKey());
});

describe('initAndLoadCache — cache preservation', () => {
  it('does NOT clear the cache when the load runs out of memory', async () => {
    loadHook.err = new PayloadTooLargeError('oom', 'load', FAMILY_ID, 3_000_000);

    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBeInstanceOf(PayloadTooLargeError);

    // The whole point: the user's cache is still there.
    expect(cache.clearCache).not.toHaveBeenCalled();
  });

  it('STILL clears the cache for genuine corruption (self-healing must not regress)', async () => {
    loadHook.err = new CorruptPayloadError('bad bytes', 'load', FAMILY_ID);

    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBeInstanceOf(CorruptPayloadError);

    expect(cache.clearCache).toHaveBeenCalledWith(FAMILY_ID);
  });

  it('KEEPS the cache for an unrecognised error, wraps it so the CAUSE survives, and closes the handle', async () => {
    // ⚠️ BEHAVIOUR CHANGED (C5a, data-layer audit 2026-10-03). This used to CLEAR the cache
    // for anything that was not an allocation failure, a transient iOS IndexedDB error
    // included, and then report `nothing-to-lose` so main installed the remote wholesale.
    // Only a PROVEN-corrupt payload clears now. The handle is closed so the empty document
    // App's path 3 installs next cannot write its base over the rows this kept.
    //
    // It is WRAPPED rather than rethrown, because main used to guess whether
    // this device still held anything worth protecting from the error's class —
    // and guessed wrong in both directions. The failure class must still reach
    // telemetry, which is what `cause` is for.
    const close = vi.spyOn(cache, 'closeCacheDB');
    loadHook.err = Object.assign(new Error('IndexedDB is closing'), { name: 'InvalidStateError' });

    const err = await initAndLoadCache(FAMILY_ID).catch((e) => e);
    expect(err).toBeInstanceOf(CacheInitError);
    expect(err.stage).toBe('load');
    expect(err.loss).toBe('something-to-lose');
    expect(err.cause).toBe('InvalidStateError');

    expect(cache.clearCache).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(cachePersistFailed).toHaveBeenCalledWith(true, {
      kind: 'open',
      errorName: 'InvalidStateError',
    });
    close.mockRestore();
  });

  it('says `something-to-lose` when the reseed could NOT delete the cache', async () => {
    // ⚠️ THE DATA-LOSS PATH, PINNED. A blocked delete is not exotic: `clearCache`
    // CLOSES its handle before deleting, and the delete is blocked whenever
    // another connection is open — i.e. whenever a second tab exists, which
    // after a two-session soak is the normal state. Every `inc:*` row is still
    // on disk, unread, with no handle held. An earlier version of this asked
    // `cache.isCacheReady()`, which answers "is a handle open" rather than "does
    // the cache hold anything", and so answered `nothing-to-lose` here —
    // authorising a wholesale install that leaves `lastPersistedHeads` null, so
    // the next persist deletes every one of those rows.
    // (C5a: an unrecognised error no longer reseeds at all, so the delete is never attempted;
    // the verdict is the same, and now holds whether or not a delete would have been blocked.)
    loadHook.err = Object.assign(new Error('nope'), { name: 'InvalidStateError' });

    const err = await initAndLoadCache(FAMILY_ID).catch((e) => e);
    expect(err.loss).toBe('something-to-lose');
    // And it is the DELETE that decided it, not a handle: nothing re-opened.
    expect(cache.initPersistenceDB).toHaveBeenCalledTimes(1); // the initial open only
  });

  it('KEEPS the cache for a wrong-key decrypt: `keyMayBeWrong` is not proof of corruption', async () => {
    // C5a: a decrypt failure is the classic "the cached key is stale" case. The bytes are
    // very likely fine; deleting them destroyed the only copy of anything unsynced.
    loadHook.err = new CorruptPayloadError('cannot decrypt', 'decrypt', FAMILY_ID);

    const err = await initAndLoadCache(FAMILY_ID).catch((e) => e);
    expect(err).toBeInstanceOf(CacheInitError);
    expect(err.loss).toBe('something-to-lose');
    expect(cache.clearCache).not.toHaveBeenCalled();
  });

  it('NEVER drops a same-family live document on a load failure (C5e)', async () => {
    // A live session (Settings reload, `replaceDocWithCacheRecovery`) holds this family's
    // document with this session's edits in it. A load failure used to `dropDoc()` it.
    initDoc();
    await openCache(FAMILY_ID); // names the document's family
    loadHook.err = Object.assign(new Error('nope'), { name: 'InvalidStateError' });

    const err = await initAndLoadCache(FAMILY_ID).catch((e) => e);
    expect(err).toBeInstanceOf(CacheInitError);
    expect(err.loss).toBe('something-to-lose');
    expect(__hasDocForTesting()).toBe(true);
    expect(cache.clearCache).not.toHaveBeenCalled();
  });

  it('a PROVEN-corrupt cache under a live document is replaced BY that document (C5e)', async () => {
    initDoc();
    await openCache(FAMILY_ID);
    loadHook.err = new CorruptPayloadError('bad bytes', 'materialize', FAMILY_ID);

    const res = await initAndLoadCache(FAMILY_ID);
    expect(cache.clearCache).toHaveBeenCalledWith(FAMILY_ID);
    // The live document is still installed and main is told the family is loaded, so it
    // merges the remote into it rather than installing the remote wholesale over it.
    expect(__hasDocForTesting()).toBe(true);
    expect(res.loaded).toBe(true);
    expect(res.replay).toMatchObject({ recovered: true, corruptBaseReplaced: true });
  });

  it('wraps an OPEN-stage failure, and a cold boot there has nothing to lose', async () => {
    // The cold boot behind a second tab: `initPersistenceDB` times out, nothing
    // was ever loaded, no cache handle exists. This is the ONE cell of the
    // classification matrix that changed verdict — it used to refuse, latch, and
    // raise a full-screen overlay whose only action reproduced the timeout.
    vi.mocked(cache.initPersistenceDB).mockRejectedValueOnce(
      Object.assign(new Error('cache open timed out'), { name: 'CacheOpenTimeoutError' })
    );
    // Deliberately NOT stubbing `isCacheReady`: the open stage does not consult
    // it, and a stub here would hide it if a future edit made it do so.

    const err = await initAndLoadCache(FAMILY_ID).catch((e) => e);
    expect(err).toBeInstanceOf(CacheInitError);
    expect(err.stage).toBe('open');
    expect(err.loss).toBe('nothing-to-lose');
    expect(err.cause).toBe('CacheOpenTimeoutError');
    // Nothing was loaded, so nothing was cleared.
    expect(cache.clearCache).not.toHaveBeenCalled();
  });

  it('re-throws the original error in both branches, so the caller can classify', async () => {
    const oom = new PayloadTooLargeError('oom', 'materialize', FAMILY_ID, 42);
    loadHook.err = oom;
    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBe(oom);
  });
});

describe('initAndLoadCache — when the clear is BLOCKED', () => {
  beforeEach(() => {
    vi.mocked(cache.clearCache).mockResolvedValue({ deleted: false });
    loadHook.err = new CorruptPayloadError('bad bytes', 'load', FAMILY_ID);
  });

  it('does NOT re-open the database, which is the hang', async () => {
    // ⚠️ THE LOCKOUT, IN ONE ASSERTION. A delete that was blocked is a delete
    // still QUEUED, and an open of the same name then waits behind a delete that
    // waits for a connection this code does not control. Nothing settles, and
    // the sign-in spinner runs until the RPC ceiling kills the worker.
    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBeInstanceOf(CorruptPayloadError);
    // ONCE, for the opening call at the top of `initAndLoadCache`. The second
    // call, the re-seed after the clear, is the one that never returns.
    expect(cache.initPersistenceDB).toHaveBeenCalledTimes(1);
  });

  it('still re-throws the ORIGINAL classification', async () => {
    // The caller's self-heal dispatches on the error class. A failure inside the
    // recovery must never replace it.
    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBeInstanceOf(CorruptPayloadError);
  });

  it('raises the durability signal, so skipping the re-open is not silent', async () => {
    // Without an open DB, `persistOnce` early-returns for the rest of the
    // session and nothing is written anywhere. Trading a hang for an invisible
    // durability loss would not be a fix.
    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBeInstanceOf(CorruptPayloadError);
    expect(cachePersistFailed).toHaveBeenCalledWith(true, {
      kind: 'open',
      errorName: 'DeleteBlocked',
    });
  });

  it('raises it for a failed re-open too, not only a blocked delete', async () => {
    vi.mocked(cache.clearCache).mockResolvedValue({ deleted: true });
    // The FIRST call is the ordinary open at the top; the re-seed is the second.
    vi.mocked(cache.initPersistenceDB)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cache open timed out after 10000ms'));
    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBeInstanceOf(CorruptPayloadError);
    expect(cachePersistFailed).toHaveBeenCalledWith(true, { kind: 'open', errorName: 'Error' });
  });

  it('survives a cache mock that answers the OLD shape, rather than throwing over the error', async () => {
    // A stale mock or an older worker bundle answers `undefined`. That must
    // degrade to "do not re-open" — the safe direction — never to a TypeError
    // raised out of a helper documented as never throwing, on top of the error
    // the caller still has to classify.
    vi.mocked(cache.clearCache).mockResolvedValue(undefined as never);
    await expect(initAndLoadCache(FAMILY_ID)).rejects.toBeInstanceOf(CorruptPayloadError);
    expect(cache.initPersistenceDB).toHaveBeenCalledTimes(1); // the opening call only
  });
});
