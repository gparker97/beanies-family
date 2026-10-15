// @vitest-environment node
/**
 * 2026-10-15 (cache replay torn read): `loadCachedDoc` reads the base and the increments in ONE
 * transaction. They used to be two auto-commit reads with the base decrypt (seconds on a slow
 * device) between them, so a compaction by another realm landing in that gap left this realm
 * with the OLD base and only the rows written on top of the NEW one: missing deps that existed
 * nowhere on disk any more.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import {
  migrateDoc,
  saveDoc,
  applyMutation,
  getHeads,
  getChangesSince,
  frameChanges,
} from '../docOps';
import {
  initPersistenceDB,
  persistDocBinary,
  persistIncrement,
  loadCachedDoc,
  clearCache,
  __resetCacheForTesting,
} from '../cache';

/** Runs once, inside the next `decryptPayload` call, before it decrypts. */
const decryptHook = vi.hoisted(() => ({ next: null as null | (() => Promise<void>) }));
vi.mock('@/services/crypto/familyKeyService', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/crypto/familyKeyService')>();
  return {
    ...real,
    decryptPayload: async (...args: Parameters<typeof real.decryptPayload>) => {
      const hook = decryptHook.next;
      decryptHook.next = null;
      if (hook) await hook();
      return real.decryptPayload(...args);
    },
  };
});

const FAMILY_ID = 'cache-single-read-family';
type Doc = Automerge.Doc<FamilyDocument>;
const base = (): Doc => migrateDoc(Automerge.init<FamilyDocument>());
/** On a CLONE: Automerge 2 shares one handle across versions, so `saveDoc(prev)` after a
 * change on `prev` would save the newer state and the "old base" would not be old. */
const setAccount = (doc: Doc, id: string) =>
  applyMutation(Automerge.clone(doc), {
    op: 'set',
    collection: 'accounts',
    id,
    entity: { id, balance: 1 },
  }).doc;
const delta = (from: Doc, to: Doc) => frameChanges(getChangesSince(to, getHeads(from)));
const accounts = (doc: Doc) =>
  Object.keys((Automerge.toJS(doc) as { accounts: object }).accounts).sort();

let key: CryptoKey;
beforeEach(async () => {
  __resetCacheForTesting();
  decryptHook.next = null;
  key = await generateFamilyKey();
  await initPersistenceDB(FAMILY_ID);
});
afterEach(async () => {
  vi.restoreAllMocks();
  decryptHook.next = null;
  await clearCache(FAMILY_ID);
});

/** Base `d0`, then two increments (`a1`, `a2`) on top of it. */
async function seedBaseAndIncrements(): Promise<{ d0: Doc; d1: Doc; d2: Doc }> {
  const d0 = base();
  const d1 = setAccount(d0, 'a1');
  const d2 = setAccount(d1, 'a2');
  await persistDocBinary(key, saveDoc(d0), { supersede: true });
  await persistIncrement(key, delta(d0, d1));
  await persistIncrement(key, delta(d1, d2));
  return { d0, d1, d2 };
}

describe('loadCachedDoc reads base + increments in one transaction', () => {
  it('the base, legacy and increment reads are served by ONE readonly transaction', async () => {
    await seedBaseAndIncrements();
    const opened: Array<{ tx: IDBTransaction; mode: IDBTransactionMode | undefined }> = [];
    const realTx = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const tx = realTx.apply(this, args);
      opened.push({ tx, mode: args[1] });
      return tx;
    });
    const reads: Array<{ what: string; tx: IDBTransaction }> = [];
    const realGet = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange
    ) {
      reads.push({ what: String(query), tx: this.transaction });
      return realGet.call(this, query);
    });
    const realGetAll = IDBObjectStore.prototype.getAll;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['getAll']>
    ) {
      reads.push({ what: 'getAll', tx: this.transaction });
      return realGetAll.apply(this, args);
    });

    const loaded = await loadCachedDoc(key, FAMILY_ID);
    expect(loaded && accounts(loaded.doc)).toEqual(['a1', 'a2']);

    const rowReads = reads.filter((r) => ['base', 'current', 'getAll'].includes(r.what));
    expect(rowReads.map((r) => r.what).sort()).toEqual(['base', 'current', 'getAll']);
    const servingTx = new Set(rowReads.map((r) => r.tx));
    expect(servingTx.size).toBe(1);
    const [only] = [...servingTx];
    expect(opened.filter((o) => o.tx === only)).toEqual([{ tx: only, mode: 'readonly' }]);
  });

  it('a compaction landing during the base decrypt never yields a torn view', async () => {
    const { d2 } = await seedBaseAndIncrements();
    // Another realm compacts while this one decrypts: a new base holding a1+a2 (folded rows
    // deleted in the same transaction), then a row for a3 written on top of the NEW base.
    const d3 = setAccount(d2, 'a3');
    decryptHook.next = async () => {
      await persistDocBinary(key, saveDoc(d2), { supersede: true });
      await persistIncrement(key, delta(d2, d3));
    };

    const loaded = await loadCachedDoc(key, FAMILY_ID);
    expect(decryptHook.next).toBeNull(); // the compaction really ran mid-load
    // Fully pre-compaction: the old base with ITS increments. Never the old base with the
    // new base's row (which waits on a2's change and reports a missing dep).
    expect(loaded).toMatchObject({ missingDeps: 0, droppedIncrements: 0, incrementCount: 2 });
    expect(accounts(loaded!.doc)).toEqual(['a1', 'a2']);

    // And the next open sees the fully post-compaction state.
    const next = await loadCachedDoc(key, FAMILY_ID);
    expect(next).toMatchObject({ missingDeps: 0, incrementCount: 1 });
    expect(accounts(next!.doc)).toEqual(['a1', 'a2', 'a3']);
  });
});
