/**
 * The device's last weather reading (#134, ADR-043), in localStorage. Mirrors
 * `services/billing/entitlementCache.ts`: this module only moves bytes and reports failures;
 * `weatherStore` owns every decision about what a read means.
 *
 * DEVICE STATE, NOT FAMILY DATA. A reading is a third-party observation that changes every
 * 15 minutes. In the Automerge doc it would add CRDT churn and sync traffic to every family
 * device and re-dirty the doc every 30 minutes, so it stays on the device.
 *
 * ONE KEY (`STORAGE_KEYS.WEATHER`) holding the reading plus the `familyId` and `placeKey` it
 * belongs to. A mismatch on either is a miss: a town or home-zone change never shows the old
 * reading, and another family on this device never sees this one's town. A device that
 * switches between two families refetches once per switch; in exchange, sign-out is a single
 * removal on every tier and there is no key sweeping. About 1KB, read synchronously, so a
 * wall paints its last reading on the first frame.
 */
import type { WeatherPlace } from '@/types/models';
import type { WeatherReading } from '@/types/weather';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import {
  readStoredJson,
  removeStoredJson,
  writeStoredJson,
  type StoredJsonWrite,
} from '@/utils/storedJson';
import { logEvent } from '@/services/telemetry';

const LABEL = 'weather';
const SURFACE = 'weather';

export type WeatherCacheRead =
  { kind: 'ok'; value: WeatherReading } | { kind: 'missing' } | { kind: 'corrupt' };

/**
 * The cache identity of a place in a home zone: `"lat,lon|zone"` with 2-decimal coordinates.
 * The zone is part of it because the daily entries are home-zone days. This module owns the
 * format; the store uses it for the lookup and for its watch, and the service never sees it.
 */
export function placeKeyOf(place: Pick<WeatherPlace, 'lat' | 'lon'>, zone: string): string {
  return `${place.lat.toFixed(2)},${place.lon.toFixed(2)}|${zone}`;
}

/**
 * Read the cached reading for this family and place. Valid JSON of the wrong shape is
 * `corrupt`, exactly like unparseable JSON, and is REMOVED here so the warning fires once
 * rather than on every open. A reading for another family or place is `missing`.
 */
export function readWeatherCache(familyId: string, placeKey: string): WeatherCacheRead {
  const read = readStoredJson(STORAGE_KEYS.WEATHER, LABEL);
  if (read.kind === 'missing') return read;
  if (read.kind === 'corrupt' || !isWeatherReading(read.value)) {
    console.warn(`[${LABEL}] cached weather reading has an unexpected shape; removing it`);
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'weather_cache',
      context: { action: 'cache', error_code: 'cache_corrupt' },
    });
    removeCache();
    return { kind: 'corrupt' };
  }
  const value = read.value;
  if (value.familyId !== familyId || value.placeKey !== placeKey) return { kind: 'missing' };
  return { kind: 'ok', value };
}

/** Store the reading. A refused write is returned, never thrown: the store reports it. */
export function writeWeatherCache(reading: WeatherReading): StoredJsonWrite {
  return writeStoredJson(STORAGE_KEYS.WEATHER, reading, LABEL);
}

/** Forget this device's reading (sign-out, every tier). Never throws. */
export function clearWeatherCache(): void {
  removeCache();
}

/** Remove the record; a refused removal is logged (the next write overwrites it anyway). */
function removeCache(): void {
  const removed = removeStoredJson(STORAGE_KEYS.WEATHER, LABEL);
  if (removed.ok) return;
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'weather_cache',
    context: { action: 'cache', error_code: 'cache_clear_failed' },
    error: removed.error,
  });
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isWeatherReading(v: unknown): v is WeatherReading {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<WeatherReading>;
  const c = r.current as Partial<WeatherReading['current']> | undefined;
  return (
    r.v === 1 &&
    typeof r.familyId === 'string' &&
    typeof r.placeKey === 'string' &&
    isFiniteNumber(r.fetchedAt) &&
    !!c &&
    isFiniteNumber(c.tempC) &&
    isFiniteNumber(c.code) &&
    typeof c.isDay === 'boolean' &&
    Array.isArray(r.daily) &&
    r.daily.every(
      (d) =>
        typeof d === 'object' &&
        d !== null &&
        typeof d.ymd === 'string' &&
        isFiniteNumber(d.code) &&
        isFiniteNumber(d.maxC) &&
        isFiniteNumber(d.minC)
    )
  );
}
