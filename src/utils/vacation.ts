import { parseLocalDate, extractDatePart } from '@/utils/date';
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

/** Get the emoji for a vacation trip type, defaulting to ✈️ */
export function tripTypeEmoji(tripType?: string): string {
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
 * Translation key suffix for trip-type-appropriate countdown label.
 * Returns a key like 'travel.countdown.fly_and_stay' for use with t().
 */
export function tripCountdownKey(tripType?: string): string {
  const valid = ['fly_and_stay', 'cruise', 'road_trip', 'camping', 'adventure', 'combo'];
  if (tripType && valid.includes(tripType)) return `travel.countdown.${tripType}`;
  return 'travel.countdown.fly_and_stay';
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
