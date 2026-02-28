import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach } from 'vitest';
import { useMemberFilterStore } from './memberFilterStore';
import { useFamilyStore } from './familyStore';
import type { FamilyMember } from '@/types/models';

function makeMember(overrides?: Partial<FamilyMember>): FamilyMember {
  return {
    id: 'member-1',
    name: 'Alice',
    email: 'alice@test.com',
    role: 'member',
    gender: 'female',
    ageGroup: 'adult',
    color: '#3b82f6',
    requiresPassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ALICE = makeMember({ id: 'alice', name: 'Alice' });
const BOB = makeMember({ id: 'bob', name: 'Bob', gender: 'male' });
const CHARLIE = makeMember({ id: 'charlie', name: 'Charlie', gender: 'male', ageGroup: 'child' });

describe('memberFilterStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function seedMembers(...members: FamilyMember[]) {
    const familyStore = useFamilyStore();
    familyStore.members.push(...members);
  }

  // ── Initialize ──

  describe('initialize', () => {
    it('should select all members on initialization', () => {
      seedMembers(ALICE, BOB, CHARLIE);
      const store = useMemberFilterStore();

      store.initialize();

      expect(store.isInitialized).toBe(true);
      expect(store.selectedMemberIds.size).toBe(3);
      expect(store.isMemberSelected('alice')).toBe(true);
      expect(store.isMemberSelected('bob')).toBe(true);
      expect(store.isMemberSelected('charlie')).toBe(true);
    });

    it('should report isAllSelected after initialization', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();

      store.initialize();

      expect(store.isAllSelected).toBe(true);
    });

    it('should report isAllSelected when not initialized', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();

      // Before initialize, isAllSelected should be true (treat as all)
      expect(store.isAllSelected).toBe(true);
    });
  });

  // ── Toggle Member ──

  describe('toggleMember', () => {
    it('should deselect a selected member', () => {
      seedMembers(ALICE, BOB, CHARLIE);
      const store = useMemberFilterStore();
      store.initialize();

      const result = store.toggleMember('bob');

      expect(result).toBe(true);
      expect(store.isMemberSelected('bob')).toBe(false);
      expect(store.isMemberSelected('alice')).toBe(true);
      expect(store.isMemberSelected('charlie')).toBe(true);
      expect(store.selectedCount).toBe(2);
    });

    it('should select a deselected member', () => {
      seedMembers(ALICE, BOB, CHARLIE);
      const store = useMemberFilterStore();
      store.initialize();

      store.toggleMember('bob'); // deselect
      store.toggleMember('bob'); // re-select

      expect(store.isMemberSelected('bob')).toBe(true);
      expect(store.selectedCount).toBe(3);
    });

    it('should prevent deselecting the last remaining member', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();
      store.initialize();

      store.toggleMember('alice'); // deselect alice, bob remains
      const result = store.toggleMember('bob'); // try to deselect bob

      expect(result).toBe(false);
      expect(store.isMemberSelected('bob')).toBe(true);
      expect(store.selectedCount).toBe(1);
    });

    it('should update isAllSelected when a member is toggled off', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();
      store.initialize();

      expect(store.isAllSelected).toBe(true);
      store.toggleMember('alice');
      expect(store.isAllSelected).toBe(false);
    });
  });

  // ── Select Only ──

  describe('selectOnly', () => {
    it('should select only the specified member', () => {
      seedMembers(ALICE, BOB, CHARLIE);
      const store = useMemberFilterStore();
      store.initialize();

      store.selectOnly('bob');

      expect(store.selectedCount).toBe(1);
      expect(store.isMemberSelected('bob')).toBe(true);
      expect(store.isMemberSelected('alice')).toBe(false);
      expect(store.isMemberSelected('charlie')).toBe(false);
      expect(store.isAllSelected).toBe(false);
    });
  });

  // ── Select All ──

  describe('selectAll', () => {
    it('should select all members after some were deselected', () => {
      seedMembers(ALICE, BOB, CHARLIE);
      const store = useMemberFilterStore();
      store.initialize();

      store.toggleMember('alice');
      store.toggleMember('charlie');
      expect(store.selectedCount).toBe(1);

      store.selectAll();

      expect(store.isAllSelected).toBe(true);
      expect(store.selectedCount).toBe(3);
      expect(store.isMemberSelected('alice')).toBe(true);
      expect(store.isMemberSelected('charlie')).toBe(true);
    });
  });

  // ── isMemberSelected ──

  describe('isMemberSelected', () => {
    it('should return true for all members before initialization', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();

      // Before initialize, treat all as selected
      expect(store.isMemberSelected('alice')).toBe(true);
      expect(store.isMemberSelected('bob')).toBe(true);
      expect(store.isMemberSelected('unknown')).toBe(true);
    });

    it('should return correct state after toggle', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();
      store.initialize();

      store.toggleMember('alice');

      expect(store.isMemberSelected('alice')).toBe(false);
      expect(store.isMemberSelected('bob')).toBe(true);
    });
  });

  // ── selectedMembers getter ──

  describe('selectedMembers', () => {
    it('should return full member objects for selected ids', () => {
      seedMembers(ALICE, BOB, CHARLIE);
      const store = useMemberFilterStore();
      store.initialize();

      store.toggleMember('bob');

      expect(store.selectedMembers).toHaveLength(2);
      expect(store.selectedMembers.map((m) => m.id)).toEqual(
        expect.arrayContaining(['alice', 'charlie'])
      );
    });
  });

  // ── syncWithMembers ──

  describe('syncWithMembers', () => {
    it('should add newly added members to selection', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();
      store.initialize();

      expect(store.selectedCount).toBe(2);

      // Add a new member
      const familyStore = useFamilyStore();
      familyStore.members.push(CHARLIE);
      store.syncWithMembers();

      expect(store.selectedCount).toBe(3);
      expect(store.isMemberSelected('charlie')).toBe(true);
    });

    it('should remove selections for deleted members', () => {
      seedMembers(ALICE, BOB, CHARLIE);
      const store = useMemberFilterStore();
      store.initialize();

      // Remove charlie from family
      const familyStore = useFamilyStore();
      familyStore.members.splice(2, 1); // remove CHARLIE
      store.syncWithMembers();

      expect(store.selectedCount).toBe(2);
      expect(store.isMemberSelected('charlie')).toBe(false);
    });
  });

  // ── getSelectedMemberAccountIds ──

  describe('getSelectedMemberAccountIds', () => {
    it('should return all account ids when all selected', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();
      store.initialize();

      const accounts = [
        { id: 'acc-1', memberId: 'alice' },
        { id: 'acc-2', memberId: 'bob' },
      ];
      const result = store.getSelectedMemberAccountIds(accounts);

      expect(result.size).toBe(2);
      expect(result.has('acc-1')).toBe(true);
      expect(result.has('acc-2')).toBe(true);
    });

    it('should return only accounts for selected members', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();
      store.initialize();
      store.toggleMember('bob');

      const accounts = [
        { id: 'acc-1', memberId: 'alice' },
        { id: 'acc-2', memberId: 'bob' },
        { id: 'acc-3', memberId: 'alice' },
      ];
      const result = store.getSelectedMemberAccountIds(accounts);

      expect(result.size).toBe(2);
      expect(result.has('acc-1')).toBe(true);
      expect(result.has('acc-3')).toBe(true);
      expect(result.has('acc-2')).toBe(false);
    });
  });

  // ── resetState ──

  describe('resetState', () => {
    it('should clear all state', () => {
      seedMembers(ALICE, BOB);
      const store = useMemberFilterStore();
      store.initialize();

      store.resetState();

      expect(store.isInitialized).toBe(false);
      expect(store.selectedMemberIds.size).toBe(0);
    });
  });
});
