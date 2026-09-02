import { computed, watch } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';

/** Routes that require canViewFinances permission */
export const FINANCE_ROUTES = [
  '/dashboard',
  '/accounts',
  '/budgets',
  '/transactions',
  '/goals',
  '/assets',
  '/reports',
  '/forecast',
];

export function usePermissions() {
  const familyStore = useFamilyStore();
  const authStore = useAuthStore();

  // When currentMember is resolved, use its role and permission flags.
  /**
   * Has the roster been RESOLVED? Two independent signals, either of which is sufficient.
   *
   * `members.length > 0` was the original test, and it is still valid in one direction: a
   * loaded pod always contains its owner, so a non-empty roster is certainly loaded. It
   * holds for the many paths that populate `members` without going through `loadMembers`
   * (createMember, updateMember, removeMember, and tests).
   *
   * It is NOT valid in the other direction, which is where the privilege leak was. App.vue's
   * path 3 renders an empty doc as a persistent recoverable state (cache unavailable, Drive
   * permission lost) that a user can sit in for a whole session, and `resolveSessionMember`
   * deliberately refuses to sign them out of it. So "empty" is not "still loading", and
   * keyed on emptiness alone the fallback below stopped being a pre-load window and became
   * an indefinite grant of owner from the forgeable session `role`: write a bare legacy
   * session with `role:'owner'`, revoke Drive permission, and pod management unlocks
   * (#80 review). `rosterResolved` closes exactly that case.
   */
  const rosterLoaded = computed(() => familyStore.rosterResolved || familyStore.members.length > 0);

  const isOwner = computed(
    () =>
      familyStore.currentMember?.role === 'owner' ||
      // Pre-load ONLY. Once a load has completed, an absent currentMember is a REJECTION
      // (see familyStore's session handling), not a fallback — otherwise forging just the
      // `role` field in the stored session confers owner outright (#80).
      (!rosterLoaded.value && authStore.currentUser?.role === 'owner')
  );

  const canManagePod = computed(() => isOwner.value || !!familyStore.currentMember?.canManagePod);

  const canViewFinances = computed(
    () => isOwner.value || canManagePod.value || !!familyStore.currentMember?.canViewFinances
  );

  const canEditActivities = computed(
    () => isOwner.value || canManagePod.value || !!familyStore.currentMember?.canEditActivities
  );

  // Diagnostic: log when canViewFinances changes to false unexpectedly
  watch(canViewFinances, (newVal, oldVal) => {
    if (oldVal === true && newVal === false) {
      const member = familyStore.currentMember;
      console.warn(
        '[usePermissions] canViewFinances changed true→false!',
        'currentMember:',
        member ? `${member.id} (${member.name})` : 'UNDEFINED',
        'currentMemberId:',
        familyStore.currentMemberId,
        'authUser:',
        authStore.currentUser?.memberId,
        'memberPerms:',
        member
          ? {
              canViewFinances: member.canViewFinances,
              canEditActivities: member.canEditActivities,
              canManagePod: member.canManagePod,
            }
          : 'N/A'
      );
    }
  });

  return { isOwner, canManagePod, canViewFinances, canEditActivities };
}
