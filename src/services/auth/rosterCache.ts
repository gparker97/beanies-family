/**
 * Roster-cache refresh — keeps the device-local pre-decrypt person picker current.
 *
 * Called (fire-and-forget) whenever the member roster is loaded or mutated while a pod
 * is open. Reads the active family from the registry itself so callers don't have to
 * thread family context through, and writes the minimal `RosterCacheEntry` projection.
 *
 * The cache is an ENHANCEMENT LAYER: login surfaces must render from credential records
 * when it is missing (browser storage eviction), and must never treat its contents as
 * authorization. Member names stay out of telemetry — same privacy class as
 * `PasskeyRegistration.memberName`.
 */

import type { FamilyMember, RosterCacheEntry, RosterCacheMember } from '@/types/models';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { getFamilyById } from '@/services/familyContext';
import { saveRosterCache } from '@/services/indexeddb/repositories/rosterCacheRepository';
import { toISODateString } from '@/utils/date';
import { emitRosterRefreshFailed } from '@/services/telemetry/loginFlowEvents';

function toRosterMember(m: FamilyMember): RosterCacheMember {
  return {
    id: m.id,
    name: m.name,
    color: m.color,
    gender: m.gender,
    ageGroup: m.ageGroup,
    hasCredential: !!m.passwordHash || !!m.pinHash,
  };
}

/**
 * Refresh the active family's roster-cache entry from the live member list.
 *
 * `members` must already be in roster order (pass the sorted projection; pets are
 * filtered out here so every caller gets the same picker). A no-op when there is no
 * active family or the list is empty: an empty write would erase a good roster during
 * the sign-out reset churn, which is exactly the moment the cache exists to survive.
 */
export async function refreshRosterCache(members: FamilyMember[]): Promise<void> {
  const humans = members.filter((m) => !m.isPet);
  if (humans.length === 0) return;

  try {
    const familyId = getActiveFamilyId();
    if (!familyId) return;
    const family = await getFamilyById(familyId);

    const entry: RosterCacheEntry = {
      familyId,
      familyName: family?.name ?? '',
      members: humans.map(toRosterMember),
      cachedAt: toISODateString(new Date()),
    };
    // TOCTOU guard: the active family can switch between the read above and this write
    // (a late family-A members mutation landing after startForFamily flipped to B would
    // otherwise durably file A's names under B's entry — a cross-household privacy leak
    // on a shared device). Re-check just before persisting; a mismatch means this
    // refresh belongs to a superseded family — drop it.
    if (getActiveFamilyId() !== familyId) return;
    await saveRosterCache(entry);
  } catch (err) {
    // Non-critical (the picker falls back to credential records / the open-pod roster),
    // but never silent: a persistent failure here degrades every future login on this
    // device, and only this event says so.
    emitRosterRefreshFailed(err instanceof Error ? err.name : 'unknown');
  }
}
