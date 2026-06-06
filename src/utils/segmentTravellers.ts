// Pure helpers for per-segment travellers (#30 follow-up).
//
// A vacation segment's `travellerIds` is OPTIONAL: `undefined` means "the whole trip"
// (resolves to the trip's `assigneeIds`). A concrete array — including one the user or AI
// has explicitly set — is returned verbatim and is NOT rewritten when trip travellers later
// change. These helpers are pure, total, and independent (no helper calls another), so each
// can be reasoned about and tested in isolation.

import type { FamilyMember, UUID } from '@/types/models';
import type { SegmentBuckets } from '@/utils/travelExtractionToSegments';

/**
 * The members on a segment. `undefined` → the whole trip (`tripAssigneeIds`); a defined
 * array (incl. empty) → returned as-is. Single source of truth for the "undefined = everyone"
 * rule, used by the edit-modal prefill, the expanded-details list, and the subset check.
 */
export function resolveSegmentTravellers(
  travellerIds: UUID[] | undefined,
  tripAssigneeIds: UUID[]
): UUID[] {
  return travellerIds !== undefined ? travellerIds : tripAssigneeIds;
}

/**
 * True when this segment carries an explicit traveller list that omits at least one trip
 * member (a strict subset). `undefined` → false (everyone, no avatar row). Empty array → true
 * (but unreachable from the UI, which falls back to the trip default on save).
 */
export function isTravellerSubset(
  travellerIds: UUID[] | undefined,
  tripAssigneeIds: UUID[]
): boolean {
  if (travellerIds === undefined) return false;
  const set = new Set(travellerIds);
  return tripAssigneeIds.some((id) => !set.has(id));
}

/**
 * Match document traveller names (as written on a ticket/itinerary) to family members.
 * Case-insensitive, trimmed. A document name matches a member when the member's name equals
 * the full document name OR its first whitespace token (so a ticket "John Smith" matches a
 * member named "John"). The asymmetry is deliberate — we do NOT match the member's first
 * token against the document name, which would let "John Smith" and "John Doe" both match a
 * ticket "John …" (a silent false positive). Returns de-duplicated member ids; drops unmatched.
 */
export function matchTravellerIds(names: string[], roster: FamilyMember[]): UUID[] {
  const ids = new Set<UUID>();
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    const firstToken = name.split(/\s+/)[0];
    for (const member of roster) {
      const memberName = member.name.trim().toLowerCase();
      if (memberName && (memberName === name || memberName === firstToken)) {
        ids.add(member.id);
      }
    }
  }
  return [...ids];
}

/**
 * De-duplicated union of every segment's explicit `travellerIds` across the three buckets
 * (segments with no list are skipped). Used to seed a NEW AI-created trip's `assigneeIds`.
 */
export function unionTravellerIds(buckets: SegmentBuckets): UUID[] {
  const ids = new Set<UUID>();
  const all = [...buckets.travelSegments, ...buckets.accommodations, ...buckets.transportation];
  for (const seg of all) {
    if (seg.travellerIds) for (const id of seg.travellerIds) ids.add(id);
  }
  return [...ids];
}
