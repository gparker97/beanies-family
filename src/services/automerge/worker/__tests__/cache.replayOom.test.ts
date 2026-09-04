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

/**
 * `err` is what `applyChanges` throws; `failOn` names WHICH calls throw (null =
 * all of them). Call 0 is the fast path; 1..n are the single-increment replays.
 */
const applyHook = vi.hoisted(() => ({
  err: null as null | Error,
  failOn: null as null | number[],
  calls: 0,
}));

// Only `applyChanges` is faked — `loadAndVerify`, `payloadFailure`, the framing
// helpers and the mutation ops stay real, so the branch under test is the
// production one and the classifier is the production classifier.
vi.mock('../docOps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../docOps')>();
  return {
    ...actual,
    applyChanges: vi.fn((doc: unknown, changes: Uint8Array[]) => {
      const n = applyHook.calls++;
      if (applyHook.err && (!applyHook.failOn || applyHook.failOn.includes(n))) {
        throw applyHook.err;
      }
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
/** The decoded base size — the value only the increment path reports. */
let baseBinaryLength = 0;
const base = () => migrateDoc(Automerge.init<FamilyDocument>());

describe('loadCachedDoc — increment replay classification', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    __resetCacheForTesting();
    applyHook.err = null;
    applyHook.failOn = null;
    applyHook.calls = 0;
    key = await generateFamilyKey();
    await initPersistenceDB(FAMILY_ID);

    // A base plus two increments, all genuinely valid on disk.
    const baseDoc = base();
    const baseBinary = saveDoc(baseDoc);
    baseBinaryLength = baseBinary.byteLength;
    await persistDocBinary(key, baseBinary);
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

  it('recovers the PREFIX when a later increment is genuinely corrupt', async () => {
    // The behaviour the recovery path exists for, and the direction an
    // over-broad OOM classifier would break. An earlier version of this test
    // failed EVERY apply, so the slow path broke at the first increment and
    // recovered nothing — it asserted `recovered === true` and would have
    // passed even if the prefix were dropped entirely. Fail the fast path
    // (call 0) and the SECOND replay (call 2), letting the first replay ('a')
    // through, then assert 'a' survived and 'b' did not.
    applyHook.err = new Error('invalid chunk type');
    applyHook.failOn = [0, 2];

    const result = await loadCachedDoc(key, FAMILY_ID);

    expect(result).not.toBeNull();
    expect(result!.recovered).toBe(true);
    expect(Object.keys((result!.doc as unknown as { accounts: object }).accounts)).toEqual(['a']);
  });

  it('classifies an INCREMENT decrypt allocation failure, not just the base one', async () => {
    // ⚠️ The obvious version of this test does not test anything. `loadCachedDoc`
    // decrypts the BASE row first, so a plain `mockRejectedValueOnce` is consumed
    // there — by a catch that hardcoded `'decrypt'` before `openIncrement`
    // existed — and the assertions pass while `openIncrement` is never reached.
    // Proven: deleting `openIncrement`'s whole classification block left that
    // version green. So let the base decrypt through and fail the NEXT call.
    const real = globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle);
    let call = 0;
    const spy = vi
      .spyOn(globalThis.crypto.subtle, 'decrypt')
      .mockImplementation((...args: Parameters<typeof real>) => {
        if (call++ === 0) return real(...args); // the base row
        return Promise.reject(new RangeError('Array buffer allocation failed'));
      });
    try {
      const err = await loadCachedDoc(key, FAMILY_ID).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PayloadTooLargeError);
      expect((err as PayloadTooLargeError).step).toBe('decrypt');
      // The size only the INCREMENT path produces: `oomDuringReplay` reports the
      // decoded BASE length, whereas the base-row catch reports
      // `decodedSizeOf(baseEntry.payload)`. Asserting it is what pins that this
      // came from `openIncrement` and not from the row above it.
      expect((err as PayloadTooLargeError).payloadBytes).toBe(baseBinaryLength);
      expect(call).toBeGreaterThan(1);
    } finally {
      spy.mockRestore(); // `vitest.config.ts` sets no `restoreMocks`
    }
  });
});
