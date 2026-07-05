// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getById as projGetById } from '../projection';
import { createAutomergeRepository } from '../automergeRepository';
import { installInlineBackend } from '../worker/__tests__/inlineHarness';
import type { FamilyMember } from '@/types/models';

// Test with familyMembers collection using a transform
function applyDefaults(member: FamilyMember): FamilyMember {
  return {
    ...member,
    gender: member.gender ?? 'other',
    ageGroup: member.ageGroup ?? 'adult',
    requiresPassword: !member.passwordHash,
  };
}

const repo = createAutomergeRepository<
  'familyMembers',
  FamilyMember,
  Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>>
>('familyMembers', { transform: applyDefaults });

describe('createAutomergeRepository', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  describe('create', () => {
    it('creates entity with auto-generated ID and timestamps', async () => {
      const member = await repo.create({
        name: 'Alice',
        email: 'alice@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'owner',
        color: '#FF0000',
        requiresPassword: false,
      });

      expect(member.id).toBeDefined();
      expect(member.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(member.createdAt).toBeDefined();
      expect(member.updatedAt).toBeDefined();
      expect(member.name).toBe('Alice');
    });

    it('entity is stored in the Automerge doc', async () => {
      const member = await repo.create({
        name: 'Bob',
        email: 'bob@example.com',
        gender: 'male',
        ageGroup: 'adult',
        role: 'member',
        color: '#0000FF',
        requiresPassword: false,
      });

      const stored = projGetById('familyMembers', member.id) as FamilyMember | undefined;
      expect(stored).toBeDefined();
      expect(stored!.name).toBe('Bob');
    });
  });

  describe('getById', () => {
    it('returns entity by ID', async () => {
      const created = await repo.create({
        name: 'Charlie',
        email: 'charlie@example.com',
        gender: 'other',
        ageGroup: 'child',
        role: 'member',
        color: '#00FF00',
        requiresPassword: false,
      });

      const found = await repo.getById(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Charlie');
    });

    it('returns undefined for non-existent ID', async () => {
      const found = await repo.getById('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all entities', async () => {
      await repo.create({
        name: 'A',
        email: 'a@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'owner',
        color: '#F00',
        requiresPassword: false,
      });
      await repo.create({
        name: 'B',
        email: 'b@example.com',
        gender: 'male',
        ageGroup: 'adult',
        role: 'member',
        color: '#0F0',
        requiresPassword: false,
      });

      const all = await repo.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((m) => m.name).sort()).toEqual(['A', 'B']);
    });

    it('returns empty array when collection is empty', async () => {
      const all = await repo.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates entity and bumps updatedAt', async () => {
      const created = await repo.create({
        name: 'Dana',
        email: 'dana@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#ABC',
        requiresPassword: false,
      });

      const updated = await repo.update(created.id, { name: 'Dana Updated' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Dana Updated');
      expect(updated!.email).toBe('dana@example.com'); // unchanged
      expect(updated!.id).toBe(created.id); // same ID
    });

    it('returns undefined for non-existent ID', async () => {
      const result = await repo.update('non-existent', { name: 'Nope' });
      expect(result).toBeUndefined();
    });

    it('deletes fields explicitly set to undefined', async () => {
      const created = await repo.create({
        name: 'Eve',
        email: 'eve@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#DEF',
        requiresPassword: false,
      });

      // Set institution field (simulates linking to a goal/entity)
      await repo.update(created.id, { institution: 'Test Bank' } as any);
      let fetched = await repo.getById(created.id);
      expect((fetched as any).institution).toBe('Test Bank');

      // Now clear it by passing explicit undefined (simulates unlinking)
      await repo.update(created.id, { institution: undefined } as any);
      fetched = await repo.getById(created.id);
      expect((fetched as any).institution).toBeUndefined();

      // Other fields should be untouched
      expect(fetched!.name).toBe('Eve');
      expect(fetched!.email).toBe('eve@example.com');
    });
  });

  describe('remove', () => {
    it('removes entity and returns true', async () => {
      const created = await repo.create({
        name: 'Eve',
        email: 'eve@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#DEF',
        requiresPassword: false,
      });

      const result = await repo.remove(created.id);
      expect(result).toBe(true);

      const found = await repo.getById(created.id);
      expect(found).toBeUndefined();
    });

    it('returns false for non-existent ID', async () => {
      const result = await repo.remove('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('transform', () => {
    it('applies transform on getById', async () => {
      // Create a member without passwordHash — transform should set requiresPassword
      const created = await repo.create({
        name: 'Frank',
        email: 'frank@example.com',
        gender: 'male',
        ageGroup: 'adult',
        role: 'member',
        color: '#123',
        requiresPassword: false,
      });

      const found = await repo.getById(created.id);
      // Transform sets requiresPassword = !passwordHash
      // Since passwordHash is undefined, requiresPassword should be true
      expect(found!.requiresPassword).toBe(true);
    });

    it('applies transform on getAll', async () => {
      await repo.create({
        name: 'Grace',
        email: 'grace@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#456',
        requiresPassword: false,
      });

      const all = await repo.getAll();
      expect(all).toHaveLength(1);
      // Transform should have applied
      expect(all[0]!.requiresPassword).toBe(true);
    });
  });

  describe('undefined value handling', () => {
    it('create() strips undefined values instead of passing them to Automerge', async () => {
      // Reproduces the real bug: TransactionModal passes { monthOfYear: undefined }
      // for non-yearly recurring items. Automerge rejects undefined values with:
      // "Cannot assign undefined value at /recurringItems/.../monthOfYear"
      const recurringRepo = createAutomergeRepository<
        'recurringItems',
        import('@/types/models').RecurringItem
      >('recurringItems');

      const item = await recurringRepo.create({
        accountId: 'acc-1',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        category: 'utilities',
        description: 'Electric bill',
        frequency: 'monthly',
        dayOfMonth: 15,
        monthOfYear: undefined, // ← This is what the UI sends for non-yearly items
        startDate: '2026-01-15',
        endDate: undefined,
        lastProcessedDate: undefined,
        isActive: true,
      } as any);

      expect(item.id).toBeDefined();
      expect(item.description).toBe('Electric bill');
      // undefined fields should NOT be present on the stored entity
      const stored = projGetById('recurringItems', item.id) as unknown as Record<string, unknown>;
      expect(stored).toBeDefined();
      expect('monthOfYear' in stored).toBe(false);
    });

    it('update() strips undefined values instead of passing them to Automerge', async () => {
      const recurringRepo = createAutomergeRepository<
        'recurringItems',
        import('@/types/models').RecurringItem
      >('recurringItems');

      const item = await recurringRepo.create({
        accountId: 'acc-1',
        type: 'expense',
        amount: 50,
        currency: 'USD',
        category: 'food',
        description: 'Groceries',
        frequency: 'monthly',
        dayOfMonth: 1,
        startDate: '2026-01-01',
        isActive: true,
      } as any);

      // Update with an undefined field — should not throw
      const updated = await recurringRepo.update(item.id, {
        monthOfYear: undefined,
        description: 'Updated groceries',
      } as any);

      expect(updated).toBeDefined();
      expect(updated!.description).toBe('Updated groceries');
    });
  });

  // CRDT-merge behaviour now lives in the doc layer (worker) — covered by
  // worker/__tests__/{docOps,applyAndProject}.test.ts (mergeDocs + the
  // mergeRemoteEnvelope round-trip). The repository is a thin projection/RPC
  // adapter and no longer owns merge.
});
