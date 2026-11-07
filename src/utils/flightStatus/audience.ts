/**
 * Live flight checks (#143): who is told when an airline changes or cancels a flight. The
 * rule lives ONCE here, for the bell deriver and the OS change notice alike:
 *
 *   every adult in the family, plus any child who is travelling on this segment.
 *
 * Adults are told whether or not they travel (a parent at home still drives to the airport);
 * a child is told only on their own flight. Departure rows do NOT use this: they follow
 * `classifyAudience` on the resolved travellers.
 *
 * Pure. `isAdult` restates `isAdultMember` (`composables/useMemberInfo.ts`) on the member
 * object alone, so this leaf never imports a composable module (and its store graph).
 */
import type { FamilyMember, UUID } from '@/types/models';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';

export type ChangeAudienceMember = Pick<FamilyMember, 'id' | 'role' | 'ageGroup' | 'isPet'>;

/** The segment's travellers as an occurrence carries them (`undefined` = the whole trip). */
export interface OccurrenceTravellers {
  travellerIds?: UUID[];
  tripAssigneeIds: UUID[];
}

/** A grown-up: a human whose age group is adult, or the pod owner. Pets never are. */
function isAdult(member: ChangeAudienceMember): boolean {
  return !member.isPet && (member.role === 'owner' || member.ageGroup === 'adult');
}

/** True when `member` gets the change/cancel notice for this segment. Pets never do. */
export function isChangeRecipient(
  member: ChangeAudienceMember,
  travellers: OccurrenceTravellers
): boolean {
  if (member.isPet) return false;
  if (isAdult(member)) return true;
  return resolveSegmentTravellers(travellers.travellerIds, travellers.tripAssigneeIds).includes(
    member.id
  );
}
