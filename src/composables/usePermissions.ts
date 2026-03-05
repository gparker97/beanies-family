import { computed } from 'vue';
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
  // Fallback: if currentMember is transiently null (e.g. during signup before
  // stores finish loading), check authStore.currentUser.role so the owner
  // isn't locked out of the UI.
  const isOwner = computed(
    () =>
      familyStore.currentMember?.role === 'owner' ||
      (!familyStore.currentMember && authStore.currentUser?.role === 'owner')
  );

  const canManagePod = computed(() => isOwner.value || !!familyStore.currentMember?.canManagePod);

  const canViewFinances = computed(
    () => isOwner.value || canManagePod.value || !!familyStore.currentMember?.canViewFinances
  );

  const canEditActivities = computed(
    () => isOwner.value || canManagePod.value || !!familyStore.currentMember?.canEditActivities
  );

  return { isOwner, canManagePod, canViewFinances, canEditActivities };
}
