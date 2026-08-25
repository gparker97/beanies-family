import { describe, it, expect } from 'vitest';
import { segmentIdentityKey, mergeNotes, mergeExtractedIntoVacation } from '@/utils/segmentMerge';
import type { SegmentBuckets } from '@/utils/travelExtractionToSegments';
import type {
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
} from '@/types/models';

function flight(over: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'f1',
    type: 'flight_outbound',
    title: 'SIN → HND',
    status: 'booked',
    airline: 'Singapore Airlines',
    flightNumber: 'SQ318',
    departureAirport: 'SIN',
    arrivalAirport: 'HND',
    departureDate: '2026-08-12',
    departureTime: '09:00',
    ...over,
  };
}

function buckets(over: Partial<SegmentBuckets> = {}): SegmentBuckets {
  return { travelSegments: [], accommodations: [], transportation: [], ...over };
}

describe('segmentIdentityKey', () => {
  it('matches two flights with the same flight number + departure date', () => {
    const a = segmentIdentityKey(flight(), 'travel');
    const b = segmentIdentityKey(
      flight({ id: 'f2', airline: 'SQ', departureTime: '09:15' }),
      'travel'
    );
    expect(a).not.toBeNull();
    expect(a).toBe(b); // airline/time differ but identity holds
  });
  it('separates flights with a different number or date', () => {
    const base = segmentIdentityKey(flight(), 'travel');
    expect(segmentIdentityKey(flight({ flightNumber: 'SQ319' }), 'travel')).not.toBe(base);
    expect(segmentIdentityKey(flight({ departureDate: '2026-08-13' }), 'travel')).not.toBe(base);
  });
  it('shares a key across flight subtypes (same flight)', () => {
    expect(segmentIdentityKey(flight({ type: 'flight_return' }), 'travel')).toBe(
      segmentIdentityKey(flight(), 'travel')
    );
  });
  it('returns null for a flight with no flight number', () => {
    expect(segmentIdentityKey(flight({ flightNumber: '' }), 'travel')).toBeNull();
  });
  it('returns null for car and activity (no reliable key)', () => {
    expect(segmentIdentityKey(flight({ type: 'car' }), 'travel')).toBeNull();
    expect(segmentIdentityKey(flight({ type: 'activity' }), 'travel')).toBeNull();
  });
  it('keys accommodation on name + check-in', () => {
    const acc = {
      type: 'hotel',
      name: 'Park Hyatt',
      checkInDate: '2026-08-12',
    } as VacationAccommodation;
    expect(segmentIdentityKey(acc, 'accommodation')).not.toBeNull();
    expect(segmentIdentityKey({ ...acc, name: 'Hilton' }, 'accommodation')).not.toBe(
      segmentIdentityKey(acc, 'accommodation')
    );
  });
  it('keys rental_car but not taxi/shuttle', () => {
    const car = {
      type: 'rental_car',
      agencyName: 'Hertz',
      pickupDate: '2026-08-12',
    } as VacationTransportation;
    expect(segmentIdentityKey(car, 'transportation')).not.toBeNull();
    expect(segmentIdentityKey({ ...car, type: 'taxi_rideshare' }, 'transportation')).toBeNull();
  });
});

describe('mergeNotes', () => {
  it('appends new lines, deduped, dropping blanks', () => {
    expect(mergeNotes('Seat 1A', 'Seat 1A\nBaggage 30kg\n')).toBe('Seat 1A\nBaggage 30kg');
  });
  it('returns undefined when empty', () => {
    expect(mergeNotes(undefined, undefined)).toBeUndefined();
  });
});

describe('mergeExtractedIntoVacation', () => {
  it('merges a matching flight: union travellers, no duplicate, id-remap to existing', () => {
    const existing = buckets({ travelSegments: [flight({ id: 'EX', travellerIds: ['dad'] })] });
    const incoming = buckets({ travelSegments: [flight({ id: 'IN', travellerIds: ['mum'] })] });
    const { merged, idRemap } = mergeExtractedIntoVacation(existing, incoming);
    expect(merged.travelSegments).toHaveLength(1);
    expect(merged.travelSegments[0].id).toBe('EX');
    expect(merged.travelSegments[0].travellerIds).toEqual(['dad', 'mum']);
    expect(idRemap).toEqual({ IN: 'EX' });
  });

  it('newer document wins on a conflicting field, keeps existing where incoming is empty', () => {
    const existing = buckets({ travelSegments: [flight({ id: 'EX', departureTime: '09:00' })] });
    const incoming = buckets({
      travelSegments: [flight({ id: 'IN', departureTime: '09:15', airline: '' })],
    });
    const seg = mergeExtractedIntoVacation(existing, incoming).merged.travelSegments[0];
    expect(seg.departureTime).toBe('09:15'); // newer wins
    expect(seg.airline).toBe('Singapore Airlines'); // incoming empty → keep existing
  });

  it('preserves type / status / sortDate (a return-flight doc cannot flip the bucket)', () => {
    const existing = buckets({
      travelSegments: [
        flight({ id: 'EX', type: 'flight_outbound', status: 'booked', sortDate: '2026-08-12' }),
      ],
    });
    const incoming = buckets({
      travelSegments: [flight({ id: 'IN', type: 'flight_return', status: 'pending' })],
    });
    const seg = mergeExtractedIntoVacation(existing, incoming).merged.travelSegments[0];
    expect(seg.type).toBe('flight_outbound');
    expect(seg.status).toBe('booked');
    expect(seg.sortDate).toBe('2026-08-12'); // re-derived from departureDate
  });

  it('preserves a true boolean when the newer doc omits it', () => {
    const existing = buckets({ travelSegments: [flight({ id: 'EX', arrivesNextDay: true })] });
    const incoming = buckets({ travelSegments: [flight({ id: 'IN' })] }); // no arrivesNextDay
    const seg = mergeExtractedIntoVacation(existing, incoming).merged.travelSegments[0];
    expect(seg.arrivesNextDay).toBe(true);
  });

  it('appends seat-assignment notes deduped', () => {
    const existing = buckets({ travelSegments: [flight({ id: 'EX', notes: 'Seat 1A' })] });
    const incoming = buckets({ travelSegments: [flight({ id: 'IN', notes: 'Seat 1A\nSeat 2B' })] });
    const seg = mergeExtractedIntoVacation(existing, incoming).merged.travelSegments[0];
    expect(seg.notes).toBe('Seat 1A\nSeat 2B');
  });

  it('keeps an everyone-segment as everyone when adding a person', () => {
    const existing = buckets({ travelSegments: [flight({ id: 'EX', travellerIds: undefined })] });
    const incoming = buckets({ travelSegments: [flight({ id: 'IN', travellerIds: ['mum'] })] });
    const seg = mergeExtractedIntoVacation(existing, incoming).merged.travelSegments[0];
    expect(seg.travellerIds).toBeUndefined();
  });

  it('appends a non-matching flight as a new segment', () => {
    const existing = buckets({ travelSegments: [flight({ id: 'EX' })] });
    const incoming = buckets({ travelSegments: [flight({ id: 'IN', flightNumber: 'SQ999' })] });
    const { merged, idRemap } = mergeExtractedIntoVacation(existing, incoming);
    expect(merged.travelSegments).toHaveLength(2);
    expect(idRemap).toEqual({ IN: 'IN' });
  });

  it('always appends a car (null identity key)', () => {
    const car = flight({ id: 'EX', type: 'car' });
    const existing = buckets({ travelSegments: [car] });
    const incoming = buckets({ travelSegments: [flight({ id: 'IN', type: 'car' })] });
    const { merged, idRemap } = mergeExtractedIntoVacation(existing, incoming);
    expect(merged.travelSegments).toHaveLength(2);
    expect(idRemap).toEqual({ IN: 'IN' });
  });

  it('is idempotent on re-upload of the same document', () => {
    const existing = buckets({
      travelSegments: [flight({ id: 'EX', notes: 'Seat 1A', travellerIds: ['dad'] })],
    });
    const incoming = buckets({
      travelSegments: [flight({ id: 'IN', notes: 'Seat 1A', travellerIds: ['dad'] })],
    });
    const once = mergeExtractedIntoVacation(existing, incoming).merged;
    const twice = mergeExtractedIntoVacation(once, incoming).merged;
    expect(twice.travelSegments).toHaveLength(1);
    expect(twice.travelSegments[0].notes).toBe('Seat 1A');
    expect(twice.travelSegments[0].travellerIds).toEqual(['dad']);
  });

  it('merges into the FIRST of two existing segments that share a key (collision)', () => {
    const existing = buckets({
      travelSegments: [flight({ id: 'EX1' }), flight({ id: 'EX2' })],
    });
    const incoming = buckets({ travelSegments: [flight({ id: 'IN', travellerIds: ['mum'] })] });
    const { merged, idRemap } = mergeExtractedIntoVacation(existing, incoming);
    expect(merged.travelSegments).toHaveLength(2);
    expect(idRemap).toEqual({ IN: 'EX1' });
  });
});

describe('identity keys must not collide for two bookings at one place', () => {
  // The very ordinary case this missed: a family books two rooms at one hotel for the same
  // night. Keyed on (name + check-in) the second upload folded into the first, its
  // confirmation number overwrote the other's, and the second booking was never created —
  // so a reference the family needs at check-in was silently destroyed.
  const acc = (over: Record<string, unknown>) =>
    ({ id: 'a', type: 'hotel', name: 'Hilton Paris', checkInDate: '2026-07-14', ...over }) as never;

  it('separates two rooms at the same hotel on the same day', () => {
    const a = segmentIdentityKey(acc({ confirmationNumber: 'ABC123' }), 'accommodation');
    const b = segmentIdentityKey(acc({ confirmationNumber: 'XYZ789' }), 'accommodation');
    expect(a).not.toBe(b);
    expect(a).toBeTruthy();
  });

  it('still merges a re-upload of the SAME booking', () => {
    const a = segmentIdentityKey(acc({ confirmationNumber: 'ABC123' }), 'accommodation');
    const b = segmentIdentityKey(acc({ confirmationNumber: 'ABC123' }), 'accommodation');
    expect(a).toBe(b);
  });

  it('falls back to the date when no confirmation number is present', () => {
    const a = segmentIdentityKey(acc({}), 'accommodation');
    const b = segmentIdentityKey(acc({}), 'accommodation');
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });
});
