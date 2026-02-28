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
 */
export const useMemberFilterStore = defineStore('memberFilter', () => {
  // State
  const selectedMemberIds = ref<Set<string>>(new Set());
  const isInitialized = ref(false);

  // Getters
  const isAllSelected = computed(() => {
    const familyStore = useFamilyStore();
    if (!isInitialized.value || familyStore.members.length === 0) return true;
    return selectedMemberIds.value.size === familyStore.members.length;
  });

  const selectedCount = computed(() => selectedMemberIds.value.size);

  const selectedMembers = computed(() => {
    const familyStore = useFamilyStore();
    return familyStore.members.filter((m) => selectedMemberIds.value.has(m.id));
  });

  // Actions

  /**
   * Initialize the filter with all members selected.
   * Should be called after family members are loaded.
   */
  function initialize() {
    const familyStore = useFamilyStore();
    selectedMemberIds.value = new Set(familyStore.members.map((m) => m.id));
    isInitialized.value = true;
  }

  /**
   * Re-initialize when members change (e.g., new member added).
   * Keeps existing selections and adds new members.
   */
  function syncWithMembers() {
    const familyStore = useFamilyStore();
    const currentIds = new Set(familyStore.members.map((m) => m.id));

    // Remove selections for deleted members
    for (const id of selectedMemberIds.value) {
      if (!currentIds.has(id)) {
        selectedMemberIds.value.delete(id);
      }
    }

    // Add new members to selection
    for (const member of familyStore.members) {
      if (!selectedMemberIds.value.has(member.id)) {
        selectedMemberIds.value.add(member.id);
      }
    }

    // Ensure at least one is selected
    if (selectedMemberIds.value.size === 0 && familyStore.members.length > 0) {
      selectedMemberIds.value.add(familyStore.members[0]!.id);
    }

    // Trigger reactivity
    selectedMemberIds.value = new Set(selectedMemberIds.value);
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
    selectedMemberIds.value = new Set(familyStore.members.map((m) => m.id));
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
    return selectedMemberIds.value.has(memberId);
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
    syncWithMembers,
    toggleMember,
    selectAll,
    selectOnly,
    isMemberSelected,
    getSelectedMemberAccountIds,
    resetState,
  };
});
