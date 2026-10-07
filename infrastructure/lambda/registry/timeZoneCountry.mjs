/**
 * Device time zone -> country (#125), for the write-once `deviceCountry` registry field.
 *
 * WHY A TIME ZONE, AND WHY A STATIC TABLE
 * The Slack sign-up lines and the metrics want a country for every family, including the many
 * that never set one in Settings. The device's IANA zone (`Intl` `resolvedOptions().timeZone`) is
 * already on the device, names a country for almost every zone, and needs no IP lookup and no
 * third party. The table is IANA's own (`zone.tab` plus its link aliases), generated into
 * `timeZoneCountryData.mjs` by `scripts/gen-timezone-countries.mjs`; this module only validates
 * the input and reads the table.
 *
 * Country-level only: the zone itself is never stored or logged by the caller.
 *
 * PURE: no AWS imports, no env, no logging. Never throws.
 */

import { ZONE_COUNTRIES } from './timeZoneCountryData.mjs';

/**
 * `Area/Location` or `Area/Sub/Location`: every IANA name that can carry a country.
 *
 * `security/detect-unsafe-regex` flags the quantified group and is wrong here: each repetition
 * must start with a literal `/`, which the character classes exclude, so a string splits into
 * segments exactly one way and nothing backtracks. The length cap also runs first.
 */
// eslint-disable-next-line security/detect-unsafe-regex -- linear: see the note above
const ZONE_SHAPE_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/;
const MAX_ZONE_LENGTH = 64;

/**
 * The ISO 3166-1 alpha-2 country for an IANA zone, or null. Client-supplied input, so it is
 * trimmed and shape-checked before the lookup; `UTC`, `Etc/*`, unknown zones and anything
 * malformed are null (no country is better than a guessed one, and the field is write-once).
 */
export function countryForTimeZone(zone) {
  if (typeof zone !== 'string') return null;
  const z = zone.trim();
  if (z.length > MAX_ZONE_LENGTH || !ZONE_SHAPE_RE.test(z)) return null;
  // Own-property lookup only: a zone string must never reach `Object.prototype`.
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(ZONE_COUNTRIES, z) ? ZONE_COUNTRIES[z] : null;
}
