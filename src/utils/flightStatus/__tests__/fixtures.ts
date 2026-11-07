/**
 * Test fixtures for the live flight check utils and store (#143): a provider leg, a booked
 * flight segment and a cached check, each with overridable parts. Invented values only (no
 * real booking data, memory `feedback_no_real_pii_in_fixtures`).
 */
import type { FlightCheck, FlightLeg } from '@/types/flightStatus';
import type { VacationTravelSegment } from '@/types/models';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';

/** The English translator, as the stores pass `useTranslationStore().t`. */
export const t = (k: UIStringKey): string => UI_STRINGS[k];

export function makeLeg(over: {
  number?: string;
  status?: string;
  dep?: Partial<FlightLeg['departure']>;
  arr?: Partial<FlightLeg['arrival']>;
  airline?: FlightLeg['airline'];
}): FlightLeg {
  return {
    number: over.number ?? 'SQ 318',
    airline: over.airline ?? { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA' },
    status: over.status ?? 'Expected',
    codeshareStatus: 'IsOperator',
    isCargo: false,
    departure: {
      iata: 'SIN',
      scheduledLocal: '2026-12-13 17:00+08:00',
      scheduledUtc: '2026-12-13 09:00Z',
      terminal: '2',
      quality: ['Basic'],
      ...over.dep,
    },
    arrival: {
      iata: 'LHR',
      scheduledLocal: '2026-12-13 23:10+00:00',
      scheduledUtc: '2026-12-13 23:10Z',
      quality: ['Basic'],
      ...over.arr,
    },
  };
}

/** The booking that matches `makeLeg()` exactly. */
export function makeFlight(over: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'seg-1',
    type: 'flight_outbound',
    title: 'Singapore to London',
    status: 'booked',
    airline: 'Singapore Airlines (SQ)',
    flightNumber: 'SQ318',
    departureAirport: 'Singapore (SIN)',
    arrivalAirport: 'London Heathrow (LHR)',
    departureDate: '2026-12-13',
    departureTime: '17:00',
    terminal: 'Terminal 2',
    arrivalDate: '2026-12-13',
    arrivalTime: '23:10',
    ...over,
  };
}

export function makeCheck(leg: FlightLeg | null, over: Partial<FlightCheck> = {}): FlightCheck {
  return {
    v: 1,
    segmentId: 'seg-1',
    flight: 'SQ318',
    date: '2026-12-13',
    checkedAt: Date.parse('2026-12-12T08:48:00Z'),
    leg,
    match: leg ? 'deterministic' : 'none',
    ...(leg ? {} : { miss: 'no_match' as const }),
    ...over,
  };
}
