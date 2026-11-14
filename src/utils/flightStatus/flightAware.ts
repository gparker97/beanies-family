/**
 * Follow a flight live: the FlightAware page for a flight segment, and WHEN to offer it.
 *
 * FlightAware's `/live/flight/<ident>` page shows the CURRENT or NEXT flight under that number,
 * not the one on a given date, so a link a month ahead (or a week after) would show someone
 * else's flight. The link is therefore offered only around the day of travel: from 24 h before
 * scheduled departure until 6 h after scheduled arrival.
 *
 * Pure, no logging, no store access. The ident comes from `normaliseFlightNumber`, the same rule
 * the live flight checks use, so a number this file links is exactly a number those checks would
 * query. The instants come from `departureInstant` / `arrivalInstant`, the one rule the check
 * window uses (the cached leg's UTC when a fitting check exists, else the stored wall clock read
 * in the family home zone).
 *
 * One deliberate difference: a STORED arrival time is used only when a fitting check confirms it.
 * The stored arrival is the destination's local clock, and with no airport time zones in the app
 * it can only be read in the home zone, which can put it hours early (a Singapore family's
 * 05:00 London landing reads 8 h early) and would take the link away mid-flight, exactly when the
 * family at home is watching. Without a check the arrival is treated as unknown (departure +
 * 24 h): a link that lingers is harmless, one that vanishes before landing is the failure.
 *
 * The URL carries the flight ident and nothing else: no date, no route, no family.
 */
import type { FlightCheck } from '@/types/flightStatus';
import type { VacationTravelSegment } from '@/types/models';
import { isFlightType } from '../travelCodes';
import { normaliseFlightNumber } from './flightNumber';
import { arrivalInstant, departureInstant } from './window';

const HOUR_MS = 3_600_000;

export const FLIGHTAWARE_FLIGHT_BASE = 'https://www.flightaware.com/live/flight/';
/** The link appears this long before scheduled departure. */
export const TRACK_OPENS_BEFORE_MS = 24 * HOUR_MS;
/** ...and goes away this long after scheduled arrival. */
export const TRACK_CLOSES_AFTER_MS = 6 * HOUR_MS;
/** With no arrival on record, the flight is taken to land this long after it leaves. */
export const TRACK_ASSUMED_FLIGHT_MS = 24 * HOUR_MS;

type TrackableSegment = Pick<
  VacationTravelSegment,
  | 'type'
  | 'airline'
  | 'flightNumber'
  | 'departureDate'
  | 'departureTime'
  | 'arrivalDate'
  | 'arrivalTime'
>;

/**
 * The ident FlightAware keys a flight on: carrier designator + digits, upper-cased, no
 * separators, no leading zeros ("SQ 321" → "SQ321", "BA0007" → "BA7"). Null when the fields do
 * not plainly name a flight (empty, no digits, a placeholder, a name-only airline with a bare
 * number).
 *
 * FlightAware keys on the ICAO designator (SIA321) and also resolves the IATA form itself. The
 * app's airline list holds IATA codes only, so the ICAO form is used only when this segment's
 * cached live check names it, and only when that leg IS this flight (same carrier + digits): on
 * a codeshare the provider may answer with the operating flight, whose ICAO code belongs to a
 * different number.
 */
export function flightAwareIdent(
  airline?: string,
  flightNumber?: string,
  check?: FlightCheck
): string | null {
  const mine = normaliseFlightNumber(airline, flightNumber);
  if (!mine) return null;
  const leg = check?.leg;
  const icao = leg?.airline?.icao?.trim().toUpperCase();
  if (
    leg &&
    icao &&
    /^[A-Z]{3}$/.test(icao) &&
    leg.airline?.iata?.trim().toUpperCase() === mine.carrier &&
    normaliseFlightNumber(undefined, leg.number)?.query === mine.query
  ) {
    return `${icao}${mine.digits}`;
  }
  return mine.query;
}

/** The FlightAware page for a flight segment, or null when it is not a flight with a usable number. */
export function flightAwareUrl(
  seg: Pick<VacationTravelSegment, 'type' | 'airline' | 'flightNumber'>,
  check?: FlightCheck
): string | null {
  if (!isFlightType(seg.type)) return null;
  const ident = flightAwareIdent(seg.airline, seg.flightNumber, check);
  return ident ? `${FLIGHTAWARE_FLIGHT_BASE}${encodeURIComponent(ident)}` : null;
}

/**
 * Is `nowMs` inside [departure - 24 h, arrival + 6 h]? An unknown arrival is taken as departure
 * + 24 h; an arrival before departure (a data error) closes on the departure instead. No
 * departure instant (no date) means no window.
 */
export function trackWindowOpen(
  departureMs: number | null,
  arrivalMs: number | null,
  nowMs: number
): boolean {
  if (departureMs === null) return false;
  const lands = arrivalMs ?? departureMs + TRACK_ASSUMED_FLIGHT_MS;
  const opens = departureMs - TRACK_OPENS_BEFORE_MS;
  const closes = Math.max(departureMs, lands) + TRACK_CLOSES_AFTER_MS;
  return nowMs >= opens && nowMs <= closes;
}

/**
 * The link to show on a flight segment right now: its FlightAware page inside the tracking
 * window, else null (the number then reads as plain text). The window closes 6 h after the
 * checked arrival, or 30 h after departure when no check has confirmed one.
 */
export function flightTrackUrl(
  seg: TrackableSegment,
  check: FlightCheck | undefined,
  homeZone: string,
  nowMs: number
): string | null {
  const url = flightAwareUrl(seg, check);
  if (!url) return null;
  const departs = departureInstant(seg, check, homeZone);
  // Without its stored arrival time, `arrivalInstant` answers only from a fitting cached check
  // (exact UTC), else null: the "trust the arrival only when confirmed" rule in the header.
  const lands = arrivalInstant({ ...seg, arrivalTime: undefined }, check, homeZone);
  return trackWindowOpen(departs, lands, nowMs) ? url : null;
}
