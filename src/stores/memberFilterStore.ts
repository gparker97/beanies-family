import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useFamilyStore } from './familyStore';

/**
 * Global member filter store for filtering data across views.
 *
 * This filter applies to: Dashboard, Accounts, Transactions, Recurring, Assets, Goals, Forecast
 * It does NOT apply to: Reports (has own filter), Settings, Family, Setup
 *
 * The filter resets on page refresh (not persisted).
 * At least one member must be selected at all times.
 *
 * SCOPED TO HUMANS: pets never own finance entities, so they're
 * excluded from the filter universe. `isAllSelected` compares against
 * `familyStore.humans.length`; `initialize` operates on
 * humans only. Prevents the "all selected" chip from flipping off
 * when a pet is added.
 *
 * RECONCILED ON READ (see `liveSelectedIds`): a member who leaves stops counting the moment the
 * roster says so, with no sync call for anyone to forget.
 */
export const useMemberFilterStore = defineStore('memberFilter', () => {
  // State
  const selectedMemberIds = ref<Set<string>>(new Set());
  const isInitialized = ref(false);

  /**
   * The selection, intersected with the CURRENT roster. Every getter reads this, never the raw
   * set.
   *
   * ⚠️ RECONCILE ON READ. There was a `syncWithMembers()` for this, dormant for years with no
   * caller, and wiring it to a roster watch made things worse rather than better: it has no
   * memory of the previous roster, so it cannot tell "this member just arrived" from "the user
   * deselected this member", and its post-condition is always all-humans. Any roster change —
   * including one that removed an unrelated person — silently reset a narrowed filter to
   * everyone, on every page that reads it.
   *
   * A derived intersection has no such ambiguity and no lifecycle: a departed member stops
   * counting the instant the roster says so, a returning one is still selected if they were,
   * and there is nothing for a future caller to forget to call.
   */
  const liveSelectedIds = computed(() => {
    const familyStore = useFamilyStore();
    const present = new Set(familyStore.humans.map((m) => m.id));
    return new Set([...selectedMemberIds.value].filter((id) => present.has(id)));
  });

  // Getters
  const isAllSelected = computed(() => {
    const familyStore = useFamilyStore();
    if (!isInitialized.value || familyStore.humans.length === 0) return true;
    return liveSelectedIds.value.size === familyStore.humans.length;
  });

  const selectedCount = computed(() => liveSelectedIds.value.size);

  const selectedMembers = computed(() => {
    const familyStore = useFamilyStore();
    return familyStore.humans.filter((m) => liveSelectedIds.value.has(m.id));
  });

  // Actions

  /**
   * Initialize the filter with all members selected.
   * Should be called after family members are loaded.
   */
  function initialize() {
    const familyStore = useFamilyStore();
    selectedMemberIds.value = new Set(familyStore.humans.map((m) => m.id));
    isInitialized.value = true;
  }

  /**
   * Toggle a member's selection.
   * Prevents deselecting the last remaining member.
   */
  function toggleMember(memberId: string): boolean {
    if (selectedMemberIds.value.has(memberId)) {
      // Prevent deselecting the last member
      if (selectedMemberIds.value.size <= 1) {
        return false;
      }
      selectedMemberIds.value.delete(memberId);
    } else {
      selectedMemberIds.value.add(memberId);
    }
    // Trigger reactivity
    selectedMemberIds.value = new Set(selectedMemberIds.value);
    return true;
  }

  /**
   * Select all members.
   */
  function selectAll() {
    const familyStore = useFamilyStore();
    selectedMemberIds.value = new Set(familyStore.humans.map((m) => m.id));
  }

  /**
   * Select only one member (deselect all others).
   */
  function selectOnly(memberId: string) {
    selectedMemberIds.value = new Set([memberId]);
  }

  /**
   * Check if a specific member is selected.
   */
  function isMemberSelected(memberId: string): boolean {
    // Before initialization, treat as all selected
    if (!isInitialized.value) return true;
    // ⚠️ `liveSelectedIds`, so a member removed on another device mid-session stops counting
    // immediately rather than leaving a ghost id that filters every page down to nothing.
    return liveSelectedIds.value.has(memberId);
  }

  /**
   * Get account IDs for currently selected members.
   * Useful for filtering transactions and recurring items.
   */
  function resetState() {
    selectedMemberIds.value = new Set();
    isInitialized.value = false;
  }

  function getSelectedMemberAccountIds(accounts: { id: string; memberId: string }[]): Set<string> {
    if (!isInitialized.value || isAllSelected.value) {
      return new Set(accounts.map((a) => a.id));
    }
    return new Set(accounts.filter((a) => isMemberSelected(a.memberId)).map((a) => a.id));
  }

  return {
    // State
    selectedMemberIds,
    isInitialized,
    // Getters
    isAllSelected,
    selectedCount,
    selectedMembers,
    // Actions
    initialize,
    toggleMember,
    selectAll,
    selectOnly,
    isMemberSelected,
    getSelectedMemberAccountIds,
    resetState,
  };
});
