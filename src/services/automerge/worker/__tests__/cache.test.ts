// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { CorruptPayloadError } from '@/types/sync';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import { migrateDoc, saveDoc, applyMutation, materializeCollection } from '../docOps';
import {
  initPersistenceDB,
  persistDocBinary,
  loadCachedDoc,
  persistEnvelope,
  loadCachedEnvelope,
  isCacheReady,
  clearCache,
  closeCacheDB,
  __resetCacheForTesting,
} from '../cache';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

const FAMILY_ID = 'cache-test-family';
const base = () => migrateDoc(Automerge.init<FamilyDocument>());

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
    expect(materializeCollection(loaded!, 'accounts')).toEqual([['a1', { id: 'a1', balance: 42 }]]);
  });

  it('returns null when the cache has no doc row', async () => {
    expect(await loadCachedDoc(key, FAMILY_ID)).toBeNull();
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
});
