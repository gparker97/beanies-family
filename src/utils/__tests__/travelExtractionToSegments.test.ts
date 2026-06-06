import { describe, it, expect, vi, afterEach } from 'vitest';
import { travelExtractionToSegments, inferTripType } from '../travelExtractionToSegments';
import { parseTravelExtractionResult } from '@/services/ai/extractionPrompt';
import type { TravelExtractionResult, TravelSegmentDraft } from '@/services/ai/types';

function draft(over: Partial<TravelSegmentDraft> = {}): TravelSegmentDraft {
  return {
    kind: 'travel',
    type: 'flight_outbound',
    title: '',
    status: 'booked',
    bookingReference: '',
    notes: '',
    arrivesNextDay: false,
    breakfastIncluded: false,
    fields: {},
    confidence: 0.9,
    ...over,
  };
}

function result(
  segments: TravelSegmentDraft[],
  over: Partial<TravelExtractionResult> = {}
): TravelExtractionResult {
  return { isTravel: true, tripName: 'Tokyo Trip', tripTypeHint: '', segments, ...over };
}

describe('travelExtractionToSegments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps a flight draft into a travel segment with fields + derived title', () => {
    const r = result([
      draft({
        type: 'flight_outbound',
        fields: {
          departureAirport: 'Singapore (SIN)',
          arrivalAirport: 'Tokyo (HND)',
          departureDate: '2026-08-12',
          departureTime: '09:00',
          airline: 'SQ',
        },
        bookingReference: 'ABC123',
      }),
    ]);
    const { travelSegments } = travelExtractionToSegments(r);
    expect(travelSegments).toHaveLength(1);
    const seg = travelSegments[0];
    expect(seg.type).toBe('flight_outbound');
    expect(seg.departureAirport).toBe('Singapore (SIN)');
    expect(seg.departureDate).toBe('2026-08-12');
    expect(seg.bookingReference).toBe('ABC123');
    expect(seg.sortDate).toBe('2026-08-12');
    expect(seg.title).toBe('SIN → HND'); // derived
    expect(seg.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('maps an accommodation draft and keeps the model title', () => {
    const r = result([
      draft({
        kind: 'accommodation',
        type: 'hotel',
        title: 'Park Hyatt Tokyo',
        fields: {
          checkInDate: '2026-08-12',
          checkOutDate: '2026-08-16',
          confirmationNumber: 'H99',
        },
        breakfastIncluded: true,
      }),
    ]);
    const { accommodations } = travelExtractionToSegments(r);
    expect(accommodations).toHaveLength(1);
    expect(accommodations[0].title).toBe('Park Hyatt Tokyo');
    expect(accommodations[0].checkInDate).toBe('2026-08-12');
    expect(accommodations[0].breakfastIncluded).toBe(true);
  });

  it('maps a transportation draft', () => {
    const r = result([
      draft({
        kind: 'transportation',
        type: 'rental_car',
        fields: { agencyName: 'Hertz', pickupDate: '2026-08-12', returnDate: '2026-08-16' },
      }),
    ]);
    const { transportation } = travelExtractionToSegments(r);
    expect(transportation).toHaveLength(1);
    expect(transportation[0].type).toBe('rental_car');
    expect(transportation[0].agencyName).toBe('Hertz');
    expect(transportation[0].title).toBe('rental car — Hertz');
  });

  it('folds unmapped fields and the model notes into the segment notes (no data loss)', () => {
    const r = result([
      draft({
        type: 'flight_outbound',
        notes: 'Window seat',
        fields: { departureAirport: 'SIN', baggage: '30kg', seat: '12A' },
      }),
    ]);
    const seg = travelExtractionToSegments(r).travelSegments[0];
    expect(seg.notes).toContain('Window seat');
    expect(seg.notes).toContain('Baggage: 30kg'); // humanized label
    expect(seg.notes).toContain('Seat: 12A');
    // mapped field is NOT duplicated into notes
    expect(seg.notes).not.toContain('departureAirport');
  });

  it('coerces an unknown type to the safe per-kind default', () => {
    const r = result([draft({ kind: 'accommodation', type: 'bogus', title: 'Somewhere' })]);
    expect(travelExtractionToSegments(r).accommodations[0].type).toBe('hotel');
  });

  it('skips a draft with an unrecognized kind (warns, never throws)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Force an invalid kind past the type system.
    const bad = { ...draft(), kind: 'mystery' } as unknown as TravelSegmentDraft;
    const r = result([bad, draft({ kind: 'accommodation', type: 'hotel', title: 'Hotel' })]);
    const buckets = travelExtractionToSegments(r);
    expect(buckets.travelSegments).toHaveLength(0);
    expect(buckets.accommodations).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('generates a distinct id per segment', () => {
    const r = result([
      draft({ fields: { departureAirport: 'SIN' } }),
      draft({ type: 'flight_return', fields: { departureAirport: 'HND' } }),
    ]);
    const segs = travelExtractionToSegments(r).travelSegments;
    expect(segs[0].id).not.toBe(segs[1].id);
  });
});

describe('inferTripType', () => {
  it('uses a valid tripTypeHint as-is', () => {
    expect(inferTripType(result([], { tripTypeHint: 'camping' }))).toBe('camping');
  });

  it('ignores an invalid hint and infers from segments', () => {
    const r = result([draft({ kind: 'travel', type: 'cruise' })], { tripTypeHint: 'nonsense' });
    expect(inferTripType(r)).toBe('cruise');
  });

  it('returns fly_and_stay when there is a flight', () => {
    const r = result([draft({ type: 'flight_outbound' })]);
    expect(inferTripType(r)).toBe('fly_and_stay');
  });

  it('returns road_trip for transportation-only (no flight, no accommodation)', () => {
    const r = result([draft({ kind: 'transportation', type: 'rental_car' })]);
    expect(inferTripType(r)).toBe('road_trip');
  });

  it('defaults to fly_and_stay when undetermined', () => {
    const r = result([draft({ kind: 'accommodation', type: 'hotel' })]);
    expect(inferTripType(r)).toBe('fly_and_stay');
  });
});

// Regression for #30: the managed model nests detail fields under travelFields /
// accommodationFields / transportationFields. The parser must flatten them so the mapper
// populates the real columns (airline, flight number, airports, dates) instead of blanks.
describe('parseTravelExtractionResult → travelExtractionToSegments (nested *Fields shape)', () => {
  it('flattens nested travelFields into populated travel-segment columns', () => {
    const raw = {
      isTravel: true,
      tripName: 'Singapore to Shanghai Trip',
      tripTypeHint: 'fly_and_stay',
      segments: [
        {
          kind: 'travel',
          type: 'flight_outbound',
          title: 'June 20, 2026 - Singapore to Shanghai',
          status: 'booked',
          bookingReference: 'QJSRKE',
          notes: 'Economy class.',
          confidence: { overall: 0.95 },
          travelFields: {
            airline: 'Juneyao Airlines',
            flightNumber: 'HO1602',
            departureAirport: 'Singapore Changi Airport',
            arrivalAirport: 'Shanghai Pudong International Airport',
            departureDate: '2026-06-20',
            departureTime: '16:10',
            arrivalDate: '2026-06-20',
            arrivalTime: '21:30',
            terminal: 'Terminal 1',
            arrivesNextDay: false,
          },
        },
      ],
    };

    const parsed = parseTravelExtractionResult(raw);
    expect(parsed.segments[0].fields.airline).toBe('Juneyao Airlines');
    expect(parsed.segments[0].fields.flightNumber).toBe('HO1602');

    const seg = travelExtractionToSegments(parsed).travelSegments[0];
    expect(seg.airline).toBe('Juneyao Airlines');
    expect(seg.flightNumber).toBe('HO1602');
    expect(seg.departureAirport).toBe('Singapore Changi Airport');
    expect(seg.arrivalAirport).toBe('Shanghai Pudong International Airport');
    expect(seg.terminal).toBe('Terminal 1');
    expect(seg.departureTime).toBe('16:10');
    expect(seg.arrivalTime).toBe('21:30');
    expect(seg.sortDate).toBe('2026-06-20');
    expect(seg.bookingReference).toBe('QJSRKE');
    // structural keys must NOT leak into the notes overflow
    expect(seg.notes ?? '').not.toContain('flight_outbound');
    expect(seg.notes ?? '').not.toContain('QJSRKE');
  });

  it('reads arrivesNextDay / breakfastIncluded from the nested object', () => {
    const raw = {
      isTravel: true,
      tripName: 'Trip',
      tripTypeHint: '',
      segments: [
        {
          kind: 'travel',
          type: 'flight_other',
          title: '',
          status: 'booked',
          bookingReference: '',
          notes: '',
          confidence: { overall: 0.8 },
          travelFields: { departureAirport: 'SIN', arrivalAirport: 'LHR', arrivesNextDay: true },
        },
        {
          kind: 'accommodation',
          type: 'hotel',
          title: 'Hotel',
          status: 'booked',
          bookingReference: '',
          notes: '',
          confidence: { overall: 0.8 },
          accommodationFields: { name: 'Hotel', breakfastIncluded: true },
        },
      ],
    };
    const parsed = parseTravelExtractionResult(raw);
    const buckets = travelExtractionToSegments(parsed);
    expect(buckets.travelSegments[0].arrivesNextDay).toBe(true);
    expect(buckets.accommodations[0].breakfastIncluded).toBe(true);
  });
});
