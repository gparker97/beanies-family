import { computed, type ComputedRef, type Ref } from 'vue';
import {
  formatNookDate,
  formatDateShort,
  formatDateFull,
  extractDatePart,
  formatTime12,
} from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import {
  arrivalDayOffset,
  computeAccommodationGaps,
  buildTravelSegmentTitle,
  buildAccommodationTitle,
  buildTransportationTitle,
  airlineLabel,
  airportLabel,
  buildWhenBand,
  flightCodeLabel,
  segmentSpan,
  classifySegmentPhase,
  type WhenBand,
  type SegmentPhase,
  type TimingSegment,
} from '@/utils/vacation';
import { isTravellerSubset, resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { isFlightType } from '@/utils/travelCodes';
import { flightLabel } from '@/utils/flightStatus/occurrenceNotice';
import { confirmsTerminal } from '@/utils/flightStatus/copy';
import { splitLocal } from '@/utils/flightStatus/schedule';
import { useTranslationStore } from '@/stores/translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { FlightLiveInfo, FlightVerification } from '@/types/flightStatus';
import type {
  FamilyVacation,
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
} from '@/types/models';

/** Translator threaded into the detail-row builders so labels + enum values
 *  localize (they render in the read-only timeline, not just the edit modal). */
type T = (key: UIStringKey) => string;

// ── Shared types ────────────────────────────────────────────────────────────

export interface DetailRow {
  label: string;
  value: string;
  /** Formatted value for display (falls back to value if not set) */
  displayValue?: string;
  /** Model field name for inline editing (omit for read-only display) */
  field?: string;
  /** Input type for inline editing (default: 'text') */
  inputType?: 'text' | 'date' | 'time';
  /** Show copy-to-clipboard badge (booking ref only) */
  copyable?: boolean;
  /** Show map link icon */
  mapLink?: boolean;
  /** Render as a clickable external link */
  isLink?: boolean;
  /** A value this device's check reads (gate, belt, estimate), or a plan value it confirms
   *  (the flight terminal); never editable, so it carries a small "live" pill and no editor
   *  (#143). */
  live?: boolean;
}

/** What the live-check surfaces (chip, change notice, rail) need from a FLIGHT segment (#143).
 *  `label` is the flight as the family would say it ("SQ318"). */
export type FlightRef = Pick<
  VacationTravelSegment,
  | 'airline'
  | 'flightNumber'
  | 'bookingReference'
  | 'departureDate'
  | 'liveAppliedAt'
  | 'liveCancelledAt'
> & { label: string };

/**
 * The time of day a booking happens, for same-day ordering.
 *
 * Without it the comparator sorted on the date part alone and Array.sort is stable, so
 * same-day items kept the order their arrays were pushed in — travel, then accommodation,
 * then transportation. A day with a 04:30 airport shuttle, a 07:15 flight and a 15:00 hotel
 * check-in rendered flight → check-in → shuttle: the car taking the family to the airport
 * listed below the hotel they reach eleven hours later.
 *
 * Best-effort across the three shapes; anything with no time sorts last within its day,
 * which is the honest place for "sometime that day".
 */
function timeOfDay(seg: Record<string, unknown>): string {
  for (const key of [
    'departureTime',
    'embarkationTime',
    'leavingTime',
    'startTime',
    'pickupTime',
    'checkInTime',
  ]) {
    const v = seg[key];
    if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) return v.padStart(5, '0');
  }
  return '';
}

export interface TimelineItem {
  id: string;
  kind: 'travel' | 'accommodation' | 'transportation';
  /** The model's own `type` within `kind` ("flight_outbound", "train", "hotel", "bus"). */
  segmentType: string;
  /** Set for flight segments only: what the live flight checks render from (#143). */
  flight?: FlightRef;
  icon: string;
  title: string;
  keyValue: string;
  status: 'booked' | 'pending';
  sortDate: string;
  /**
   * Time of day within `sortDate`, `HH:MM`, for ordering items on the SAME day.
   * '' when the booking carries no time — those sort last, after everything scheduled.
   */
  sortTime: string;
  /** Wizard step number for this kind: 2=travel, 3=accommodation, 4=transportation */
  stepNumber: number;
  detailRows: DetailRow[];
  /** Original index in the vacation's array (for targeted updates) */
  arrayIndex: number;
  /** Attached booking-document ids (images/PDFs) — for the timeline indicator + strip. */
  photoIds?: string[];
  /** Resolved member ids on this segment (the explicit list, or the whole trip). Always listed when expanded. */
  travellers: string[];
  /** True only when `travellers` is a strict subset of the trip — gates the collapsed avatar row. */
  showTravellers: boolean;
  /**
   * When-band + past/now/future phase for the expanded card. Present ONLY for
   * dated items — undated ("still deciding") items omit it entirely, so they can
   * never be tinted "past" or marked "staying now". Grouped so the invariant is
   * structural: no half-populated state.
   */
  timing?: {
    /** the departs→arrives (or single "starts") hero band shown atop the card */
    band: WhenBand;
    phase: SegmentPhase;
    /** an ongoing multi-day span (today inside a stay with a distinct end) */
    isOngoingSpan: boolean;
  };
}

export interface DateGroup {
  date: string;
  label: string;
  items: TimelineItem[];
}

// ── Icon maps ───────────────────────────────────────────────────────────────

export const travelIcons: Record<string, string> = {
  flight_outbound: '🛫',
  flight_return: '🛬',
  flight_other: '✈️',
  cruise: '🚢',
  train: '🚅',
  ferry: '⛴️',
  car: '🚗',
  activity: '🎭',
};

export const activityCategoryIcons: Record<string, string> = {
  show_musical: '🎭',
  theme_park: '🎢',
  sporting_event: '🏟️',
  concert: '🎵',
  excursion: '🚤',
  other: '✨',
};

export const accomIcons: Record<string, string> = {
  hotel: '🏨',
  airbnb: '🏠',
  campground: '⛺',
  family_friends: '👪',
};

export const transportIcons: Record<string, string> = {
  airport_shuttle: '🚐',
  rental_car: '🚗',
  taxi_rideshare: '🚕',
  bus: '🚌',
};

// ── Key-value summary builders ──────────────────────────────────────────────

export function buildTravelKeyValue(seg: {
  type?: string;
  airline?: string;
  flightNumber?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  departureDate?: string;
  departureTime?: string;
  terminal?: string;
  cruiseLine?: string;
  shipName?: string;
  embarkationDate?: string;
  disembarkationDate?: string;
  operator?: string;
  route?: string;
  startTime?: string;
  location?: string;
  description?: string;
}): string {
  const p: string[] = [];
  const t12 = (v: string) => formatTime12(v);
  const isF = seg.type?.startsWith('flight');
  // Departure date + time only (arrival time intentionally omitted — summary space is at a
  // premium). Shared by flights and train/ferry.
  const pushDeparture = (): void => {
    if (seg.departureDate) {
      const datePart = formatDateShort(seg.departureDate).toLowerCase();
      p.push(seg.departureTime ? `${datePart} · ${t12(seg.departureTime)}` : datePart);
    } else if (seg.departureTime) {
      p.push(t12(seg.departureTime));
    }
  };
  if (isF) {
    // NOT gated on `seg.airline`: a flight number with no airline used to vanish from the row.
    const carrierLabel = flightCodeLabel(seg.airline, seg.flightNumber);
    if (carrierLabel) p.push(carrierLabel);
    pushDeparture();
    if (seg.terminal) p.push(seg.terminal);
  } else if (seg.type === 'cruise') {
    if (seg.shipName) p.push(seg.shipName);
    if (seg.embarkationDate && seg.disembarkationDate) {
      p.push(
        `${formatDateShort(seg.embarkationDate).toLowerCase()} – ${formatDateShort(seg.disembarkationDate).toLowerCase()}`
      );
    } else if (seg.embarkationDate) {
      p.push(formatDateShort(seg.embarkationDate).toLowerCase());
    }
    if (seg.terminal) p.push(seg.terminal);
  } else if (seg.type === 'activity') {
    if (seg.location) p.push(seg.location);
    if (seg.startTime) p.push(t12(seg.startTime));
    if (seg.description) p.push(seg.description.slice(0, 40));
  } else {
    // Train / Ferry
    if (seg.operator) p.push(seg.operator);
    if (seg.route) p.push(seg.route);
    pushDeparture();
  }
  return p.join(' · ');
}

/**
 * Build detail rows for a travel segment.
 * Inline editing only for: dates, times, flight #, cabin #, car label, description, duration, notes.
 * Dropdown/selection fields (airline, airports, cruise line/ship/port, car type): read-only.
 * Location/address fields: mapLink (opens maps). Link fields: isLink (clickable URL).
 */
/** Add formatted displayValue to date/time rows */
function enrichRows(rows: DetailRow[]): DetailRow[] {
  for (const row of rows) {
    if (row.inputType === 'date' && row.value) {
      row.displayValue = formatDateFull(row.value);
    } else if (row.inputType === 'time' && row.value) {
      row.displayValue = formatTime12(row.value);
    }
  }
  return rows;
}

/**
 * "Arrives", "Arrives (+1)" or "Arrives (+2)" — derived from the DATES.
 *
 * `+2` is a real itinerary, not an edge case: a westbound date-line crossing
 * leaves one evening and lands two calendar days later. This read the
 * `arrivesNextDay` boolean, so such a flight showed the right arrival date beside
 * the label "(+1)".
 */
function arrivalOffsetLabel(seg: VacationTravelSegment, t: T): string {
  const n = arrivalDayOffset(seg);
  if (n === 0) return t('segmentRow.arrives');
  return fillTemplate(t('segmentRow.arrivesPlusDays'), { n: String(n) });
}

/**
 * "5:20pm" (or "5:20pm · 14 Dec" when the estimate lands on another day) for a live estimate,
 * or null when there is none or it says exactly what the plan says (a duplicate of the band).
 */
function estimateValue(
  local: string | undefined,
  plannedDate: string | undefined,
  plannedTime: string | undefined
): string | null {
  const est = splitLocal(local);
  if (!est) return null;
  const sameDay = !plannedDate || extractDatePart(plannedDate) === est.date;
  if (sameDay && plannedTime?.padStart(5, '0') === est.time) return null;
  return sameDay
    ? formatTime12(est.time)
    : `${formatTime12(est.time)} · ${formatDateShort(est.date)}`;
}

/** Read-only rows from this device's live check: gate, check-in desk, estimates, belt. */
function liveRows(seg: VacationTravelSegment, live: FlightLiveInfo, t: T): DetailRow[] {
  const rows: DetailRow[] = [];
  const arrivalDate = seg.arrivalDate || seg.departureDate;
  const estDeparts = estimateValue(live.estimatedDeparture, seg.departureDate, seg.departureTime);
  const estArrives = estimateValue(live.estimatedArrival, arrivalDate, seg.arrivalTime);
  if (live.gate) rows.push({ label: t('travel.live.row.gate'), value: live.gate, live: true });
  if (live.desk) rows.push({ label: t('travel.live.row.desk'), value: live.desk, live: true });
  if (estDeparts) {
    rows.push({ label: t('travel.live.row.estDeparts'), value: estDeparts, live: true });
  }
  if (estArrives) {
    rows.push({ label: t('travel.live.row.estArrives'), value: estArrives, live: true });
  }
  if (live.belt) rows.push({ label: t('travel.live.row.belt'), value: live.belt, live: true });
  return rows;
}

/**
 * Detail rows for a travel segment. `v` is this device's flight verification: its `live` rows
 * (gate, desk, estimates, belt) follow the terminal and are never editable, and the flight
 * terminal row itself carries the live pill when the airline's latest answer matches it (`confirmsTerminal`).
 */
export function travelDetailRows(
  seg: VacationTravelSegment,
  t: T,
  v?: FlightVerification
): DetailRow[] {
  const rows: DetailRow[] = [];
  const isF = seg.type?.startsWith('flight');
  if (isF) {
    // where → which order (date/time now lead in the hero band, so route + carrier
    // come first in the row list). Date/time rows are still pushed below but the
    // band-consumed filter drops them — the band is their single display home.
    // Expanded for READING only — a bare "SIN" becomes "Singapore (SIN)", the same shape the
    // dropdown shows. Anything that already carries text stays exactly as stored.
    if (seg.departureAirport)
      rows.push({ label: t('segmentRow.from'), value: airportLabel(seg.departureAirport) });
    if (seg.arrivalAirport)
      rows.push({ label: t('segmentRow.to'), value: airportLabel(seg.arrivalAirport) });
    if (seg.airline)
      rows.push({ label: t('segmentRow.airline'), value: airlineLabel(seg.airline) });
    if (seg.flightNumber)
      rows.push({
        label: t('segmentRow.flightNumber'),
        value: seg.flightNumber,
        field: 'flightNumber',
      });
    if (seg.terminal) {
      rows.push({
        label: t('segmentRow.terminal'),
        value: seg.terminal,
        ...(confirmsTerminal(v, seg.terminal) ? { live: true } : {}),
      });
    }
    if (v?.live) rows.push(...liveRows(seg, v.live, t));
    if (seg.departureDate)
      rows.push({
        label: t('segmentRow.date'),
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.departureTime)
      rows.push({
        label: t('segmentRow.departs'),
        value: seg.departureTime,
        field: 'departureTime',
        inputType: 'time',
      });
    if (seg.arrivalTime)
      rows.push({
        // Derived from the DATES, not the `arrivesNextDay` shadow — a flight saved
        // as +2 rendered "Arrives (+1)" here while showing the right date.
        label: arrivalOffsetLabel(seg, t),
        value: seg.arrivalTime,
        field: 'arrivalTime',
        inputType: 'time',
      });
  } else if (seg.type === 'cruise') {
    if (seg.cruiseLine) rows.push({ label: t('segmentRow.cruiseLine'), value: seg.cruiseLine });
    if (seg.shipName) rows.push({ label: t('segmentRow.ship'), value: seg.shipName });
    if (seg.departurePort) rows.push({ label: t('segmentRow.port'), value: seg.departurePort });
    if (seg.terminal) rows.push({ label: t('segmentRow.terminal'), value: seg.terminal });
    if (seg.cabinNumber)
      rows.push({ label: t('segmentRow.cabin'), value: seg.cabinNumber, field: 'cabinNumber' });
    if (seg.embarkationDate)
      rows.push({
        label: t('segmentRow.embark'),
        value: seg.embarkationDate,
        field: 'embarkationDate',
        inputType: 'date',
      });
    if (seg.embarkationTime)
      rows.push({
        label: t('segmentRow.departTime'),
        value: seg.embarkationTime,
        field: 'embarkationTime',
        inputType: 'time',
      });
    if (seg.disembarkationDate)
      rows.push({
        label: t('segmentRow.disembark'),
        value: seg.disembarkationDate,
        field: 'disembarkationDate',
        inputType: 'date',
      });
  } else if (seg.type === 'car') {
    if (seg.carType)
      rows.push({
        label: t('segmentRow.carType'),
        value: t(('vacation.carType.' + seg.carType) as UIStringKey),
      });
    if (seg.carLabel)
      rows.push({ label: t('segmentRow.car'), value: seg.carLabel, field: 'carLabel' });
    if (seg.departureDate)
      rows.push({
        label: t('segmentRow.date'),
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.leavingTime)
      rows.push({
        label: t('segmentRow.leaving'),
        value: seg.leavingTime,
        field: 'leavingTime',
        inputType: 'time',
      });
  } else if (seg.type === 'activity') {
    if (seg.activityCategory)
      rows.push({
        label: t('segmentRow.type'),
        value: t(('vacation.activityCategory.' + seg.activityCategory) as UIStringKey),
      });
    if (seg.description)
      rows.push({ label: t('segmentRow.details'), value: seg.description, field: 'description' });
    if (seg.departureDate)
      rows.push({
        label: t('segmentRow.date'),
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.startTime)
      rows.push({
        label: t('segmentRow.time'),
        value: seg.startTime,
        field: 'startTime',
        inputType: 'time',
      });
    if (seg.duration)
      rows.push({ label: t('segmentRow.duration'), value: seg.duration, field: 'duration' });
    if (seg.location)
      rows.push({ label: t('segmentRow.location'), value: seg.location, mapLink: true });
  } else {
    // Train / Ferry
    if (seg.operator) rows.push({ label: t('segmentRow.operator'), value: seg.operator });
    if (seg.route) rows.push({ label: t('segmentRow.route'), value: seg.route });
    if (seg.departureStation)
      rows.push({ label: t('segmentRow.from'), value: seg.departureStation });
    if (seg.arrivalStation) rows.push({ label: t('segmentRow.to'), value: seg.arrivalStation });
    if (seg.departureDate)
      rows.push({
        label: t('segmentRow.date'),
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.departureTime)
      rows.push({
        label: t('segmentRow.departs'),
        value: seg.departureTime,
        field: 'departureTime',
        inputType: 'time',
      });
    if (seg.arrivalTime)
      rows.push({
        label: t('segmentRow.arrives'),
        value: seg.arrivalTime,
        field: 'arrivalTime',
        inputType: 'time',
      });
  }
  if (seg.bookingReference)
    rows.push({ label: t('segmentRow.bookingRef'), value: seg.bookingReference, copyable: true });
  if (seg.link) rows.push({ label: t('segmentRow.link'), value: seg.link, isLink: true });
  if (seg.notes) rows.push({ label: t('segmentRow.notes'), value: seg.notes, field: 'notes' });
  return enrichRows(rows);
}

/** Detail rows for an accommodation. Check-in/out rows are pushed here but the
 *  when-band promotes (and the `withTiming` filter then drops) them. */
export function accommodationDetailRows(acc: VacationAccommodation, t: T): DetailRow[] {
  const rows: DetailRow[] = [];
  if (acc.address) rows.push({ label: t('segmentRow.address'), value: acc.address, mapLink: true });
  if (acc.checkInDate)
    rows.push({
      label: t('segmentRow.checkIn'),
      value: acc.checkInDate,
      field: 'checkInDate',
      inputType: 'date',
    });
  if (acc.checkOutDate)
    rows.push({
      label: t('segmentRow.checkOut'),
      value: acc.checkOutDate,
      field: 'checkOutDate',
      inputType: 'date',
    });
  if (acc.roomType) rows.push({ label: t('segmentRow.room'), value: acc.roomType });
  if (acc.confirmationNumber)
    rows.push({
      label: t('segmentRow.confirmation'),
      value: acc.confirmationNumber,
      copyable: true,
    });
  if (acc.contactPhone)
    rows.push({ label: t('segmentRow.phone'), value: acc.contactPhone, field: 'contactPhone' });
  if (acc.breakfastIncluded)
    rows.push({ label: t('segmentRow.breakfast'), value: t('segmentRow.included') });
  if (acc.link) rows.push({ label: t('segmentRow.link'), value: acc.link, isLink: true });
  if (acc.notes) rows.push({ label: t('segmentRow.notes'), value: acc.notes, field: 'notes' });
  return enrichRows(rows);
}

/** Detail rows for a transportation segment. Pick-up (and rental return) date/
 *  time rows are pushed here; `withTiming` drops exactly the ones the band shows,
 *  so a non-rental `returnDate` survives as a row. */
export function transportationDetailRows(trans: VacationTransportation, t: T): DetailRow[] {
  const rows: DetailRow[] = [];
  if (trans.agencyAddress)
    rows.push({ label: t('segmentRow.address'), value: trans.agencyAddress, mapLink: true });
  if (trans.operator) rows.push({ label: t('segmentRow.operator'), value: trans.operator });
  if (trans.route) rows.push({ label: t('segmentRow.route'), value: trans.route });
  if (trans.departureStation)
    rows.push({ label: t('segmentRow.from'), value: trans.departureStation });
  if (trans.arrivalStation) rows.push({ label: t('segmentRow.to'), value: trans.arrivalStation });
  if (trans.pickupDate)
    rows.push({
      label: t('segmentRow.pickupDate'),
      value: trans.pickupDate,
      field: 'pickupDate',
      inputType: 'date',
    });
  if (trans.pickupTime)
    rows.push({
      label: t('segmentRow.pickupTime'),
      value: trans.pickupTime,
      field: 'pickupTime',
      inputType: 'time',
    });
  if (trans.returnDate)
    rows.push({
      label: t('segmentRow.returnDate'),
      value: trans.returnDate,
      field: 'returnDate',
      inputType: 'date',
    });
  if (trans.returnTime)
    rows.push({
      label: t('segmentRow.returnTime'),
      value: trans.returnTime,
      field: 'returnTime',
      inputType: 'time',
    });
  if (trans.departureDate && !trans.pickupDate)
    rows.push({
      label: t('segmentRow.date'),
      value: trans.departureDate,
      field: 'departureDate',
      inputType: 'date',
    });
  if (trans.departureTime && !trans.pickupTime)
    rows.push({
      label: t('segmentRow.departs'),
      value: trans.departureTime,
      field: 'departureTime',
      inputType: 'time',
    });
  if (trans.bookingReference)
    rows.push({ label: t('segmentRow.bookingRef'), value: trans.bookingReference, copyable: true });
  if (trans.link) rows.push({ label: t('segmentRow.link'), value: trans.link, isLink: true });
  if (trans.notes) rows.push({ label: t('segmentRow.notes'), value: trans.notes, field: 'notes' });
  return enrichRows(rows);
}

/**
 * Attach the when-band + phase to a dated segment and drop the rows the band now
 * displays (drop set = exactly the fields the band reported consuming, so nothing
 * is orphaned or duplicated). Undated items (no date) get no band/phase and keep
 * every row. `today` is passed in so the caller controls reactivity.
 */
function withTiming(
  kind: 'travel' | 'accommodation' | 'transportation',
  seg: TimingSegment,
  rows: DetailRow[],
  dated: boolean,
  today: string
): { detailRows: DetailRow[]; timing?: TimelineItem['timing'] } {
  if (!dated) return { detailRows: rows };
  const built = buildWhenBand(kind, seg);
  if (!built) return { detailRows: rows };
  const consumed = new Set(built.consumed);
  const detailRows = rows.filter((r) => !r.field || !consumed.has(r.field));
  const span = segmentSpan(kind, seg);
  const phase = classifySegmentPhase(span, today);
  const isOngoingSpan = phase === 'now' && !!span.end && span.end !== span.start;
  return { detailRows, timing: { band: built.band, phase, isOngoingSpan } };
}

// ── Composable ──────────────────────────────────────────────────────────────

export interface VacationTimelineOptions {
  /**
   * Live flight checks (#143): the page passes `flightStatusStore.verificationFor` so flight
   * rows gain the display-only live details. Injected rather than read here, so the rows stay
   * a pure function of what the caller hands in (the wall passes nothing and shows none).
   */
  verificationFor?: (segmentId: string) => FlightVerification | undefined;
}

export function useVacationTimeline(
  vacation: ComputedRef<FamilyVacation | undefined>,
  /** Today's local date (`YYYY-MM-DD`), reactive. Read inside the computed so
   *  segment phase (`past`/`now`/`future`) re-derives on the midnight day-roll. */
  today: Ref<string>,
  options: VacationTimelineOptions = {}
) {
  // Reading `t` inside the computeds below makes them re-evaluate on a language
  // switch, so the read-only timeline localizes live.
  const { t } = useTranslationStore();

  const accommodationGaps = computed(() => {
    const v = vacation.value;
    if (!v) return [];
    return computeAccommodationGaps(v);
  });

  const timelineItems = computed<TimelineItem[]>(() => {
    const v = vacation.value;
    if (!v) return [];
    const items: TimelineItem[] = [];

    // Resolve a segment's travellers against the trip default + flag a strict subset.
    // Shared across all three kinds so the rule lives in exactly one expression.
    const travellersFor = (ids: string[] | undefined) => ({
      travellers: resolveSegmentTravellers(ids, v.assigneeIds),
      showTravellers: isTravellerSubset(ids, v.assigneeIds),
    });

    for (let i = 0; i < v.travelSegments.length; i++) {
      const seg = v.travelSegments[i]!;
      const date = seg.sortDate || seg.departureDate || seg.embarkationDate || '';
      const isFlight = isFlightType(seg.type);
      const verification = isFlight ? options.verificationFor?.(seg.id) : undefined;
      const { detailRows, timing } = withTiming(
        'travel',
        seg,
        travelDetailRows(seg, t, verification),
        !!date,
        today.value
      );
      const title =
        seg.type === 'activity' ? seg.title || 'activity' : buildTravelSegmentTitle(seg);
      items.push({
        id: seg.id,
        kind: 'travel',
        segmentType: seg.type,
        ...(isFlight
          ? {
              flight: {
                label: flightLabel({ airline: seg.airline, flightNumber: seg.flightNumber, title }),
                airline: seg.airline,
                flightNumber: seg.flightNumber,
                bookingReference: seg.bookingReference,
                departureDate: seg.departureDate,
                liveAppliedAt: seg.liveAppliedAt,
                liveCancelledAt: seg.liveCancelledAt,
              },
            }
          : {}),
        icon:
          seg.type === 'activity' && seg.activityCategory
            ? (activityCategoryIcons[seg.activityCategory] ?? '🎭')
            : (travelIcons[seg.type] ?? '✈️'),
        title,
        keyValue: buildTravelKeyValue(seg),
        status: seg.status,
        sortDate: date ? extractDatePart(date) : '9999-12-31',
        sortTime: timeOfDay(seg as unknown as Record<string, unknown>),
        stepNumber: 2,
        detailRows,
        timing,
        arrayIndex: i,
        photoIds: seg.photoIds,
        ...travellersFor(seg.travellerIds),
      });
    }

    for (let i = 0; i < v.accommodations.length; i++) {
      const acc = v.accommodations[i]!;
      const date = acc.checkInDate || '';
      const { detailRows, timing } = withTiming(
        'accommodation',
        acc,
        accommodationDetailRows(acc, t),
        !!date,
        today.value
      );

      const kvParts: string[] = [];
      if (acc.checkInDate && acc.checkOutDate)
        kvParts.push(
          `${formatDateShort(acc.checkInDate).toLowerCase()} – ${formatDateShort(acc.checkOutDate).toLowerCase()}`
        );
      if (acc.confirmationNumber) kvParts.push(acc.confirmationNumber);

      items.push({
        id: acc.id,
        kind: 'accommodation',
        segmentType: acc.type,
        icon: accomIcons[acc.type] ?? '🏨',
        title: buildAccommodationTitle(acc),
        keyValue: kvParts.join(' · '),
        status: acc.status,
        sortDate: date ? extractDatePart(date) : '9999-12-31',
        sortTime: timeOfDay(acc as unknown as Record<string, unknown>),
        stepNumber: 3,
        detailRows,
        timing,
        arrayIndex: i,
        photoIds: acc.photoIds,
        ...travellersFor(acc.travellerIds),
      });
    }

    for (let i = 0; i < v.transportation.length; i++) {
      const trans = v.transportation[i]!;
      const date = trans.pickupDate || trans.departureDate || '';
      const { detailRows, timing } = withTiming(
        'transportation',
        trans,
        transportationDetailRows(trans, t),
        !!date,
        today.value
      );

      const kvParts: string[] = [];
      if (trans.route) kvParts.push(trans.route);
      if (trans.type === 'rental_car') {
        if (trans.pickupDate && trans.returnDate) {
          kvParts.push(
            `${formatDateShort(trans.pickupDate).toLowerCase()} – ${formatDateShort(trans.returnDate).toLowerCase()}`
          );
        } else if (trans.pickupDate) {
          kvParts.push(formatDateShort(trans.pickupDate).toLowerCase());
        }
      } else if (trans.type === 'bus') {
        if (trans.departureDate) {
          const datePart = formatDateShort(trans.departureDate).toLowerCase();
          kvParts.push(trans.departureTime ? `${datePart} · ${trans.departureTime}` : datePart);
        } else if (trans.departureTime) {
          kvParts.push(trans.departureTime);
        }
      } else {
        if (trans.pickupDate) {
          const datePart = formatDateShort(trans.pickupDate).toLowerCase();
          kvParts.push(trans.pickupTime ? `${datePart} · ${trans.pickupTime}` : datePart);
        } else if (trans.pickupTime) {
          kvParts.push(trans.pickupTime);
        }
      }
      if (trans.bookingReference) kvParts.push(trans.bookingReference);

      items.push({
        id: trans.id,
        kind: 'transportation',
        segmentType: trans.type,
        icon: transportIcons[trans.type] ?? '🚐',
        title: buildTransportationTitle(trans),
        keyValue: kvParts.join(' · '),
        status: trans.status,
        sortDate: date ? extractDatePart(date) : '9999-12-31',
        sortTime: timeOfDay(trans as unknown as Record<string, unknown>),
        stepNumber: 4,
        detailRows,
        timing,
        arrayIndex: i,
        photoIds: trans.photoIds,
        ...travellersFor(trans.travellerIds),
      });
    }

    items.sort((a, b) => {
      const byDate = a.sortDate.localeCompare(b.sortDate);
      if (byDate !== 0) return byDate;
      // Same day: order by clock time, untimed last. Without this tiebreak the order was
      // whichever array the item came from, which is not chronology.
      if (a.sortTime === b.sortTime) return 0;
      if (!a.sortTime) return 1;
      if (!b.sortTime) return -1;
      return a.sortTime.localeCompare(b.sortTime);
    });
    return items;
  });

  /** Items with no date set — shown in a separate "no date" section */
  const undatedItems = computed(() =>
    timelineItems.value.filter((i) => i.sortDate === '9999-12-31')
  );

  const groupedByDate = computed<DateGroup[]>(() => {
    const groups: DateGroup[] = [];
    for (const item of timelineItems.value.filter((i) => i.sortDate !== '9999-12-31')) {
      const existing = groups.find((g) => g.date === item.sortDate);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.push({
          date: item.sortDate,
          label: item.sortDate !== '9999-12-31' ? formatNookDate(item.sortDate) : '',
          items: [item],
        });
      }
    }
    return groups;
  });

  return { timelineItems, groupedByDate, accommodationGaps, undatedItems };
}
