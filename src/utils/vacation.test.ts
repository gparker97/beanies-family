import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeVacationDates,
  bookingProgress,
  daysUntilTrip,
  tripDurationDays,
  tripTypeEmoji,
} from './vacation';
import { daysBetween } from './date';
import type {
  FamilyVacation,
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
} from '@/types/models';

// ── Factory helpers ──

function makeTravelSegment(overrides?: Partial<VacationTravelSegment>): VacationTravelSegment {
  return {
    id: 'seg-1',
    type: 'flight_outbound',
    title: 'Outbound Flight',
    status: 'booked',
    ...overrides,
  };
}

function makeAccommodation(overrides?: Partial<VacationAccommodation>): VacationAccommodation {
  return {
    id: 'acc-1',
    type: 'hotel',
    title: 'Beach Hotel',
    status: 'booked',
    ...overrides,
  };
}

function makeTransportation(overrides?: Partial<VacationTransportation>): VacationTransportation {
  return {
    id: 'trans-1',
    type: 'rental_car',
    title: 'Rental Car',
    status: 'pending',
    ...overrides,
  };
}

function makeVacation(overrides?: Partial<FamilyVacation>): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Beach Trip',
    tripType: 'fly_and_stay',
    assigneeIds: ['m-1'],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── computeVacationDates ──

describe('computeVacationDates', () => {
  it('returns {} for empty vacation (no segments)', () => {
    const result = computeVacationDates({
      travelSegments: [],
      accommodations: [],
      transportation: [],
    });
    expect(result).toEqual({});
  });

  it('returns correct dates from travel segments only', () => {
    const result = computeVacationDates({
      travelSegments: [
        makeTravelSegment({ departureDate: '2026-07-01', arrivalDate: '2026-07-01' }),
        makeTravelSegment({
          id: 'seg-2',
          departureDate: '2026-07-10',
          arrivalDate: '2026-07-10',
        }),
      ],
      accommodations: [],
      transportation: [],
    });
    expect(result).toEqual({ startDate: '2026-07-01', endDate: '2026-07-10' });
  });

  it('returns correct dates from accommodation only', () => {
    const result = computeVacationDates({
      travelSegments: [],
      accommodations: [
        makeAccommodation({ checkInDate: '2026-07-02', checkOutDate: '2026-07-09' }),
      ],
      transportation: [],
    });
    expect(result).toEqual({ startDate: '2026-07-02', endDate: '2026-07-09' });
  });

  it('returns correct dates from mixed segments', () => {
    const result = computeVacationDates({
      travelSegments: [
        makeTravelSegment({ departureDate: '2026-07-01', arrivalDate: '2026-07-01' }),
      ],
      accommodations: [
        makeAccommodation({ checkInDate: '2026-07-01', checkOutDate: '2026-07-08' }),
      ],
      transportation: [makeTransportation({ pickupDate: '2026-07-01', returnDate: '2026-07-10' })],
    });
    // Earliest is 2026-07-01, latest is 2026-07-10 (from rental return)
    expect(result).toEqual({ startDate: '2026-07-01', endDate: '2026-07-10' });
  });

  it('handles cruise dates (embarkation/disembarkation)', () => {
    const result = computeVacationDates({
      travelSegments: [
        makeTravelSegment({
          type: 'cruise',
          embarkationDate: '2026-08-01',
          disembarkationDate: '2026-08-07',
        }),
      ],
      accommodations: [],
      transportation: [],
    });
    expect(result).toEqual({ startDate: '2026-08-01', endDate: '2026-08-07' });
  });

  it('uses sortDate when other dates are missing', () => {
    const result = computeVacationDates({
      travelSegments: [makeTravelSegment({ sortDate: '2026-06-15' })],
      accommodations: [],
      transportation: [],
    });
    expect(result).toEqual({ startDate: '2026-06-15', endDate: '2026-06-15' });
  });
});

// ── bookingProgress ──

describe('bookingProgress', () => {
  it('returns { booked: 0, total: 0, percent: 100 } for empty vacation', () => {
    const result = bookingProgress(makeVacation());
    expect(result).toEqual({ booked: 0, total: 0, percent: 100 });
  });

  it('counts all booked items across all three arrays', () => {
    const v = makeVacation({
      travelSegments: [
        makeTravelSegment({ status: 'booked' }),
        makeTravelSegment({ id: 'seg-2', status: 'booked' }),
      ],
      accommodations: [makeAccommodation({ status: 'booked' })],
      transportation: [makeTransportation({ status: 'booked' })],
    });
    const result = bookingProgress(v);
    expect(result).toEqual({ booked: 4, total: 4, percent: 100 });
  });

  it('handles mixed statuses', () => {
    const v = makeVacation({
      travelSegments: [
        makeTravelSegment({ status: 'booked' }),
        makeTravelSegment({ id: 'seg-2', status: 'pending' }),
      ],
      accommodations: [makeAccommodation({ status: 'pending' })],
      transportation: [makeTransportation({ status: 'pending' })],
    });
    const result = bookingProgress(v);
    expect(result).toEqual({ booked: 1, total: 4, percent: 25 });
  });

  it('returns correct percentage for partial bookings', () => {
    const v = makeVacation({
      travelSegments: [
        makeTravelSegment({ status: 'booked' }),
        makeTravelSegment({ id: 'seg-2', status: 'booked' }),
      ],
      accommodations: [makeAccommodation({ status: 'pending' })],
    });
    const result = bookingProgress(v);
    // 2/3 = 66.666... → rounds to 67
    expect(result).toEqual({ booked: 2, total: 3, percent: 67 });
  });
});

// ── daysUntilTrip ──

describe('daysUntilTrip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns positive number for future date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 20)); // March 20, 2026
    expect(daysUntilTrip('2026-03-25')).toBe(5);
  });

  it('returns 0 for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 20));
    expect(daysUntilTrip('2026-03-20')).toBe(0);
  });

  it('returns negative for past date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 20));
    expect(daysUntilTrip('2026-03-15')).toBe(-5);
  });
});

// ── tripDurationDays ──

describe('tripDurationDays', () => {
  it('returns 1 for same start/end', () => {
    expect(tripDurationDays('2026-07-01', '2026-07-01')).toBe(1);
  });

  it('returns correct number for multi-day range', () => {
    expect(tripDurationDays('2026-07-01', '2026-07-10')).toBe(10);
  });
});

// ── tripTypeEmoji ──

describe('tripTypeEmoji', () => {
  it('returns correct emoji for each trip type', () => {
    expect(tripTypeEmoji('fly_and_stay')).toBe('✈️');
    expect(tripTypeEmoji('cruise')).toBe('🚢');
    expect(tripTypeEmoji('road_trip')).toBe('🚗');
    expect(tripTypeEmoji('combo')).toBe('🎒');
    expect(tripTypeEmoji('camping')).toBe('🏕️');
    expect(tripTypeEmoji('adventure')).toBe('🏔️');
  });

  it('returns airplane emoji for unknown type', () => {
    expect(tripTypeEmoji('unknown_type')).toBe('✈️');
    expect(tripTypeEmoji(undefined)).toBe('✈️');
  });
});

// ── daysBetween (from date.ts) ──

describe('daysBetween', () => {
  it('returns 0 for same date', () => {
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(0);
  });

  it('returns 1 for adjacent dates', () => {
    expect(daysBetween('2026-07-01', '2026-07-02')).toBe(1);
  });

  it('returns correct count for multi-day span', () => {
    expect(daysBetween('2026-07-01', '2026-07-15')).toBe(14);
  });

  it('returns non-negative regardless of order', () => {
    expect(daysBetween('2026-07-15', '2026-07-01')).toBe(14);
  });
});
