import { computed, type ComputedRef } from 'vue';
import {
  formatNookDate,
  formatDateShort,
  extractDatePart,
  parseLocalDate,
  addDays,
  toDateInputValue,
} from '@/utils/date';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';

// ── Shared types ────────────────────────────────────────────────────────────

export interface DetailRow {
  label: string;
  value: string;
  copyable?: boolean;
  mapLink?: boolean;
}

export interface TimelineItem {
  id: string;
  kind: 'travel' | 'accommodation' | 'transportation';
  icon: string;
  title: string;
  keyValue: string;
  status: 'booked' | 'pending' | 'not_booked' | 'researching';
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
  train: '🚄',
  ferry: '⛴️',
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
  train: '🚄',
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

/** Build detail rows for a travel segment — only includes populated fields */
export function travelDetailRows(seg: VacationTravelSegment): DetailRow[] {
  const rows: DetailRow[] = [];
  const isF = seg.type?.startsWith('flight');
  if (isF) {
    if (seg.airline) rows.push({ label: 'airline', value: seg.airline });
    if (seg.flightNumber) rows.push({ label: 'flight #', value: seg.flightNumber, copyable: true });
    if (seg.departureAirport) rows.push({ label: 'from', value: seg.departureAirport });
    if (seg.arrivalAirport) rows.push({ label: 'to', value: seg.arrivalAirport });
    if (seg.departureDate)
      rows.push({
        label: 'departs',
        value: `${formatDateShort(seg.departureDate)}${seg.departureTime ? ' · ' + seg.departureTime : ''}`,
      });
    if (seg.arrivalDate)
      rows.push({
        label: 'arrives',
        value: `${formatDateShort(seg.arrivalDate)}${seg.arrivalTime ? ' · ' + seg.arrivalTime : ''}`,
      });
  } else if (seg.type === 'cruise') {
    if (seg.cruiseLine) rows.push({ label: 'cruise line', value: seg.cruiseLine });
    if (seg.shipName) rows.push({ label: 'ship', value: seg.shipName });
    if (seg.departurePort) rows.push({ label: 'port', value: seg.departurePort });
    if (seg.cabinNumber) rows.push({ label: 'cabin', value: seg.cabinNumber, copyable: true });
    if (seg.embarkationDate)
      rows.push({ label: 'embark', value: formatDateShort(seg.embarkationDate) });
    if (seg.disembarkationDate)
      rows.push({ label: 'disembark', value: formatDateShort(seg.disembarkationDate) });
  } else {
    if (seg.operator) rows.push({ label: 'operator', value: seg.operator });
    if (seg.route) rows.push({ label: 'route', value: seg.route });
    if (seg.departureStation) rows.push({ label: 'from', value: seg.departureStation });
    if (seg.arrivalStation) rows.push({ label: 'to', value: seg.arrivalStation });
    if (seg.departureDate)
      rows.push({
        label: 'departs',
        value: `${formatDateShort(seg.departureDate)}${seg.departureTime ? ' · ' + seg.departureTime : ''}`,
      });
  }
  if (seg.bookingReference)
    rows.push({ label: 'booking ref', value: seg.bookingReference, copyable: true });
  if (seg.notes) rows.push({ label: 'notes', value: seg.notes });
  return rows;
}

// ── Composable ──────────────────────────────────────────────────────────────

export function useVacationTimeline(vacation: ComputedRef<FamilyVacation | undefined>) {
  const accommodationGaps = computed(() => {
    const v = vacation.value;
    if (!v?.startDate || !v?.endDate) return [];
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
        icon: travelIcons[seg.type] ?? '✈️',
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
      if (acc.name) rows.push({ label: 'name', value: acc.name });
      if (acc.address) rows.push({ label: 'address', value: acc.address, mapLink: true });
      if (acc.checkInDate)
        rows.push({ label: 'check-in', value: formatDateShort(acc.checkInDate) });
      if (acc.checkOutDate)
        rows.push({ label: 'check-out', value: formatDateShort(acc.checkOutDate) });
      if (acc.roomType) rows.push({ label: 'room', value: acc.roomType });
      if (acc.confirmationNumber)
        rows.push({ label: 'confirmation', value: acc.confirmationNumber, copyable: true });
      if (acc.contactPhone) rows.push({ label: 'phone', value: acc.contactPhone, copyable: true });
      if (acc.breakfastIncluded) rows.push({ label: 'breakfast', value: 'included' });
      if (acc.notes) rows.push({ label: 'notes', value: acc.notes });

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
      if (trans.agencyName) rows.push({ label: 'company', value: trans.agencyName });
      if (trans.agencyAddress)
        rows.push({ label: 'address', value: trans.agencyAddress, mapLink: true });
      if (trans.operator) rows.push({ label: 'operator', value: trans.operator });
      if (trans.route) rows.push({ label: 'route', value: trans.route });
      if (trans.departureStation) rows.push({ label: 'from', value: trans.departureStation });
      if (trans.arrivalStation) rows.push({ label: 'to', value: trans.arrivalStation });
      if (trans.pickupDate)
        rows.push({
          label: 'pickup',
          value: `${formatDateShort(trans.pickupDate)}${trans.pickupTime ? ' · ' + trans.pickupTime : ''}`,
        });
      if (trans.returnDate)
        rows.push({
          label: 'return',
          value: `${formatDateShort(trans.returnDate)}${trans.returnTime ? ' · ' + trans.returnTime : ''}`,
        });
      if (trans.departureDate && !trans.pickupDate)
        rows.push({
          label: 'departs',
          value: `${formatDateShort(trans.departureDate)}${trans.departureTime ? ' · ' + trans.departureTime : ''}`,
        });
      if (trans.bookingReference)
        rows.push({ label: 'booking ref', value: trans.bookingReference, copyable: true });
      if (trans.notes) rows.push({ label: 'notes', value: trans.notes });

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

  const bookedItems = computed(() => timelineItems.value.filter((i) => i.status !== 'not_booked'));
  const unbookedItems = computed(() =>
    timelineItems.value.filter((i) => i.status === 'not_booked')
  );

  const groupedByDate = computed<DateGroup[]>(() => {
    const groups: DateGroup[] = [];
    for (const item of bookedItems.value) {
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

  return { timelineItems, groupedByDate, accommodationGaps, bookedItems, unbookedItems };
}
