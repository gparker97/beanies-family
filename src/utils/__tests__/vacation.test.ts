import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractSegmentOccurrences,
  isSupportedTravelType,
  transportEmoji,
  splitTimedUntimed,
  validateSegmentTarget,
  tripPhase,
  tripDayProgress,
  type SupportedTravelType,
} from '../vacation';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';

function flightSeg(overrides: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'seg-1',
    type: 'flight_outbound',
    title: 'SFO → JFK',
    status: 'booked',
    departureAirport: 'SFO',
    arrivalAirport: 'JFK',
    departureDate: '2026-06-15',
    departureTime: '09:00',
    arrivalDate: '2026-06-15',
    arrivalTime: '17:30',
    ...overrides,
  };
}

describe('isSupportedTravelType', () => {
  it('returns true for the 5 supported types', () => {
    expect(isSupportedTravelType('flight_outbound')).toBe(true);
    expect(isSupportedTravelType('flight_return')).toBe(true);
    expect(isSupportedTravelType('train')).toBe(true);
    expect(isSupportedTravelType('ferry')).toBe(true);
    expect(isSupportedTravelType('cruise')).toBe(true);
  });

  it('returns false for the 3 unsupported types', () => {
    expect(isSupportedTravelType('car')).toBe(false);
    expect(isSupportedTravelType('activity')).toBe(false);
    expect(isSupportedTravelType('flight_other')).toBe(false);
  });
});

describe('extractSegmentOccurrences', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('emits 2 occurrences for a booked outbound flight with both sides', () => {
    const out = extractSegmentOccurrences('vac-1', flightSeg(), 0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      vacationId: 'vac-1',
      segmentIndex: 0,
      segmentId: 'seg-1',
      transportType: 'flight_outbound',
      kind: 'departure',
      status: 'booked',
      date: '2026-06-15',
      time: '09:00',
      title: 'SFO → JFK',
    });
    expect(out[1]).toMatchObject({ kind: 'arrival', date: '2026-06-15', time: '17:30' });
  });

  it('emits only departure when arrivalDate is missing', () => {
    const out = extractSegmentOccurrences(
      'vac-1',
      flightSeg({ arrivalDate: undefined, arrivalTime: undefined }),
      0
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('departure');
  });

  it('emits embarkation as departure (with time) and disembarkation as arrival (no time) for cruise', () => {
    const cruise = flightSeg({
      type: 'cruise',
      title: 'Mediterranean cruise',
      embarkationDate: '2026-07-01',
      embarkationTime: '14:00',
      disembarkationDate: '2026-07-08',
      // Wipe flight fields:
      departureDate: undefined,
      departureTime: undefined,
      arrivalDate: undefined,
      arrivalTime: undefined,
    });
    const out = extractSegmentOccurrences('vac-1', cruise, 0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      transportType: 'cruise',
      kind: 'departure',
      date: '2026-07-01',
      time: '14:00',
    });
    expect(out[1]).toMatchObject({
      transportType: 'cruise',
      kind: 'arrival',
      date: '2026-07-08',
      time: undefined,
    });
  });

  it('propagates pending status through occurrences', () => {
    const out = extractSegmentOccurrences('vac-1', flightSeg({ status: 'pending' }), 0);
    expect(out.every((o) => o.status === 'pending')).toBe(true);
  });

  it('emits two occurrences on different days for an overnight flight', () => {
    const out = extractSegmentOccurrences(
      'vac-1',
      flightSeg({
        departureDate: '2026-06-15',
        departureTime: '22:00',
        arrivalDate: '2026-06-16',
        arrivalTime: '02:30',
      }),
      0
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'departure', date: '2026-06-15', time: '22:00' });
    expect(out[1]).toMatchObject({ kind: 'arrival', date: '2026-06-16', time: '02:30' });
  });

  it('returns empty array for unsupported types (car, activity, flight_other)', () => {
    expect(extractSegmentOccurrences('vac-1', flightSeg({ type: 'car' }), 0)).toEqual([]);
    expect(extractSegmentOccurrences('vac-1', flightSeg({ type: 'activity' }), 0)).toEqual([]);
    expect(extractSegmentOccurrences('vac-1', flightSeg({ type: 'flight_other' }), 0)).toEqual([]);
  });

  it('logs and skips a side with a malformed date — does not throw', () => {
    const out = extractSegmentOccurrences('vac-1', flightSeg({ departureDate: 'not-a-date' }), 0);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('arrival');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[vacation] segment seg-1 has invalid departure date')
    );
  });

  it('returns no occurrences when both dates are missing', () => {
    const out = extractSegmentOccurrences(
      'vac-1',
      flightSeg({
        departureDate: undefined,
        arrivalDate: undefined,
      }),
      0
    );
    expect(out).toEqual([]);
  });

  it('omits time when timeField is undefined and rawTime is empty string', () => {
    // Empty string time → falsy → undefined in occurrence
    const out = extractSegmentOccurrences(
      'vac-1',
      flightSeg({ departureTime: '', arrivalTime: '' }),
      0
    );
    expect(out).toHaveLength(2);
    expect(out[0].time).toBeUndefined();
    expect(out[1].time).toBeUndefined();
  });

  it('passes through segmentIndex unchanged', () => {
    const out = extractSegmentOccurrences('vac-1', flightSeg(), 7);
    expect(out.every((o) => o.segmentIndex === 7)).toBe(true);
  });
});

describe('transportEmoji', () => {
  it('returns the generic emoji for each supported type when kind is omitted', () => {
    expect(transportEmoji('flight_outbound')).toBe('✈');
    expect(transportEmoji('flight_return')).toBe('✈');
    expect(transportEmoji('train')).toBe('🚆');
    expect(transportEmoji('ferry')).toBe('⛴');
    expect(transportEmoji('cruise')).toBe('🚢');
  });

  it('returns direction-specific emoji for flights when kind is supplied', () => {
    expect(transportEmoji('flight_outbound', 'departure')).toBe('🛫');
    expect(transportEmoji('flight_outbound', 'arrival')).toBe('🛬');
    expect(transportEmoji('flight_return', 'departure')).toBe('🛫');
    expect(transportEmoji('flight_return', 'arrival')).toBe('🛬');
  });

  it('keeps the generic emoji for non-flight types regardless of kind', () => {
    // Train, ferry, cruise rely on the textual Dep/Arr label for differentiation
    // since there's no canonical direction-aware Unicode for those modes.
    expect(transportEmoji('train', 'departure')).toBe('🚆');
    expect(transportEmoji('train', 'arrival')).toBe('🚆');
    expect(transportEmoji('ferry', 'departure')).toBe('⛴');
    expect(transportEmoji('cruise', 'arrival')).toBe('🚢');
  });

  it('returns empty string for unknown types (defensive)', () => {
    expect(transportEmoji('mystery' as SupportedTravelType)).toBe('');
  });
});

describe('splitTimedUntimed', () => {
  it('buckets items by presence of time', () => {
    const input = [
      { id: 'a', time: '09:00' },
      { id: 'b' },
      { id: 'c', time: '14:30' },
      { id: 'd', time: undefined },
    ];
    const { timed, untimed } = splitTimedUntimed(input);
    expect(timed).toEqual([
      { id: 'a', time: '09:00' },
      { id: 'c', time: '14:30' },
    ]);
    expect(untimed).toEqual([{ id: 'b' }, { id: 'd', time: undefined }]);
  });

  it('handles empty array', () => {
    expect(splitTimedUntimed([])).toEqual({ timed: [], untimed: [] });
  });

  it('treats empty-string time as untimed', () => {
    const { timed, untimed } = splitTimedUntimed([{ time: '' }, { time: '10:00' }]);
    expect(timed).toEqual([{ time: '10:00' }]);
    expect(untimed).toEqual([{ time: '' }]);
  });
});

describe('validateSegmentTarget', () => {
  function vacationWith(segmentCount: number): FamilyVacation {
    return {
      id: 'vac-1',
      activityId: 'act-1',
      name: 'Trip',
      tripType: 'fly_and_stay',
      assigneeIds: [],
      travelSegments: Array.from({ length: segmentCount }, (_, i) => ({
        id: `seg-${i}`,
        type: 'flight_outbound' as const,
        title: 'X',
        status: 'booked' as const,
      })),
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'm-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('returns ok for a valid (vacation, segmentIndex) pair', () => {
    expect(validateSegmentTarget(vacationWith(2), 'vac-1', 0)).toEqual({ ok: true });
    expect(validateSegmentTarget(vacationWith(2), 'vac-1', 1)).toEqual({ ok: true });
  });

  it('returns not-ok with reason when vacation is undefined', () => {
    const r = validateSegmentTarget(undefined, 'missing-vac', 0);
    expect(r).toEqual({ ok: false, reason: 'vacation missing-vac not found' });
  });

  it('returns not-ok with reason when segmentIndex is negative', () => {
    const r = validateSegmentTarget(vacationWith(2), 'vac-1', -1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('out of bounds');
  });

  it('returns not-ok with reason when segmentIndex is >= length', () => {
    const r = validateSegmentTarget(vacationWith(2), 'vac-1', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('out of bounds (2)');
  });

  it('returns not-ok when vacation has zero segments', () => {
    const r = validateSegmentTarget(vacationWith(0), 'vac-1', 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('out of bounds (0)');
  });
});

describe('tripPhase', () => {
  const TODAY = '2026-06-10';

  it('returns "past" when the trip ended before today', () => {
    expect(tripPhase({ startDate: '2026-06-01', endDate: '2026-06-05' }, TODAY)).toBe('past');
  });

  it('returns "upcoming" when the trip starts after today', () => {
    expect(tripPhase({ startDate: '2026-06-20', endDate: '2026-06-25' }, TODAY)).toBe('upcoming');
  });

  it('returns "today" when the trip starts today', () => {
    expect(tripPhase({ startDate: '2026-06-10', endDate: '2026-06-15' }, TODAY)).toBe('today');
  });

  it('returns "ongoing" when the trip started before today and has not ended', () => {
    expect(tripPhase({ startDate: '2026-06-08', endDate: '2026-06-15' }, TODAY)).toBe('ongoing');
  });

  it('treats an end date equal to today as not past (ongoing)', () => {
    expect(tripPhase({ startDate: '2026-06-08', endDate: '2026-06-10' }, TODAY)).toBe('ongoing');
  });

  it('handles a missing end date: future start → upcoming, past start → ongoing', () => {
    expect(tripPhase({ startDate: '2026-06-20', endDate: undefined }, TODAY)).toBe('upcoming');
    expect(tripPhase({ startDate: '2026-06-08', endDate: undefined }, TODAY)).toBe('ongoing');
  });

  it('treats a missing start date as "upcoming" (no countdown to derive)', () => {
    expect(tripPhase({ startDate: undefined, endDate: '2026-06-20' }, TODAY)).toBe('upcoming');
    expect(tripPhase({ startDate: undefined, endDate: undefined }, TODAY)).toBe('upcoming');
  });

  it('tolerates full ISO timestamps by comparing the date part only', () => {
    expect(
      tripPhase(
        { startDate: '2026-06-08T09:00:00.000Z', endDate: '2026-06-15T18:00:00.000Z' },
        TODAY
      )
    ).toBe('ongoing');
  });
});

describe('tripDayProgress', () => {
  const TODAY = '2026-06-10';

  it('returns {day, total} for a valid in-progress window', () => {
    // Trip 2026-06-08..2026-06-12 → day 3 of 5 on 2026-06-10.
    expect(tripDayProgress({ startDate: '2026-06-08', endDate: '2026-06-12' }, TODAY)).toEqual({
      day: 3,
      total: 5,
    });
  });

  it('returns day 1 when the trip starts today', () => {
    expect(tripDayProgress({ startDate: '2026-06-10', endDate: '2026-06-12' }, TODAY)).toEqual({
      day: 1,
      total: 3,
    });
  });

  it('returns null when the end date is missing', () => {
    expect(tripDayProgress({ startDate: '2026-06-08', endDate: undefined }, TODAY)).toBeNull();
  });

  it('returns null when the start date is missing', () => {
    expect(tripDayProgress({ startDate: undefined, endDate: '2026-06-12' }, TODAY)).toBeNull();
  });

  it('returns null on a malformed date (guards the tripDurationDays NaN path)', () => {
    expect(tripDayProgress({ startDate: 'not-a-date', endDate: '2026-06-12' }, TODAY)).toBeNull();
  });

  it('returns null when today is before the trip start (tripDayNumber → null)', () => {
    expect(tripDayProgress({ startDate: '2026-06-12', endDate: '2026-06-15' }, TODAY)).toBeNull();
  });
});
