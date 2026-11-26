import { describe, expect, it } from 'vitest';
import type { VacationTravelSegment } from '@/types/models';
import { homecomingTravellers } from '../homecoming';

const TRIP = ['mum', 'dad', 'kid'];

function seg(
  id: string,
  type: VacationTravelSegment['type'],
  from: string | undefined,
  to: string | undefined,
  date: string | undefined,
  over: Partial<VacationTravelSegment> = {}
): VacationTravelSegment {
  return {
    id,
    type,
    title: '',
    status: 'booked',
    departureAirport: from,
    arrivalAirport: to,
    departureDate: date,
    departureTime: '09:00',
    ...over,
  };
}

/** The rule's answer as a plain object, segment id → sorted travellers. */
function home(segments: VacationTravelSegment[], trip: string[] = TRIP): Record<string, string[]> {
  return Object.fromEntries(
    [...homecomingTravellers(segments, trip)].map(([id, ids]) => [id, [...ids].sort()])
  );
}

describe('homecomingTravellers: the round trip', () => {
  it('SIN → LHR, LHR → SIN: only the second flight is the way home', () => {
    const out = seg('out', 'flight_other', 'Singapore (SIN)', 'LHR', '2026-12-01');
    const back = seg('back', 'flight_other', 'LHR', 'Singapore (SIN)', '2026-12-13');
    expect(home([out, back])).toEqual({ back: ['dad', 'kid', 'mum'] });
  });

  it('a connection home: only the last leg', () => {
    const out = seg('out', 'flight_other', 'SIN', 'LHR', '2026-12-01');
    const leg1 = seg('leg1', 'flight_other', 'LHR', 'DXB', '2026-12-13');
    const leg2 = seg('leg2', 'flight_other', 'DXB', 'SIN', '2026-12-14');
    expect(home([out, leg1, leg2])).toEqual({ leg2: ['dad', 'kid', 'mum'] });
  });

  it('airport codes are compared case-insensitively', () => {
    const out = seg('out', 'flight_other', 'sin', 'LHR', '2026-12-01');
    const back = seg('back', 'flight_other', 'LHR', 'Singapore (SIN)', '2026-12-13');
    expect(Object.keys(home([out, back]))).toEqual(['back']);
  });

  it('works on unsorted input, ordered by departure date then time', () => {
    const back = seg('back', 'flight_other', 'LHR', 'SIN', '2026-12-13');
    const out = seg('out', 'flight_other', 'SIN', 'LHR', '2026-12-01');
    expect(Object.keys(home([back, out]))).toEqual(['back']);
    // Same day: the later time is the last flight ("9:05" before "18:30").
    const early = seg('early', 'flight_other', 'SIN', 'KUL', '2026-12-01', {
      departureTime: '9:05',
    });
    const late = seg('late', 'flight_other', 'KUL', 'SIN', '2026-12-01', {
      departureTime: '18:30',
    });
    expect(Object.keys(home([late, early]))).toEqual(['late']);
  });
});

describe('homecomingTravellers: the segment type decides when the airports cannot', () => {
  it('a traveller’s only flight is their way home whatever its type (one-way is always typed outbound)', () => {
    expect(Object.keys(home([seg('a', 'flight_outbound', 'LHR', 'SIN', '2026-12-01')]))).toEqual([
      'a',
    ]);
    expect(Object.keys(home([seg('a', 'flight_return', 'LHR', 'SIN', '2026-12-01')]))).toEqual([
      'a',
    ]);
    expect(Object.keys(home([seg('a', 'flight_other', 'LHR', 'SIN', '2026-12-01')]))).toEqual([
      'a',
    ]);
  });

  it('a last flight typed return that lands somewhere else is still the way home', () => {
    const out = seg('out', 'flight_outbound', 'SIN', 'LHR', '2026-12-01');
    const back = seg('back', 'flight_return', 'LHR', 'KUL', '2026-12-13');
    expect(Object.keys(home([out, back]))).toEqual(['back']);
  });

  it('two flights that do not come back, neither typed return: none', () => {
    const a = seg('a', 'flight_other', 'SIN', 'LHR', '2026-12-01');
    const b = seg('b', 'flight_other', 'LHR', 'JFK', '2026-12-05');
    expect(home([a, b])).toEqual({});
  });

  it('a last flight typed outbound that lands where the trip began is still the way home', () => {
    const a = seg('a', 'flight_outbound', 'SIN', 'LHR', '2026-12-01');
    const b = seg('b', 'flight_outbound', 'LHR', 'SIN', '2026-12-05');
    expect(Object.keys(home([a, b]))).toEqual(['b']);
  });
});

describe('homecomingTravellers: missing and name-only airports', () => {
  it('missing airports never match each other; the type decides', () => {
    const a = seg('a', 'flight_other', undefined, 'LHR', '2026-12-01');
    const b = seg('b', 'flight_other', 'LHR', undefined, '2026-12-05');
    expect(home([a, b])).toEqual({});
    const c = seg('c', 'flight_other', undefined, undefined, '2026-12-01');
    const d = seg('d', 'flight_other', undefined, undefined, '2026-12-05');
    expect(home([c, d])).toEqual({});
  });

  it('name-only airports match only when typed the same (case aside)', () => {
    const a = seg('a', 'flight_other', 'Changi', 'Heathrow', '2026-12-01');
    const b = seg('b', 'flight_other', 'Heathrow', 'changi', '2026-12-05');
    expect(Object.keys(home([a, b]))).toEqual(['b']);
    const c = seg('c', 'flight_other', 'Changi', 'Heathrow', '2026-12-01');
    const d = seg('d', 'flight_other', 'Heathrow', 'Singapore Changi', '2026-12-05');
    expect(home([c, d])).toEqual({});
  });

  it('a flight with no departure date is left out of the order', () => {
    const out = seg('out', 'flight_outbound', 'SIN', 'LHR', '2026-12-01');
    const undated = seg('undated', 'flight_return', 'LHR', 'SIN', undefined);
    // The undated return still counts as one of their flights, so the outbound is not
    // "their only flight", and it does not land where the trip began: nobody's way home.
    expect(home([out, undated])).toEqual({});
  });

  it('a traveller with an undated flight gets no flight home: it could come after the others', () => {
    const out = seg('out', 'flight_outbound', 'SIN', 'LHR', '2026-12-01');
    const back = seg('back', 'flight_return', 'LHR', 'SIN', '2026-12-05');
    const later = seg('later', 'flight_other', 'SIN', 'KUL', undefined);
    expect(home([out, back, later])).toEqual({});
  });
});

describe('homecomingTravellers: per member', () => {
  it('travellers on different flights each get their own flight home', () => {
    const allOut = seg('out', 'flight_other', 'SIN', 'LHR', '2026-12-01');
    const mumBack = seg('mumBack', 'flight_other', 'LHR', 'SIN', '2026-12-08', {
      travellerIds: ['mum'],
    });
    const restBack = seg('restBack', 'flight_other', 'LHR', 'SIN', '2026-12-13', {
      travellerIds: ['dad', 'kid'],
    });
    expect(home([allOut, mumBack, restBack])).toEqual({
      mumBack: ['mum'],
      restBack: ['dad', 'kid'],
    });
  });

  it('a member on a single flight of a longer trip: rule 3 for them alone', () => {
    const out = seg('out', 'flight_other', 'SIN', 'LHR', '2026-12-01');
    const back = seg('back', 'flight_other', 'LHR', 'SIN', '2026-12-13', {
      travellerIds: ['mum', 'dad'],
    });
    // The kid flies out only (other, single): that flight is the kid's way home by rule 3.
    expect(home([out, back])).toEqual({ out: ['kid'], back: ['dad', 'mum'] });
  });

  it('an empty traveller list belongs to nobody and is left out of every list', () => {
    const out = seg('out', 'flight_other', 'SIN', 'LHR', '2026-12-01');
    const ghost = seg('ghost', 'flight_return', 'LHR', 'KUL', '2026-12-20', { travellerIds: [] });
    const back = seg('back', 'flight_other', 'LHR', 'SIN', '2026-12-13');
    expect(home([out, ghost, back])).toEqual({ back: ['dad', 'kid', 'mum'] });
  });

  it('non-flights are ignored', () => {
    const out = seg('out', 'flight_outbound', 'SIN', 'LHR', '2026-12-01');
    const train = seg('train', 'train', 'LHR', 'SIN', '2026-12-13');
    const cruise = seg('cruise', 'cruise', 'LHR', 'SIN', '2026-12-14');
    // The train and the cruise are not flights: the flight is each traveller's only one, and
    // nothing but it gets an entry.
    expect(Object.keys(home([out, train, cruise]))).toEqual(['out']);
  });

  it('a trip with no travellers has no flight home', () => {
    expect(home([seg('a', 'flight_return', 'LHR', 'SIN', '2026-12-01')], [])).toEqual({});
  });
});
