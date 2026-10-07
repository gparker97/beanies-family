/**
 * usePodRecovery: "this device's pod has settled on an empty roster in a state the Family
 * Data drawer can actually recover from".
 *
 * `recoveryNeeded` needs BOTH halves:
 *
 * - A roster load attempt has settled (`familyStore.rosterLoadSettled`) and the roster is
 *   still empty. That is exactly the population the #85 change takes the session-role
 *   owner fallback away from, and the latch (not `syncStatus`) is what keeps this false
 *   during the boot window, so nothing flashes on a healthy reload.
 * - `syncStore.syncStatus` is one of the two statuses whose drawer branch is PURE recovery:
 *   `'needs-permission'` (a configured pod whose file permission was lost: the Grant
 *   button) and `'not-configured'` (no provider config at all, e.g. a lost local file
 *   handle: Reconnect / Load existing). A configured pod that failed to load for any other
 *   reason (`'error'`, a lost Drive token) is NOT included: its drawer branch is the
 *   management section, and its recovery lives in the reconnect toast, not here. The
 *   drawer's management branch is additionally gated on `canManagePod` in SettingsPage so a
 *   recovery-only viewer can never reach it whatever the status.
 *
 * Granting permission flips `needsPermission` before the file loads, so the drawer closes
 * at that moment; on success the roster loads and a manager gets the card back through
 * `canManagePod`, which is the intended end state.
 *
 * During the create wizard's bootstrap (`buildOwnerDoc`: `reloadAllStores` settles the
 * latch on the empty doc, then the owner is written) this is true for one await; harmless
 * only because no chrome renders on `/welcome`. Do not mount a recovery surface there.
 *
 * It deliberately consults NO role, and must never import `usePermissions`. The actions
 * behind it (Google consent, the file picker, the registry reconnect) carry their own
 * authentication, and any signed-in person on a dead device should be able to reconnect
 * it. `useFamilyDataAccess` composes this with `usePermissions` for the surfaces that
 * need both.
 */
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useSyncStore } from '@/stores/syncStore';

type SyncStatus = ReturnType<typeof useSyncStore>['syncStatus'];

/** The statuses whose Family Data drawer branch offers only recovery actions. */
const RECOVERABLE_STATUSES: readonly SyncStatus[] = ['not-configured', 'needs-permission'];

export function usePodRecovery() {
  const familyStore = useFamilyStore();
  const syncStore = useSyncStore();

  const recoveryNeeded = computed(
    () =>
      familyStore.rosterLoadSettled &&
      familyStore.members.length === 0 &&
      RECOVERABLE_STATUSES.includes(syncStore.syncStatus)
  );

  return { recoveryNeeded };
}
