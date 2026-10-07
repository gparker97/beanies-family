/**
 * useFamilyDataAccess: the ONE gate for the Family Data recovery surfaces (the Settings
 * card + drawer and the save-status "Manage connection" button).
 *
 * `familyDataReachable` is `canManagePod || recoveryNeeded`: whoever can manage the pod,
 * plus anyone on a device whose pod settled on an empty roster (#85, see `usePodRecovery`).
 * Both consumers read it from here so the button can never deep-link into a drawer whose
 * `v-if` disagrees with it. `usePermissions` is called once here and its computeds are
 * passed through, so a consumer does not register a second permissions watch.
 */
import { computed } from 'vue';
import { usePermissions } from '@/composables/usePermissions';
import { usePodRecovery } from '@/composables/usePodRecovery';

export function useFamilyDataAccess() {
  const permissions = usePermissions();
  const { recoveryNeeded } = usePodRecovery();
  const familyDataReachable = computed(
    () => permissions.canManagePod.value || recoveryNeeded.value
  );
  return { ...permissions, recoveryNeeded, familyDataReachable };
}
