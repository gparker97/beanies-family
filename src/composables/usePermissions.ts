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
   * INVARIANT (#80, #85): the forgeable session `role` may confer owner ONLY while no roster
   * load has settled: the boot window, and the signup bootstrap before the owner's record
   * exists. Once a load attempt settles (`familyStore.rosterLoadSettled`), owner comes from
   * the pod's own member record and nowhere else, even when the roster is empty.
   *
   * Why an empty roster is not enough: App.vue's path 3 renders an empty doc as a
   * PERSISTENT, recoverable state (cache unavailable, Drive permission lost, provider config
   * lost), and path-1b failures load nothing at all. Gating on `members.length` alone let a
   * hand-edited session sit on such a pod and read as owner for the whole session.
   *
   * History: a sticky latch was first tried on 2026-09-02 (commit d1ef1589) and reverted the
   * same day (c3be5e29) when `invite-join.spec.ts` went red on chromium and webkit. That
   * spec reloaded with a raw `page.goto`, which restores an empty, ownerless doc for the
   * memory provider; the Invite button existed there ONLY through this fallback, so the
   * test was exercising the hole. Pod creation never depended on it (the owner record is
   * selected before `currentUser` is set). The spec now reloads through `gotoRoute`.
   *
   * When and where the latch is set: see `familyStore.settleRosterLoad()`.
   *
   * `rosterLoaded` itself stays "a roster exists" (`members.length > 0`); App.vue's
   * home-time-zone watch consumes it with that meaning. `useReauth`'s PIN step-up remains
   * the boundary on every irreversible action.
   */
  const rosterLoaded = computed(() => familyStore.members.length > 0);

  const isOwner = computed(
    () =>
      familyStore.currentMember?.role === 'owner' ||
      // ONLY until a load attempt settles. After that, an absent currentMember is a
      // REJECTION (see familyStore's session handling) or a pod that did not load, never a
      // fallback; otherwise forging just the `role` field in the stored session confers
      // owner outright (#80, #85).
      (!rosterLoaded.value &&
        !familyStore.rosterLoadSettled &&
        authStore.currentUser?.role === 'owner')
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

  return { isOwner, canManagePod, canViewFinances, canEditActivities, rosterLoaded };
}
