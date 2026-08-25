// Merge AI-extracted travel segments into matching EXISTING segments instead of duplicating
// (#30 follow-up). Pure + total. Strict per-kind identity; newer document wins on structured
// fields; genuinely-new facts append to notes; travellers union (undefined = whole trip).

import {
  buildTravelSegmentTitle,
  buildAccommodationTitle,
  buildTransportationTitle,
} from '@/utils/vacation';
import { dedupedAppend, mergeSegmentTravellers } from '@/utils/segmentTravellers';
import type { SegmentBuckets } from '@/utils/travelExtractionToSegments';
import type {
  VacationAccommodation,
  VacationTransportation,
  VacationTravelSegment,
} from '@/types/models';

type AnySegment = VacationTravelSegment | VacationAccommodation | VacationTransportation;
type SegmentKind = 'travel' | 'accommodation' | 'transportation';

/** Fields handled out-of-band by the merge — never touched by the generic scalar overwrite. */
const SPECIAL_KEYS = new Set([
  'id',
  'title',
  'notes',
  'travellerIds',
  'photoIds',
  'arrivesNextDay',
  'breakfastIncluded',
  'type',
  'status',
  'sortDate',
]);

/** Normalize one identity-key part (lowercase, strip everything but [a-z0-9]). */
function keyPart(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Join key parts; returns null if ANY required part is empty (→ never-merge). */
function joinKey(...parts: (string | undefined)[]): string | null {
  const normalized = parts.map(keyPart);
  return normalized.some((p) => p === '') ? null : normalized.join('|');
}

/**
 * A stable identity key for a segment, or `null` when it has no reliable identity (car,
 * activity, taxi/shuttle, or a segment missing its required key fields) → those always append.
 * Flights key on flightNumber + departureDate (NOT the noisy free-text airline; the flight
 * number already encodes the carrier). All flight subtypes share the key namespace.
 */
export function segmentIdentityKey(seg: AnySegment, kind: SegmentKind): string | null {
  switch (kind) {
    case 'travel': {
      const s = seg as VacationTravelSegment;
      switch (s.type) {
        case 'flight_outbound':
        case 'flight_return':
        case 'flight_other':
          return joinKey('flight', s.flightNumber, s.departureDate);
        case 'cruise':
          // Two cabins on one sailing collide on (ship + embarkation) — see the
          // accommodation note. The booking reference separates them when present.
          return s.bookingReference
            ? joinKey('cruise', s.shipName, s.bookingReference)
            : joinKey('cruise', s.shipName, s.embarkationDate);
        case 'train':
        case 'ferry':
          return joinKey(s.type, s.operator, s.departureDate);
        default: // car, activity — no reliable identity
          return null;
      }
    }
    case 'accommodation': {
      const a = seg as VacationAccommodation;
      // The CONFIRMATION NUMBER is the identity when the booking has one.
      //
      // Keying on (name + check-in) alone collides for the very ordinary case of two rooms
      // at one hotel on one night: the second upload folded into the first, its confirmation
      // number and room type overwrote the other's, and the second booking was never
      // created. The family lost a confirmation number they need at check-in, silently.
      //
      // Two bookings can share a property and a date; they cannot share a confirmation
      // number. Falling back to (name + check-in) keeps merge working for the common case
      // where a re-upload has no reference to compare.
      if (a.confirmationNumber) return joinKey('acc', a.name, a.confirmationNumber);
      return joinKey('acc', a.name, a.checkInDate);
    }
    case 'transportation': {
      const t = seg as VacationTransportation;
      switch (t.type) {
        case 'rental_car':
          // Two cars from one agency on one day — same collision.
          return t.bookingReference
            ? joinKey('rental', t.agencyName, t.bookingReference)
            : joinKey('rental', t.agencyName, t.pickupDate);
        case 'bus':
          return joinKey('bus', t.operator, t.departureDate);
        default: // airport_shuttle, taxi_rideshare — weak identity
          return null;
      }
    }
  }
}

/**
 * Merge two notes blobs: append the incoming lines to the existing ones, case-insensitively
 * de-duplicated (so re-uploading the same document doesn't keep growing notes). `undefined`
 * when empty. Reuses `dedupedAppend` — no new dedup logic.
 */
export function mergeNotes(
  existing: string | undefined,
  incoming: string | undefined
): string | undefined {
  const merged = dedupedAppend(existing?.split('\n') ?? [], incoming?.split('\n') ?? [])
    .filter((l) => l.trim() !== '')
    .join('\n');
  return merged || undefined;
}

/**
 * Merge an INCOMING (newly-extracted) segment into an EXISTING one. Newer non-empty strings win;
 * `id`/`photoIds`/`type`/`status` are kept; booleans OR-merge (a newer doc omitting a flag can't
 * flip true→false); notes + travellers merge via their helpers; `sortDate` is re-derived from the
 * merged dates; `title` is re-derived LAST from the merged fields (it depends on them).
 */
function mergeOneSegment<T extends AnySegment>(
  existing: T,
  incoming: T,
  buildTitle: (seg: T) => string
): T {
  const merged = { ...existing } as T;
  const bag = merged as unknown as Record<string, unknown>;

  // Generic: overwrite any non-special key when the incoming value is a non-empty string.
  for (const [k, v] of Object.entries(incoming)) {
    if (SPECIAL_KEYS.has(k)) continue;
    if (typeof v === 'string' && v.trim() !== '') bag[k] = v;
  }

  // Booleans: keep existing (already spread) and set true if the incoming asserts it.
  if ((incoming as VacationTravelSegment).arrivesNextDay) {
    (merged as VacationTravelSegment).arrivesNextDay = true;
  }
  if ((incoming as VacationAccommodation).breakfastIncluded) {
    (merged as VacationAccommodation).breakfastIncluded = true;
  }

  const travellerIds = mergeSegmentTravellers(existing.travellerIds, incoming.travellerIds);
  if (travellerIds !== undefined) merged.travellerIds = travellerIds;
  const notes = mergeNotes(existing.notes, incoming.notes);
  if (notes !== undefined) merged.notes = notes;

  // sortDate is derived state (travel only); re-derive from the merged dates rather than overwrite.
  const tv = merged as VacationTravelSegment;
  const primaryDate = tv.departureDate || tv.embarkationDate || tv.arrivalDate;
  if (primaryDate) tv.sortDate = primaryDate;

  merged.title = buildTitle(merged);
  return merged;
}

/** Merge one kind's incoming segments into the existing array, recording the id-remap. */
function mergeKind<T extends AnySegment>(
  existing: T[],
  incoming: T[],
  kind: SegmentKind,
  buildTitle: (seg: T) => string,
  idRemap: Record<string, string>
): T[] {
  const result = [...existing];
  for (const inc of incoming) {
    const key = segmentIdentityKey(inc, kind);
    const matchIdx =
      key === null ? -1 : result.findIndex((e) => segmentIdentityKey(e, kind) === key);
    if (matchIdx >= 0) {
      const target = result[matchIdx]!;
      result[matchIdx] = mergeOneSegment(target, inc, buildTitle);
      idRemap[inc.id] = target.id;
    } else {
      result.push(inc);
      idRemap[inc.id] = inc.id;
    }
  }
  return result;
}

/**
 * Merge the extracted buckets into a vacation's existing segments: each incoming segment that
 * matches an existing one (same kind + identity key) folds into it; the rest append. Returns the
 * new segment arrays plus an id-remap (extracted id → final segment id) so the caller can attach
 * the source document to the right segment. Pure + total.
 */
export function mergeExtractedIntoVacation(
  existing: SegmentBuckets,
  incoming: SegmentBuckets
): { merged: SegmentBuckets; idRemap: Record<string, string> } {
  const idRemap: Record<string, string> = {};
  const merged: SegmentBuckets = {
    travelSegments: mergeKind(
      existing.travelSegments,
      incoming.travelSegments,
      'travel',
      (s) => buildTravelSegmentTitle(s),
      idRemap
    ),
    accommodations: mergeKind(
      existing.accommodations,
      incoming.accommodations,
      'accommodation',
      (s) => buildAccommodationTitle(s),
      idRemap
    ),
    transportation: mergeKind(
      existing.transportation,
      incoming.transportation,
      'transportation',
      (s) => buildTransportationTitle(s),
      idRemap
    ),
  };
  return { merged, idRemap };
}
