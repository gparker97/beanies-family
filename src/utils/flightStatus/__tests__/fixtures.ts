/**
 * Test fixtures for the live flight check utils and store (#143): a provider leg, a booked
 * flight segment and a cached check, each with overridable parts. Invented values only (no
 * real booking data, memory `feedback_no_real_pii_in_fixtures`).
 */
import type { FlightCheck, FlightLeg, FlightVerification } from '@/types/flightStatus';
import type { VacationTravelSegment } from '@/types/models';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';
import { arrivalTerminalRecord, classifyDiff, liveRecordOf, revisionOf } from '../schedule';

/** The English translator, as the stores pass `useTranslationStore().t`. */
export const t = (k: UIStringKey): string => UI_STRINGS[k];

/** A provider leg. Deliberately NO default arrival terminal: with one, every booking below
 *  (which holds none) would read as an arrival-terminal fill. A case that needs one passes
 *  `arr: { terminal }`. */
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

/** `leg` with the arrival terminal the airline publishes. */
export const withArrival = (leg: FlightLeg, terminal: string): FlightLeg => ({
  ...leg,
  arrival: { ...leg.arrival, terminal },
});

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

/** A cached check, asked beside a plan with no live record yet (`planRecord` of `{}`, what the
 *  store's `checkOne` remembers for a first answer). A case whose plan already carries live
 *  fields passes the `planRecord` it models, or `planRecord: undefined` for a pre-field check. */
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
    planRecord: liveRecordOf({}),
    ...over,
  };
}

/** Whether the plan already acted on the airline's answer: its revision (the five
 *  `REVISION_FIELDS`) and its arrival terminal are recorded separately (`classifyDiff`). */
export interface Recorded {
  revision: boolean;
  arrivalTerminal: boolean;
}

/**
 * A hand-built verification with the `diff` `deriveVerification` would carry: `classifyDiff`
 * itself, over a plan holding `v.mine` (SQ318) that has, or has not, recorded the answer in
 * `v.provider`. By default a Conflict has recorded it (the family edited away from it) and
 * every other state has not (owed). The ONE way a test gives a verification its `diff`, never a
 * hand-written field list. Without a provider it is returned unchanged.
 */
export function withDiff(
  v: FlightVerification,
  recorded: Recorded = {
    revision: v.state === 'conflict',
    arrivalTerminal: v.state === 'conflict',
  }
): FlightVerification {
  if (!v.provider) return v;
  const flight = { airline: 'Singapore Airlines (SQ)', flightNumber: 'SQ318' };
  const plan = {
    ...v.mine,
    ...flight,
    liveRevision: recorded.revision ? revisionOf(v.provider) : undefined,
    liveArrivalTerminal: recorded.arrivalTerminal
      ? arrivalTerminalRecord(flight, v.provider)
      : undefined,
  };
  return { ...v, diff: classifyDiff(plan, v.provider) };
}
