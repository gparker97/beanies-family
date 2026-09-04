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
    clearCache: vi.fn(async () => {}),
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

beforeEach(async () => {
  vi.clearAllMocks();
  loadHook.err = null;
  __resetApplyAndProjectForTesting();
  configure({
    pushChunk: () => {},
    perf: () => {},
    cachePersistFailed: () => {},
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
