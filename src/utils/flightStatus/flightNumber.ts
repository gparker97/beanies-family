/**
 * Live flight checks (#143): turn a segment's airline + flight-number fields into the one query
 * the `flight-status` Lambda accepts (`<CARRIER><digits>`, its `FLIGHT_RE`).
 *
 * Pure, no logging. Relative imports and erasable TS only: Spike 0 runs this under plain node.
 */

import { carriedCode, parseFlightDesignator } from '../travelCodes';

export interface NormalisedFlightNumber {
  /** Two-character IATA carrier designator, upper-cased: "SQ", "6E". */
  carrier: string;
  /** 1-4 digits, leading zeros dropped: "25", "318". */
  digits: string;
  /** `carrier + digits`, the string sent to the Lambda: "SQ25". */
  query: string;
}

/** The Lambda's own limit (`FLIGHT_RE = /^[A-Z0-9]{2}\d{1,4}$/`). */
const MAX_DIGITS = 4;

function build(carrier: string, rawDigits: string): NormalisedFlightNumber | null {
  const digits = rawDigits.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(digits) || digits.length > MAX_DIGITS) return null;
  return { carrier, digits, query: `${carrier}${digits}` };
}

/**
 * The carrier + digits to query, or null when no carrier can be found (the flight then shows
 * `unavailable` with reason `no_flight_number`).
 *
 * Resolution, most precise first:
 *  1. the airline field's carried code prefixes the number ("SQ" + "SQ-25", "6E" + "6E 123");
 *  2. the number carries its own designator ("SQ25", "sq 25", "SQ-25"), whatever the airline
 *     field says (a name, nothing, or a different carrier on a codeshare booking): the number is
 *     the more precise of the two, the same rule `flightCodeLabel` uses;
 *  3. a bare number ("25", "0025") with a carried airline code ("SQ", "Singapore Airlines (SQ)").
 *
 * A name-only airline with a bare number returns null: guessing a code from a name is the
 * "short and possibly false" move `carriedCode` refuses.
 */
export function normaliseFlightNumber(
  airline?: string,
  flightNumber?: string
): NormalisedFlightNumber | null {
  const fn = flightNumber?.trim() ?? '';
  if (!fn) return null;
  const code = carriedCode(airline, 2);

  if (code && fn.toUpperCase().startsWith(code)) {
    const rest = fn.slice(code.length);
    const m = /^[-/ ]*(\d+)$/.exec(rest);
    if (m) return build(code, m[1]!);
  }

  const designated = parseFlightDesignator(fn);
  if (designated) return build(designated.carrier, designated.digits);

  const bare = /^\d+$/.exec(fn.replace(/[\s\-/]+/g, ''));
  if (bare && code) return build(code, bare[0]);

  return null;
}
