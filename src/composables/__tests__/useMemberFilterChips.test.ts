import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useMemberFilterChips } from '../useMemberFilterChips';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useFamilyStore } from '@/stores/familyStore';
import type { FamilyMember } from '@/types/models';

function makeMember(id: string, name: string, isPet = false): FamilyMember {
  return {
    id,
    name,
    email: `${id}@test.local`,
    gender: 'other',
    ageGroup: 'adult',
    role: 'member',
    color: '#3b82f6',
    requiresPassword: false,
    isPet,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  } as FamilyMember;
}

function setupHumans(humans: FamilyMember[]) {
  const familyStore = useFamilyStore();
  // Direct state assignment is the established pattern in other store tests
  // (vacationStore.test.ts, accountsStore tests etc.) — Pinia exposes the
  // underlying refs.
  familyStore.members = humans;
  const filterStore = useMemberFilterStore();
  filterStore.initialize();
  return { familyStore, filterStore };
}

describe('useMemberFilterChips', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAllActive / isFiltered', () => {
    it('isAllActive reflects isAllSelected', () => {
      const { filterStore } = setupHumans([makeMember('a', 'Alice'), makeMember('b', 'Bob')]);
      const chips = useMemberFilterChips();

      expect(chips.isAllActive.value).toBe(true);
      filterStore.selectOnly('a');
      expect(chips.isAllActive.value).toBe(false);
    });

    it('isFiltered is the inverse of isAllActive', () => {
      const { filterStore } = setupHumans([makeMember('a', 'Alice'), makeMember('b', 'Bob')]);
      const chips = useMemberFilterChips();

      expect(chips.isFiltered.value).toBe(false);
      filterStore.selectOnly('a');
      expect(chips.isFiltered.value).toBe(true);
    });
  });

  describe('isMemberActive', () => {
    it('returns true only when the member is selected AND filter is partial', () => {
      const { filterStore } = setupHumans([makeMember('a', 'Alice'), makeMember('b', 'Bob')]);
      const chips = useMemberFilterChips();

      // All selected → no individual chip should appear active
      expect(chips.isMemberActive('a')).toBe(false);
      expect(chips.isMemberActive('b')).toBe(false);

      filterStore.selectOnly('a');
      expect(chips.isMemberActive('a')).toBe(true);
      expect(chips.isMemberActive('b')).toBe(false);
    });

    it('returns false defensively for an unknown member id', () => {
      setupHumans([makeMember('a', 'Alice')]);
      const chips = useMemberFilterChips();

      const filterStore = useMemberFilterStore();
      filterStore.selectOnly('a');
      expect(chips.isMemberActive('unknown-id')).toBe(false);
    });
  });

  describe('onSelectAll', () => {
    it('is a no-op when already all-selected', () => {
      setupHumans([makeMember('a', 'Alice'), makeMember('b', 'Bob')]);
      const filterStore = useMemberFilterStore();
      const spy = vi.spyOn(filterStore, 'selectAll');
      const chips = useMemberFilterChips();

      chips.onSelectAll();
      expect(spy).not.toHaveBeenCalled();
    });

    it('calls selectAll when filter is partial', () => {
      const { filterStore } = setupHumans([makeMember('a', 'Alice'), makeMember('b', 'Bob')]);
      filterStore.selectOnly('a');
      const spy = vi.spyOn(filterStore, 'selectAll');
      const chips = useMemberFilterChips();

      chips.onSelectAll();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe('onSelectMember', () => {
    it('Case 1: from "all" → narrows via selectOnly(id)', () => {
      const { filterStore } = setupHumans([
        makeMember('a', 'Alice'),
        makeMember('b', 'Bob'),
        makeMember('c', 'Charlie'),
      ]);
      const selectOnlySpy = vi.spyOn(filterStore, 'selectOnly');
      const toggleSpy = vi.spyOn(filterStore, 'toggleMember');
      const chips = useMemberFilterChips();

      chips.onSelectMember('a');

      expect(selectOnlySpy).toHaveBeenCalledWith('a');
      expect(toggleSpy).not.toHaveBeenCalled();
      expect(filterStore.selectedCount).toBe(1);
    });

    it('Case 2: deselect-last → reverts to selectAll (the silent-failure-bug fix)', () => {
      const { filterStore } = setupHumans([makeMember('a', 'Alice'), makeMember('b', 'Bob')]);
      filterStore.selectOnly('a'); // partial state, only Alice selected
      const selectAllSpy = vi.spyOn(filterStore, 'selectAll');
      const toggleSpy = vi.spyOn(filterStore, 'toggleMember');
      const chips = useMemberFilterChips();

      // Click Alice's chip → would deselect last, store would refuse with false
      chips.onSelectMember('a');

      expect(selectAllSpy).toHaveBeenCalledOnce();
      // toggleMember NEVER called — we didn't even try to deselect-last,
      // we pre-empted with selectAll. No silent-failure path possible.
      expect(toggleSpy).not.toHaveBeenCalled();
      expect(filterStore.isAllSelected).toBe(true);
    });

    it('Case 3: ordinary toggle inside a partial selection', () => {
      const { filterStore } = setupHumans([
        makeMember('a', 'Alice'),
        makeMember('b', 'Bob'),
        makeMember('c', 'Charlie'),
        makeMember('d', 'Dana'),
      ]);
      // Partial: only Alice + Bob selected (2 of 4 humans)
      filterStore.selectOnly('a');
      filterStore.toggleMember('b');
      expect(filterStore.isAllSelected).toBe(false);
      const toggleSpy = vi.spyOn(filterStore, 'toggleMember');
      const chips = useMemberFilterChips();

      // Add Charlie — still partial (3/4)
      chips.onSelectMember('c');
      expect(toggleSpy).toHaveBeenLastCalledWith('c');
      expect(filterStore.selectedCount).toBe(3);
      expect(filterStore.isAllSelected).toBe(false);

      // Remove Bob — still partial (2/4) so case 3, not case 2
      chips.onSelectMember('b');
      expect(toggleSpy).toHaveBeenLastCalledWith('b');
      expect(filterStore.isMemberSelected('b')).toBe(false);
    });

    it('logs a [useMemberFilterChips] warn if toggleMember refuses unexpectedly', () => {
      const { filterStore } = setupHumans([
        makeMember('a', 'Alice'),
        makeMember('b', 'Bob'),
        makeMember('c', 'Charlie'),
      ]);
      // Force a partial state with 2 members so case-2 guard does NOT trigger
      filterStore.selectOnly('a');
      filterStore.toggleMember('b'); // now {a, b} selected
      // Stub toggleMember to refuse — simulates a future store-rule change
      vi.spyOn(filterStore, 'toggleMember').mockReturnValue(false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const chips = useMemberFilterChips();

      chips.onSelectMember('c');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[useMemberFilterChips] toggleMember(c) refused unexpectedly')
      );
    });
  });

  describe('activeMemberNames', () => {
    it('is empty when filter is all-selected', () => {
      setupHumans([makeMember('a', 'Alice'), makeMember('b', 'Bob')]);
      const chips = useMemberFilterChips();

      expect(chips.activeMemberNames.value).toEqual([]);
    });

    it('lists names of selected members when filter is partial', () => {
      const { filterStore } = setupHumans([
        makeMember('a', 'Alice'),
        makeMember('b', 'Bob'),
        makeMember('c', 'Charlie'),
      ]);
      filterStore.selectOnly('a');
      filterStore.toggleMember('c'); // {a, c}
      const chips = useMemberFilterChips();

      expect(chips.activeMemberNames.value).toEqual(['Alice', 'Charlie']);
    });

    it('excludes pets (they are not in familyStore.humans)', () => {
      // 2 humans + 1 pet so a partial filter is meaningful (1 of 2 humans).
      // With only 1 human, selecting that human is the "all" state.
      const { filterStore } = setupHumans([
        makeMember('a', 'Alice'),
        makeMember('b', 'Bob'),
        makeMember('p', 'Pet', /* isPet */ true),
      ]);
      filterStore.selectOnly('a');
      const chips = useMemberFilterChips();

      // Only Alice — pet excluded by familyStore.humans filter
      expect(chips.activeMemberNames.value).toEqual(['Alice']);
    });
  });

  describe('reactivity', () => {
    it('store mutations propagate to composable returns synchronously', () => {
      const { filterStore } = setupHumans([
        makeMember('a', 'Alice'),
        makeMember('b', 'Bob'),
        makeMember('c', 'Charlie'),
      ]);
      const chips = useMemberFilterChips();

      expect(chips.isFiltered.value).toBe(false);
      expect(chips.activeMemberNames.value).toEqual([]);

      filterStore.selectOnly('a');

      expect(chips.isFiltered.value).toBe(true);
      expect(chips.activeMemberNames.value).toEqual(['Alice']);
      expect(chips.isMemberActive('a')).toBe(true);
      expect(chips.isMemberActive('b')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('empty family produces sensible returns and does not throw', () => {
      const familyStore = useFamilyStore();
      familyStore.members = [];
      // Don't call initialize — store stays uninitialized with empty Set
      const chips = useMemberFilterChips();

      expect(chips.isAllActive.value).toBe(true); // true by store contract when humans=0
      expect(chips.isFiltered.value).toBe(false);
      expect(chips.activeMemberNames.value).toEqual([]);
      // Shouldn't throw on any handler call
      expect(() => chips.onSelectAll()).not.toThrow();
      expect(() => chips.onSelectMember('a')).not.toThrow();
    });
  });
});
