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
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type {
  FamilyVacation,
  VacationTripType,
  VacationTravelSegment,
  VacationTravelType,
  VacationSegmentStatus,
  VacationAccommodation,
  VacationTransportation,
  SupportedTravelType,
  UUID,
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
    // departureDate is what a BUS or COACH booking carries — it is in TRANSPORTATION_FIELDS
    // and both sibling collectors (collectSegmentDates, segmentDateRange) already read it.
    // Only this one drifted, and this one is the seed rule when createVacation gets no dates
    // — i.e. exactly the AI-reader path. A coach itinerary produced a DATELESS trip, whose
    // linked activity then fell back to today, putting next month's trip on today's calendar
    // with no gap warnings and no way for a later upload to match it. Silent, because today
    // is a real and plausible date.
    if (trans.departureDate) dates.push(extractDatePart(trans.departureDate));
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
 * Used by `TravelPlansPage` to mute past days and to gate the inline
 * `<TodayTimelineMarker>` chip onto today's date-group.
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

export type TripPhase = 'upcoming' | 'today' | 'ongoing' | 'past';

/**
 * Classify a vacation relative to `todayStr` (`YYYY-MM-DD`) into a lifecycle
 * phase. Pure + date-only lexicographic comparison (valid for ISO dates),
 * matching the convention of `classifyTripDay` in this file.
 *  - 'past':     ended before today
 *  - 'upcoming': no start date, or starts after today
 *  - 'today':    starts today
 *  - 'ongoing':  started before today and not yet ended
 * No startDate → 'upcoming' (preserves current card copy).
 */
export function tripPhase(
  v: Pick<FamilyVacation, 'startDate' | 'endDate'>,
  todayStr: string
): TripPhase {
  const end = v.endDate ? extractDatePart(v.endDate) : undefined;
  if (end && end < todayStr) return 'past';
  const start = v.startDate ? extractDatePart(v.startDate) : undefined;
  if (!start || start > todayStr) return 'upcoming';
  if (start === todayStr) return 'today';
  return 'ongoing';
}

/**
 * "Day X of N" progress for an in-progress trip, or `null` when it can't be
 * computed (missing/invalid dates, or a non-positive/NaN duration). Pure;
 * `todayStr` is injected (no clock read). Owns validation at this boundary
 * because `tripDurationDays` does not guard malformed input (returns NaN),
 * whereas `tripDayNumber` returns `null` — this helper normalizes both.
 *
 * Returns the {day, total} numbers (not the localized string) so the i18n
 * substitution stays in the component layer, consistent with the ribbon.
 */
export function tripDayProgress(
  v: Pick<FamilyVacation, 'startDate' | 'endDate'>,
  todayStr: string
): { day: number; total: number } | null {
  if (!v.startDate || !v.endDate) return null;
  const day = tripDayNumber(todayStr, v.startDate); // null on bad/missing
  const total = tripDurationDays(v.startDate, v.endDate); // NaN on bad input
  if (day === null || !Number.isFinite(total) || total <= 0) return null;
  return { day, total };
}

// ── Timeline "when" band + segment phase ─────────────────────────────────────
// Single source of per-kind date/time knowledge for the expanded-segment band
// and the past/now/future classification. Adding a segment kind is one row in
// SEGMENT_TIMING (mirrors SIDE_FIELDS). All pure — no reactivity, no store.

export type SegmentPhase = 'past' | 'now' | 'future';

/** One cell of the "when" band. Raw values — `SegmentWhenBand.vue` formats them. */
export interface WhenCell {
  captionKey: UIStringKey;
  /** HH:mm, unformatted */
  time?: string;
  /** ISO date-part (YYYY-MM-DD), unformatted */
  date?: string;
  /** arrival lands the next calendar day (flight/train/ferry) */
  nextDay?: boolean;
}

export interface WhenBand {
  start: WhenCell;
  /** second cell — arrival, or the span end (check-out / disembark / return) */
  end?: WhenCell;
}

/** Field names are model keys read off travel / accommodation / transportation
 *  segments; typed loosely because one descriptor spans all three entities. */
interface TimingCellSpec {
  captionKey: UIStringKey;
  /** Date fields that make the cell "present" (first present wins). A real
   *  fallback chain, e.g. transport `pickupDate → departureDate`. */
  dateFields: string[];
  /** Display-only date fields, appended after `dateFields` for the shown date but
   *  NOT counted for presence — e.g. a flight arrival borrows the departure date
   *  for display, but must not force an arrival cell when there's no arrival time. */
  fallbackDateFields?: string[];
  timeFields?: string[];
  /** boolean model field that, when true, flags a next-day arrival */
  nextDayField?: string;
}
interface TimingSpec {
  start: TimingCellSpec;
  /** the band's second cell; ALSO the span end when `spanning` is true */
  second?: TimingCellSpec;
  /** true ONLY when `second` is a multi-day span end (drives past/now/`staying now`).
   *  A flight has a second cell (arrival) but is NOT spanning. */
  spanning?: boolean;
}

/** The one place per-kind date/time knowledge lives (see SIDE_FIELDS precedent).
 *  Keyed by a resolved timing key (`resolveTimingKey`), not the raw segment type. */
const SEGMENT_TIMING: Record<string, TimingSpec> = {
  // flights + train + ferry: departs → arrives, same-day (never a multi-day span)
  flightlike: {
    start: {
      captionKey: 'segmentRow.departs',
      dateFields: ['departureDate'],
      timeFields: ['departureTime'],
    },
    second: {
      captionKey: 'segmentRow.arrives',
      dateFields: ['arrivalDate'],
      // borrow the departure date for display when arrival lands the same day —
      // but only decorate an arrival cell that already exists (has a time)
      fallbackDateFields: ['departureDate'],
      timeFields: ['arrivalTime'],
      nextDayField: 'arrivesNextDay',
    },
  },
  cruise: {
    start: {
      captionKey: 'segmentRow.embark',
      dateFields: ['embarkationDate'],
      timeFields: ['embarkationTime'],
    },
    // schema has no disembarkationTime — disembark cell is date-only
    second: { captionKey: 'segmentRow.disembark', dateFields: ['disembarkationDate'] },
    spanning: true,
  },
  car: {
    start: {
      captionKey: 'segmentRow.starts',
      dateFields: ['departureDate'],
      timeFields: ['leavingTime'],
    },
  },
  activity: {
    start: {
      captionKey: 'segmentRow.starts',
      dateFields: ['departureDate'],
      timeFields: ['startTime'],
    },
  },
  accommodation: {
    start: { captionKey: 'segmentRow.checkIn', dateFields: ['checkInDate'] },
    second: { captionKey: 'segmentRow.checkOut', dateFields: ['checkOutDate'] },
    spanning: true,
  },
  rental_car: {
    start: {
      captionKey: 'segmentRow.pickup',
      dateFields: ['pickupDate'],
      timeFields: ['pickupTime'],
    },
    second: {
      captionKey: 'segmentRow.return',
      dateFields: ['returnDate'],
      timeFields: ['returnTime'],
    },
    spanning: true,
  },
  // non-rental transport (shuttle / taxi / bus): a single "starts" cell.
  // Bus carries departureDate; shuttle/taxi carry pickupDate — fallback chain.
  transport: {
    start: {
      captionKey: 'segmentRow.starts',
      dateFields: ['pickupDate', 'departureDate'],
      timeFields: ['pickupTime', 'departureTime'],
    },
  },
};

/** Map a timeline item's kind + raw segment type onto a SEGMENT_TIMING key. */
export function resolveTimingKey(
  kind: 'travel' | 'accommodation' | 'transportation',
  type: string | undefined
): string {
  if (kind === 'accommodation') return 'accommodation';
  if (kind === 'transportation') return type === 'rental_car' ? 'rental_car' : 'transport';
  if (type?.startsWith('flight')) return 'flightlike';
  if (type === 'cruise') return 'cruise';
  if (type === 'car') return 'car';
  if (type === 'activity') return 'activity';
  // train / ferry share the flight departs→arrives shape
  return 'flightlike';
}

/** Any of the three timeline segment entities — read generically by field name. */
export type TimingSegment = VacationTravelSegment | VacationAccommodation | VacationTransportation;

/** First present, non-empty string field from a fallback chain. */
function readField(
  seg: Record<string, unknown>,
  fields: string[] | undefined
): { value?: string; field?: string } {
  if (!fields) return {};
  for (const f of fields) {
    const v = seg[f];
    if (typeof v === 'string' && v) return { value: v, field: f };
  }
  return {};
}

/**
 * Start / end DATE span for phase classification. `end` is returned ONLY when
 * the kind is a multi-day span (accommodation / cruise / rental_car) — flights
 * have a second band cell but are not spans. Date-parts only. Total: missing
 * dates yield `undefined`, never throws.
 */
export function segmentSpan(
  kind: 'travel' | 'accommodation' | 'transportation',
  seg: TimingSegment
): { start?: string; end?: string } {
  const rec = seg as unknown as Record<string, unknown>;
  const spec = SEGMENT_TIMING[resolveTimingKey(kind, seg.type)];
  if (!spec) return {};
  const start = readField(rec, spec.start.dateFields).value;
  const end = spec.spanning ? readField(rec, spec.second?.dateFields).value : undefined;
  return {
    start: start ? extractDatePart(start) : undefined,
    end: end ? extractDatePart(end) : undefined,
  };
}

/**
 * Phase of a segment relative to `today` (`YYYY-MM-DD`). A span is `past` once
 * its END date is before today — this is the ongoing-stay fix (a hotel mid-stay
 * is `now`, not `past`). Single-point items use their own date. Pure, `today`
 * injected, TOTAL: a missing/blank date never hides a segment (falls to `now`).
 */
export function classifySegmentPhase(
  span: { start?: string; end?: string },
  today: string
): SegmentPhase {
  const end = span.end ?? span.start;
  if (end && end < today) return 'past';
  if (span.start && span.start > today) return 'future';
  return 'now';
}

/**
 * Build the when-band plus the exact model fields it consumed, so the row list
 * can drop precisely those (never orphaning or duplicating a date). Returns
 * `null` when the start cell has neither a date nor a time. A kind with a
 * `second` cell but no second value degrades to a single-cell band. Raw values —
 * `SegmentWhenBand.vue` does the formatting.
 */
export function buildWhenBand(
  kind: 'travel' | 'accommodation' | 'transportation',
  seg: TimingSegment
): { band: WhenBand; consumed: string[] } | null {
  const rec = seg as unknown as Record<string, unknown>;
  const spec = SEGMENT_TIMING[resolveTimingKey(kind, seg.type)];
  if (!spec) return null;
  const consumed: string[] = [];

  const buildCell = (cell: TimingCellSpec): WhenCell | null => {
    const tm = readField(rec, cell.timeFields);
    // presence: a time, or a date from the presence-counting fields
    const present = readField(rec, cell.dateFields);
    if (!tm.value && !present.value) return null;
    // display date: presence fields first, then display-only fallbacks
    const shown = readField(rec, [...cell.dateFields, ...(cell.fallbackDateFields ?? [])]);
    if (shown.field) consumed.push(shown.field);
    if (tm.field) consumed.push(tm.field);
    return {
      captionKey: cell.captionKey,
      date: shown.value ? extractDatePart(shown.value) : undefined,
      time: tm.value,
      nextDay: cell.nextDayField ? rec[cell.nextDayField] === true : undefined,
    };
  };

  const start = buildCell(spec.start);
  if (!start) return null;
  const end = spec.second ? buildCell(spec.second) : null;
  return { band: end ? { start, end } : { start }, consumed };
}

/**
 * The ONE badge a trip card shows, by construction.
 *
 * Every surface that badges a trip (the nook card, the travel list card, the
 * travel detail header) routes through this. Before it existed, `TravelPlansPage`
 * decided from `daysUntilTrip(startDate) <= 0` — days until the trip *starts* —
 * so the moment a trip began it read "completed" while the family was still on it.
 *
 * Pure: `todayStr` is injected, no clock read, matching `tripPhase` /
 * `tripDayProgress`. Returns i18n KEYS (+ params), never copy — substitution
 * stays in the component layer, as elsewhere in this file.
 */
export type TripBadge =
  /** `labelKey` is `string`, not `UIStringKey`: `tripCountdownKey` returns `string`
   *  and the render sites cast it into `t()`. Deliberate; don't "tidy" it. */
  | { kind: 'countdown'; days: number; labelKey: string; emoji: string }
  | { kind: 'status'; textKey: UIStringKey; params?: Record<string, string | number> }
  /** Distinct from `status`: its copy and check-mark styling differ per surface,
   *  and the nook never renders it. */
  | { kind: 'completed' };

export function tripBadge(
  v: Pick<FamilyVacation, 'startDate' | 'endDate' | 'tripType' | 'tripPurpose'>,
  todayStr: string
): TripBadge | null {
  const phase = tripPhase(v, todayStr);

  switch (phase) {
    case 'past':
      return { kind: 'completed' };

    case 'today':
      return { kind: 'status', textKey: 'vacation.startsToday' };

    case 'ongoing': {
      const prog = tripDayProgress(v, todayStr);
      return prog
        ? {
            kind: 'status',
            textKey: 'vacation.dayOfTrip',
            params: { n: prog.day, total: prog.total },
          }
        : { kind: 'status', textKey: 'vacation.onNow' }; // graceful: never a blank/NaN badge
    }

    case 'upcoming': {
      // Load-bearing: without it `daysBetween` would call `extractDatePart(undefined)`
      // and throw. `tripPhase` maps a falsy startDate to 'upcoming'.
      if (!v.startDate) return null;

      // Safe to use the absolute `daysBetween` here: phase 'upcoming' proves
      // startDate > todayStr for a well-formed date, so the result is positive.
      const days = daysBetween(todayStr, v.startDate);

      // A MALFORMED startDate also lands in 'upcoming' (junk sorts after an ISO
      // date), and `daysBetween` then returns NaN. `NaN <= 0` is false, so without
      // this the chip would render the string "NaN" — where today it renders
      // nothing. The finite check is what preserves that.
      if (!Number.isFinite(days) || days <= 0) return null;

      return {
        kind: 'countdown',
        days,
        labelKey: tripCountdownKey(v.tripType, v.tripPurpose),
        emoji: tripTypeEmoji(v.tripType, v.tripPurpose),
      };
    }

    default: {
      // A new TripPhase member fails to compile here rather than silently
      // returning undefined.
      const _exhaustive: never = phase;
      void _exhaustive;
      return null;
    }
  }
}

// ── Trip targeting for AI travel extraction (#30) ────────────────────────────

export interface DateRange {
  start: string;
  end: string;
}

/**
 * The inclusive date window of the extracted segments, or `null` when none of them
 * carry a usable date. Pure; scans the same date fields as `computeVacationDates`.
 */
export function segmentDateRange(buckets: {
  travelSegments: {
    departureDate?: string;
    arrivalDate?: string;
    embarkationDate?: string;
    disembarkationDate?: string;
    sortDate?: string;
  }[];
  accommodations: { checkInDate?: string; checkOutDate?: string }[];
  transportation: { pickupDate?: string; returnDate?: string; departureDate?: string }[];
}): DateRange | null {
  const dates: string[] = [];
  const push = (d?: string) => {
    if (d && isValidISODate(extractDatePart(d))) dates.push(extractDatePart(d));
  };
  for (const s of buckets.travelSegments) {
    push(s.departureDate);
    push(s.arrivalDate);
    push(s.embarkationDate);
    push(s.disembarkationDate);
    push(s.sortDate);
  }
  for (const a of buckets.accommodations) {
    push(a.checkInDate);
    push(a.checkOutDate);
  }
  for (const t of buckets.transportation) {
    push(t.pickupDate);
    push(t.returnDate);
    push(t.departureDate);
  }
  if (dates.length === 0) return null;
  dates.sort();
  return { start: dates[0]!, end: dates[dates.length - 1]! };
}

/**
 * Non-past trips whose date window overlaps `range`. Pure; `todayStr` excludes trips
 * that have already ended (via `tripPhase`). A trip with no usable start date can't
 * be matched and is skipped. A missing trip end is treated as a single-day window.
 */
export function tripsOverlappingRange(
  vacations: FamilyVacation[],
  range: DateRange,
  todayStr: string
): FamilyVacation[] {
  if (!isValidISODate(range.start) || !isValidISODate(range.end)) return [];
  return vacations.filter((v) => {
    if (tripPhase(v, todayStr) === 'past') return false;
    const tStart = v.startDate ? extractDatePart(v.startDate) : undefined;
    if (!tStart || !isValidISODate(tStart)) return false;
    const tEndRaw = v.endDate ? extractDatePart(v.endDate) : tStart;
    const tEnd = isValidISODate(tEndRaw) ? tEndRaw : tStart;
    // Inclusive overlap on YYYY-MM-DD strings (lexicographic == chronological).
    return tStart <= range.end && tEnd >= range.start;
  });
}

export type TripTarget =
  | { kind: 'create' }
  | { kind: 'attach'; vacationId: string }
  | { kind: 'choose'; candidates: FamilyVacation[] };

/**
 * The match/prompt/create rule for where extracted segments should go (#30):
 * 0 matches → create a new trip; exactly 1 → attach to it; 2+ → let the user choose.
 * Pure — the composable and the review modal both consume this; neither re-derives it.
 */
export function resolveTripTarget(matches: FamilyVacation[]): TripTarget {
  if (matches.length === 0) return { kind: 'create' };
  if (matches.length === 1) return { kind: 'attach', vacationId: matches[0]!.id };
  return { kind: 'choose', candidates: matches };
}

/**
 * When the reader is launched from a specific trip's detail page, that trip is the intended
 * default — override the date-resolved target with an `attach` to it (the review modal still lets
 * the user switch to New or another trip). Falls back to the original date-resolved target when
 * no trip was pre-selected, or when the pre-selected trip no longer exists (e.g. deleted
 * mid-flow). Pure — safe to unit-test without Vue.
 */
export function overrideTripTarget(
  target: TripTarget,
  tripId: string | null,
  vacations: FamilyVacation[]
): TripTarget {
  if (tripId && vacations.some((v) => v.id === tripId)) {
    return { kind: 'attach', vacationId: tripId };
  }
  return target;
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
/** Translation lookup, threaded in from the calling component so this pure
 *  util stays store-agnostic (mirrors `travelDetailRows` in useVacationTimeline). */
type Translate = (key: UIStringKey) => string;
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
function detectAccommodationOverlaps(accItems: DatedItem[], addHint: AddHint, t: Translate): void {
  for (let i = 0; i < accItems.length; i++) {
    for (let j = i + 1; j < accItems.length; j++) {
      const a = accItems[i]!;
      const b = accItems[j]!;
      if (rangesOverlap(a.range, b.range)) {
        addHint(a.id, fillTemplate(t('travel.hint.accommodationOverlap'), { title: b.title }), [
          a.id,
          b.id,
        ]);
        addHint(b.id, fillTemplate(t('travel.hint.accommodationOverlap'), { title: a.title }), [
          a.id,
          b.id,
        ]);
      }
    }
  }
}

/** Accommodation booked during a cruise window — cruise already includes it. */
function detectAccommodationDuringCruise(
  accItems: DatedItem[],
  cruiseItems: DatedItem[],
  addHint: AddHint,
  t: Translate
): void {
  for (const acc of accItems) {
    for (const cruise of cruiseItems) {
      if (rangesOverlap(acc.range, cruise.range)) {
        addHint(
          acc.id,
          fillTemplate(t('travel.hint.accommodationDuringCruise'), { title: cruise.title }),
          [acc.id, cruise.id]
        );
        addHint(
          cruise.id,
          fillTemplate(t('travel.hint.cruiseHasAccommodation'), { title: acc.title }),
          [acc.id, cruise.id]
        );
      }
    }
  }
}

/** Flight scheduled during a cruise window — is this intentional? */
function detectFlightDuringCruise(
  flightItems: DatedItem[],
  cruiseItems: DatedItem[],
  addHint: AddHint,
  t: Translate
): void {
  for (const flight of flightItems) {
    for (const cruise of cruiseItems) {
      if (flight.range.start >= cruise.range.start && flight.range.start < cruise.range.end) {
        addHint(
          flight.id,
          fillTemplate(t('travel.hint.flightDuringCruise'), { title: cruise.title }),
          [flight.id, cruise.id]
        );
        addHint(
          cruise.id,
          fillTemplate(t('travel.hint.cruiseHasFlight'), { title: flight.title }),
          [flight.id, cruise.id]
        );
      }
    }
  }
}

/** Departures close to midnight are a frequent source of off-by-one date bugs. */
function detectNightFlights(v: FamilyVacation, addHint: AddHint, t: Translate): void {
  for (const seg of v.travelSegments) {
    const depTime = seg.departureTime || seg.embarkationTime || seg.leavingTime || seg.startTime;
    const night = detectNightFlight(depTime);
    if (night === 'early-morning') {
      addHint(
        seg.id,
        fillTemplate(t('travel.hint.nightFlightEarly'), { time: depTime ?? '' }),
        [seg.id],
        { nightFlight: 'early-morning' }
      );
    } else if (night === 'late-night') {
      addHint(
        seg.id,
        fillTemplate(t('travel.hint.nightFlightLate'), { time: depTime ?? '' }),
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
function detectOutOfRange(v: FamilyVacation, addHint: AddHint, t: Translate): void {
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
      addHint(
        item.id,
        fillTemplate(t('travel.hint.beforeTripStart'), { date: v.startDate }),
        [item.id],
        {
          outOfRange: 'before-start',
        }
      );
    } else if (v.endDate && date > extractDatePart(v.endDate)) {
      addHint(
        item.id,
        fillTemplate(t('travel.hint.afterTripEnd'), { date: v.endDate }),
        [item.id],
        {
          outOfRange: 'after-end',
        }
      );
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
export function computeTimelineHints(v: FamilyVacation, t: Translate): Map<string, TimelineHint> {
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

  detectAccommodationOverlaps(accItems, addHint, t);
  detectAccommodationDuringCruise(accItems, cruiseItems, addHint, t);
  detectFlightDuringCruise(flightItems, cruiseItems, addHint, t);
  detectNightFlights(v, addHint, t);
  detectOutOfRange(v, addHint, t);

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
  /** Optional structured rendering — see BaseCombobox.vue's ComboboxOption.rich. */
  rich?: {
    primary: string;
    secondary?: string;
    badge?: string;
  };
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
    // `label` stays full-form so search by city, airport name, or code all match.
    label: `${a.city} - ${a.name} (${a.code})`,
    // Rich layout: city primary, airport name secondary, IATA code as a
    // right-aligned monospace badge — visually distinctive when scanning a
    // multi-airport city like "London" or "New York".
    rich: {
      primary: a.city,
      secondary: a.name,
      badge: a.code,
    },
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
    // Rich layout: city primary, "port name · country" secondary. No badge
    // for ports — there's no universal short code (cruise ports lack an
    // IATA-equivalent), and country names are too long to fit a chip.
    rich: {
      primary: p.city,
      secondary: `${p.name} · ${p.country}`,
    },
  }));
}

// ── Travel-segment calendar occurrences ────────────────────────────────────
//
// Surface flights, trains, ferries, and cruises on the activities calendar at
// their actual departure / arrival times. Pure derivation — orchestration sits
// in `vacationStore` (see `allTravelSegmentOccurrences` + `safeExtract`).

/** Travel-segment types that have a meaningful departure/arrival pair.
 *  Canonical definition lives in `@/types/models` (avoids a circular import
 *  when model interfaces key on it); imported above + re-exported for consumers. */
export type { SupportedTravelType };

/** A single calendar occurrence — one side of a travel segment. */
export interface TravelSegmentOccurrence {
  vacationId: string;
  segmentIndex: number;
  segmentId: string;
  transportType: SupportedTravelType;
  kind: 'departure' | 'arrival';
  status: VacationSegmentStatus;
  /** YYYY-MM-DD, local-day (same convention as activities). */
  date: string;
  /** HH:mm — undefined → render as untimed/all-day. */
  time?: string;
  title: string;
  /** The segment's travellers. `undefined` = the whole trip — always resolve via
   *  `resolveSegmentTravellers(travellerIds, tripAssigneeIds)`, never read raw. */
  travellerIds?: UUID[];
  /** The trip's assignees, carried so the occurrence is self-contained for that
   *  resolution (the OS reminder scheduler has no vacation in scope). */
  tripAssigneeIds: UUID[];
}

type SideField = {
  kind: 'departure' | 'arrival';
  dateField: keyof VacationTravelSegment;
  timeField?: keyof VacationTravelSegment;
};

const STD_FLIGHT_RAIL_FERRY_SIDES: SideField[] = [
  { kind: 'departure', dateField: 'departureDate', timeField: 'departureTime' },
  { kind: 'arrival', dateField: 'arrivalDate', timeField: 'arrivalTime' },
];

/**
 * Per-type extraction recipe. Adding a new transport type means adding one
 * row here — no branching in extractSegmentOccurrences.
 */
const SIDE_FIELDS: Record<SupportedTravelType, SideField[]> = {
  flight_outbound: STD_FLIGHT_RAIL_FERRY_SIDES,
  flight_return: STD_FLIGHT_RAIL_FERRY_SIDES,
  train: STD_FLIGHT_RAIL_FERRY_SIDES,
  ferry: STD_FLIGHT_RAIL_FERRY_SIDES,
  cruise: [
    { kind: 'departure', dateField: 'embarkationDate', timeField: 'embarkationTime' },
    // Schema has no disembarkationTime — disembark renders as untimed/all-day.
    { kind: 'arrival', dateField: 'disembarkationDate' },
  ],
};

/** True when this travel type has a meaningful departure/arrival to surface on the calendar. */
export function isSupportedTravelType(t: VacationTravelType): t is SupportedTravelType {
  return t in SIDE_FIELDS;
}

/**
 * Pure: derive 0–2 calendar occurrences for one travel segment.
 *
 * - Returns `[]` for unsupported types (`car`, `activity`, `flight_other`).
 * - Skips a side that's missing its date.
 * - Skips a side with a malformed date (logs `[vacation]`, never throws).
 *
 * Unit-testable in isolation — no Pinia, no Vue, no side effects beyond the
 * `console.warn` for malformed dates.
 */
export function extractSegmentOccurrences(
  vacationId: string,
  seg: VacationTravelSegment,
  segmentIndex: number,
  /** The trip's `assigneeIds`. REQUIRED, deliberately not defaulted: a default
   *  of `[]` would let a forgetful caller silently fall back to "everyone is a
   *  traveller", re-opening the whole-family-woken-for-one-flight bug with no
   *  failing test and no telemetry. A compile error is the point. */
  tripAssigneeIds: UUID[]
): TravelSegmentOccurrence[] {
  if (!isSupportedTravelType(seg.type)) return [];
  const out: TravelSegmentOccurrence[] = [];
  for (const side of SIDE_FIELDS[seg.type]) {
    const date = seg[side.dateField] as string | undefined;
    if (!date) continue;
    const d = extractDatePart(date);
    if (!isValidISODate(d)) {
      console.warn(
        `[vacation] segment ${seg.id} has invalid ${side.kind} date "${date}" — skipping that side`
      );
      continue;
    }
    const rawTime = side.timeField ? (seg[side.timeField] as string | undefined) : undefined;
    out.push({
      vacationId,
      segmentIndex,
      segmentId: seg.id,
      transportType: seg.type,
      kind: side.kind,
      status: seg.status,
      date: d,
      time: rawTime || undefined,
      title: seg.title,
      travellerIds: seg.travellerIds,
      tripAssigneeIds,
    });
  }
  return out;
}

const TRANSPORT_EMOJI: Record<SupportedTravelType, string> = {
  flight_outbound: '✈',
  flight_return: '✈',
  train: '🚆',
  ferry: '⛴',
  cruise: '🚢',
};

/**
 * Single-character transport emoji used as a chip prefix on the calendar.
 * Pass `kind` to get a direction-aware variant when one is meaningful:
 * flights map to 🛫 (departure) / 🛬 (arrival) — exact Unicode semantic match.
 * Other transport types return the same emoji regardless of kind; the
 * caller is expected to add a textual "Dep"/"Arr" label for disambiguation.
 */
export function transportEmoji(type: SupportedTravelType, kind?: 'departure' | 'arrival'): string {
  if (kind && (type === 'flight_outbound' || type === 'flight_return')) {
    return kind === 'departure' ? '🛫' : '🛬';
  }
  return TRANSPORT_EMOJI[type] ?? '';
}

/** Bucket items by whether they have a `time`. Used by week/day/DayTimeline rendering. */
export function splitTimedUntimed<T extends { time?: string }>(
  items: T[]
): { timed: T[]; untimed: T[] } {
  const timed: T[] = [];
  const untimed: T[] = [];
  for (const o of items) {
    if (o.time) timed.push(o);
    else untimed.push(o);
  }
  return { timed, untimed };
}

/**
 * Validate that `(vacationId, segmentIndex)` targets a real travel segment.
 * Pure helper used by the planner page's "click segment chip" handler so the
 * no-silent-failure path is unit-testable without mounting the page.
 */
export function validateSegmentTarget(
  vacation: FamilyVacation | undefined,
  vacationId: string,
  segmentIndex: number
): { ok: true } | { ok: false; reason: string } {
  if (!vacation) {
    return { ok: false, reason: `vacation ${vacationId} not found` };
  }
  if (segmentIndex < 0 || segmentIndex >= vacation.travelSegments.length) {
    return {
      ok: false,
      reason: `segment index ${segmentIndex} out of bounds (${vacation.travelSegments.length}) on vacation ${vacationId}`,
    };
  }
  return { ok: true };
}
