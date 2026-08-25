import { computed, type ComputedRef, type Ref } from 'vue';
import {
  formatNookDate,
  formatDateShort,
  formatDateFull,
  extractDatePart,
  formatTime12,
} from '@/utils/date';
import {
  computeAccommodationGaps,
  buildTravelSegmentTitle,
  buildAccommodationTitle,
  buildTransportationTitle,
  buildWhenBand,
  segmentSpan,
  classifySegmentPhase,
  type WhenBand,
  type SegmentPhase,
  type TimingSegment,
} from '@/utils/vacation';
import { isTravellerSubset, resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { useTranslationStore } from '@/stores/translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
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
}

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
    if (seg.airline) {
      const code = seg.airline.match(/\(([A-Z0-9]{2})\)/)?.[1] ?? seg.airline.split(' ')[0];
      p.push(seg.flightNumber ? `${code} ${seg.flightNumber}` : code!);
    }
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

export function travelDetailRows(seg: VacationTravelSegment, t: T): DetailRow[] {
  const rows: DetailRow[] = [];
  const isF = seg.type?.startsWith('flight');
  if (isF) {
    // where → which order (date/time now lead in the hero band, so route + carrier
    // come first in the row list). Date/time rows are still pushed below but the
    // band-consumed filter drops them — the band is their single display home.
    if (seg.departureAirport)
      rows.push({ label: t('segmentRow.from'), value: seg.departureAirport });
    if (seg.arrivalAirport) rows.push({ label: t('segmentRow.to'), value: seg.arrivalAirport });
    if (seg.airline) rows.push({ label: t('segmentRow.airline'), value: seg.airline });
    if (seg.flightNumber)
      rows.push({
        label: t('segmentRow.flightNumber'),
        value: seg.flightNumber,
        field: 'flightNumber',
      });
    if (seg.terminal) rows.push({ label: t('segmentRow.terminal'), value: seg.terminal });
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
        label: seg.arrivesNextDay ? t('segmentRow.arrivesNextDay') : t('segmentRow.arrives'),
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

export function useVacationTimeline(
  vacation: ComputedRef<FamilyVacation | undefined>,
  /** Today's local date (`YYYY-MM-DD`), reactive. Read inside the computed so
   *  segment phase (`past`/`now`/`future`) re-derives on the midnight day-roll. */
  today: Ref<string>
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
      const { detailRows, timing } = withTiming(
        'travel',
        seg,
        travelDetailRows(seg, t),
        !!date,
        today.value
      );
      items.push({
        id: seg.id,
        kind: 'travel',
        icon:
          seg.type === 'activity' && seg.activityCategory
            ? (activityCategoryIcons[seg.activityCategory] ?? '🎭')
            : (travelIcons[seg.type] ?? '✈️'),
        title: seg.type === 'activity' ? seg.title || 'activity' : buildTravelSegmentTitle(seg),
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
