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
   *
   * ⚠️ A STRONGER VERSION OF THIS WAS TRIED AND REVERTED (2026-09-02). The #80 review found
   * a real hole: App.vue's path 3 renders an empty doc as a PERSISTENT recoverable state
   * (cache unavailable, Drive permission lost), so "empty" is not always "still loading",
   * and the fallback below then grants owner from the forgeable session `role` indefinitely.
   * The fix added a sticky `familyStore.rosterResolved` and OR-ed it in here.
   *
   * It broke pod creation. `rosterResolved` latches on the FIRST completed `loadMembers`,
   * which during the create-pod wizard runs against a doc that legitimately has no members
   * yet — so the fallback died before the owner's own record existed, and every
   * `canManagePod` surface (the invite button among them) vanished for the rest of the
   * session. Caught by `invite-join.spec.ts` on both chromium and webkit.
   *
   * Closing the hole needs a signal that separates "this pod exists but did not load" from
   * "this pod is being created" — most likely whether a sync file is configured, which is
   * false only in the second case. Until that lands, this stays as it was: the hole is
   * narrow (it needs a hand-edited session AND lost file access), the seal already makes
   * hand-editing hard, and `useReauth`'s PIN step-up — not this — is the documented boundary
   * on every irreversible action.
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
