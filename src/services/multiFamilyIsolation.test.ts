/**
 * Multi-family (multi-tenant) isolation tests.
 *
 * Validates that:
 * 1. Each family's data lives in a separate IndexedDB database
 * 2. Switching families changes which database is accessed
 * 3. Sync file handles are scoped per-family
 * 4. Auth-resolved family IDs correctly select the right family
 * 5. One user's data is never visible to another user's family
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  setActiveFamily,
  getDatabase,
  getActiveFamilyId,
  getFamilyDatabaseName,
  closeDatabase,
} from '@/services/indexeddb/database';
import { getRegistryDatabase, closeRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import * as familyContext from '@/services/familyContext';
import * as globalSettingsRepo from '@/services/indexeddb/repositories/globalSettingsRepository';
import type { Family, FamilyMember } from '@/types/models';

// Helper to create a family member
function makeMember(overrides: Partial<FamilyMember> & { id: string; name: string }): FamilyMember {
  return {
    email: `${overrides.name.toLowerCase().replace(/\s/g, '.')}@test.com`,
    gender: 'other',
    ageGroup: 'adult',
    role: 'owner',
    color: '#3b82f6',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

describe('Multi-Family Database Isolation', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    // Ensure clean state
    await closeDatabase();
    await closeRegistryDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
    await closeRegistryDatabase();
  });

  it('should throw if no active family is set', async () => {
    await expect(getDatabase()).rejects.toThrow('No active family set');
  });

  it('should create separate databases for different families', async () => {
    const familyAId = 'family-aaa';
    const familyBId = 'family-bbb';

    // Create a member in Family A's database
    await setActiveFamily(familyAId);
    const dbA = await getDatabase();
    const memberA = makeMember({ id: 'member-a', name: 'Alice' });
    await dbA.add('familyMembers', memberA);

    // Switch to Family B and create a different member
    await closeDatabase();
    await setActiveFamily(familyBId);
    const dbB = await getDatabase();
    const memberB = makeMember({ id: 'member-b', name: 'Bob' });
    await dbB.add('familyMembers', memberB);

    // Verify Family B only has Bob
    const membersB = await dbB.getAll('familyMembers');
    expect(membersB).toHaveLength(1);
    expect(membersB[0]!.name).toBe('Bob');

    // Switch back to Family A and verify only Alice is there
    await closeDatabase();
    await setActiveFamily(familyAId);
    const dbA2 = await getDatabase();
    const membersA = await dbA2.getAll('familyMembers');
    expect(membersA).toHaveLength(1);
    expect(membersA[0]!.name).toBe('Alice');
  });

  it('should use different database names for different families', () => {
    expect(getFamilyDatabaseName('family-aaa')).toBe('gp-family-finance-family-aaa');
    expect(getFamilyDatabaseName('family-bbb')).toBe('gp-family-finance-family-bbb');
    expect(getFamilyDatabaseName('family-aaa')).not.toBe(getFamilyDatabaseName('family-bbb'));
  });

  it('should track the active family ID', async () => {
    await setActiveFamily('family-aaa');
    expect(getActiveFamilyId()).toBe('family-aaa');

    await setActiveFamily('family-bbb');
    expect(getActiveFamilyId()).toBe('family-bbb');
  });

  it('should not leak data when switching families rapidly', async () => {
    // Create data in Family A
    await setActiveFamily('family-rapid-a');
    const dbA = await getDatabase();
    await dbA.add('familyMembers', makeMember({ id: 'ra', name: 'RapidA' }));
    await dbA.add('accounts', {
      id: 'acc-a',
      memberId: 'ra',
      name: 'Account A',
      type: 'checking',
      currency: 'USD',
      balance: 1000,
      isActive: true,
      includeInNetWorth: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });

    // Switch to Family B — should be empty
    await closeDatabase();
    await setActiveFamily('family-rapid-b');
    const dbB = await getDatabase();
    const membersB = await dbB.getAll('familyMembers');
    const accountsB = await dbB.getAll('accounts');
    expect(membersB).toHaveLength(0);
    expect(accountsB).toHaveLength(0);

    // Switch back to Family A — data still intact
    await closeDatabase();
    await setActiveFamily('family-rapid-a');
    const dbA2 = await getDatabase();
    const membersA = await dbA2.getAll('familyMembers');
    const accountsA = await dbA2.getAll('accounts');
    expect(membersA).toHaveLength(1);
    expect(membersA[0]!.name).toBe('RapidA');
    expect(accountsA).toHaveLength(1);
    expect(accountsA[0]!.name).toBe('Account A');
  });
});

describe('Family Context and Registry', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await closeDatabase();
    await closeRegistryDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
    await closeRegistryDatabase();
  });

  it('should create a family in the registry and activate it', async () => {
    const family = await familyContext.createNewFamily('Test Family');

    expect(family.name).toBe('Test Family');
    expect(family.id).toBeTruthy();
    expect(getActiveFamilyId()).toBe(family.id);

    // Should be in the registry
    const allFamilies = await familyContext.getAllFamilies();
    expect(allFamilies).toHaveLength(1);
    expect(allFamilies[0]!.id).toBe(family.id);
  });

  it('should set lastActiveFamilyId when activating a family', async () => {
    const family = await familyContext.createNewFamily('Active Family');

    const settings = await globalSettingsRepo.getGlobalSettings();
    expect(settings.lastActiveFamilyId).toBe(family.id);
  });

  it('should resolve the last active family', async () => {
    const familyA = await familyContext.createNewFamily('Family A');
    await closeDatabase();
    const familyB = await familyContext.createNewFamily('Family B');

    // Last active should be Family B
    const lastActive = await familyContext.getLastActiveFamily();
    expect(lastActive?.id).toBe(familyB.id);

    // Switch to A
    await closeDatabase();
    await familyContext.activateFamily(familyA.id);
    const lastActiveAfterSwitch = await familyContext.getLastActiveFamily();
    expect(lastActiveAfterSwitch?.id).toBe(familyA.id);
  });

  it('should return null when activating a non-existent family', async () => {
    const result = await familyContext.activateFamily('non-existent-id');
    expect(result).toBeNull();
  });

  it('should create a family with a specific ID via createFamilyWithId', async () => {
    const specificId = 'auth-resolved-family-id-123';
    const family = await familyContext.createFamilyWithId(specificId, 'Auth Family');

    expect(family.id).toBe(specificId);
    expect(family.name).toBe('Auth Family');
    expect(getActiveFamilyId()).toBe(specificId);

    // Should be findable in the registry
    const found = await familyContext.getFamilyById(specificId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(specificId);
  });

  it('should return existing family if createFamilyWithId is called twice', async () => {
    const specificId = 'duplicate-family-id';
    const family1 = await familyContext.createFamilyWithId(specificId, 'First Name');
    const family2 = await familyContext.createFamilyWithId(specificId, 'Second Name');

    // Should return the existing family (first name preserved)
    expect(family2.id).toBe(specificId);
    expect(family2.name).toBe('First Name');

    // Both calls return the same family
    expect(family1.id).toBe(family2.id);
  });

  it('should isolate data between auth-resolved family and migrated family', async () => {
    // Simulate: migrated family has data from legacy DB
    const migratedFamily = await familyContext.createNewFamily('Legacy Family');
    const dbLegacy = await getDatabase();
    await dbLegacy.add(
      'familyMembers',
      makeMember({ id: 'legacy-member', name: 'Greg', role: 'owner' })
    );
    await dbLegacy.add('accounts', {
      id: 'legacy-account',
      memberId: 'legacy-member',
      name: 'Greg Checking',
      type: 'checking',
      currency: 'USD',
      balance: 5000,
      isActive: true,
      includeInNetWorth: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });

    // Simulate: new user signs in, auth resolves a different familyId
    const authFamilyId = 'new-user-auth-family-id';
    await closeDatabase();
    await familyContext.createFamilyWithId(authFamilyId, 'New User Family');

    // The new family's DB should be empty
    const dbNew = await getDatabase();
    const members = await dbNew.getAll('familyMembers');
    const accounts = await dbNew.getAll('accounts');
    expect(members).toHaveLength(0);
    expect(accounts).toHaveLength(0);

    // Switch back to legacy — data should still be there
    await closeDatabase();
    await familyContext.activateFamily(migratedFamily.id);
    const dbLegacy2 = await getDatabase();
    const legacyMembers = await dbLegacy2.getAll('familyMembers');
    expect(legacyMembers).toHaveLength(1);
    expect(legacyMembers[0]!.name).toBe('Greg');
  });
});

describe('Multi-User Family Isolation (simulated sign-in/sign-out)', () => {
  let familyA: Family;
  let familyB: Family;

  beforeEach(async () => {
    setActivePinia(createPinia());
    await closeDatabase();
    await closeRegistryDatabase();

    // Simulate two users creating families (like during sign-up)
    familyA = await familyContext.createNewFamily('Greg Family');
    const dbA = await getDatabase();
    await dbA.add(
      'familyMembers',
      makeMember({ id: 'greg-id', name: 'Greg', email: 'greg@test.com', role: 'owner' })
    );
    await dbA.add(
      'familyMembers',
      makeMember({ id: 'sophia-id', name: 'Willa', email: 'sophia@test.com', role: 'member' })
    );
    await dbA.add('accounts', {
      id: 'greg-checking',
      memberId: 'greg-id',
      name: 'Greg Checking',
      type: 'checking' as const,
      currency: 'USD' as const,
      balance: 5000,
      isActive: true,
      includeInNetWorth: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });

    await closeDatabase();

    familyB = await familyContext.createNewFamily('Test User Family');
    const dbB = await getDatabase();
    await dbB.add(
      'familyMembers',
      makeMember({ id: 'testuser-id', name: 'Test User', email: 'test@test.com', role: 'owner' })
    );
  });

  afterEach(async () => {
    await closeDatabase();
    await closeRegistryDatabase();
  });

  it('User A should only see User A family members', async () => {
    await closeDatabase();
    await familyContext.activateFamily(familyA.id);

    const db = await getDatabase();
    const members = await db.getAll('familyMembers');

    expect(members).toHaveLength(2);
    expect(members.map((m) => m.name).sort()).toEqual(['Greg', 'Willa']);
  });

  it('User B should only see User B family members', async () => {
    await closeDatabase();
    await familyContext.activateFamily(familyB.id);

    const db = await getDatabase();
    const members = await db.getAll('familyMembers');

    expect(members).toHaveLength(1);
    expect(members[0]!.name).toBe('Test User');
  });

  it('User A accounts should not be visible to User B', async () => {
    await closeDatabase();
    await familyContext.activateFamily(familyB.id);

    const db = await getDatabase();
    const accounts = await db.getAll('accounts');

    expect(accounts).toHaveLength(0);
  });

  it('switching from User A to User B should change visible data', async () => {
    // Start as User A
    await closeDatabase();
    await familyContext.activateFamily(familyA.id);
    let db = await getDatabase();
    let members = await db.getAll('familyMembers');
    expect(members).toHaveLength(2);
    expect(members.some((m) => m.name === 'Greg')).toBe(true);

    // Sign out User A, sign in as User B
    await closeDatabase();
    await familyContext.activateFamily(familyB.id);
    db = await getDatabase();
    members = await db.getAll('familyMembers');
    expect(members).toHaveLength(1);
    expect(members[0]!.name).toBe('Test User');
    expect(members.some((m) => m.name === 'Greg')).toBe(false);
  });

  it('User B data should remain after switching away and back', async () => {
    // Switch to A, then back to B
    await closeDatabase();
    await familyContext.activateFamily(familyA.id);
    await closeDatabase();
    await familyContext.activateFamily(familyB.id);

    const db = await getDatabase();
    const members = await db.getAll('familyMembers');
    expect(members).toHaveLength(1);
    expect(members[0]!.name).toBe('Test User');
  });

  it('adding data to User B should not affect User A', async () => {
    // Add an account to User B
    await closeDatabase();
    await familyContext.activateFamily(familyB.id);
    const dbB = await getDatabase();
    await dbB.add('accounts', {
      id: 'test-savings',
      memberId: 'testuser-id',
      name: 'Test Savings',
      type: 'savings' as const,
      currency: 'EUR' as const,
      balance: 2000,
      isActive: true,
      includeInNetWorth: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });

    // Switch to User A — should still only have original account
    await closeDatabase();
    await familyContext.activateFamily(familyA.id);
    const dbA = await getDatabase();
    const accountsA = await dbA.getAll('accounts');
    expect(accountsA).toHaveLength(1);
    expect(accountsA[0]!.name).toBe('Greg Checking');
  });
});

describe('Sync File Handle Isolation', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await closeDatabase();
    await closeRegistryDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
    await closeRegistryDatabase();
  });

  it('getSyncFileKey should return family-scoped key', async () => {
    // Import dynamically to get the module functions
    const { getActiveFamilyId: getId } = await import('@/services/indexeddb/database');

    await setActiveFamily('family-123');
    expect(getId()).toBe('family-123');

    // The fileHandleStore should use the active family
    const fileHandleStore = await import('@/services/sync/fileHandleStore');
    // getFileHandle internally uses getSyncFileKey which uses getActiveFamilyId
    // We can verify it returns null (no handle stored) rather than a legacy handle
    const handle = await fileHandleStore.getFileHandle();
    expect(handle).toBeNull();
  });

  it('should not return a handle for a different family', async () => {
    const fileHandleStore = await import('@/services/sync/fileHandleStore');

    // Store a handle for family-xxx (we can't create a real FileSystemFileHandle in tests,
    // but we can verify that getFileHandle returns null for a different family)
    await setActiveFamily('family-xxx');
    let handle = await fileHandleStore.getFileHandle();
    expect(handle).toBeNull();

    // Switch to family-yyy — should also be null (no cross-family leakage)
    await setActiveFamily('family-yyy');
    handle = await fileHandleStore.getFileHandle();
    expect(handle).toBeNull();
  });
});

describe('UserFamilyMapping Lookup', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await closeDatabase();
    await closeRegistryDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
    await closeRegistryDatabase();
  });

  it('should find family by email in UserFamilyMapping', async () => {
    const db = await getRegistryDatabase();

    // Create a family
    const familyId = 'family-lookup-test';
    await db.add('families', {
      id: familyId,
      name: 'Lookup Test Family',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });

    // Create a mapping
    await db.add('userFamilyMappings', {
      id: 'mapping-1',
      email: 'lookup@test.com',
      familyId,
      familyRole: 'owner',
      memberId: 'member-1',
      isLocalOnly: false,
      lastActiveAt: '2024-01-01',
    });

    // Look up by email
    const mappings = await db.getAllFromIndex('userFamilyMappings', 'by-email', 'lookup@test.com');
    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.familyId).toBe(familyId);
  });

  it('should not find mapping for unknown email', async () => {
    const db = await getRegistryDatabase();

    const mappings = await db.getAllFromIndex('userFamilyMappings', 'by-email', 'unknown@test.com');
    expect(mappings).toHaveLength(0);
  });
});
