// @vitest-environment node
/**
 * Increment replay must not treat an out-of-memory failure as corruption.
 *
 * `loadCachedDoc`'s recovery path exists for a corrupt increment TAIL: it
 * re-applies increments one at a time, stops at the first bad one, and returns
 * `recovered: true` so the caller rewrites a clean base. A base write clears
 * every increment — which is exactly right when the tail is genuinely damaged.
 *
 * It is data loss when the failure was an allocation failure. Every
 * single-increment apply fails identically on a device that has no room, so
 * replay stops at the FIRST increment, and the "recovery" then DELETES every
 * mutation after it, some of which may never have reached Drive. On a 3GB
 * tablet that is silent, permanent loss.
 *
 * Both directions are asserted, because an over-broad classifier would break
 * the corrupt-tail recovery this path was built for.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { PayloadTooLargeError } from '@/types/sync';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';

const applyHook = vi.hoisted(() => ({ err: null as null | Error }));

// Only `applyChanges` is faked — `loadAndVerify`, `payloadFailure`, the framing
// helpers and the mutation ops stay real, so the branch under test is the
// production one and the classifier is the production classifier.
vi.mock('../docOps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../docOps')>();
  return {
    ...actual,
    applyChanges: vi.fn((doc: unknown, changes: Uint8Array[]) => {
      if (applyHook.err) throw applyHook.err;
      return actual.applyChanges(doc as never, changes);
    }),
  };
});

const { migrateDoc, applyMutation, saveDoc, getHeads, getChangesSince, frameChanges } =
  await import('../docOps');
const {
  initPersistenceDB,
  persistDocBinary,
  persistIncrement,
  loadCachedDoc,
  clearCache,
  __resetCacheForTesting,
} = await import('../cache');

const FAMILY_ID = 'cache-replay-oom';
const base = () => migrateDoc(Automerge.init<FamilyDocument>());

describe('loadCachedDoc — increment replay classification', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    __resetCacheForTesting();
    applyHook.err = null;
    key = await generateFamilyKey();
    await initPersistenceDB(FAMILY_ID);

    // A base plus two increments, all genuinely valid on disk.
    const baseDoc = base();
    await persistDocBinary(key, saveDoc(baseDoc));
    let doc = baseDoc;
    for (const [id, balance] of [
      ['a', 1],
      ['b', 2],
    ] as const) {
      const next = applyMutation(doc, {
        op: 'set',
        collection: 'accounts',
        id,
        entity: { id, balance },
      }).doc;
      await persistIncrement(key, frameChanges(getChangesSince(next, getHeads(doc))));
      doc = next;
    }
  });

  afterEach(async () => {
    await clearCache(FAMILY_ID);
  });

  it('surfaces an OOM as PayloadTooLargeError instead of "recovering" a truncated doc', async () => {
    applyHook.err = new Error('error inflating document chunk ops: out of memory');

    const err = await loadCachedDoc(key, FAMILY_ID).catch((e: unknown) => e);

    // The class is what matters: `initAndLoadCache` branches on it to SKIP the
    // destructive cache clear. A `recovered: true` result here would instead
    // schedule a base rewrite that erases both increments.
    expect(err).toBeInstanceOf(PayloadTooLargeError);
    expect((err as PayloadTooLargeError).step).toBe('materialize');
    expect((err as PayloadTooLargeError).familyId).toBe(FAMILY_ID);
    expect((err as PayloadTooLargeError).payloadBytes).toBeGreaterThan(0);
  });

  it('still recovers the prefix when an increment is genuinely corrupt', async () => {
    // The behaviour the recovery path exists for — an over-broad OOM classifier
    // would turn this into a hard failure and leave the user wedged.
    applyHook.err = new Error('invalid chunk type');

    const result = await loadCachedDoc(key, FAMILY_ID);

    expect(result).not.toBeNull();
    expect(result!.recovered).toBe(true);
  });
});
