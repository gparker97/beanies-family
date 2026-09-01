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
   * A loaded pod ALWAYS contains its owner (`normalizeRoles` guarantees exactly one; the
   * single exception, a pets-only pod, has no human to confer owner on anyway), so an
   * empty roster means "not loaded yet" — never "a pod with no owner".
   */
  const rosterLoaded = computed(() => familyStore.members.length > 0);

  const isOwner = computed(
    () =>
      familyStore.currentMember?.role === 'owner' ||
      // Pre-load ONLY. Once a roster exists, an absent currentMember is a REJECTION (see
      // familyStore's session handling), not a fallback — otherwise forging just the
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
