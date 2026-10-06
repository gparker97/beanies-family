import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  allTimeZones,
  decideHomeTimeZoneBackfill,
  deviceTimeZone,
  isValidTimeZone,
  resolveHomeTimeZone,
  sameOffsetNow,
  singleZoneFor,
  wallClockInZone,
  zoneDisplayName,
  zonesForCountry,
} from '../timeZone';

// Every zone below is passed explicitly: Vitest does not pin `TZ`, and this suite is
// also run under TZ=Pacific/Honolulu and TZ=America/Los_Angeles.

// `Intl`'s members are non-enumerable, so `vi.stubGlobal('Intl', { ...Intl })` would
// drop them all; patch the one member under test and restore it after each test.
const RealLocale = Intl.Locale;
const realSupportedValuesOf = (Intl as { supportedValuesOf?: unknown }).supportedValuesOf;
function patchIntl(key: string, value: unknown) {
  Object.defineProperty(Intl, key, { value, writable: true, configurable: true });
}

/** Replace `Intl.Locale` with one that carries no zone data (Firefox, older WebKit). */
function stubLocaleWithoutZoneData() {
  class NoZones {
    constructor(tag: string) {
      // Keep construction semantics (a bad tag still throws), drop the zone getters.
      void new RealLocale(tag);
    }
  }
  patchIntl('Locale', NoZones);
}

/** Does this engine ship `Intl.Locale` zone data? (Node does; Firefox does not.) */
const engineHasZoneData = zonesForCountry('SG').length > 0;

afterEach(() => {
  patchIntl('Locale', RealLocale);
  patchIntl('supportedValuesOf', realSupportedValuesOf);
  vi.restoreAllMocks();
});

describe('deviceTimeZone / isValidTimeZone', () => {
  it('returns a zone this engine can format', () => {
    expect(isValidTimeZone(deviceTimeZone())).toBe(true);
  });

  it('accepts real IANA ids and rejects junk and the empty string', () => {
    expect(isValidTimeZone('Asia/Singapore')).toBe(true);
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe.runIf(engineHasZoneData)('zonesForCountry / singleZoneFor (engine with zone data)', () => {
  it('lists a single-zone country’s one zone', () => {
    expect(zonesForCountry('SG')).toEqual(['Asia/Singapore']);
    expect(singleZoneFor('SG')).toBe('Asia/Singapore');
  });

  it('a multi-zone country has no single zone', () => {
    expect(zonesForCountry('US').length).toBeGreaterThan(1);
    expect(singleZoneFor('US')).toBeNull();
  });
});

describe('zonesForCountry / singleZoneFor (degraded)', () => {
  it('no country → no zones', () => {
    expect(zonesForCountry(undefined)).toEqual([]);
    expect(zonesForCountry(null)).toEqual([]);
    expect(singleZoneFor(null)).toBeNull();
  });

  it('a malformed country code is "unknown", never a throw', () => {
    expect(zonesForCountry('not a country!')).toEqual([]);
  });

  it('an engine with no Intl.Locale zone data reports UNKNOWN (empty), not single-zone', () => {
    stubLocaleWithoutZoneData();
    expect(zonesForCountry('SG')).toEqual([]);
    expect(singleZoneFor('SG')).toBeNull();
  });
});

describe('resolveHomeTimeZone — resolution order', () => {
  const LA = 'America/Los_Angeles';

  it('a stored zone wins, is hashed, and is reported valid', () => {
    expect(
      resolveHomeTimeZone({ stored: 'Asia/Singapore', country: 'US', deviceZone: LA })
    ).toEqual({
      zone: 'Asia/Singapore',
      source: 'family',
      hashZone: 'Asia/Singapore',
      invalidStored: false,
    });
  });

  it('a stored zone this engine does not know STILL wins and is STILL hashed (Caveat 7)', () => {
    // A fallback here would hash '' on this engine and the id on others: the
    // two would re-push each other's events every poll.
    expect(
      resolveHomeTimeZone({ stored: 'Mars/Olympus_Mons', country: 'SG', deviceZone: LA })
    ).toEqual({
      zone: 'Mars/Olympus_Mons',
      source: 'family',
      hashZone: 'Mars/Olympus_Mons',
      invalidStored: true,
    });
  });

  it.runIf(engineHasZoneData)(
    'unset → the family country’s single zone, NOT hashed (engine-dependent)',
    () => {
      expect(resolveHomeTimeZone({ stored: undefined, country: 'SG', deviceZone: LA })).toEqual({
        zone: 'Asia/Singapore',
        source: 'country',
        hashZone: '',
        invalidStored: false,
      });
    }
  );

  it('unset + multi-zone country → device fallback, NOT hashed', () => {
    expect(resolveHomeTimeZone({ stored: '', country: 'US', deviceZone: LA })).toEqual({
      zone: LA,
      source: 'device-fallback',
      hashZone: '',
      invalidStored: false,
    });
  });

  it('unset + no country → device fallback', () => {
    expect(resolveHomeTimeZone({ stored: null, country: null, deviceZone: LA }).source).toBe(
      'device-fallback'
    );
  });

  it('without Intl.Locale zone data, a single-zone country falls back to the device — and the hash is the SAME as with it', () => {
    const withData = resolveHomeTimeZone({ stored: undefined, country: 'SG', deviceZone: LA });
    stubLocaleWithoutZoneData();
    const without = resolveHomeTimeZone({ stored: undefined, country: 'SG', deviceZone: LA });
    expect(without).toEqual({
      zone: LA,
      source: 'device-fallback',
      hashZone: '',
      invalidStored: false,
    });
    // Chrome and Firefox devices of one family must hash identically before backfill.
    expect(without.hashZone).toBe(withData.hashZone);
  });
});

describe('decideHomeTimeZoneBackfill', () => {
  const LA = 'America/Los_Angeles';
  const owner = { isOwner: true, canManagePod: true };
  const admin = { isOwner: false, canManagePod: true };
  const member = { isOwner: false, canManagePod: false };

  it('a device that cannot manage the pod never writes', () => {
    expect(decideHomeTimeZoneBackfill({ country: 'SG', deviceZone: LA, ...member })).toEqual({
      persist: null,
      detail: 'skipped-no-permission',
    });
  });

  it.runIf(engineHasZoneData)(
    'a single-zone country persists its zone from ANY manager device',
    () => {
      for (const who of [owner, admin]) {
        expect(decideHomeTimeZoneBackfill({ country: 'SG', deviceZone: LA, ...who })).toEqual({
          persist: 'Asia/Singapore',
          kind: 'country',
        });
      }
    }
  );

  it.runIf(engineHasZoneData)(
    'a multi-zone country: only the OWNER persists, and their own device zone',
    () => {
      expect(decideHomeTimeZoneBackfill({ country: 'US', deviceZone: LA, ...owner })).toEqual({
        persist: LA,
        kind: 'owner-device',
      });
      expect(decideHomeTimeZoneBackfill({ country: 'US', deviceZone: LA, ...admin })).toEqual({
        persist: null,
        detail: 'skipped-not-owner',
      });
    }
  );

  it('no country: only the OWNER persists their device zone', () => {
    expect(decideHomeTimeZoneBackfill({ country: null, deviceZone: LA, ...owner })).toEqual({
      persist: LA,
      kind: 'owner-device',
    });
    expect(decideHomeTimeZoneBackfill({ country: undefined, deviceZone: LA, ...admin })).toEqual({
      persist: null,
      detail: 'skipped-not-owner',
    });
  });

  it('a country whose zones this engine does not know persists NOTHING, even for the owner', () => {
    stubLocaleWithoutZoneData();
    for (const who of [owner, admin]) {
      expect(decideHomeTimeZoneBackfill({ country: 'SG', deviceZone: LA, ...who })).toEqual({
        persist: null,
        detail: 'skipped-zones-unknown',
      });
    }
  });
});

describe('allTimeZones', () => {
  it('lists the engine’s zones', () => {
    const zones = allTimeZones();
    expect(zones).toContain('Asia/Singapore');
    expect(zones.length).toBeGreaterThan(100);
  });

  it('degrades to the device zone with a console warning, never silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    patchIntl('supportedValuesOf', undefined);
    expect(allTimeZones()).toEqual([deviceTimeZone()]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Intl.supportedValuesOf unavailable')
    );
  });
});

describe('sameOffsetNow', () => {
  const JAN = new Date('2026-01-15T12:00:00Z');
  const JUL = new Date('2026-07-15T12:00:00Z');

  it('compares OFFSETS, not ids (Kuala Lumpur and Singapore are both +08:00)', () => {
    expect(sameOffsetNow('Asia/Kuala_Lumpur', 'Asia/Singapore', JAN)).toBe(true);
    expect(sameOffsetNow('America/Los_Angeles', 'Asia/Singapore', JAN)).toBe(false);
  });

  it('follows DST: London matches UTC in winter and not in summer', () => {
    expect(sameOffsetNow('Europe/London', 'UTC', JAN)).toBe(true);
    expect(sameOffsetNow('Europe/London', 'UTC', JUL)).toBe(false);
  });

  it('returns true (no caption) for a zone this engine cannot format', () => {
    expect(sameOffsetNow('Mars/Olympus_Mons', 'Asia/Singapore', JAN)).toBe(true);
  });
});

describe('zoneDisplayName', () => {
  it('gives a localized generic name', () => {
    const name = zoneDisplayName('Asia/Singapore', 'en-US');
    expect(name).not.toBe('');
    expect(name).not.toBe('Asia/Singapore');
  });

  it('falls back to the raw id for a zone this engine cannot format', () => {
    expect(zoneDisplayName('Mars/Olympus_Mons', 'en-US')).toBe('Mars/Olympus_Mons');
  });
});

describe('wallClockInZone', () => {
  it('reads the wall clock in the given zone, whatever the device zone', () => {
    const at = new Date('2026-09-05T10:45:00+08:00');
    expect(wallClockInZone(at, 'Asia/Singapore')).toEqual({ ymd: '2026-09-05', hhmm: '10:45' });
    // The Oct 1 incident, in one line: the same instant in Los Angeles.
    expect(wallClockInZone(at, 'America/Los_Angeles')).toEqual({
      ymd: '2026-09-04',
      hhmm: '19:45',
    });
  });

  it('prints midnight as 00, never 24', () => {
    expect(wallClockInZone(new Date('2026-09-05T00:00:00+08:00'), 'Asia/Singapore')).toEqual({
      ymd: '2026-09-05',
      hhmm: '00:00',
    });
  });

  it('crosses DST correctly (Los Angeles, spring forward and fall back 2026)', () => {
    // 2026-03-08 02:00 PST → 03:00 PDT. 09:59Z is 01:59 PST; 10:00Z is 03:00 PDT.
    expect(wallClockInZone(new Date('2026-03-08T09:59:00Z'), 'America/Los_Angeles').hhmm).toBe(
      '01:59'
    );
    expect(wallClockInZone(new Date('2026-03-08T10:00:00Z'), 'America/Los_Angeles').hhmm).toBe(
      '03:00'
    );
    // 2026-11-01 02:00 PDT → 01:00 PST. 08:30Z is 01:30 PDT; 09:30Z is 01:30 PST.
    expect(wallClockInZone(new Date('2026-11-01T08:30:00Z'), 'America/Los_Angeles').hhmm).toBe(
      '01:30'
    );
    expect(wallClockInZone(new Date('2026-11-01T09:30:00Z'), 'America/Los_Angeles').hhmm).toBe(
      '01:30'
    );
  });

  it('THROWS for a zone this engine cannot format (callers own the fallback)', () => {
    expect(() => wallClockInZone(new Date(), 'Mars/Olympus_Mons')).toThrow();
  });
});

describe('review fixes', () => {
  it('decideHomeTimeZoneBackfill refuses an owner device with no known zone', async () => {
    const { decideHomeTimeZoneBackfill } = await import('@/utils/timeZone');
    expect(
      decideHomeTimeZoneBackfill({
        country: null,
        deviceZone: null,
        isOwner: true,
        canManagePod: true,
      })
    ).toEqual({ persist: null, detail: 'skipped-device-zone-unknown' });
  });

  it('utcOffsetLabel returns an empty string for a zone the engine does not know', async () => {
    const { utcOffsetLabel } = await import('@/utils/timeZone');
    expect(utcOffsetLabel('Not/AZone')).toBe('');
    expect(utcOffsetLabel('Asia/Singapore', new Date('2026-10-06T00:00:00Z'))).toBe('GMT+08:00');
  });
});
