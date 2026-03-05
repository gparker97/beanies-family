// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDoc, getDoc, changeDoc, resetDoc } from '@/services/automerge/docService';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import { initPersistenceDB, persistDoc, loadCachedDoc, clearCache } from './persistenceService';

describe('persistenceService', () => {
  const FAMILY_ID = 'test-family-1';
  let familyKey: CryptoKey;

  beforeEach(async () => {
    resetDoc();
    initDoc();
    familyKey = await generateFamilyKey();
    await initPersistenceDB(FAMILY_ID);
  });

  afterEach(async () => {
    await clearCache(FAMILY_ID);
  });

  it('loadCachedDoc does NOT replace the currentDoc singleton', async () => {
    // Add data to the singleton and persist it to cache
    changeDoc((d) => {
      d.familyMembers['member-1'] = {
        id: 'member-1',
        name: 'Original',
        email: 'orig@test.com',
        role: 'owner',
        color: '#000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;
    });
    await persistDoc(familyKey);

    // Now change the singleton to have different data
    changeDoc((d) => {
      d.familyMembers['member-1']!.name = 'Modified';
      d.familyMembers['member-2'] = {
        id: 'member-2',
        name: 'New Member',
        email: 'new@test.com',
        role: 'member',
        color: '#fff',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;
    });

    // Load cached doc — this must NOT touch the singleton
    const cached = await loadCachedDoc(familyKey);

    // Singleton should still have the modifications
    const singleton = getDoc();
    expect(singleton.familyMembers['member-1']!.name).toBe('Modified');
    expect(singleton.familyMembers['member-2']).toBeDefined();

    // Cached doc should have the original data (before modification)
    expect(cached).not.toBeNull();
    expect(cached!.familyMembers['member-1']!.name).toBe('Original');
    expect(cached!.familyMembers['member-2']).toBeUndefined();

    // Cached doc should be a separate object from the singleton
    expect(cached).not.toBe(singleton);
  });
});
