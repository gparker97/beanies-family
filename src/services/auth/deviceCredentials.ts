/**
 * Device-local family-key credentials, per member (tracker #77).
 *
 * The ONE implementation of "retire a member's credentials on this device", shared by
 * member removal (on the remover's device), unclaim, the removed-members watcher and
 * eviction on a removed member's own device. It used to live in `familyStore` as
 * `invalidateDeviceCredentials`, with a second caller in `authStore.unclaimMember`.
 *
 * Service, not store: it imports no store, so both stores can call it without a cycle.
 */
import { removePinUnlock, listPinUnlocks } from '@/services/auth/deviceUnlock';
import {
  removeAllPasskeysForMember,
  removeNativeKeystoreForMember,
  resolveDeviceKeys,
} from '@/services/auth/passkeyService';
import { reportError } from '@/utils/errorReporter';

/**
 * Retire every credential this device holds for (familyId, memberId): registered
 * passkeys / keystore records, the PIN unlock wrap, and any keystore blob addressed to the
 * member that has no registry record (one that survived an uninstall).
 *
 * Deliberately NEVER throws, and each step is independent: one failing must not stop the
 * others, and none may flip the caller's outcome — by the time this runs the membership
 * decision has already been made. Every failure is reported.
 *
 * SCOPE: this device only. The passkey registry and PIN wraps are device-local.
 */
export async function retireMemberDeviceCredentials(
  familyId: string,
  memberId: string
): Promise<void> {
  const tail = memberId.slice(-8);
  try {
    await removeAllPasskeysForMember(memberId);
  } catch (e) {
    reportError({
      surface: 'member-removal',
      message: 'failed to invalidate device credentials for a removed member',
      error: e,
      severity: 'warning',
      context: { action: 'invalidate_credentials', member_id_tail: tail },
    });
  }
  // The PIN device-unlock wrap is family-key material too: a removed member's PIN must
  // stop unwrapping the family key on this device.
  try {
    await removePinUnlock(familyId, memberId);
  } catch (e) {
    reportError({
      surface: 'member-removal',
      message: 'failed to remove the PIN unlock wrap for a removed member',
      error: e,
      severity: 'warning',
      context: { action: 'invalidate_pin_wrap', member_id_tail: tail },
    });
  }
  try {
    await removeNativeKeystoreForMember(familyId, memberId);
  } catch (e) {
    reportError({
      surface: 'member-removal',
      message: 'failed to clear an unregistered keystore blob for a removed member',
      error: e,
      severity: 'warning',
      context: { action: 'invalidate_keystore_blob', member_id_tail: tail },
    });
  }
}

/**
 * The member ids that hold ANY family-key credential on this device for `familyId`:
 * a PIN unlock wrap or a device key (native keystore / passkey registration).
 */
export async function membersWithDeviceCredentials(familyId: string): Promise<Set<string>> {
  const [pins, keys] = await Promise.all([listPinUnlocks(familyId), resolveDeviceKeys(familyId)]);
  return new Set([...pins.map((p) => p.memberId), ...keys.map((k) => k.memberId)]);
}

export type FamilyEvictionDecision =
  'evict' | 'live-credential' | 'live-session' | 'unsynced' | 'not-removed';

/**
 * May this device forget the whole family, having found a removed member here?
 *
 * Pure, so the matrix is unit-testable without a store. Only when all hold:
 *  - the member is recorded in `removedMembers` (authenticated) — never mere roster absence;
 *  - no LIVE member of the family still has a credential on this device (a shared family
 *    tablet must keep working for everyone else);
 *  - no live member holds the session here;
 *  - this device's copy holds no work the family file has not got. A live member who
 *    signs in here with a password or a magic link leaves NO device credential, so the
 *    credential check alone cannot see them — but their unsaved edits could be in this
 *    cache, and forgetting the family would destroy them. (In a Drive family whose file
 *    access was just revoked this can defer eviction indefinitely; that device loses file
 *    access before it can read the removal anyway.)
 */
export function shouldEvictFamily(input: {
  memberIsRemoved: boolean;
  liveMemberIdsWithDeviceCredential: readonly string[];
  sessionMemberIsLive: boolean;
  hasUnpushedWork: boolean;
}): FamilyEvictionDecision {
  if (!input.memberIsRemoved) return 'not-removed';
  if (input.liveMemberIdsWithDeviceCredential.length > 0) return 'live-credential';
  if (input.sessionMemberIsLive) return 'live-session';
  if (input.hasUnpushedWork) return 'unsynced';
  return 'evict';
}
