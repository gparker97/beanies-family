// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { initDoc, resetDoc, getDoc, saveDoc } from '../docService';
import { createAutomergeRepository } from '../automergeRepository';
import type { FamilyMember } from '@/types/models';
import type { FamilyDocument } from '@/types/automerge';

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
  beforeEach(() => {
    resetDoc();
    initDoc();
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

      const doc = getDoc();
      const stored = doc.familyMembers[member.id];
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

  describe('CRDT merge', () => {
    it('concurrent changes from two docs merge cleanly', async () => {
      // Create initial member
      await repo.create({
        name: 'Initial',
        email: 'initial@example.com',
        gender: 'other',
        ageGroup: 'adult',
        role: 'owner',
        color: '#000',
        requiresPassword: false,
      });

      // Save and fork
      const binary = saveDoc();
      const docB = Automerge.load<FamilyDocument>(binary);

      // Change on A: add another member
      await repo.create({
        name: 'From A',
        email: 'a@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'member',
        color: '#AAA',
        requiresPassword: false,
      });

      // Change on B: add a different member
      const docBChanged = Automerge.change(docB, (d) => {
        d.familyMembers['b-member'] = {
          id: 'b-member',
          name: 'From B',
          email: 'b@example.com',
          gender: 'male',
          ageGroup: 'adult',
          role: 'member',
          color: '#BBB',
          requiresPassword: false,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        };
      });

      // Merge
      const { mergeDoc } = await import('../docService');
      mergeDoc(docBChanged);

      // All three members should exist
      const all = await repo.getAll();
      expect(all).toHaveLength(3);
      const names = all.map((m) => m.name).sort();
      expect(names).toEqual(['From A', 'From B', 'Initial']);
    });
  });
});
