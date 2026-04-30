/**
 * Wires `<MemberChipFilter>` to the global `memberFilterStore` for the three
 * pages that surface a member chip filter inline (Family Planner, Accounts,
 * Transactions). Single source of truth — extracted from FamilyPlannerPage's
 * inline helpers so adding a chip filter to a new page is a 2-line consumer
 * (`useMemberFilterChips()` → spread the returns into `<MemberChipFilter>`).
 *
 * Replaces the deleted `MemberFilterDropdown.vue`. That component had a
 * silent-failure bug in its v-model setter (it ignored `toggleMember`'s
 * `false` return when the user tried to deselect the last member). The
 * chip path baked here handles the same case explicitly — see `onSelectMember`
 * Case 2 — so the bug cannot recur.
 *
 * See `docs/plans/2026-04-30-member-filter-relocation.md` for context.
 */
import { computed } from 'vue';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useFamilyStore } from '@/stores/familyStore';

export function useMemberFilterChips() {
  const memberFilterStore = useMemberFilterStore();
  const familyStore = useFamilyStore();

  const isAllActive = computed(() => memberFilterStore.isAllSelected);
  const isFiltered = computed(() => !memberFilterStore.isAllSelected);

  // When "all" is selected, no individual chip should appear active — only
  // the "All" chip does. Without the `!isAllSelected` clamp, every chip
  // would render as selected at once when the user is in the "all" state,
  // which reads as "everything is filtered" instead of "no filter applied".
  const isMemberActive = (id: string) =>
    memberFilterStore.isMemberSelected(id) && !memberFilterStore.isAllSelected;

  function onSelectAll() {
    if (!memberFilterStore.isAllSelected) memberFilterStore.selectAll();
  }

  function onSelectMember(id: string) {
    // Case 1: from "all" → narrow to one member. Matches planner's existing
    // UX (one click switches the filter from broad to focused).
    if (memberFilterStore.isAllSelected) {
      memberFilterStore.selectOnly(id);
      return;
    }

    // Case 2: deselecting the last-remaining selected member.
    // The store enforces min-selection: 1 (returning false from toggleMember
    // when the user tries to remove the last entry). The deleted
    // MemberFilterDropdown.vue had a silent-failure bug here: its v-model
    // setter ignored that return, so the UI desynced from the store. We
    // replace that broken interaction with the intuitive un-filter:
    // clicking the only-selected member's chip reverts the filter to
    // "all". DO NOT collapse this into a plain toggleMember call without
    // revisiting the min-selection contract.
    const onlyOneSelected =
      memberFilterStore.isMemberSelected(id) && memberFilterStore.selectedCount === 1;
    if (onlyOneSelected) {
      memberFilterStore.selectAll();
      return;
    }

    // Case 3: ordinary toggle inside a partial selection. The store should
    // never refuse here given the case-2 guard, but we log instead of going
    // silent if it ever does (e.g. a future store-rule change we missed).
    const ok = memberFilterStore.toggleMember(id);
    if (!ok) {
      console.warn(
        `[useMemberFilterChips] toggleMember(${id}) refused unexpectedly — store min-selection rule may have changed`
      );
    }
  }

  // Names of currently-selected members when the filter is partial. Used
  // for the "Filtered to: X, Y" line on consumer pages and the planner's
  // mobile button label. Empty when filter is "all" so callers can drive
  // visibility off the array length or `isFiltered`.
  const activeMemberNames = computed(() =>
    familyStore.humans
      .filter((m) => memberFilterStore.isMemberSelected(m.id) && !memberFilterStore.isAllSelected)
      .map((m) => m.name)
  );

  return {
    isAllActive,
    isFiltered,
    isMemberActive,
    onSelectAll,
    onSelectMember,
    activeMemberNames,
  };
}
