/**
 * Live flight checks (#143): the runtime shape guards for a normalised `FlightLeg`, shared by
 * the Lambda client (`flightStatusApi`) and the device cache (`flightStatusCache`) so an
 * answer and a cached copy are accepted by exactly the same rule. `types/flightStatus.ts`
 * stays type-only.
 *
 * Pure, no logging. Relative imports and erasable TS only (the `schedule.ts` convention).
 */
import type { FlightLeg } from '../../types/flightStatus';

/** A plain object (not null, not an array): the base of every shape check here. */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** An optional string field: absent, null, or a string. */
function optString(v: unknown): boolean {
  return v === undefined || v === null || typeof v === 'string';
}

/** Every string a leg side carries, each later trimmed, split or parsed by the utils. */
const SIDE_STRINGS = [
  'iata',
  'icao',
  'name',
  'timeZone',
  'scheduledLocal',
  'scheduledUtc',
  'revisedLocal',
  'terminal',
  'gate',
] as const;

function isSide(v: unknown, extra: 'checkInDesk' | 'baggageBelt'): boolean {
  return (
    isObject(v) &&
    SIDE_STRINGS.every((k) => optString(v[k])) &&
    optString(v[extra]) &&
    Array.isArray(v.quality) &&
    v.quality.every((q) => typeof q === 'string')
  );
}

/**
 * The Lambda's normalised leg (`providers/aerodatabox.mjs` `mapLeg`): every field the matcher,
 * the schedule tuple and the live details dereference has the type they assume, so a corrupt
 * answer or cache entry can never throw (or compare a number as a time) downstream.
 */
export function isFlightLeg(value: unknown): value is FlightLeg {
  if (!isObject(value)) return false;
  const airline = value.airline;
  return (
    typeof value.number === 'string' &&
    typeof value.status === 'string' &&
    optString(value.codeshareStatus) &&
    optString(value.lastUpdatedUtc) &&
    (value.isCargo === undefined || typeof value.isCargo === 'boolean') &&
    (airline === undefined ||
      (isObject(airline) &&
        optString(airline.name) &&
        optString(airline.iata) &&
        optString(airline.icao))) &&
    isSide(value.departure, 'checkInDesk') &&
    isSide(value.arrival, 'baggageBelt')
  );
}
