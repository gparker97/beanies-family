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
import { CorruptPayloadError, PayloadTooLargeError } from '@/types/sync';
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
const { configure, setKey, initAndLoadCache, __resetApplyAndProjectForTesting } =
  await import('../applyAndProject');

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

  it('STILL clears for an unrecognised error — the conservative default', async () => {
    // Anything not positively identified as an allocation failure keeps taking
    // the existing path, including IndexedDB and key errors.
    loadHook.err = new Error('IndexedDB is closing');

    await expect(initAndLoadCache(FAMILY_ID)).rejects.toThrow('IndexedDB is closing');

    expect(cache.clearCache).toHaveBeenCalledWith(FAMILY_ID);
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
