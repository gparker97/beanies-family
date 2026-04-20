/**
 * Pure helpers for vacation date/segment logic. No reactivity, no store
 * access, no side effects. Orchestration (auto-extend, activity sync,
 * persistence) lives in `vacationStore`. See ADR-023 for the
 * architectural model (user-owned trip dates, extend-never-shrink).
 */

import {
  parseLocalDate,
  extractDatePart,
  addDays,
  toDateInputValue,
  detectNightFlight,
  daysBetween,
} from '@/utils/date';
import { AIRLINES } from '@/constants/airlines';
import { AIRPORTS } from '@/constants/airports';
import { CRUISE_LINES } from '@/constants/cruiseLines';
import { CRUISE_SHIPS } from '@/constants/cruiseShips';
import { CRUISE_PORTS } from '@/constants/cruisePorts';
import type {
  FamilyVacation,
  VacationTripType,
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
} from '@/types/models';

/** Emoji lookup for vacation trip types */
const TRIP_TYPE_EMOJIS: Record<VacationTripType, string> = {
  fly_and_stay: '✈️',
  cruise: '🚢',
  road_trip: '🚗',
  combo: '🎒',
  camping: '🏕️',
  adventure: '🏔️',
};

/** Get the emoji for a vacation trip type, defaulting to ✈️. Business fly_and_stay uses 💼. */
export function tripTypeEmoji(tripType?: string, tripPurpose?: string): string {
  if (tripType === 'fly_and_stay' && tripPurpose === 'business') return '💼';
  return TRIP_TYPE_EMOJIS[tripType as VacationTripType] ?? '✈️';
}

/**
 * Derive the overall start and end dates from all vacation segments.
 * Scans travel (departure/embarkation), accommodation (check-in/out),
 * and transportation (pickup/return) to find the earliest start and latest end.
 *
 * **Retained as a seed fallback only** (see ADR-023). Call from
 * `createVacation` when the caller didn't provide explicit dates, or
 * from `updateVacation` when the existing vacation has `undefined` for
 * both dates (historical data before ADR-023 landed). Everyday segment
 * mutation goes through `extendTripDates` instead — never recompute
 * from scratch on edit, that's what caused the shrink bug.
 */
export function computeVacationDates(v: {
  travelSegments: VacationTravelSegment[];
  accommodations: VacationAccommodation[];
  transportation: VacationTransportation[];
}): { startDate?: string; endDate?: string } {
  const dates: string[] = [];

  for (const seg of v.travelSegments) {
    const hasRealDates =
      seg.departureDate || seg.arrivalDate || seg.embarkationDate || seg.disembarkationDate;
    if (seg.departureDate) dates.push(extractDatePart(seg.departureDate));
    if (seg.arrivalDate) dates.push(extractDatePart(seg.arrivalDate));
    if (seg.embarkationDate) dates.push(extractDatePart(seg.embarkationDate));
    if (seg.disembarkationDate) dates.push(extractDatePart(seg.disembarkationDate));
    // sortDate is a UI sort helper — only use as fallback when no real dates exist on this segment
    if (!hasRealDates && seg.sortDate) dates.push(extractDatePart(seg.sortDate));
  }

  for (const acc of v.accommodations) {
    if (acc.checkInDate) dates.push(extractDatePart(acc.checkInDate));
    if (acc.checkOutDate) dates.push(extractDatePart(acc.checkOutDate));
  }

  for (const trans of v.transportation) {
    if (trans.pickupDate) dates.push(extractDatePart(trans.pickupDate));
    if (trans.returnDate) dates.push(extractDatePart(trans.returnDate));
  }

  if (dates.length === 0) return {};

  dates.sort();
  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

// ── Trip-date helpers (ADR-023: user-owned, extend-never-shrink) ─────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Narrow guard: true only for well-formed `YYYY-MM-DD` ISO date strings. */
export function isValidISODate(s: unknown): s is string {
  return typeof s === 'string' && ISO_DATE_RE.test(s);
}

/**
 * Widen the current {start, end} window to include every candidate
 * date. Never narrows — if a candidate falls inside the current window,
 * it's a no-op. Missing current.start or current.end is treated as
 * "infinitely wide open" on that side.
 *
 * Invalid or malformed ISO date strings are logged with the
 * `[vacation]` prefix and skipped — fail-safe, never silent.
 * `undefined` candidates are ignored without logging (common path).
 *
 * @example
 *   extendTripDates({ start: '2026-06-01', end: '2026-06-10' }, '2026-06-15')
 *   // → { start: '2026-06-01', end: '2026-06-15' }
 *   extendTripDates({ start: '2026-06-01', end: '2026-06-10' }, '2026-06-05')
 *   // → { start: '2026-06-01', end: '2026-06-10' }   (no-op — within range)
 *   extendTripDates({}, '2026-06-05')
 *   // → { start: '2026-06-05', end: '2026-06-05' }
 */
export function extendTripDates(
  current: { start?: string; end?: string },
  ...candidates: Array<string | undefined>
): { start?: string; end?: string } {
  let { start, end } = current;

  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (!isValidISODate(candidate)) {
      console.warn(
        `[vacation] Skipping invalid trip-date candidate "${candidate}" — expected ISO YYYY-MM-DD`
      );
      continue;
    }
    if (!start || candidate < start) start = candidate;
    if (!end || candidate > end) end = candidate;
  }

  return { start, end };
}

/**
 * Collect every segment/accommodation/transportation date that might
 * contribute to the trip window. Used by the store to feed candidates
 * into `extendTripDates` after a segment mutation.
 *
 * Accepts a partial input shape so callers can pass only the arrays
 * they're actually mutating (the store does this to avoid re-scanning
 * unchanged data).
 */
export function collectSegmentDates(v: {
  travelSegments?: VacationTravelSegment[];
  accommodations?: VacationAccommodation[];
  transportation?: VacationTransportation[];
}): string[] {
  const dates: string[] = [];
  for (const seg of v.travelSegments ?? []) {
    if (seg.departureDate) dates.push(seg.departureDate);
    if (seg.arrivalDate) dates.push(seg.arrivalDate);
    if (seg.embarkationDate) dates.push(seg.embarkationDate);
    if (seg.disembarkationDate) dates.push(seg.disembarkationDate);
  }
  for (const acc of v.accommodations ?? []) {
    if (acc.checkInDate) dates.push(acc.checkInDate);
    if (acc.checkOutDate) dates.push(acc.checkOutDate);
  }
  for (const trans of v.transportation ?? []) {
    if (trans.pickupDate) dates.push(trans.pickupDate);
    if (trans.returnDate) dates.push(trans.returnDate);
    if (trans.departureDate) dates.push(trans.departureDate);
  }
  return dates;
}

// ── Segment prefill on add (seed from trip dates) ────────────────────────────

/**
 * Return a copy of the travel segment with its primary date(s) filled
 * in from the trip window, per segment type. Used when adding a new
 * segment to avoid forcing the user to retype dates they already set
 * at wizard Step 1.
 *
 * Idempotent — existing dates on the segment are never overwritten.
 * The `switch` is exhaustive over `VacationTravelType`; the `never`
 * default guards against drift if a new subtype is added.
 *
 * @see ADR-023
 */
export function prefillSegmentDates<T extends VacationTravelSegment>(
  segment: T,
  tripStart: string | undefined,
  tripEnd: string | undefined
): T {
  if (!tripStart && !tripEnd) {
    console.warn('[vacation] prefillSegmentDates called without trip dates — returning unchanged');
    return segment;
  }
  const type = segment.type;
  if (!type) return segment;

  switch (type) {
    case 'flight_outbound':
    case 'flight_other':
    case 'train':
    case 'ferry':
    case 'car':
      return segment.departureDate || !tripStart
        ? segment
        : { ...segment, departureDate: tripStart };

    case 'flight_return':
      return segment.departureDate || !tripEnd ? segment : { ...segment, departureDate: tripEnd };

    case 'cruise':
      return {
        ...segment,
        embarkationDate: segment.embarkationDate ?? tripStart,
        disembarkationDate: segment.disembarkationDate ?? tripEnd,
      };

    case 'activity':
      // Activities pick their own day — no auto-prefill.
      return segment;

    default: {
      // Exhaustiveness guard: a new `VacationTravelType` member makes
      // this unreachable and `type` becomes `never`. Adding a subtype
      // without updating the switch will fail compilation.
      const _exhaustive: never = type;
      void _exhaustive;
      return segment;
    }
  }
}

/**
 * Fill in check-in/check-out from the trip window on a newly-added
 * accommodation. Idempotent. The caller decides whether to apply
 * (typically only for the first accommodation — see Req 3 in the
 * refactor plan).
 */
export function prefillAccommodationDates<T extends VacationAccommodation>(
  acc: T,
  tripStart: string | undefined,
  tripEnd: string | undefined
): T {
  if (!tripStart && !tripEnd) {
    console.warn(
      '[vacation] prefillAccommodationDates called without trip dates — returning unchanged'
    );
    return acc;
  }
  return {
    ...acc,
    checkInDate: acc.checkInDate ?? tripStart,
    checkOutDate: acc.checkOutDate ?? tripEnd,
  };
}

/**
 * Fill in pickup/return or departure from the trip window on a newly-
 * added transportation entry. Switch on `VacationTransportationType`
 * is exhaustive.
 */
export function prefillTransportationDates<T extends VacationTransportation>(
  trans: T,
  tripStart: string | undefined,
  tripEnd: string | undefined
): T {
  if (!tripStart && !tripEnd) {
    console.warn(
      '[vacation] prefillTransportationDates called without trip dates — returning unchanged'
    );
    return trans;
  }
  const type = trans.type;
  if (!type) return trans;

  switch (type) {
    case 'rental_car':
    case 'airport_shuttle':
    case 'taxi_rideshare':
      return {
        ...trans,
        pickupDate: trans.pickupDate ?? tripStart,
        returnDate: trans.returnDate ?? tripEnd,
      };

    case 'bus':
      return trans.departureDate || !tripStart ? trans : { ...trans, departureDate: tripStart };

    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return trans;
    }
  }
}

// ── "You are here" classification (mid-trip timeline markers) ────────────────

/**
 * Classify a trip date relative to today's local calendar day.
 * Used by `TravelPlansPage` to mute past days and place the
 * `<TodayTimelineMarker>` at the right rail position.
 *
 * The `today` argument is injectable so tests can stub it; in app code
 * it defaults to the device's current local date (no UTC surprises).
 */
export function classifyTripDay(
  isoDate: string,
  today: string = toDateInputValue(new Date())
): 'past' | 'today' | 'future' {
  const date = extractDatePart(isoDate);
  if (date < today) return 'past';
  if (date > today) return 'future';
  return 'today';
}

/**
 * 1-indexed day number of `isoDate` within the trip that starts on
 * `tripStart`. Returns `null` if either date is missing/invalid or
 * if `isoDate` falls before the trip started.
 */
export function tripDayNumber(isoDate: string, tripStart: string | undefined): number | null {
  if (!tripStart || !isValidISODate(isoDate) || !isValidISODate(tripStart)) return null;
  const date = extractDatePart(isoDate);
  const start = extractDatePart(tripStart);
  if (date < start) return null;
  return daysBetween(start, date) + 1;
}

/**
 * Count booking progress across all segment arrays.
 */
export function bookingProgress(v: FamilyVacation): {
  booked: number;
  total: number;
  percent: number;
} {
  const allItems = [...v.travelSegments, ...v.accommodations, ...v.transportation] as Array<{
    status: string;
  }>;

  const total = allItems.length;
  if (total === 0) return { booked: 0, total: 0, percent: 100 };

  const booked = allItems.filter((item) => item.status === 'booked').length;
  return { booked, total, percent: Math.round((booked / total) * 100) };
}

/**
 * Days from today until the trip starts. Negative if trip has passed.
 */
export function daysUntilTrip(startDate: string): number {
  const start = parseLocalDate(extractDatePart(startDate));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Trip duration in days (inclusive of start and end).
 */
export function tripDurationDays(start: string, end: string): number {
  const startDate = parseLocalDate(extractDatePart(start));
  const endDate = parseLocalDate(extractDatePart(end));
  return Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

// ── Auto-generated segment titles ────────────────────────────────────────────

/** Extract 3-letter airport code from strings like "Singapore (SIN)" */
function airportCode(airport?: string): string {
  if (!airport) return '';
  const m = airport.match(/\(([A-Z]{3})\)/);
  return m ? m[1]! : (airport.split(' ')[0] ?? '');
}

/** Build a display title for a travel segment based on its type and fields */
export function buildTravelSegmentTitle(seg: {
  type?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  operator?: string;
  route?: string;
  departureStation?: string;
  arrivalStation?: string;
  cruiseLine?: string;
  carType?: string;
  carLabel?: string;
  title?: string;
  activityCategory?: string;
}): string {
  const t = seg.type;
  if (t === 'flight_outbound' || t === 'flight_return' || t === 'flight_other') {
    const from = airportCode(seg.departureAirport);
    const to = airportCode(seg.arrivalAirport);
    if (from && to) return `${from} → ${to}`;
    if (from) return from;
    if (to) return to;
    return t === 'flight_outbound'
      ? 'outbound flight'
      : t === 'flight_return'
        ? 'return flight'
        : 'flight';
  }
  if (t === 'cruise') return seg.cruiseLine || 'cruise';
  if (t === 'train' || t === 'ferry') {
    const from = seg.departureStation;
    const to = seg.arrivalStation;
    if (from && to) return `${from} → ${to}`;
    if (from) return from;
    if (to) return to;
    return t === 'train' ? 'train' : 'ferry';
  }
  if (t === 'car') {
    return seg.carLabel || (seg.carType ? seg.carType.replace(/_/g, ' ') : 'car');
  }
  if (t === 'activity') return seg.title || 'activity';
  return seg.title || '';
}

/** Build a display title for an accommodation based on its type and name */
export function buildAccommodationTitle(acc: { type?: string; name?: string }): string {
  if (acc.name) return acc.name;
  const typeLabels: Record<string, string> = {
    hotel: 'hotel',
    airbnb: 'airbnb',
    campground: 'campground',
    family_friends: 'stay',
  };
  return typeLabels[acc.type ?? ''] ?? 'stay';
}

/** Build a display title for a transportation item based on its type */
export function buildTransportationTitle(trans: {
  type?: string;
  agencyName?: string;
  operator?: string;
}): string {
  const typeLabels: Record<string, string> = {
    airport_shuttle: 'airport shuttle',
    rental_car: 'rental car',
    taxi_rideshare: 'taxi / rideshare',
    bus: 'bus',
  };
  const label = typeLabels[trans.type ?? ''] ?? 'transport';
  const detail = trans.agencyName || trans.operator;
  return detail ? `${label} — ${detail}` : label;
}

/**
 * Compute dates with no overnight accommodation between trip start and end.
 * Accounts for hotel check-in/out, cruise embarkation spans, and overnight flights.
 * Returns an array of ISO date strings for uncovered nights.
 */
export function computeAccommodationGaps(v: FamilyVacation): string[] {
  if (!v.startDate || !v.endDate) return [];
  const start = parseLocalDate(extractDatePart(v.startDate));
  const end = parseLocalDate(extractDatePart(v.endDate));
  const coveredDates = new Set<string>();

  // Accommodation check-in to check-out (exclusive of checkout day)
  for (const acc of v.accommodations) {
    if (acc.checkInDate && acc.checkOutDate) {
      let d = parseLocalDate(extractDatePart(acc.checkInDate));
      const out = parseLocalDate(extractDatePart(acc.checkOutDate));
      while (d < out) {
        coveredDates.add(toDateInputValue(d));
        d = addDays(d, 1);
      }
    }
  }

  // Cruise ships include accommodation — cover embarkation→disembarkation dates
  for (const seg of v.travelSegments) {
    if (seg.type === 'cruise' && seg.embarkationDate && seg.disembarkationDate) {
      let d = parseLocalDate(extractDatePart(seg.embarkationDate));
      const out = parseLocalDate(extractDatePart(seg.disembarkationDate));
      while (d < out) {
        coveredDates.add(toDateInputValue(d));
        d = addDays(d, 1);
      }
    }
  }

  // Overnight flights cover the departure night
  for (const seg of v.travelSegments) {
    if (seg.type?.startsWith('flight') && seg.departureDate && seg.arrivalDate) {
      const dep = extractDatePart(seg.departureDate);
      const arr = extractDatePart(seg.arrivalDate);
      if (arr > dep) {
        let d = parseLocalDate(dep);
        const arrDate = parseLocalDate(arr);
        while (d < arrDate) {
          coveredDates.add(toDateInputValue(d));
          d = addDays(d, 1);
        }
      }
    }
  }

  // The last day of the trip (return travel day) doesn't need accommodation
  const endStr = toDateInputValue(end);

  const gaps: string[] = [];
  let d = new Date(start);
  while (d < end) {
    const dateStr = toDateInputValue(d);
    if (dateStr !== endStr && !coveredDates.has(dateStr)) gaps.push(dateStr);
    d = addDays(d, 1);
  }
  return gaps;
}

// ── Timeline helpful hints (overlap detection) ──────────────────────────────

export interface TimelineHint {
  /** Short description of the overlap */
  message: string;
  /** IDs of all items affected by this hint */
  affectedIds: string[];
  /** Night-flight type, if applicable */
  nightFlight?: 'early-morning' | 'late-night';
  /**
   * Out-of-range classification, if applicable. Set by `detectOutOfRange`
   * when a segment falls before `vacation.startDate` or after
   * `vacation.endDate`. Consumers (banner count, per-card badges) should
   * filter on this flag rather than string-matching the message.
   */
  outOfRange?: 'before-start' | 'after-end';
}

/** Date range helper */
function dateRange(startDate?: string, endDate?: string): { start: string; end: string } | null {
  if (!startDate || !endDate) return null;
  return { start: extractDatePart(startDate), end: extractDatePart(endDate) };
}

/** Check if two date ranges overlap */
function rangesOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string }
): boolean {
  return a.start < b.end && b.start < a.end;
}

type AddHint = (
  id: string,
  message: string,
  affectedIds: string[],
  extras?: Partial<TimelineHint>
) => void;
type DatedItem = { id: string; range: { start: string; end: string }; title: string };

function buildAccommodationItems(v: FamilyVacation): DatedItem[] {
  return v.accommodations
    .map((acc) => ({
      id: acc.id,
      range: dateRange(acc.checkInDate, acc.checkOutDate),
      title: acc.title || acc.name || 'accommodation',
    }))
    .filter((a): a is DatedItem => !!a.range);
}

function buildCruiseItems(v: FamilyVacation): DatedItem[] {
  return v.travelSegments
    .filter((s) => s.type === 'cruise')
    .map((s) => ({
      id: s.id,
      range: dateRange(s.embarkationDate, s.disembarkationDate),
      title: s.title || 'cruise',
    }))
    .filter((c): c is DatedItem => !!c.range);
}

function buildFlightItems(v: FamilyVacation): DatedItem[] {
  return v.travelSegments
    .filter((s) => s.type?.startsWith('flight'))
    .map((s) => ({
      id: s.id,
      range: dateRange(s.departureDate, s.arrivalDate ?? s.departureDate),
      title: s.title || 'flight',
    }))
    .filter((f): f is DatedItem => !!f.range);
}

/** Two accommodations overlapping in date range → double-booked nights? */
function detectAccommodationOverlaps(accItems: DatedItem[], addHint: AddHint): void {
  for (let i = 0; i < accItems.length; i++) {
    for (let j = i + 1; j < accItems.length; j++) {
      const a = accItems[i]!;
      const b = accItems[j]!;
      if (rangesOverlap(a.range, b.range)) {
        addHint(a.id, `Overlaps with "${b.title}" — double-booked nights?`, [a.id, b.id]);
        addHint(b.id, `Overlaps with "${a.title}" — double-booked nights?`, [a.id, b.id]);
      }
    }
  }
}

/** Accommodation booked during a cruise window — cruise already includes it. */
function detectAccommodationDuringCruise(
  accItems: DatedItem[],
  cruiseItems: DatedItem[],
  addHint: AddHint
): void {
  for (const acc of accItems) {
    for (const cruise of cruiseItems) {
      if (rangesOverlap(acc.range, cruise.range)) {
        addHint(acc.id, `Overlaps with "${cruise.title}" — cruise includes accommodation`, [
          acc.id,
          cruise.id,
        ]);
        addHint(cruise.id, `"${acc.title}" booked during cruise — cruise includes accommodation`, [
          acc.id,
          cruise.id,
        ]);
      }
    }
  }
}

/** Flight scheduled during a cruise window — is this intentional? */
function detectFlightDuringCruise(
  flightItems: DatedItem[],
  cruiseItems: DatedItem[],
  addHint: AddHint
): void {
  for (const flight of flightItems) {
    for (const cruise of cruiseItems) {
      if (flight.range.start >= cruise.range.start && flight.range.start < cruise.range.end) {
        addHint(flight.id, `Scheduled during "${cruise.title}" — is this intentional?`, [
          flight.id,
          cruise.id,
        ]);
        addHint(cruise.id, `"${flight.title}" scheduled during cruise`, [flight.id, cruise.id]);
      }
    }
  }
}

/** Departures close to midnight are a frequent source of off-by-one date bugs. */
function detectNightFlights(v: FamilyVacation, addHint: AddHint): void {
  for (const seg of v.travelSegments) {
    const depTime = seg.departureTime || seg.embarkationTime || seg.leavingTime || seg.startTime;
    const night = detectNightFlight(depTime);
    if (night === 'early-morning') {
      addHint(
        seg.id,
        `Departs at ${depTime} — just after midnight. Double-check the date to make sure you're travelling on the right day.`,
        [seg.id],
        { nightFlight: 'early-morning' }
      );
    } else if (night === 'late-night') {
      addHint(
        seg.id,
        `Departs at ${depTime} — just before midnight. Make sure you have the correct departure date and allow extra time.`,
        [seg.id],
        { nightFlight: 'late-night' }
      );
    }
  }
}

/**
 * Segments whose primary date falls before `v.startDate` or after
 * `v.endDate`. Amber hint surfaces the misalignment; the user can fix
 * by editing the segment date or the trip window. Never blocks.
 *
 * Tags each affected hint with `outOfRange: 'before-start' | 'after-end'`
 * so downstream UI (banner count, per-card badges) filters on a
 * structured flag rather than string-matching the message.
 */
function detectOutOfRange(v: FamilyVacation, addHint: AddHint): void {
  if (!v.startDate && !v.endDate) return;

  type Item = { id: string; date: string; title: string };
  const items: Item[] = [];

  for (const seg of v.travelSegments) {
    const primary = seg.departureDate ?? seg.embarkationDate;
    if (primary) items.push({ id: seg.id, date: primary, title: seg.title || 'item' });
  }
  for (const acc of v.accommodations) {
    if (acc.checkInDate) {
      items.push({
        id: acc.id,
        date: acc.checkInDate,
        title: acc.title || acc.name || 'accommodation',
      });
    }
  }
  for (const trans of v.transportation) {
    const primary = trans.departureDate ?? trans.pickupDate;
    if (primary) items.push({ id: trans.id, date: primary, title: trans.title || 'transport' });
  }

  for (const item of items) {
    const date = extractDatePart(item.date);
    if (v.startDate && date < extractDatePart(v.startDate)) {
      addHint(item.id, `Scheduled before trip start (${v.startDate})`, [item.id], {
        outOfRange: 'before-start',
      });
    } else if (v.endDate && date > extractDatePart(v.endDate)) {
      addHint(item.id, `Scheduled after trip end (${v.endDate})`, [item.id], {
        outOfRange: 'after-end',
      });
    }
  }
}

/**
 * Detect planning issues worth surfacing on the timeline. Returns a
 * map of item ID → hint message; each affected item gets its own entry
 * so the UI can tint the matching card.
 *
 * Composed from single-concern detectors so each can be tested and
 * evolved in isolation (see ADR-023 and the refactor plan). Adding a
 * new detector is a one-line change here plus one new function.
 */
export function computeTimelineHints(v: FamilyVacation): Map<string, TimelineHint> {
  const hintMap = new Map<string, TimelineHint>();

  const addHint: AddHint = (id, message, affectedIds, extras) => {
    const existing = hintMap.get(id);
    if (existing) {
      existing.message += '; ' + message;
      for (const aid of affectedIds) {
        if (!existing.affectedIds.includes(aid)) existing.affectedIds.push(aid);
      }
      if (extras) Object.assign(existing, extras);
    } else {
      hintMap.set(id, { message, affectedIds: [...affectedIds], ...extras });
    }
  };

  // Build item-range projections once and share across the overlap detectors.
  const accItems = buildAccommodationItems(v);
  const cruiseItems = buildCruiseItems(v);
  const flightItems = buildFlightItems(v);

  detectAccommodationOverlaps(accItems, addHint);
  detectAccommodationDuringCruise(accItems, cruiseItems, addHint);
  detectFlightDuringCruise(flightItems, cruiseItems, addHint);
  detectNightFlights(v, addHint);
  detectOutOfRange(v, addHint);

  return hintMap;
}

/**
 * Translation key suffix for trip-type-appropriate countdown label.
 * Returns a key like 'travel.countdown.fly_and_stay' for use with t().
 * Business trips get a muted, neutral label.
 */
export function tripCountdownKey(tripType?: string, tripPurpose?: string): string {
  if (tripPurpose === 'business') return 'travel.countdown.business';
  const valid = ['fly_and_stay', 'cruise', 'road_trip', 'camping', 'adventure', 'combo'];
  if (tripType && valid.includes(tripType)) return `travel.countdown.${tripType}`;
  return 'travel.countdown.fly_and_stay';
}

/** Whether this vacation is a business trip */
export function isBusinessTrip(v?: { tripPurpose?: string }): boolean {
  return v?.tripPurpose === 'business';
}

// ── Combobox option builders (shared by VacationStep2 + edit modals) ────────

export interface ComboOption {
  value: string;
  label: string;
}

export function buildAirlineOptions(): ComboOption[] {
  return AIRLINES.map((a) => ({
    value: `${a.name} (${a.code})`,
    label: `${a.name} (${a.code})`,
  }));
}

export function buildAirportOptions(): ComboOption[] {
  return AIRPORTS.map((a) => ({
    value: `${a.city} (${a.code})`,
    label: `${a.city} - ${a.name} (${a.code})`,
  }));
}

export function buildCruiseLineOptions(): ComboOption[] {
  return CRUISE_LINES.map((c) => ({
    value: c.name,
    label: `${c.name} (${c.shortName})`,
  }));
}

export function buildCruiseShipOptions(cruiseLine?: string): ComboOption[] {
  const ships = cruiseLine ? CRUISE_SHIPS.filter((s) => s.cruiseLine === cruiseLine) : CRUISE_SHIPS;
  return ships.map((s) => ({
    value: s.name,
    label: cruiseLine ? s.name : `${s.name} — ${s.cruiseLine}`,
  }));
}

export function buildCruisePortOptions(): ComboOption[] {
  return CRUISE_PORTS.map((p) => ({
    value: `${p.city} — ${p.name}`,
    label: `${p.city} — ${p.name}, ${p.country}`,
  }));
}
