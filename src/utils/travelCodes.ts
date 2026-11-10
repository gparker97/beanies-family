/**
 * Travel code shapes: the IATA code a field carries, a flight designator, and the flight-type
 * guard.
 *
 * A LEAF module on purpose: no runtime imports at all (the one `import type` is erased). The
 * flight-status matcher imports this, and Spike 0 (`scripts/spikes/flight-status-spike.mts`)
 * runs that matcher under plain `node` type-stripping, which cannot resolve the `@/` alias and
 * cannot run non-erasable TS. So: relative imports only, no enums, no parameter properties.
 * `utils/vacation.ts` re-exports `carriedCode` so its existing callers are untouched.
 */

import type { FlightTravelType } from '../types/models';

/**
 * A code-SHAPED token that is not a code. The prompt forbids the model inventing these, but
 * `UNK` is Unalakleet and `NAN` is Nadi, so one reaching a lookup would name a real airport in
 * the wrong hemisphere. Treated as "no code carried", which renders the field verbatim instead.
 */
export const PLACEHOLDER_CODES: ReadonlySet<string> = new Set([
  'TBA',
  'TBD',
  'TBC',
  'UNK',
  'XXX',
  'ZZZ',
  'NIL',
  'NA',
  'XX',
]);
// The line is drawn at tokens that read as "I do not know", and it stops there on purpose. `UNK`
// costs Unalakleet, which is worth it. `NAN` is NOT listed: it is Nadi, Fiji — a genuine family
// destination and an unlikely placeholder — so a wider net would cost more than it saves.

/**
 * The IATA code a field EXPLICITLY carries, or `undefined` when it carries a name.
 *
 * ONE definition, several consumers (`airportCode`, `flightCodeLabel`, the extraction
 * telemetry's shape probe, and the flight-status matcher), because two of those disagreeing is
 * its own defect class: an anchored probe beside an unanchored extractor logged working input as
 * a translation failure.
 *
 * Two shapes only, and deliberately no cleverer rung. Three rounds of review each broke a new
 * input class as rungs were added — most sharply a leading-bare-code rung placed before the
 * parenthesized one, which turned "LOS ANGELES (LAX)" into LOS (Lagos, Nigeria). The rule that
 * holds is **verbose but true beats short and possibly false**: when the field does not plainly
 * carry a code, the caller renders the whole string rather than guessing which token is one.
 */
export function carriedCode(value: string | undefined, width: 2 | 3): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const exact = width === 3 ? /^[A-Z]{3}$/ : /^[A-Z0-9]{2}$/;
  // Unanchored for width 3: the picker's "Sydney (SYD) Terminal 1" is a real stored shape, and
  // matching parens FIRST is what keeps an all-caps city name from winning over the real code.
  const parens = width === 3 ? /\(([A-Z]{3})\)/ : /\(([A-Z0-9]{2,3})\)$/;
  const code = exact.test(v) ? v : (parens.exec(v)?.[1] ?? undefined);
  return code && !PLACEHOLDER_CODES.has(code) ? code : undefined;
}

/**
 * The airport code for a title, from whatever shape the field holds: a bare "SIN" (what the
 * extraction prompt now asks the model for), the picker's "Singapore (SIN)", or a name.
 *
 * The first-word fallback this replaced is the bug: "John F. Kennedy International Airport"
 * titled a flight "John". Falling back to the WHOLE string is longer but never wrong, and a
 * name only reaches here when the model could not identify the airport (or the segment predates
 * the prompt asking). Resolving a name to a code is the model's job, not ours — see
 * `TRAVEL_JSON_SHAPE` in `extractionPrompt.ts`. Case-sensitive, like `carriedCode`.
 */
export function airportCode(airport?: string): string {
  return carriedCode(airport, 3) ?? airport?.trim() ?? '';
}

/** Two alphanumerics (at least one a letter) then 1-4 digits: "SQ25", "HO1602", "6E123". */
export const FLIGHT_DESIGNATOR = /^(?=[a-z0-9]{2}\d)(?=[a-z0-9]*[a-z])[a-z0-9]{2}\d{1,4}$/i;

/**
 * Split a flight number that carries its own carrier designator into carrier + digits.
 *
 * Accepts "SQ25", "sq25", "SQ 25", "SQ-25", "SQ/25" and "6E123"; the separator is dropped
 * before the `FLIGHT_DESIGNATOR` test, so a spaced or hyphenated number is the same flight.
 * Returns null for a bare number ("25"), an equipment code that is not digit-terminated
 * ("ATR72" has three letters before the digits), or anything else. The carrier comes back
 * upper-cased; the digits keep their leading zeros ("DL 00123" → "00123"), which the caller
 * decides how to normalise.
 */
export function parseFlightDesignator(
  text: string | undefined
): { carrier: string; digits: string } | null {
  const compact = text?.trim().replace(/[\s\-/]+/g, '') ?? '';
  if (!compact) return null;
  // The designator regex caps digits at 4, so a zero-padded "DL00123" is tried stripped too.
  const m = /^([a-z0-9]{2})(\d+)$/i.exec(compact);
  if (!m) return null;
  const carrier = m[1]!.toUpperCase();
  const digits = m[2]!;
  const stripped = digits.replace(/^0+(?=\d)/, '');
  if (!FLIGHT_DESIGNATOR.test(carrier + digits) && !FLIGHT_DESIGNATOR.test(carrier + stripped)) {
    return null;
  }
  return { carrier, digits };
}

/**
 * The three flight segment types, spelled out ONCE. Accepts any string so a loosely typed
 * caller (a title builder fed `type?: string`) can narrow through it too.
 */
export function isFlightType(t: string | null | undefined): t is FlightTravelType {
  return t === 'flight_outbound' || t === 'flight_return' || t === 'flight_other';
}
