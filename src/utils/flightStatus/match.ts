/**
 * Live flight checks (#143): choose the provider leg that IS the family's booked flight.
 *
 * Deterministic only. The one case it cannot settle (`ambiguous`: several candidates and no
 * code to separate them) is the only input the optional AI residue arm ever sees; every other
 * miss is `null` (reason `no_match`), shown honestly and never written.
 *
 * Pure, no logging. Relative imports and erasable TS only: Spike 0 runs this under plain node.
 */

import { AIRPORTS, type AirportInfo } from '../../constants/airports';
import type { FlightLeg } from '../../types/flightStatus';
import type { VacationTravelSegment } from '../../types/models';
import { carriedCode } from '../travelCodes';
import { parseUtcMs, splitLocal } from './schedule';

export type PickLegResult =
  | {
      leg: FlightLeg;
      /**
       * Where the arrival half of the schedule comes from, with `tupleFromLeg`'s default
       * semantics: `undefined` = `leg` itself; the continuation of `leg` under a multi-stop
       * number (departs `leg`'s arrival airport at or after `leg` lands, within 36 h) whose
       * arrival is the booking's; `null` = no returned continuation reaches the booking's
       * arrival code, so the arrival half stays undefined (never compared, never written).
       */
      arrivalLeg?: FlightLeg | null;
      how: 'airport' | 'name' | 'single';
    }
  | { legs: FlightLeg[]; how: 'ambiguous' };

export type MatchableSegment = Pick<
  VacationTravelSegment,
  'departureAirport' | 'arrivalAirport' | 'departureDate'
>;

const DAY_MS = 86_400_000;

function ymdToMs(ymd: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Cargo, legs without a usable departure schedule, and legs departing (local date) outside the
 *  booking date ± 1 day never take part. */
function usableLegs(legs: readonly FlightLeg[], departureDate: string | undefined): FlightLeg[] {
  const booked = ymdToMs(departureDate);
  return legs.filter((leg) => {
    if (leg.isCargo) return false;
    const dep = splitLocal(leg.departure.scheduledLocal);
    if (!dep) return false;
    if (booked === null) return true;
    const at = ymdToMs(dep.date);
    return at !== null && Math.abs(at - booked) <= DAY_MS;
  });
}

// ── Name matching (the booking holds a name, not a code) ────────────────────

let airportsByCode: Map<string, AirportInfo> | null = null;

function fold(text: string | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whole-word containment, so "York" never matches "New York" by accident of substrings. */
function containsWords(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

/**
 * True when a booking's free-text airport names this leg side. Compared against the AIRPORTS
 * entry for the side's IATA code (city and name) and the provider's own airport name, in both
 * directions: "London" names LHR (city), "Heathrow" names LHR (provider "London Heathrow"),
 * "Singapore Changi Airport" names SIN (name contained in the booking).
 */
function namesSide(booking: string, side: FlightLeg['departure']): boolean {
  const b = fold(booking);
  if (!b) return false;
  airportsByCode ??= new Map(AIRPORTS.map((a) => [a.code, a]));
  const entry = side.iata ? airportsByCode.get(side.iata) : undefined;
  const names = [entry?.city, entry?.name, side.name].map(fold).filter((n) => n.length > 0);
  return names.some((n) => containsWords(b, n) || containsWords(n, b));
}

/** The longest layover a continuation sector may follow its inbound sector by. */
const MAX_CONNECTION_MS = 36 * 3_600_000;

/** Wall-clock `YYYY-MM-DD HH:mm` as ms on a zone-free axis, for two times at ONE airport. */
function wallMs(value: string | undefined): number | null {
  const p = splitLocal(value);
  if (!p) return null;
  const ms = Date.parse(`${p.date}T${p.time}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * True when `next` is the continuation of `first` under one flight number: it departs from the
 * airport `first` lands at, no earlier than `first`'s scheduled arrival, and within
 * `MAX_CONNECTION_MS` of it.
 *
 * A `dateLocalRole=Departure` answer holds every sector that DEPARTS on the queried date, so
 * for SQ25 on 2026-12-14 it returns JFK→FRA and the PREVIOUS rotation's FRA→SIN, which leaves
 * Frankfurt before the JFK sector has even landed. Pairing those two writes an arrival a day
 * early; this check is what refuses it.
 *
 * Instants compare by `scheduledUtc` when both sides carry one. Otherwise by the two local wall
 * clocks, which share a zone because they are the same airport (only a DST change between the
 * two can skew that by an hour). Anything not comparable is not a continuation.
 */
function continues(first: FlightLeg, next: FlightLeg): boolean {
  if (next === first) return false;
  if (!first.arrival.iata || next.departure.iata !== first.arrival.iata) return false;
  const arrUtc = parseUtcMs(first.arrival.scheduledUtc);
  const depUtc = parseUtcMs(next.departure.scheduledUtc);
  const [landed, leaves] =
    arrUtc !== null && depUtc !== null
      ? [arrUtc, depUtc]
      : [wallMs(first.arrival.scheduledLocal), wallMs(next.departure.scheduledLocal)];
  if (landed === null || leaves === null) return false;
  return leaves >= landed && leaves - landed <= MAX_CONNECTION_MS;
}

/** One leg, several (ambiguous), or none. */
function oneOf(found: FlightLeg[]): FlightLeg | FlightLeg[] | null {
  if (found.length === 0) return null;
  return found.length === 1 ? found[0]! : found;
}

/**
 * The arrival half for a chosen departure leg. Single-sector agreement (or a booking with no
 * usable arrival) → `undefined`; the chosen leg's continuation (`continues`) reaching the
 * booking's arrival → that sector; a resolvable arrival code no continuation reaches → `null`.
 */
function arrivalFor(
  legs: FlightLeg[],
  chosen: FlightLeg,
  arrCode: string | undefined,
  arrName: string | undefined
): FlightLeg | null | undefined {
  const reaches = (l: FlightLeg): boolean =>
    arrCode ? l.arrival.iata === arrCode : !!arrName && namesSide(arrName, l.arrival);
  if (!arrCode && !arrName) return undefined;
  if (reaches(chosen)) return undefined;
  const onward = legs.find((l) => continues(chosen, l) && reaches(l));
  if (onward) return onward;
  return arrCode ? null : undefined;
}

/**
 * Pick the booked leg among the provider's legs for `<CODE><digits>` on the booking date.
 *
 *  1. Departure IATA equals `carriedCode(departureAirport, 3)`. With a resolvable departure code
 *     nothing else is tried: no leg from that airport is `null`, never a guess.
 *  2. Else arrival IATA equals `carriedCode(arrivalAirport, 3)`; a departure NAME on the booking
 *     must then name that leg's departure or an earlier sector's (multi-stop), else `null`.
 *  3. Else the booking's names against `AIRPORTS` city/name and the provider's airport name.
 *  4. The lone leg, only when the booking carries no resolvable code on either side.
 *
 * A multi-stop number (SQ25 SIN→FRA→JFK returns two legs) booked end to end takes its
 * departure from one sector and its arrival from that sector's continuation (`arrivalLeg`):
 * the leg departing the first sector's arrival airport, at or after its scheduled arrival and
 * within 36 h (`continues`). Never a sector of another day's rotation.
 */
export function pickLeg(legs: readonly FlightLeg[], seg: MatchableSegment): PickLegResult | null {
  const usable = usableLegs(legs, seg.departureDate);
  if (usable.length === 0) return null;

  const depCode = carriedCode(seg.departureAirport, 3);
  const arrCode = carriedCode(seg.arrivalAirport, 3);
  const depName = depCode ? undefined : seg.departureAirport?.trim() || undefined;
  const arrName = arrCode ? undefined : seg.arrivalAirport?.trim() || undefined;

  // 1. Departure code.
  if (depCode) {
    let found = usable.filter((l) => l.departure.iata === depCode);
    if (found.length > 1) {
      // A daily flight seen on two adjacent dates: the booked date wins.
      const onDate = found.filter(
        (l) => splitLocal(l.departure.scheduledLocal)?.date === seg.departureDate
      );
      if (onDate.length > 0) found = onDate;
    }
    const pick = oneOf(found);
    if (pick === null) return null;
    if (Array.isArray(pick)) return { legs: pick, how: 'ambiguous' };
    return withArrival(usable, pick, arrCode, arrName, 'airport');
  }

  // 2. Arrival code.
  if (arrCode) {
    const pick = oneOf(usable.filter((l) => l.arrival.iata === arrCode));
    if (pick === null) return null;
    if (Array.isArray(pick)) return { legs: pick, how: 'ambiguous' };
    if (!depName || namesSide(depName, pick.departure)) return { leg: pick, how: 'airport' };
    const earlier = usable.find((l) => continues(l, pick) && namesSide(depName, l.departure));
    return earlier ? { leg: earlier, arrivalLeg: pick, how: 'airport' } : null;
  }

  // 3. Names only.
  if (depName || arrName) {
    const found = depName
      ? usable.filter((l) => namesSide(depName, l.departure))
      : usable.filter((l) => namesSide(arrName!, l.arrival));
    const pick = oneOf(found);
    if (Array.isArray(pick)) return { legs: pick, how: 'ambiguous' };
    if (pick) {
      return depName
        ? withArrival(usable, pick, undefined, arrName, 'name')
        : { leg: pick, how: 'name' };
    }
  }

  // 4. No code on either side and the names settled nothing.
  if (usable.length === 1) return { leg: usable[0]!, how: 'single' };
  return { legs: usable, how: 'ambiguous' };
}

function withArrival(
  usable: FlightLeg[],
  leg: FlightLeg,
  arrCode: string | undefined,
  arrName: string | undefined,
  how: 'airport' | 'name'
): PickLegResult {
  const arrivalLeg = arrivalFor(usable, leg, arrCode, arrName);
  return arrivalLeg === undefined ? { leg, how } : { leg, arrivalLeg, how };
}

/**
 * The operating flight's number when the provider answered the queried marketing number with
 * another one ("BA12" for a QF-marketed query), for "Operated by …" copy; else undefined.
 */
export function operatedAs(leg: FlightLeg, query: string): string | undefined {
  const n = leg.number.replace(/[\s\-/]+/g, '').toUpperCase();
  const q = query.replace(/[\s\-/]+/g, '').toUpperCase();
  return n && n !== q ? n : undefined;
}
