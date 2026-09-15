import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractSegmentOccurrences,
  isSupportedTravelType,
  transportEmoji,
  splitTimedUntimed,
  validateSegmentTarget,
  tripPhase,
  tripDayProgress,
  tripBadge,
  segmentDateRange,
  tripsOverlappingRange,
  buildTravelSegmentTitle,
  flightCodeLabel,
  airportLabel,
  airlineLabel,
  buildAirportOptions,
  buildAirlineOptions,
  resolveTripTarget,
  overrideTripTarget,
  type SupportedTravelType,
} from '../vacation';
import { AIRPORTS } from '@/constants/airports';
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
    const out = extractSegmentOccurrences('vac-1', flightSeg(), 0, []);
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
      0,
      []
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
    const out = extractSegmentOccurrences('vac-1', cruise, 0, []);
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
    const out = extractSegmentOccurrences('vac-1', flightSeg({ status: 'pending' }), 0, []);
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
      0,
      []
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'departure', date: '2026-06-15', time: '22:00' });
    expect(out[1]).toMatchObject({ kind: 'arrival', date: '2026-06-16', time: '02:30' });
  });

  it('returns empty array for unsupported types (car, activity, flight_other)', () => {
    expect(extractSegmentOccurrences('vac-1', flightSeg({ type: 'car' }), 0, [])).toEqual([]);
    expect(extractSegmentOccurrences('vac-1', flightSeg({ type: 'activity' }), 0, [])).toEqual([]);
    expect(extractSegmentOccurrences('vac-1', flightSeg({ type: 'flight_other' }), 0, [])).toEqual(
      []
    );
  });

  it('logs and skips a side with a malformed date — does not throw', () => {
    const out = extractSegmentOccurrences(
      'vac-1',
      flightSeg({ departureDate: 'not-a-date' }),
      0,
      []
    );
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
      0,
      []
    );
    expect(out).toEqual([]);
  });

  it('omits time when timeField is undefined and rawTime is empty string', () => {
    // Empty string time → falsy → undefined in occurrence
    const out = extractSegmentOccurrences(
      'vac-1',
      flightSeg({ departureTime: '', arrivalTime: '' }),
      0,
      []
    );
    expect(out).toHaveLength(2);
    expect(out[0].time).toBeUndefined();
    expect(out[1].time).toBeUndefined();
  });

  it('passes through segmentIndex unchanged', () => {
    const out = extractSegmentOccurrences('vac-1', flightSeg(), 7, []);
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

describe('segmentDateRange / tripsOverlappingRange / resolveTripTarget (#30)', () => {
  const TODAY = '2026-06-10';

  function vac(over: Partial<FamilyVacation> = {}): FamilyVacation {
    return {
      id: over.id ?? 'v1',
      activityId: 'a1',
      name: 'Trip',
      tripType: 'fly_and_stay',
      assigneeIds: [],
      travelSegments: [],
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'm1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      ...over,
    };
  }

  it('segmentDateRange spans the earliest and latest segment dates', () => {
    const range = segmentDateRange({
      travelSegments: [{ departureDate: '2026-08-12', arrivalDate: '2026-08-12' }],
      accommodations: [{ checkInDate: '2026-08-12', checkOutDate: '2026-08-16' }],
      transportation: [],
    });
    expect(range).toEqual({ start: '2026-08-12', end: '2026-08-16' });
  });

  it('segmentDateRange returns null when no usable dates', () => {
    expect(
      segmentDateRange({ travelSegments: [{}], accommodations: [], transportation: [] })
    ).toBeNull();
  });

  it('tripsOverlappingRange returns trips whose window overlaps and excludes past trips', () => {
    const overlapping = vac({ id: 'a', startDate: '2026-08-10', endDate: '2026-08-20' });
    const disjoint = vac({ id: 'b', startDate: '2026-09-01', endDate: '2026-09-05' });
    const past = vac({ id: 'c', startDate: '2026-05-01', endDate: '2026-05-05' });
    const matches = tripsOverlappingRange(
      [overlapping, disjoint, past],
      { start: '2026-08-12', end: '2026-08-16' },
      TODAY
    );
    expect(matches.map((m) => m.id)).toEqual(['a']);
  });

  it('tripsOverlappingRange skips trips with no start date', () => {
    const noDates = vac({ id: 'a', startDate: undefined, endDate: undefined });
    expect(
      tripsOverlappingRange([noDates], { start: '2026-08-12', end: '2026-08-16' }, TODAY)
    ).toHaveLength(0);
  });

  it('resolveTripTarget: 0 → create, 1 → attach, 2+ → choose', () => {
    expect(resolveTripTarget([])).toEqual({ kind: 'create' });
    expect(resolveTripTarget([vac({ id: 'x' })])).toEqual({ kind: 'attach', vacationId: 'x' });
    const two = [vac({ id: 'x' }), vac({ id: 'y' })];
    expect(resolveTripTarget(two)).toEqual({ kind: 'choose', candidates: two });
  });

  it('overrideTripTarget: pins to the pre-selected trip when it exists', () => {
    const trips = [vac({ id: 'open' }), vac({ id: 'other' })];
    expect(overrideTripTarget({ kind: 'create' }, 'open', trips)).toEqual({
      kind: 'attach',
      vacationId: 'open',
    });
  });

  it('overrideTripTarget: falls back to the original target when no trip pre-selected', () => {
    const original = resolveTripTarget([]);
    expect(overrideTripTarget(original, null, [vac({ id: 'x' })])).toEqual(original);
  });

  it('overrideTripTarget: falls back when the pre-selected trip no longer exists', () => {
    const original = { kind: 'attach', vacationId: 'matched' } as const;
    expect(overrideTripTarget(original, 'deleted', [vac({ id: 'matched' })])).toEqual(original);
  });
});

describe('tripBadge', () => {
  const TODAY = '2026-06-10';
  const trip = (startDate?: string, endDate?: string) =>
    ({ startDate, endDate, tripType: 'fly_and_stay', tripPurpose: 'vacation' }) as never;

  it('shows a countdown for an upcoming trip', () => {
    expect(tripBadge(trip('2026-06-20', '2026-06-25'), TODAY)).toMatchObject({
      kind: 'countdown',
      days: 10,
    });
  });

  it('says the trip starts today', () => {
    expect(tripBadge(trip('2026-06-10', '2026-06-15'), TODAY)).toEqual({
      kind: 'status',
      textKey: 'vacation.startsToday',
    });
  });

  it('shows day-of-trip progress for an ongoing trip, NOT "completed"', () => {
    // The bug: the travel page derived "completed" from days-until-START, so a
    // trip that had begun read as finished while the family was still on it.
    expect(tripBadge(trip('2026-06-08', '2026-06-14'), TODAY)).toEqual({
      kind: 'status',
      textKey: 'vacation.dayOfTrip',
      params: { n: 3, total: 7 },
    });
  });

  it('falls back to "now" for an ongoing trip whose progress cannot be computed', () => {
    // startDate in the past, no endDate -> phase 'ongoing', tripDayProgress null.
    expect(tripBadge(trip('2026-06-08', undefined), TODAY)).toEqual({
      kind: 'status',
      textKey: 'vacation.onNow',
    });
  });

  it('shows completed only once the trip has ended', () => {
    expect(tripBadge(trip('2026-06-01', '2026-06-09'), TODAY)).toEqual({ kind: 'completed' });
  });

  it('shows no badge when there is no start date', () => {
    // Load-bearing: without the guard, daysBetween would call
    // extractDatePart(undefined) and throw.
    expect(tripBadge(trip(undefined, undefined), TODAY)).toBeNull();
  });

  it('shows no badge for a malformed start date, never "NaN"', () => {
    // Junk sorts after an ISO date, so tripPhase says 'upcoming' and daysBetween
    // returns NaN. NaN <= 0 is false, so only the finite check stops a "NaN" chip.
    expect(tripBadge(trip('garbage', undefined), TODAY)).toBeNull();
  });
});

// The two title/label fixes (2026-09-15). Translating a name to a code is the MODEL's job now
// (see TRAVEL_JSON_SHAPE); these only cover what the app does with whatever it was given.
// docs/plans/2026-09-15-airport-airline-code-normalization.md
describe('buildTravelSegmentTitle — flights', () => {
  const flight = (departureAirport?: string, arrivalAirport?: string) =>
    buildTravelSegmentTitle({ type: 'flight_outbound', departureAirport, arrivalAirport });

  it('titles from the codes the model now returns', () => {
    expect(flight('SIN', 'JFK')).toBe('SIN → JFK');
  });

  it('titles from the picker shape', () => {
    expect(flight('Singapore (SIN)', 'Tokyo (HND)')).toBe('SIN → HND');
  });

  it('still reads a PARENTHESIZED code with trailing text after it', () => {
    // A terminal used to be appended into the airport field, and pre-prompt segments still hold
    // that shape.
    expect(flight('Sydney (SYD) Terminal 1', 'Tokyo (HND) Japan')).toBe('SYD → HND');
  });

  it('renders a bare code with trailing text verbatim — the accepted trade-off', () => {
    // A leading-bare-code rung would shorten this to "SIN → JFK", and that rung is precisely
    // what turned "LOS ANGELES (LAX)" into Lagos. Verbose but true beats short and possibly
    // false, so this stays long rather than earning back a rung with a wrong-airport failure
    // mode. The full value is shown in the detail row either way.
    expect(flight('SIN Terminal 3', 'JFK International Airport')).toBe(
      'SIN Terminal 3 → JFK International Airport'
    );
  });

  it('reads the code out of an ALL-CAPS name, not the first word', () => {
    // GDS/e-ticket text is overwhelmingly all-caps, and a leading-bare-code rung placed before
    // the parenthesized one turned these into LOS (Lagos), SAN (San Diego) and ABU (Atambua).
    expect(flight('LOS ANGELES (LAX)', 'SIN')).toBe('LAX → SIN');
    expect(flight('SAN FRANCISCO (SFO)', 'SIN')).toBe('SFO → SIN');
    expect(flight('ABU DHABI (AUH)', 'SIN')).toBe('AUH → SIN');
    expect(flight('NEW YORK (JFK)', 'SIN')).toBe('JFK → SIN');
  });

  it('renders an all-caps name with no code verbatim rather than guessing', () => {
    expect(flight('LOS ANGELES', 'SIN')).toBe('LOS ANGELES → SIN');
  });

  it('never turns a forbidden placeholder into an airport', () => {
    // UNK is Unalakleet and NAN is Nadi, so a placeholder reaching a lookup would name a real
    // airport in the wrong hemisphere. Both shapes must be refused.
    expect(flight('TBA', 'SIN')).toBe('TBA → SIN');
    expect(flight('Somewhere (TBA)', 'SIN')).toBe('Somewhere (TBA) → SIN');
    expect(flight('UNK', 'SIN')).toBe('UNK → SIN');
  });

  it('renders a NAME in full rather than its first word — the defect', () => {
    // Was 'Singapore → John'. A name only reaches here when the model could not identify the
    // airport, or the segment predates the prompt asking for a code.
    expect(flight('Singapore Changi Airport', 'John F. Kennedy International Airport')).toBe(
      'Singapore Changi Airport → John F. Kennedy International Airport'
    );
  });

  it('falls back to a generic title with no airports', () => {
    expect(flight(undefined, undefined)).toBe('outbound flight');
  });
});

describe('flightCodeLabel', () => {
  it('prints the carrier beside a plain flight number', () => {
    expect(flightCodeLabel('China Eastern (MU)', '5678')).toBe('MU 5678');
    expect(flightCodeLabel('MU', '5678')).toBe('MU 5678');
  });

  it('never prints the carrier twice', () => {
    expect(flightCodeLabel('Singapore Airlines (SQ)', 'SQ25')).toBe('SQ25');
    expect(flightCodeLabel('SQ', 'SQ25')).toBe('SQ25');
    expect(flightCodeLabel('Emirates (EK)', 'EK')).toBe('EK');
    expect(flightCodeLabel('Singapore Airlines (SQ)', 'SQ-25')).toBe('SQ-25');
    expect(flightCodeLabel('Singapore Airlines (SQ)', 'SQ 25')).toBe('SQ 25');
    expect(flightCodeLabel('Delta (DL)', 'DL 00123')).toBe('DL 00123');
  });

  it('keeps the airline when the flight-number field holds something else', () => {
    // Equipment codes must not swallow the carrier. The second case is the one a bare prefix
    // test got wrong: "AT" is a real carrier code and "ATR72" starts with it.
    expect(flightCodeLabel('Singapore Airlines (SQ)', 'E190')).toBe('SQ E190');
    expect(flightCodeLabel('Royal Air Maroc (AT)', 'ATR72')).toBe('AT ATR72');
    expect(flightCodeLabel('British Airways (BA)', 'BAW117')).toBe('BA BAW117');
    // …and identically for the BARE code, which is the mainline shape after the prompt change.
    // Guarding only the parenthesized branch left these three dropping the carrier.
    expect(flightCodeLabel('SQ', 'E190')).toBe('SQ E190');
    expect(flightCodeLabel('LH', 'A380')).toBe('LH A380');
    expect(flightCodeLabel('AT', 'ATR72')).toBe('AT ATR72');
  });

  it('collapses a bare code the flight number already names', () => {
    // "EK" + "EK" printed "EK EK" — the exact defect this function exists to prevent — because
    // the bare path could not reach the collapse rule.
    expect(flightCodeLabel('EK', 'EK')).toBe('EK');
    expect(flightCodeLabel('SQ', 'SQ25')).toBe('SQ25');
  });

  it('reads the code out of the LAST paren group', () => {
    expect(flightCodeLabel('ANA (All Nippon Airways) (NH)', 'NH820')).toBe('NH820');
    expect(flightCodeLabel('ANA (All Nippon Airways) (NH)', '820')).toBe('NH 820');
  });

  it('prefers a self-describing flight number over a paren-less airline NAME', () => {
    // The prompt's not-confident fallback returns a name. Printing it in full beside a number
    // that already names the carrier is just long — this was "Singapore Airlines SQ25".
    expect(flightCodeLabel('Singapore Airlines', 'SQ25')).toBe('SQ25');
    expect(flightCodeLabel('Beanstalk Air', 'BN220')).toBe('BN220');
    // …but a number with no designator still needs the name beside it.
    expect(flightCodeLabel('China Eastern', '5678')).toBe('China Eastern 5678');
  });

  it('collapses an undecidable carrier-vs-equipment collision, by documented choice', () => {
    // "A3" + digits is exactly the shape of a real Aegean flight number, so the flightNumber
    // field is read as one. travelDetailRows still shows the airline in full.
    expect(flightCodeLabel('Aegean Airlines (A3)', 'A320')).toBe('A320');
  });

  it('renders a flight number with no airline, which used to vanish', () => {
    expect(flightCodeLabel(undefined, 'SQ25')).toBe('SQ25');
    expect(flightCodeLabel(undefined, '5678')).toBe('5678');
  });

  it('renders the carrier alone with no flight number', () => {
    expect(flightCodeLabel('Singapore Airlines (SQ)', undefined)).toBe('SQ');
  });

  it('is empty when it has nothing to say', () => {
    expect(flightCodeLabel(undefined, undefined)).toBe('');
  });
});

// code -> readable label. The SAFE direction: code→entry is 1:1 and exact, unlike the name→code
// resolver that was built for this feature, measured, and deleted.
describe('airportLabel / airlineLabel', () => {
  it('expands a bare code to the shape the dropdown shows', () => {
    expect(airportLabel('SIN')).toBe('Singapore (SIN)');
    expect(airportLabel('JFK')).toBe('New York (JFK)');
    expect(airlineLabel('SQ')).toBe('Singapore Airlines (SQ)');
  });

  it('matches buildAirportOptions byte-for-byte, so the two cannot drift', () => {
    const option = buildAirportOptions().find((o) => o.value.endsWith('(SIN)'));
    expect(option).toBeDefined();
    expect(airportLabel('SIN')).toBe(option!.value);
    const airline = buildAirlineOptions().find((o) => o.value.endsWith('(SQ)'));
    expect(airlineLabel('SQ')).toBe(airline!.value);
  });

  it('leaves a value that already carries text exactly as stored', () => {
    // Expanding these would discard what the document said.
    expect(airportLabel('Singapore (SIN)')).toBe('Singapore (SIN)');
    expect(airportLabel('Sydney (SYD) Terminal 1')).toBe('Sydney (SYD) Terminal 1');
    expect(airportLabel('John F. Kennedy International Airport')).toBe(
      'John F. Kennedy International Airport'
    );
    expect(airlineLabel('Juneyao Airlines')).toBe('Juneyao Airlines');
  });

  it('still resolves a RETIRED code, so a trip saved before the code moved keeps reading right', () => {
    // PBI left the upstream dataset in Sept 2026 when West Palm Beach was reassigned to DJT.
    // A family with a PBI flight already saved must not watch it decay into bare 'PBI'.
    const retired = AIRPORTS.filter((a) => a.retired);
    expect(retired.length).toBeGreaterThan(0);
    for (const a of retired.slice(0, 5)) {
      expect(airportLabel(a.code)).toBe(`${a.city} (${a.code})`);
    }
  });

  it('never OFFERS a retired code in the picker, because it is gone or now means somewhere else', () => {
    const offered = new Set(buildAirportOptions().map((o) => o.value));
    for (const a of AIRPORTS.filter((x) => x.retired)) {
      expect(offered.has(`${a.city} (${a.code})`)).toBe(false);
    }
    // ...and the live ones are all still there, so the filter cannot quietly empty the list.
    const live = AIRPORTS.filter((a) => !a.retired);
    expect(buildAirportOptions()).toHaveLength(live.length);
  });

  it('never expands a forbidden placeholder into a real place', () => {
    // UNK is Unalakleet, Alaska — a real row, and the single most likely "unknown" placeholder a
    // model would emit. Blocked, at the cost of one tiny airport being unreachable by its code.
    expect(airportLabel('UNK')).toBe('UNK');
    expect(airportLabel('TBA')).toBe('TBA');
    expect(airportLabel('TBD')).toBe('TBD');
  });

  it('does NOT block a real destination that merely looks like garbage', () => {
    // NAN is Nadi, Fiji. It resembles JavaScript's NaN, but it is a genuine family destination
    // and an unlikely model placeholder, so the denylist deliberately stops short of it. The
    // line is drawn at tokens that read as "I do not know", not at anything code-shaped.
    expect(airportLabel('NAN')).toBe('Nadi (NAN)');
  });

  it('keeps an unlisted code as-is', () => {
    expect(airlineLabel('HO')).toBe('HO'); // Juneyao is not in the 135-entry list
    expect(airportLabel('ZZQ')).toBe('ZZQ');
  });

  it('is empty-safe and idempotent', () => {
    expect(airportLabel(undefined)).toBe('');
    expect(airportLabel('  ')).toBe('');
    expect(airportLabel(airportLabel('SIN'))).toBe('Singapore (SIN)');
  });
});
