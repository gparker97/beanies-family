// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { CorruptPayloadError } from '@/types/sync';
import { openDB } from 'idb';
import { generateFamilyKey, encryptPayload } from '@/services/crypto/familyKeyService';
import { bufferToBase64 } from '@/utils/encoding';
import {
  migrateDoc,
  saveDoc,
  applyMutation,
  materializeCollection,
  getHeads,
  getChangesSince,
  frameChanges,
  buildFullProjection,
} from '../docOps';
import {
  initPersistenceDB,
  persistDocBinary,
  persistIncrement,
  incrementCount,
  loadCachedDoc,
  persistEnvelope,
  loadCachedEnvelope,
  isCacheReady,
  clearCache,
  closeCacheDB,
  __resetCacheForTesting,
  persistProjectionSnapshot,
  loadProjectionSnapshot,
  SNAPSHOT_VERSION,
  readRemoteBaseline,
  writeRemoteBaseline,
  clearRemoteBaseline,
} from '../cache';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

const FAMILY_ID = 'cache-test-family';
const base = () => migrateDoc(Automerge.init<FamilyDocument>());

/** Seed a base doc + one framed increment carrying `doc`'s changes since `fromHeads`. */
async function seedIncrement(
  key: CryptoKey,
  baseDoc: ReturnType<typeof base>,
  nextDoc: ReturnType<typeof base>
): Promise<void> {
  await persistIncrement(key, frameChanges(getChangesSince(nextDoc, getHeads(baseDoc))));
}

const setAccount = (doc: ReturnType<typeof base>, id: string, balance: number) =>
  applyMutation(doc, { op: 'set', collection: 'accounts', id, entity: { id, balance } }).doc;

describe('worker/cache', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    __resetCacheForTesting();
    key = await generateFamilyKey();
    await initPersistenceDB(FAMILY_ID);
  });

  afterEach(async () => {
    await clearCache(FAMILY_ID);
  });

  it('round-trips a doc binary through encrypt → cache → decrypt', async () => {
    const doc = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 42 },
    }).doc;

    await persistDocBinary(key, saveDoc(doc));
    const loaded = await loadCachedDoc(key, FAMILY_ID);

    expect(loaded).not.toBeNull();
    expect(loaded!.recovered).toBe(false);
    expect(materializeCollection(loaded!.doc, 'accounts')).toEqual([
      ['a1', { id: 'a1', balance: 42 }],
    ]);
  });

  it('returns null when the cache has no doc row', async () => {
    expect(await loadCachedDoc(key, FAMILY_ID)).toBeNull();
  });

  describe('remote-baseline row (#61)', () => {
    it('round-trips the opaque payload + checkedAt (plaintext, no key needed)', async () => {
      await writeRemoteBaseline('ver:7');
      const row = await readRemoteBaseline();
      expect(row?.payload).toBe('ver:7');
      expect(typeof row?.checkedAt).toBe('string');
      expect(Number.isNaN(Date.parse(row!.checkedAt))).toBe(false);
    });

    it('is untouched by persistDocBinary base + increment sweep, and unread by loadCachedDoc', async () => {
      const doc = setAccount(base(), 'a1', 42);
      await persistDocBinary(key, saveDoc(doc));
      await writeRemoteBaseline('ver:9');
      // A later base write clears all increments — the baseline row must survive.
      const doc2 = setAccount(doc, 'a2', 7);
      await seedIncrement(key, doc, doc2);
      await persistDocBinary(key, saveDoc(doc2)); // base write → increment sweep

      expect((await readRemoteBaseline())?.payload).toBe('ver:9');
      // loadCachedDoc reconstructs the doc and never reads/consumes the baseline row.
      const loaded = await loadCachedDoc(key, FAMILY_ID);
      expect(loaded).not.toBeNull();
      expect(materializeCollection(loaded!.doc, 'accounts').length).toBe(2);
      expect((await readRemoteBaseline())?.payload).toBe('ver:9');
    });

    it('clearRemoteBaseline removes the row (no-op if already absent)', async () => {
      await writeRemoteBaseline('ver:3');
      await clearRemoteBaseline();
      expect(await readRemoteBaseline()).toBeNull();
      await clearRemoteBaseline(); // idempotent
      expect(await readRemoteBaseline()).toBeNull();
    });
  });

  it('detects a materialize-corrupt cache as CorruptPayloadError (not a silent later throw)', async () => {
    // Bytes that decrypt fine but are not a loadable Automerge document.
    await persistDocBinary(key, new Uint8Array([1, 2, 3, 4, 5]));
    await expect(loadCachedDoc(key, FAMILY_ID)).rejects.toBeInstanceOf(CorruptPayloadError);
  });

  it('round-trips the V4 envelope', async () => {
    const envelope = {
      version: '4.0',
      familyId: FAMILY_ID,
      familyName: 'Test',
      keyId: 'k1',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: 'deadbeef',
    } as unknown as BeanpodFileV4;

    await persistEnvelope(envelope);
    expect(await loadCachedEnvelope()).toEqual(envelope);
  });

  it('persistDocBinary throws if the DB was never initialized', async () => {
    __resetCacheForTesting();
    await expect(persistDocBinary(key, new Uint8Array([0]))).rejects.toThrow(/not initialized/);
  });

  it('clearCache deletes the DB so it no longer lists', async () => {
    await persistDocBinary(key, saveDoc(base()));
    await clearCache(FAMILY_ID);
    expect(isCacheReady()).toBe(false);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain(`beanies-automerge-${FAMILY_ID}`);
  });

  it('closeCacheDB drops the handle without deleting data', async () => {
    await persistDocBinary(key, saveDoc(base()));
    closeCacheDB();
    expect(isCacheReady()).toBe(false);
    // Reopen and the row is still there.
    await initPersistenceDB(FAMILY_ID);
    expect(await loadCachedDoc(key, FAMILY_ID)).not.toBeNull();
  });

  // ─── B1: incremental persistence (base + inc:* rows) ───────────────────────

  it('reconstructs base + N increments deep-equal to the whole-doc path', async () => {
    const d0 = setAccount(base(), 'a1', 1);
    await persistDocBinary(key, saveDoc(d0)); // base
    const d1 = setAccount(d0, 'a2', 2);
    await seedIncrement(key, d0, d1); // inc:0
    const d2 = setAccount(d1, 'a3', 3);
    await seedIncrement(key, d1, d2); // inc:1

    const loaded = await loadCachedDoc(key, FAMILY_ID);
    expect(loaded!.recovered).toBe(false);
    expect(materializeCollection(loaded!.doc, 'accounts')).toEqual(
      materializeCollection(d2, 'accounts')
    );
  });

  it('a legacy `current`-only cache still loads (no base/inc rows)', async () => {
    // Emulate a pre-B1 cache: the whole doc written under the legacy `current` id.
    const d0 = setAccount(base(), 'a1', 5);
    const enc = await encryptPayload(key, saveDoc(d0));
    const raw = await openDB(`beanies-automerge-${FAMILY_ID}`, 1);
    await raw.put('doc', {
      id: 'current',
      payload: bufferToBase64(enc),
      updatedAt: new Date().toISOString(),
    });
    raw.close();

    const loaded = await loadCachedDoc(key, FAMILY_ID);
    expect(materializeCollection(loaded!.doc, 'accounts')).toEqual([
      ['a1', { id: 'a1', balance: 5 }],
    ]);
  });

  it('a fresh base write clears prior increments and resets the seq', async () => {
    const d0 = setAccount(base(), 'a1', 1);
    await persistDocBinary(key, saveDoc(d0));
    const d1 = setAccount(d0, 'a2', 2);
    await seedIncrement(key, d0, d1);
    const d2 = setAccount(d1, 'a3', 3);
    await seedIncrement(key, d1, d2);
    expect(incrementCount()).toBe(2);

    // Re-compaction: rewrite the base from the latest doc, increments cleared.
    await persistDocBinary(key, saveDoc(d2));
    expect(incrementCount()).toBe(0);

    const loaded = await loadCachedDoc(key, FAMILY_ID);
    expect(loaded!.recovered).toBe(false);
    expect(materializeCollection(loaded!.doc, 'accounts')).toEqual(
      materializeCollection(d2, 'accounts')
    );
  });

  it('recovers base + increments before the first bad one (corrupt tail, not all-discarded)', async () => {
    const d0 = setAccount(base(), 'a1', 1);
    await persistDocBinary(key, saveDoc(d0));
    const d1 = setAccount(d0, 'a2', 2);
    await seedIncrement(key, d0, d1); // inc:0 (good)
    // inc:1 corrupt: write bytes that decrypt but won't unframe/apply.
    await persistIncrement(key, new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
    const d2 = setAccount(d1, 'a3', 3);
    await seedIncrement(key, d1, d2); // inc:2 (good, but after the bad one)

    const loaded = await loadCachedDoc(key, FAMILY_ID);
    expect(loaded!.recovered).toBe(true);
    // Base + inc:0 recovered (a1, a2); inc:2 dropped because replay stopped at inc:1.
    expect(materializeCollection(loaded!.doc, 'accounts')).toEqual(
      materializeCollection(d1, 'accounts')
    );
  });

  it('re-initializes the seq from the max existing inc key on reopen (no clobber)', async () => {
    const d0 = setAccount(base(), 'a1', 1);
    await persistDocBinary(key, saveDoc(d0));
    const d1 = setAccount(d0, 'a2', 2);
    await seedIncrement(key, d0, d1); // inc:0
    const d2 = setAccount(d1, 'a3', 3);
    await seedIncrement(key, d1, d2); // inc:1
    expect(incrementCount()).toBe(2);

    // Simulate a worker respawn: drop the handle, reopen — seq must resume at 2.
    closeCacheDB();
    await initPersistenceDB(FAMILY_ID);
    expect(incrementCount()).toBe(2);

    // A further increment lands at inc:2 and all three replay in order.
    const d3 = setAccount(d2, 'a4', 4);
    await seedIncrement(key, d2, d3);
    const loaded = await loadCachedDoc(key, FAMILY_ID);
    expect(
      materializeCollection(loaded!.doc, 'accounts')
        .map(([id]) => id)
        .sort()
    ).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  // ─── Projection snapshot (display-only fast first paint) ────────────────────

  describe('projection snapshot', () => {
    const snapshotOf = (doc: ReturnType<typeof base>) => ({
      version: SNAPSHOT_VERSION,
      deltas: buildFullProjection(doc),
    });

    it('round-trips the projection snapshot through encrypt → cache → decrypt', async () => {
      const doc = setAccount(setAccount(base(), 'a1', 10), 'a2', 20);
      const snap = snapshotOf(doc);

      await persistProjectionSnapshot(key, snap);
      const loaded = await loadProjectionSnapshot(key);

      expect(loaded).toEqual(snap);
      expect(loaded!.version).toBe(SNAPSHOT_VERSION);
    });

    it('returns null when no snapshot has been written (clean miss)', async () => {
      expect(await loadProjectionSnapshot(key)).toBeNull();
    });

    it('THROWS on a wrong-key decrypt so the caller falls back (never a silent empty)', async () => {
      await persistProjectionSnapshot(key, snapshotOf(setAccount(base(), 'a1', 1)));
      const otherKey = await generateFamilyKey();
      await expect(loadProjectionSnapshot(otherKey)).rejects.toThrow();
    });

    it('SNAPSHOT_VERSION is a stable `<rev>:<fingerprint>` string', () => {
      expect(SNAPSHOT_VERSION).toMatch(/^\d+:\d+$/);
    });

    it('is dropped by clearCache (whole-DB delete), like every other cache row', async () => {
      await persistProjectionSnapshot(key, snapshotOf(setAccount(base(), 'a1', 1)));
      expect(await loadProjectionSnapshot(key)).not.toBeNull();

      await clearCache(FAMILY_ID);
      await initPersistenceDB(FAMILY_ID);

      expect(await loadProjectionSnapshot(key)).toBeNull();
    });
  });
});
