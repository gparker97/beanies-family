import { computed, type ComputedRef } from 'vue';
import { formatNookDate, formatDateShort, extractDatePart } from '@/utils/date';
import { computeAccommodationGaps } from '@/utils/vacation';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';

// ── Shared types ────────────────────────────────────────────────────────────

export interface DetailRow {
  label: string;
  value: string;
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

export interface TimelineItem {
  id: string;
  kind: 'travel' | 'accommodation' | 'transportation';
  icon: string;
  title: string;
  keyValue: string;
  status: 'booked' | 'pending';
  sortDate: string;
  /** Wizard step number for this kind: 2=travel, 3=accommodation, 4=transportation */
  stepNumber: number;
  detailRows: DetailRow[];
  /** Original index in the vacation's array (for targeted updates) */
  arrayIndex: number;
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
  train: '🚅',
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
  const isF = seg.type?.startsWith('flight');
  if (isF) {
    if (seg.airline) {
      const code = seg.airline.match(/\(([A-Z0-9]{2})\)/)?.[1] ?? seg.airline.split(' ')[0];
      p.push(seg.flightNumber ? `${code} ${seg.flightNumber}` : code!);
    }
    if (seg.departureAirport && seg.arrivalAirport) {
      const from = seg.departureAirport.match(/\(([A-Z]{3})\)/)?.[1] ?? seg.departureAirport;
      const to = seg.arrivalAirport.match(/\(([A-Z]{3})\)/)?.[1] ?? seg.arrivalAirport;
      p.push(`${from}→${to}`);
    }
    if (seg.departureDate) {
      const datePart = formatDateShort(seg.departureDate).toLowerCase();
      p.push(seg.departureTime ? `${datePart} · ${seg.departureTime}` : datePart);
    } else if (seg.departureTime) {
      p.push(seg.departureTime);
    }
  } else if (seg.type === 'cruise') {
    if (seg.cruiseLine) p.push(seg.cruiseLine);
    if (seg.shipName) p.push(seg.shipName);
    if (seg.embarkationDate && seg.disembarkationDate) {
      p.push(
        `${formatDateShort(seg.embarkationDate).toLowerCase()} – ${formatDateShort(seg.disembarkationDate).toLowerCase()}`
      );
    } else if (seg.embarkationDate) {
      p.push(formatDateShort(seg.embarkationDate).toLowerCase());
    }
  } else if (seg.type === 'activity') {
    if (seg.location) p.push(seg.location);
    if (seg.startTime) p.push(seg.startTime);
    if (seg.description) p.push(seg.description.slice(0, 40));
  } else {
    // Train / Ferry
    if (seg.operator) p.push(seg.operator);
    if (seg.route) p.push(seg.route);
    if (seg.departureDate) {
      const datePart = formatDateShort(seg.departureDate).toLowerCase();
      p.push(seg.departureTime ? `${datePart} · ${seg.departureTime}` : datePart);
    } else if (seg.departureTime) {
      p.push(seg.departureTime);
    }
  }
  return p.join(' · ');
}

/** Build detail rows for a travel segment — each field gets its own editable row */
export function travelDetailRows(seg: VacationTravelSegment): DetailRow[] {
  const rows: DetailRow[] = [];
  const isF = seg.type?.startsWith('flight');
  if (isF) {
    if (seg.airline) rows.push({ label: 'airline', value: seg.airline, field: 'airline' });
    if (seg.flightNumber)
      rows.push({ label: 'flight #', value: seg.flightNumber, field: 'flightNumber' });
    if (seg.departureAirport)
      rows.push({ label: 'from', value: seg.departureAirport, field: 'departureAirport' });
    if (seg.arrivalAirport)
      rows.push({ label: 'to', value: seg.arrivalAirport, field: 'arrivalAirport' });
    if (seg.departureDate)
      rows.push({
        label: 'date',
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.departureTime)
      rows.push({
        label: 'departs',
        value: seg.departureTime,
        field: 'departureTime',
        inputType: 'time',
      });
    if (seg.arrivalTime)
      rows.push({
        label: 'arrives',
        value: seg.arrivalTime,
        field: 'arrivalTime',
        inputType: 'time',
      });
  } else if (seg.type === 'cruise') {
    if (seg.cruiseLine)
      rows.push({ label: 'cruise line', value: seg.cruiseLine, field: 'cruiseLine' });
    if (seg.shipName) rows.push({ label: 'ship', value: seg.shipName, field: 'shipName' });
    if (seg.departurePort)
      rows.push({ label: 'port', value: seg.departurePort, field: 'departurePort' });
    if (seg.cabinNumber)
      rows.push({ label: 'cabin', value: seg.cabinNumber, field: 'cabinNumber' });
    if (seg.embarkationDate)
      rows.push({
        label: 'embark',
        value: seg.embarkationDate,
        field: 'embarkationDate',
        inputType: 'date',
      });
    if (seg.embarkationTime)
      rows.push({
        label: 'depart time',
        value: seg.embarkationTime,
        field: 'embarkationTime',
        inputType: 'time',
      });
    if (seg.disembarkationDate)
      rows.push({
        label: 'disembark',
        value: seg.disembarkationDate,
        field: 'disembarkationDate',
        inputType: 'date',
      });
  } else if (seg.type === 'car') {
    if (seg.carType) rows.push({ label: 'car type', value: seg.carType, field: 'carType' });
    if (seg.carLabel) rows.push({ label: 'car', value: seg.carLabel, field: 'carLabel' });
    if (seg.departureDate)
      rows.push({
        label: 'date',
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.leavingTime)
      rows.push({
        label: 'leaving',
        value: seg.leavingTime,
        field: 'leavingTime',
        inputType: 'time',
      });
  } else if (seg.type === 'activity') {
    if (seg.activityCategory)
      rows.push({ label: 'type', value: seg.activityCategory.replace(/_/g, ' ') });
    if (seg.description)
      rows.push({ label: 'details', value: seg.description, field: 'description' });
    if (seg.departureDate)
      rows.push({
        label: 'date',
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.startTime)
      rows.push({ label: 'time', value: seg.startTime, field: 'startTime', inputType: 'time' });
    if (seg.duration) rows.push({ label: 'duration', value: seg.duration, field: 'duration' });
    if (seg.location) rows.push({ label: 'location', value: seg.location, mapLink: true });
    if (seg.link) rows.push({ label: 'link', value: seg.link, isLink: true });
  } else {
    // Train / Ferry
    if (seg.operator) rows.push({ label: 'operator', value: seg.operator, field: 'operator' });
    if (seg.route) rows.push({ label: 'route', value: seg.route, field: 'route' });
    if (seg.departureStation)
      rows.push({ label: 'from', value: seg.departureStation, field: 'departureStation' });
    if (seg.arrivalStation)
      rows.push({ label: 'to', value: seg.arrivalStation, field: 'arrivalStation' });
    if (seg.departureDate)
      rows.push({
        label: 'date',
        value: seg.departureDate,
        field: 'departureDate',
        inputType: 'date',
      });
    if (seg.departureTime)
      rows.push({
        label: 'departs',
        value: seg.departureTime,
        field: 'departureTime',
        inputType: 'time',
      });
  }
  if (seg.bookingReference)
    rows.push({ label: 'booking ref', value: seg.bookingReference, copyable: true });
  if (seg.notes) rows.push({ label: 'notes', value: seg.notes, field: 'notes' });
  return rows;
}

// ── Composable ──────────────────────────────────────────────────────────────

export function useVacationTimeline(vacation: ComputedRef<FamilyVacation | undefined>) {
  const accommodationGaps = computed(() => {
    const v = vacation.value;
    if (!v) return [];
    return computeAccommodationGaps(v);
  });

  const timelineItems = computed<TimelineItem[]>(() => {
    const v = vacation.value;
    if (!v) return [];
    const items: TimelineItem[] = [];

    for (let i = 0; i < v.travelSegments.length; i++) {
      const seg = v.travelSegments[i]!;
      const date = seg.sortDate ?? seg.departureDate ?? seg.embarkationDate ?? '';
      items.push({
        id: seg.id,
        kind: 'travel',
        icon:
          seg.type === 'activity' && seg.activityCategory
            ? (activityCategoryIcons[seg.activityCategory] ?? '🎭')
            : (travelIcons[seg.type] ?? '✈️'),
        title: seg.title,
        keyValue: buildTravelKeyValue(seg),
        status: seg.status,
        sortDate: date ? extractDatePart(date) : '9999-12-31',
        stepNumber: 2,
        detailRows: travelDetailRows(seg),
        arrayIndex: i,
      });
    }

    for (let i = 0; i < v.accommodations.length; i++) {
      const acc = v.accommodations[i]!;
      const date = acc.checkInDate ?? '';
      const rows: DetailRow[] = [];
      if (acc.name) rows.push({ label: 'name', value: acc.name, field: 'name' });
      if (acc.address)
        rows.push({ label: 'address', value: acc.address, field: 'address', mapLink: true });
      if (acc.checkInDate)
        rows.push({
          label: 'check-in',
          value: acc.checkInDate,
          field: 'checkInDate',
          inputType: 'date',
        });
      if (acc.checkOutDate)
        rows.push({
          label: 'check-out',
          value: acc.checkOutDate,
          field: 'checkOutDate',
          inputType: 'date',
        });
      if (acc.roomType) rows.push({ label: 'room', value: acc.roomType, field: 'roomType' });
      if (acc.confirmationNumber)
        rows.push({ label: 'confirmation', value: acc.confirmationNumber, copyable: true });
      if (acc.contactPhone)
        rows.push({ label: 'phone', value: acc.contactPhone, field: 'contactPhone' });
      if (acc.breakfastIncluded) rows.push({ label: 'breakfast', value: 'included' });
      if (acc.notes) rows.push({ label: 'notes', value: acc.notes, field: 'notes' });

      const kvParts: string[] = [];
      if (acc.name) kvParts.push(acc.name);
      if (acc.checkInDate && acc.checkOutDate)
        kvParts.push(
          `${formatDateShort(acc.checkInDate).toLowerCase()} – ${formatDateShort(acc.checkOutDate).toLowerCase()}`
        );
      if (acc.confirmationNumber) kvParts.push(acc.confirmationNumber);

      items.push({
        id: acc.id,
        kind: 'accommodation',
        icon: accomIcons[acc.type] ?? '🏨',
        title: acc.title,
        keyValue: kvParts.join(' · '),
        status: acc.status,
        sortDate: date ? extractDatePart(date) : '9999-12-31',
        stepNumber: 3,
        detailRows: rows,
        arrayIndex: i,
      });
    }

    for (let i = 0; i < v.transportation.length; i++) {
      const trans = v.transportation[i]!;
      const date = trans.pickupDate ?? trans.departureDate ?? '';
      const rows: DetailRow[] = [];
      if (trans.agencyName)
        rows.push({ label: 'company', value: trans.agencyName, field: 'agencyName' });
      if (trans.agencyAddress)
        rows.push({
          label: 'address',
          value: trans.agencyAddress,
          field: 'agencyAddress',
          mapLink: true,
        });
      if (trans.operator)
        rows.push({ label: 'operator', value: trans.operator, field: 'operator' });
      if (trans.route) rows.push({ label: 'route', value: trans.route, field: 'route' });
      if (trans.departureStation)
        rows.push({ label: 'from', value: trans.departureStation, field: 'departureStation' });
      if (trans.arrivalStation)
        rows.push({ label: 'to', value: trans.arrivalStation, field: 'arrivalStation' });
      if (trans.pickupDate)
        rows.push({
          label: 'pickup date',
          value: trans.pickupDate,
          field: 'pickupDate',
          inputType: 'date',
        });
      if (trans.pickupTime)
        rows.push({
          label: 'pickup time',
          value: trans.pickupTime,
          field: 'pickupTime',
          inputType: 'time',
        });
      if (trans.returnDate)
        rows.push({
          label: 'return date',
          value: trans.returnDate,
          field: 'returnDate',
          inputType: 'date',
        });
      if (trans.returnTime)
        rows.push({
          label: 'return time',
          value: trans.returnTime,
          field: 'returnTime',
          inputType: 'time',
        });
      if (trans.departureDate && !trans.pickupDate)
        rows.push({
          label: 'date',
          value: trans.departureDate,
          field: 'departureDate',
          inputType: 'date',
        });
      if (trans.departureTime && !trans.pickupTime)
        rows.push({
          label: 'departs',
          value: trans.departureTime,
          field: 'departureTime',
          inputType: 'time',
        });
      if (trans.bookingReference)
        rows.push({ label: 'booking ref', value: trans.bookingReference, copyable: true });
      if (trans.notes) rows.push({ label: 'notes', value: trans.notes, field: 'notes' });

      const kvParts: string[] = [];
      if (trans.agencyName) kvParts.push(trans.agencyName);
      else if (trans.operator) kvParts.push(trans.operator);
      if (trans.route) kvParts.push(trans.route);
      if (trans.type === 'rental_car') {
        if (trans.pickupDate && trans.returnDate) {
          kvParts.push(
            `${formatDateShort(trans.pickupDate).toLowerCase()} – ${formatDateShort(trans.returnDate).toLowerCase()}`
          );
        } else if (trans.pickupDate) {
          kvParts.push(formatDateShort(trans.pickupDate).toLowerCase());
        }
      } else if (trans.type === 'train' || trans.type === 'bus') {
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
        title: trans.title,
        keyValue: kvParts.join(' · '),
        status: trans.status,
        sortDate: date ? extractDatePart(date) : '9999-12-31',
        stepNumber: 4,
        detailRows: rows,
        arrayIndex: i,
      });
    }

    items.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
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
