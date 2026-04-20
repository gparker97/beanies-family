import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  computeVacationDates,
  bookingProgress,
  daysUntilTrip,
  tripDurationDays,
  tripTypeEmoji,
  extendTripDates,
  collectSegmentDates,
  prefillSegmentDates,
  prefillAccommodationDates,
  prefillTransportationDates,
  isValidISODate,
  computeTimelineHints,
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

// ── isValidISODate ──

describe('isValidISODate', () => {
  it('accepts well-formed YYYY-MM-DD strings', () => {
    expect(isValidISODate('2026-07-01')).toBe(true);
    expect(isValidISODate('1999-12-31')).toBe(true);
  });

  it('rejects malformed or non-string inputs', () => {
    expect(isValidISODate('2026-7-1')).toBe(false); // missing zero-pad
    expect(isValidISODate('2026/07/01')).toBe(false); // wrong separator
    expect(isValidISODate('2026-07-01T00:00:00Z')).toBe(false); // full ISO, not date-only
    expect(isValidISODate('')).toBe(false);
    expect(isValidISODate(undefined)).toBe(false);
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(20260701)).toBe(false);
  });
});

// ── extendTripDates ──

describe('extendTripDates', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('extends end when candidate is after current end', () => {
    const result = extendTripDates({ start: '2026-06-01', end: '2026-06-10' }, '2026-06-15');
    expect(result).toEqual({ start: '2026-06-01', end: '2026-06-15' });
  });

  it('extends start when candidate is before current start', () => {
    const result = extendTripDates({ start: '2026-06-01', end: '2026-06-10' }, '2026-05-28');
    expect(result).toEqual({ start: '2026-05-28', end: '2026-06-10' });
  });

  it('is a no-op when candidate falls within current window', () => {
    const current = { start: '2026-06-01', end: '2026-06-10' };
    expect(extendTripDates(current, '2026-06-05')).toEqual(current);
  });

  it('never shrinks, even with many candidates all inside the window', () => {
    const result = extendTripDates(
      { start: '2026-06-01', end: '2026-06-15' },
      '2026-06-05',
      '2026-06-10',
      '2026-06-12'
    );
    expect(result).toEqual({ start: '2026-06-01', end: '2026-06-15' });
  });

  it('treats undefined current as "open" — candidate becomes both bounds', () => {
    expect(extendTripDates({}, '2026-06-05')).toEqual({
      start: '2026-06-05',
      end: '2026-06-05',
    });
  });

  it('extends from a one-sided current window', () => {
    expect(extendTripDates({ start: '2026-06-01' }, '2026-06-10')).toEqual({
      start: '2026-06-01',
      end: '2026-06-10',
    });
  });

  it('ignores undefined candidates silently (no warning)', () => {
    const current = { start: '2026-06-01', end: '2026-06-10' };
    expect(extendTripDates(current, undefined, undefined)).toEqual(current);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips and warns on malformed ISO strings', () => {
    const result = extendTripDates(
      { start: '2026-06-01', end: '2026-06-10' },
      'not-a-date',
      '2026-06-15'
    );
    expect(result).toEqual({ start: '2026-06-01', end: '2026-06-15' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[vacation] Skipping invalid trip-date candidate "not-a-date"')
    );
  });

  it('picks the extreme from a multi-candidate list', () => {
    const result = extendTripDates(
      { start: '2026-06-05', end: '2026-06-05' },
      '2026-06-10',
      '2026-05-28',
      '2026-06-03'
    );
    expect(result).toEqual({ start: '2026-05-28', end: '2026-06-10' });
  });
});

// ── collectSegmentDates ──

describe('collectSegmentDates', () => {
  it('returns [] for an empty input', () => {
    expect(collectSegmentDates({})).toEqual([]);
  });

  it('gathers dates from all three arrays', () => {
    const dates = collectSegmentDates({
      travelSegments: [
        makeTravelSegment({ departureDate: '2026-07-01', arrivalDate: '2026-07-01' }),
        makeTravelSegment({
          id: 'seg-2',
          type: 'cruise',
          embarkationDate: '2026-07-03',
          disembarkationDate: '2026-07-08',
        }),
      ],
      accommodations: [
        makeAccommodation({ checkInDate: '2026-07-01', checkOutDate: '2026-07-09' }),
      ],
      transportation: [makeTransportation({ pickupDate: '2026-07-01', returnDate: '2026-07-09' })],
    });
    expect(dates).toContain('2026-07-01');
    expect(dates).toContain('2026-07-03');
    expect(dates).toContain('2026-07-08');
    expect(dates).toContain('2026-07-09');
  });

  it('skips undefined-date fields without error', () => {
    const dates = collectSegmentDates({
      travelSegments: [makeTravelSegment({})], // no dates
    });
    expect(dates).toEqual([]);
  });
});

// ── prefillSegmentDates ──

describe('prefillSegmentDates', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('sets departureDate=tripStart on flight_outbound', () => {
    const seg = makeTravelSegment({ type: 'flight_outbound' });
    expect(prefillSegmentDates(seg, '2026-06-01', '2026-06-10').departureDate).toBe('2026-06-01');
  });

  it('sets departureDate=tripEnd on flight_return', () => {
    const seg = makeTravelSegment({ type: 'flight_return' });
    expect(prefillSegmentDates(seg, '2026-06-01', '2026-06-10').departureDate).toBe('2026-06-10');
  });

  it('sets departureDate=tripStart on flight_other', () => {
    const seg = makeTravelSegment({ type: 'flight_other' });
    expect(prefillSegmentDates(seg, '2026-06-01', '2026-06-10').departureDate).toBe('2026-06-01');
  });

  it('sets embarkation + disembarkation on cruise', () => {
    const seg = makeTravelSegment({ type: 'cruise' });
    const result = prefillSegmentDates(seg, '2026-06-01', '2026-06-10');
    expect(result.embarkationDate).toBe('2026-06-01');
    expect(result.disembarkationDate).toBe('2026-06-10');
  });

  it('sets departureDate=tripStart on train', () => {
    const seg = makeTravelSegment({ type: 'train' });
    expect(prefillSegmentDates(seg, '2026-06-01', '2026-06-10').departureDate).toBe('2026-06-01');
  });

  it('sets departureDate=tripStart on ferry', () => {
    const seg = makeTravelSegment({ type: 'ferry' });
    expect(prefillSegmentDates(seg, '2026-06-01', '2026-06-10').departureDate).toBe('2026-06-01');
  });

  it('sets departureDate=tripStart on car', () => {
    const seg = makeTravelSegment({ type: 'car' });
    expect(prefillSegmentDates(seg, '2026-06-01', '2026-06-10').departureDate).toBe('2026-06-01');
  });

  it('does not prefill activity — activities pick their own day', () => {
    const seg = makeTravelSegment({ type: 'activity' });
    const result = prefillSegmentDates(seg, '2026-06-01', '2026-06-10');
    expect(result.departureDate).toBeUndefined();
    expect(result.embarkationDate).toBeUndefined();
  });

  it('never overwrites an existing date', () => {
    const seg = makeTravelSegment({ type: 'flight_outbound', departureDate: '2026-06-05' });
    expect(prefillSegmentDates(seg, '2026-06-01', '2026-06-10').departureDate).toBe('2026-06-05');
  });

  it('warns and returns unchanged when trip dates are absent', () => {
    const seg = makeTravelSegment({ type: 'flight_outbound' });
    expect(prefillSegmentDates(seg, undefined, undefined)).toBe(seg);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[vacation] prefillSegmentDates called without trip dates')
    );
  });
});

// ── prefillAccommodationDates ──

describe('prefillAccommodationDates', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('sets checkIn=tripStart, checkOut=tripEnd when both empty', () => {
    const acc = makeAccommodation();
    const result = prefillAccommodationDates(acc, '2026-06-01', '2026-06-10');
    expect(result.checkInDate).toBe('2026-06-01');
    expect(result.checkOutDate).toBe('2026-06-10');
  });

  it('never overwrites existing dates', () => {
    const acc = makeAccommodation({ checkInDate: '2026-06-03', checkOutDate: '2026-06-08' });
    const result = prefillAccommodationDates(acc, '2026-06-01', '2026-06-10');
    expect(result.checkInDate).toBe('2026-06-03');
    expect(result.checkOutDate).toBe('2026-06-08');
  });

  it('warns when trip dates are absent', () => {
    const acc = makeAccommodation();
    expect(prefillAccommodationDates(acc, undefined, undefined)).toBe(acc);
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ── prefillTransportationDates ──

describe('prefillTransportationDates', () => {
  it('fills pickup/return for rental_car', () => {
    const t = makeTransportation({ type: 'rental_car' });
    const result = prefillTransportationDates(t, '2026-06-01', '2026-06-10');
    expect(result.pickupDate).toBe('2026-06-01');
    expect(result.returnDate).toBe('2026-06-10');
  });

  it('fills pickup/return for airport_shuttle', () => {
    const t = makeTransportation({ type: 'airport_shuttle' });
    const result = prefillTransportationDates(t, '2026-06-01', '2026-06-10');
    expect(result.pickupDate).toBe('2026-06-01');
    expect(result.returnDate).toBe('2026-06-10');
  });

  it('fills pickup/return for taxi_rideshare', () => {
    const t = makeTransportation({ type: 'taxi_rideshare' });
    const result = prefillTransportationDates(t, '2026-06-01', '2026-06-10');
    expect(result.pickupDate).toBe('2026-06-01');
    expect(result.returnDate).toBe('2026-06-10');
  });

  it('fills departureDate on bus', () => {
    const t = makeTransportation({ type: 'bus' });
    const result = prefillTransportationDates(t, '2026-06-01', '2026-06-10');
    expect(result.departureDate).toBe('2026-06-01');
    expect(result.pickupDate).toBeUndefined();
  });

  it('never overwrites existing dates', () => {
    const t = makeTransportation({
      type: 'rental_car',
      pickupDate: '2026-06-03',
      returnDate: '2026-06-08',
    });
    const result = prefillTransportationDates(t, '2026-06-01', '2026-06-10');
    expect(result.pickupDate).toBe('2026-06-03');
    expect(result.returnDate).toBe('2026-06-08');
  });
});

// ── computeTimelineHints — detectOutOfRange ──

describe('computeTimelineHints — detectOutOfRange', () => {
  it('flags a flight whose departureDate is before trip start', () => {
    const v = makeVacation({
      startDate: '2026-06-05',
      endDate: '2026-06-15',
      travelSegments: [
        makeTravelSegment({ id: 's-early', type: 'flight_outbound', departureDate: '2026-06-01' }),
      ],
    });
    const hints = computeTimelineHints(v);
    expect(hints.get('s-early')?.message).toContain('before trip start');
  });

  it('flags an accommodation whose check-in is after trip end', () => {
    const v = makeVacation({
      startDate: '2026-06-05',
      endDate: '2026-06-10',
      accommodations: [makeAccommodation({ id: 'a-late', checkInDate: '2026-06-20' })],
    });
    const hints = computeTimelineHints(v);
    expect(hints.get('a-late')?.message).toContain('after trip end');
  });

  it('flags transportation outside the window', () => {
    const v = makeVacation({
      startDate: '2026-06-05',
      endDate: '2026-06-10',
      transportation: [
        makeTransportation({ id: 't-early', type: 'bus', departureDate: '2026-06-01' }),
      ],
    });
    const hints = computeTimelineHints(v);
    expect(hints.get('t-early')?.message).toContain('before trip start');
  });

  it('does not flag segments inside the window', () => {
    const v = makeVacation({
      startDate: '2026-06-01',
      endDate: '2026-06-10',
      travelSegments: [
        makeTravelSegment({ id: 's-in', type: 'flight_outbound', departureDate: '2026-06-05' }),
      ],
    });
    const hints = computeTimelineHints(v);
    expect(hints.get('s-in')).toBeUndefined();
  });

  it('skips the out-of-range check entirely when no trip window is set', () => {
    const v = makeVacation({
      startDate: undefined,
      endDate: undefined,
      travelSegments: [makeTravelSegment({ id: 's-dateless', departureDate: '2026-06-01' })],
    });
    const hints = computeTimelineHints(v);
    expect(hints.get('s-dateless')).toBeUndefined();
  });
});
