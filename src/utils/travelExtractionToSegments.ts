// Pure mapper: travel extraction result → vacation segment buckets (#30, 2nd AI wedge).
//
// The travel model returns a defensively-typed `TravelExtractionResult` (an array of
// `TravelSegmentDraft`s across three kinds). This module turns each draft into a concrete,
// id-bearing `VacationTravelSegment` / `VacationAccommodation` / `VacationTransportation`,
// coercing the `type` to a valid enum and folding any field with no dedicated home into the
// segment's `notes` (no data loss). Pure + total: a malformed draft is skipped with a
// `[travel-extract]` console.warn — never thrown, never silently dropped.

import { generateUUID } from '@/utils/id';
import {
  buildAccommodationTitle,
  buildTransportationTitle,
  buildTravelSegmentTitle,
} from './vacation';
import type { TravelExtractionResult, TravelSegmentDraft } from '@/services/ai/types';
import type {
  VacationAccommodation,
  VacationAccommodationType,
  VacationTransportation,
  VacationTransportationType,
  VacationTravelSegment,
  VacationTravelType,
  VacationTripType,
} from '@/types/models';

export interface SegmentBuckets {
  travelSegments: VacationTravelSegment[];
  accommodations: VacationAccommodation[];
  transportation: VacationTransportation[];
}

const TRAVEL_TYPES: readonly VacationTravelType[] = [
  'flight_outbound',
  'flight_return',
  'flight_other',
  'cruise',
  'train',
  'ferry',
  'car',
  'activity',
];
const ACCOMMODATION_TYPES: readonly VacationAccommodationType[] = [
  'hotel',
  'airbnb',
  'campground',
  'family_friends',
];
const TRANSPORTATION_TYPES: readonly VacationTransportationType[] = [
  'airport_shuttle',
  'rental_car',
  'taxi_rideshare',
  'bus',
];

// Fields each kind knows how to store. Anything outside these (per kind) is folded into notes.
const TRAVEL_FIELDS = [
  'airline',
  'flightNumber',
  'departureAirport',
  'arrivalAirport',
  'departureDate',
  'departureTime',
  'arrivalDate',
  'arrivalTime',
  'terminal',
  'cruiseLine',
  'shipName',
  'departurePort',
  'cabinNumber',
  'embarkationDate',
  'embarkationTime',
  'disembarkationDate',
  'operator',
  'route',
  'departureStation',
  'arrivalStation',
  'carType',
  'carLabel',
  'link',
] as const;
const ACCOMMODATION_FIELDS = [
  'name',
  'address',
  'checkInDate',
  'checkOutDate',
  'confirmationNumber',
  'roomType',
  'contactPhone',
  'link',
] as const;
const TRANSPORTATION_FIELDS = [
  'agencyName',
  'agencyAddress',
  'pickupDate',
  'pickupTime',
  'returnDate',
  'returnTime',
  'operator',
  'route',
  'departureStation',
  'arrivalStation',
  'departureDate',
  'departureTime',
  'link',
] as const;

function coerceType<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Pull the present, non-empty allowlisted fields into a typed object. */
function pickFields(
  fields: Record<string, string>,
  keys: readonly string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = fields[k];
    if (typeof v === 'string' && v.trim() !== '') out[k] = v;
  }
  return out;
}

/**
 * Turn a camelCase / snake_case model field key into a human-readable label,
 * e.g. `cabinNumber` → "Cabin number", `loyalty_number` → "Loyalty number".
 */
function humanizeFieldKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Build the `notes` value: the model's own notes plus any recognized field that this kind
 * has no column for (so nothing the model surfaced is lost). Overflow fields are rendered
 * with humanized labels (e.g. "Cabin number: 12A") so they read cleanly in the app.
 * Returns `undefined` when empty.
 */
function buildNotes(draft: TravelSegmentDraft, mappedKeys: readonly string[]): string | undefined {
  const overflow: string[] = [];
  for (const [k, v] of Object.entries(draft.fields)) {
    if (mappedKeys.includes(k)) continue;
    if (typeof v === 'string' && v.trim() !== '')
      overflow.push(`${humanizeFieldKey(k)}: ${v.trim()}`);
  }
  const parts = [draft.notes.trim(), ...overflow].filter((p) => p !== '');
  return parts.length ? parts.join('\n') : undefined;
}

function toTravelSegment(draft: TravelSegmentDraft): VacationTravelSegment {
  const type = coerceType(draft.type, TRAVEL_TYPES, 'activity');
  const mapped = pickFields(draft.fields, TRAVEL_FIELDS);
  const primaryDate =
    mapped.departureDate || mapped.embarkationDate || mapped.arrivalDate || undefined;
  const seg: VacationTravelSegment = {
    id: generateUUID(),
    type,
    status: draft.status,
    title: draft.title.trim() || buildTravelSegmentTitle({ ...mapped, type }),
    ...mapped,
    ...(draft.arrivesNextDay ? { arrivesNextDay: true } : {}),
    ...(draft.bookingReference.trim() ? { bookingReference: draft.bookingReference.trim() } : {}),
    ...(primaryDate ? { sortDate: primaryDate } : {}),
  };
  const notes = buildNotes(draft, TRAVEL_FIELDS);
  if (notes) seg.notes = notes;
  return seg;
}

function toAccommodation(draft: TravelSegmentDraft): VacationAccommodation {
  const type = coerceType(draft.type, ACCOMMODATION_TYPES, 'hotel');
  const mapped = pickFields(draft.fields, ACCOMMODATION_FIELDS);
  const acc: VacationAccommodation = {
    id: generateUUID(),
    type,
    status: draft.status,
    title: draft.title.trim() || buildAccommodationTitle({ type, name: mapped.name }),
    ...mapped,
    ...(draft.breakfastIncluded ? { breakfastIncluded: true } : {}),
  };
  const notes = buildNotes(draft, ACCOMMODATION_FIELDS);
  if (notes) acc.notes = notes;
  return acc;
}

function toTransportation(draft: TravelSegmentDraft): VacationTransportation {
  const type = coerceType(draft.type, TRANSPORTATION_TYPES, 'taxi_rideshare');
  const mapped = pickFields(draft.fields, TRANSPORTATION_FIELDS);
  const trans: VacationTransportation = {
    id: generateUUID(),
    type,
    status: draft.status,
    title:
      draft.title.trim() ||
      buildTransportationTitle({ type, agencyName: mapped.agencyName, operator: mapped.operator }),
    ...mapped,
    ...(draft.bookingReference.trim() ? { bookingReference: draft.bookingReference.trim() } : {}),
  };
  const notes = buildNotes(draft, TRANSPORTATION_FIELDS);
  if (notes) trans.notes = notes;
  return trans;
}

/**
 * Map a travel extraction result into the three segment buckets ready for the store.
 * Pure + total — unrecognized-kind drafts are skipped (warned), never thrown.
 */
export function travelExtractionToSegments(result: TravelExtractionResult): SegmentBuckets {
  const buckets: SegmentBuckets = {
    travelSegments: [],
    accommodations: [],
    transportation: [],
  };
  for (const draft of result.segments) {
    switch (draft.kind) {
      case 'travel':
        buckets.travelSegments.push(toTravelSegment(draft));
        break;
      case 'accommodation':
        buckets.accommodations.push(toAccommodation(draft));
        break;
      case 'transportation':
        buckets.transportation.push(toTransportation(draft));
        break;
      default:
        console.warn(
          `[travel-extract] skipping segment with unrecognized kind: ${String(draft.kind)}`
        );
    }
  }
  return buckets;
}

const VALID_TRIP_TYPES: readonly VacationTripType[] = [
  'fly_and_stay',
  'cruise',
  'road_trip',
  'combo',
  'camping',
  'adventure',
];

/**
 * Choose a `VacationTripType` for a NEW trip created from the extracted segments.
 * Prefers the model's hint when valid, else infers from the segment kinds/types.
 */
export function inferTripType(result: TravelExtractionResult): VacationTripType {
  if ((VALID_TRIP_TYPES as readonly string[]).includes(result.tripTypeHint)) {
    return result.tripTypeHint as VacationTripType;
  }
  const segs = result.segments;
  const hasCruise = segs.some((s) => s.kind === 'travel' && s.type === 'cruise');
  if (hasCruise) return 'cruise';
  const hasFlight = segs.some((s) => s.kind === 'travel' && s.type.startsWith('flight'));
  const hasAccommodation = segs.some((s) => s.kind === 'accommodation');
  if (hasFlight) return 'fly_and_stay';
  const hasCar = segs.some(
    (s) => (s.kind === 'travel' && s.type === 'car') || s.kind === 'transportation'
  );
  if (hasCar && !hasAccommodation) return 'road_trip';
  return 'fly_and_stay';
}
