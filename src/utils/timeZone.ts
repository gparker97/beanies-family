/**
 * The family's HOME time zone, and the small set of `Intl` helpers every consumer of
 * it shares. Pure: no logging, no store access, no I/O. The callers (the calendar
 * push, the import, Settings, the planner caption) own the telemetry.
 *
 * Why a family needs one: `FamilyActivity` stores bare wall-clock times (`HH:mm`)
 * with no zone. Until this existed, the Google push stamped the PUSHING device's zone,
 * so a relative in Los Angeles opening the family's pod moved a Singapore 10:45 piano
 * lesson to 01:45 the next day in everyone else's calendar. The home zone is what the
 * bare wall clock MEANS. See `~/projects/beanies-ops/docs/plans/2026-10-06-calendar-home-time-zone.md`.
 */

import type { CountryCode } from '@/types/models';

/** This device's IANA zone. The ONE device-zone read; never inline `resolvedOptions()`. */
export function deviceTimeZone(): string {
  // 'UTC' keeps every downstream `Intl` call constructible on an engine that reports no
  // zone. Never PERSIST this fallback: use `knownDeviceTimeZone()` for anything stored.
  return knownDeviceTimeZone() ?? 'UTC';
}

/** This device's IANA zone, or null when the engine does not report one.
 *  `resolvedOptions().timeZone` is typed `string` but was `undefined` on some old engines. */
export function knownDeviceTimeZone(): string | null {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
}

/** Does THIS engine know `zone`? Local validity only; Google is the real judge. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    // A RangeError is the answer to the question, not a failure to report.
    return false;
  }
}

/** `Intl.Locale` zone data: `getTimeZones()` (current spec) or the older `timeZones`
 *  getter. Neither is in the TS lib, and Firefox / older WebKit have neither. */
type LocaleWithZones = Intl.Locale & {
  getTimeZones?: () => string[] | undefined;
  timeZones?: string[];
};

/**
 * The IANA zones this engine lists for a country, or `[]` when it cannot say.
 *
 * ⚠️ `[]` means UNKNOWN, not "no zones". Firefox and older WebKit ship no
 * `Intl.Locale` zone data at all, so the same country is single-zone on Chrome and
 * unknown on Firefox. That engine dependence is exactly why a country-derived zone is
 * never hashed (only the persisted `homeTimeZone` is).
 */
export function zonesForCountry(country?: CountryCode | null): string[] {
  if (!country) return [];
  try {
    const locale = new Intl.Locale(`und-${country}`) as LocaleWithZones;
    const zones = locale.getTimeZones?.() ?? locale.timeZones ?? [];
    return [...zones];
  } catch {
    // A malformed country code is "zones unknown", which every caller already handles.
    return [];
  }
}

/** The country's zone when it has exactly one, else null. The ONLY single-zone test:
 *  the resolver, the backfill rules and the country picker all go through it. */
export function singleZoneFor(country?: CountryCode | null): string | null {
  const zones = zonesForCountry(country);
  return zones.length === 1 ? zones[0]! : null;
}

export type HomeTimeZoneBackfillDecision =
  | { persist: string; kind: 'country' | 'owner-device' }
  | {
      persist: null;
      detail:
        | 'skipped-no-permission'
        | 'skipped-zones-unknown'
        | 'skipped-device-zone-unknown'
        | 'skipped-not-owner';
    };

/**
 * Should THIS device seed the family's unset `homeTimeZone`, and with what? Pure; the
 * caller guards "unset, authoritative doc, roster loaded" and does the write.
 *
 * - a device that cannot manage the pod never writes;
 * - a country this engine has no zone data for writes nothing (a Chrome/Safari manager
 *   device, or the owner's Settings pick, will set it; guessing the device zone here
 *   would let a Firefox device in the wrong place decide for everyone);
 * - a single-zone country writes that zone, from any manager device (deterministic);
 * - otherwise (no country, or several zones) ONLY the owner's device writes its own zone.
 */
export function decideHomeTimeZoneBackfill(input: {
  country?: CountryCode | null;
  /** `knownDeviceTimeZone()`: null when the engine reports no zone. */
  deviceZone: string | null;
  isOwner: boolean;
  canManagePod: boolean;
}): HomeTimeZoneBackfillDecision {
  if (!input.canManagePod) return { persist: null, detail: 'skipped-no-permission' };
  const zones = zonesForCountry(input.country);
  if (input.country && zones.length === 0) {
    return { persist: null, detail: 'skipped-zones-unknown' };
  }
  if (zones.length === 1) return { persist: zones[0]!, kind: 'country' };
  if (input.isOwner) {
    // An engine that reports no zone must not persist a synthetic 'UTC' as the family's
    // permanent home zone: every event would be re-pushed shifted by the real offset.
    if (!input.deviceZone) return { persist: null, detail: 'skipped-device-zone-unknown' };
    return { persist: input.deviceZone, kind: 'owner-device' };
  }
  return { persist: null, detail: 'skipped-not-owner' };
}

/** Every zone this engine knows, for the Settings picker. Degrades loudly, never silently. */
export function allTimeZones(): string[] {
  try {
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] })
      .supportedValuesOf;
    if (!supported) throw new Error('Intl.supportedValuesOf is missing');
    return supported('timeZone');
  } catch {
    console.warn(
      '[timeZone] Intl.supportedValuesOf unavailable — offering device zone only; check engine support'
    );
    return [deviceTimeZone()];
  }
}

/** Where the resolved home zone came from. `family` is the only HASHED source. */
export type HomeTimeZoneSource = 'family' | 'country' | 'device-fallback';

export interface ResolvedHomeTimeZone {
  /** The zone to push and convert in. */
  zone: string;
  source: HomeTimeZoneSource;
  /** What the push hash folds: the stored id under `family`, else `''` (no fold). */
  hashZone: string;
  /** The stored id is unknown to THIS engine. Reporting only; it changes nothing above. */
  invalidStored: boolean;
}

/**
 * Resolve the home zone: stored `homeTimeZone` → the family country's single zone →
 * this device's zone.
 *
 * ⚠️ A non-empty stored value wins on EVERY device whatever the local engine thinks
 * of it, and is the hash input. An older engine missing e.g. `Europe/Kyiv` must not
 * fall back and hash `''` while a newer one hashes the id: the two would re-push each
 * other's events every poll. Google interprets the zone, not the device; local
 * validity only gates local `Intl` use (see `invalidStored`).
 *
 * ⚠️ `hashZone` is `''` under `country` and `device-fallback`, deliberately. A device
 * zone differs per device, and a country zone differs per ENGINE (`zonesForCountry`).
 * Either in the hash would ping-pong the family's calendar between devices.
 */
export function resolveHomeTimeZone(input: {
  stored?: string | null;
  country?: CountryCode | null;
  deviceZone: string;
}): ResolvedHomeTimeZone {
  const { stored, country, deviceZone } = input;
  if (stored) {
    return {
      zone: stored,
      source: 'family',
      hashZone: stored,
      invalidStored: !isValidTimeZone(stored),
    };
  }
  const single = singleZoneFor(country);
  if (single) return { zone: single, source: 'country', hashZone: '', invalidStored: false };
  return { zone: deviceZone, source: 'device-fallback', hashZone: '', invalidStored: false };
}

/** A zone's UTC offset at `at` as the engine prints it ("GMT+08:00", "GMT"). Throws on
 *  an unknown zone. */
function offsetLabel(zone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * Do two zones have the same UTC offset right now? Compares OFFSETS, not ids: a Kuala
 * Lumpur device with a Singapore home is not "abroad". Returns true when either zone
 * is unknown to this engine, which hides the planner caption rather than showing a
 * wrong one.
 */
export function sameOffsetNow(a: string, b: string, at: Date = new Date()): boolean {
  if (a === b) return true;
  try {
    return offsetLabel(a, at) === offsetLabel(b, at);
  } catch {
    // Unknown zone on this engine (a stored id an older engine lacks): no caption.
    return true;
  }
}

/** The localized long generic name ("Singapore Standard Time"), or the raw id. */
export function zoneDisplayName(zone: string, locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      timeZoneName: 'longGeneric',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || zone;
  } catch {
    // Unknown zone or locale on this engine: the id is still a readable name.
    return zone;
  }
}

/**
 * The wall clock an instant shows in `zone`: `{ ymd: 'YYYY-MM-DD', hhmm: 'HH:mm' }`.
 *
 * THROWS on a zone (or date) this engine cannot format. Every caller already has a
 * fallback that is better than anything this function could guess, so it is theirs
 * to apply.
 */
export function wallClockInZone(date: Date, zone: string): { ymd: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  // ⚠️ Some engines still print midnight as "24" despite `h23`; it is "00" of that day.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${hour}:${get('minute')}`,
  };
}

/** The engine's UTC offset label for `zone` at `at` ("GMT+08:00"), or '' when this engine
 *  does not know the zone. The safe public face of `offsetLabel` (picker badges). */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string {
  try {
    return offsetLabel(zone, at);
  } catch {
    return '';
  }
}
