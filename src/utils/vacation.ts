import { parseLocalDate, extractDatePart, addDays, toDateInputValue } from '@/utils/date';
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
