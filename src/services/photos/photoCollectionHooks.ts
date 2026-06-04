/**
 * Photo-collection hooks for the non-flat photo hosts.
 *
 * Registered in App.vue via `registerPhotoCollection(name, hooks)`. See
 * `PhotoCollectionHooks` in `photoStore.ts` and the design rationale in
 * docs/plans/2026-06-04-travel-segment-attachments.md.
 *
 *   - vacations: booking segments are nested array items inside
 *     `doc.vacations[*].{travelSegments|accommodations|transportation}[]`,
 *     not a flat top-level record — so attach/collect can't use the default
 *     flat hooks.
 *   - familyMembers: avatars are referenced by a scalar `avatarPhotoId`, not
 *     a `photoIds` array.
 */
import type { FamilyDocument } from '@/types/automerge';
import type {
  FamilyVacation,
  UUID,
  VacationAccommodation,
  VacationTransportation,
  VacationTravelSegment,
} from '@/types/models';
import type { PhotoCollectionHooks } from '@/stores/photoStore';

/**
 * The nested arrays on a FamilyVacation that hold attachment-bearing booking
 * segments. Tied 1:1 to the three segment interfaces in models.ts — a future
 * segment array is a one-line add here (and both hooks pick it up).
 */
const BOOKING_SEGMENT_KEYS = ['travelSegments', 'accommodations', 'transportation'] as const;

type BookingSegment = VacationTravelSegment | VacationAccommodation | VacationTransportation;

/**
 * The composite entity id used for vacation-segment attachments:
 * `${vacationId}/${segmentId}`. Segment ids are UUIDs (no '/'), so this
 * round-trips unambiguously and lets the attach hook do an O(1) vacation
 * lookup (and warn precisely on id-drift).
 */
export function vacationSegmentEntityId(vacationId: UUID, segmentId: UUID): string {
  return `${vacationId}/${segmentId}`;
}

function vacationSegmentArrays(vac: FamilyVacation): BookingSegment[][] {
  return BOOKING_SEGMENT_KEYS.map((k) => (vac[k] ?? []) as BookingSegment[]);
}

/** Visit every booking segment across all vacations (used by collect). */
export function forEachBookingSegment(
  doc: FamilyDocument,
  fn: (segment: BookingSegment) => void
): void {
  for (const vac of Object.values(doc.vacations ?? {})) {
    for (const arr of vacationSegmentArrays(vac)) {
      for (const seg of arr) fn(seg);
    }
  }
}

export const vacationPhotoHooks: PhotoCollectionHooks = {
  attach(doc, entityId, photoId) {
    const slash = entityId.indexOf('/');
    if (slash < 0) return; // not a composite key — nothing to do
    const vacationId = entityId.slice(0, slash);
    const segmentId = entityId.slice(slash + 1);
    const vac = (doc.vacations ?? {})[vacationId];
    if (!vac) return; // vacation not in the doc yet (e.g. mid-wizard) — expected no-op
    for (const arr of vacationSegmentArrays(vac)) {
      const seg = arr.find((s) => s.id === segmentId);
      if (seg) {
        seg.photoIds = [...(seg.photoIds ?? []), photoId];
        return;
      }
    }
    // Vacation exists but the segment id is gone — a real id-drift bug, not
    // the benign wizard case (where the vacation simply isn't saved yet).
    console.warn(
      `[photoCollectionHooks] vacation ${vacationId} has no segment ${segmentId} to attach photo ${photoId}`
    );
  },
  *collect(doc) {
    const ids: UUID[] = [];
    forEachBookingSegment(doc, (seg) => {
      for (const pid of seg.photoIds ?? []) ids.push(pid);
    });
    yield* ids;
  },
};

export const avatarPhotoHooks: PhotoCollectionHooks = {
  // Avatars are attached by familyStore setting the scalar
  // FamilyMember.avatarPhotoId — they never flow through attachPhotoToEntity
  // or the upload queue, so attach is a deliberate no-op (a photoIds push
  // would be wrong: family members have no photoIds array).
  attach() {
    /* no-op by design */
  },
  *collect(doc) {
    for (const member of Object.values(doc.familyMembers ?? {})) {
      if (member.avatarPhotoId) yield member.avatarPhotoId;
    }
  },
};
