/**
 * The live flight check device cache (#143) against happy-dom's localStorage: one key, one
 * family, a corrupt record removed (its warning fires once), and the prune rules (deleted
 * segments, flights that are over, nothing older than 7 days).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));

import { STORAGE_KEYS } from '@/constants/storageKeys';
import {
  MAX_CHECK_AGE_MS,
  clearFlightStatusCache,
  emptyFlightStatusCache,
  pruneFlightStatusCache,
  readFlightStatusCache,
  writeFlightStatusCache,
  type FlightStatusCacheRecord,
} from '../flightStatusCache';
import { makeCheck, makeLeg } from '@/utils/flightStatus/__tests__/fixtures';

const HOUR = 3_600_000;
const record = (over: Partial<FlightStatusCacheRecord> = {}): FlightStatusCacheRecord => ({
  ...emptyFlightStatusCache('fam-1'),
  checks: { 'seg-1': makeCheck(makeLeg({})) },
  failures: { 'seg-2': { code: 'http_5xx', count: 2, until: 1 } },
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  h.logEvent.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('read / write / clear', () => {
  it('round-trips under one key', () => {
    expect(writeFlightStatusCache(record())).toEqual({ ok: true });
    expect(localStorage.getItem(STORAGE_KEYS.FLIGHT_STATUS)).not.toBeNull();
    expect(readFlightStatusCache('fam-1')).toEqual(record());
  });

  it('a record written before `noticed` existed reads as {}', () => {
    const { noticed: _drop, ...legacy } = record();
    localStorage.setItem(STORAGE_KEYS.FLIGHT_STATUS, JSON.stringify(legacy));
    expect(readFlightStatusCache('fam-1')?.noticed).toEqual({});
  });

  it('round-trips the first-seen stamps', () => {
    writeFlightStatusCache(record({ noticed: { 'travel-change:seg-1:r': 123 } }));
    expect(readFlightStatusCache('fam-1')?.noticed).toEqual({ 'travel-change:seg-1:r': 123 });
  });

  it('another family is a miss', () => {
    writeFlightStatusCache(record());
    expect(readFlightStatusCache('fam-2')).toBeNull();
  });

  it('a multi-stop check with arrivalLeg null survives the round trip', () => {
    const r = record({ checks: { 'seg-1': makeCheck(makeLeg({}), { arrivalLeg: null }) } });
    writeFlightStatusCache(r);
    expect(readFlightStatusCache('fam-1')?.checks['seg-1']?.arrivalLeg).toBeNull();
  });

  it('missing is null and logs nothing', () => {
    expect(readFlightStatusCache('fam-1')).toBeNull();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['unparseable JSON', '{nope'],
    ['the wrong version', JSON.stringify({ ...record(), v: 2 })],
    [
      'a check keyed under another segment',
      JSON.stringify(record({ checks: { other: makeCheck(null) } })),
    ],
    [
      'a cached leg whose scheduledLocal is not a string',
      JSON.stringify(
        record({
          checks: {
            'seg-1': makeCheck(makeLeg({ dep: { scheduledLocal: 123 as unknown as string } })),
          },
        })
      ),
    ],
    [
      'a cached leg whose quality is not strings',
      JSON.stringify(
        record({ checks: { 'seg-1': makeCheck(makeLeg({ arr: { quality: [1] as never } })) } })
      ),
    ],
    [
      'a bad failure record',
      JSON.stringify(record({ failures: { x: { code: 'http_5xx' } as never } })),
    ],
  ])('%s is corrupt: removed and warned once', (_name, raw) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEYS.FLIGHT_STATUS, raw);
    expect(readFlightStatusCache('fam-1')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.FLIGHT_STATUS)).toBeNull();
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'travel-verify',
        message: 'flight cache corrupt',
        context: { action: 'cache_corrupt' },
      })
    );
    expect(readFlightStatusCache('fam-1')).toBeNull();
    expect(h.logEvent).toHaveBeenCalledTimes(1);
  });

  it('clear removes the key and never throws', () => {
    writeFlightStatusCache(record());
    clearFlightStatusCache();
    expect(localStorage.getItem(STORAGE_KEYS.FLIGHT_STATUS)).toBeNull();
    expect(() => clearFlightStatusCache()).not.toThrow();
  });
});

describe('pruneFlightStatusCache', () => {
  const checkedAt = Date.parse('2026-12-12T08:48:00Z');
  const live = new Set(['seg-1', 'seg-2']);

  it('returns the same object when nothing is dropped', () => {
    const r = record();
    expect(pruneFlightStatusCache(r, live, checkedAt + HOUR)).toBe(r);
  });

  it('drops the entries of deleted segments, checks and failures alike', () => {
    const out = pruneFlightStatusCache(record(), new Set(), checkedAt);
    expect(out.checks).toEqual({});
    expect(out.failures).toEqual({});
  });

  it('drops a flight 2 h after it lands, and an Arrived one at once', () => {
    const landed = Date.parse('2026-12-13T23:10:00Z');
    expect(pruneFlightStatusCache(record(), live, landed + 2 * HOUR).checks['seg-1']).toBeDefined();
    expect(
      pruneFlightStatusCache(record(), live, landed + 2 * HOUR + 1).checks['seg-1']
    ).toBeUndefined();
    const arrived = record({ checks: { 'seg-1': makeCheck(makeLeg({ status: 'Arrived' })) } });
    expect(pruneFlightStatusCache(arrived, live, checkedAt).checks).toEqual({});
  });

  it('drops first-seen stamps older than 7 days, keeps newer ones', () => {
    const now = 10 * MAX_CHECK_AGE_MS;
    const cache = record({
      noticed: { old: now - MAX_CHECK_AGE_MS - 1, fresh: now - MAX_CHECK_AGE_MS },
    });
    const out = pruneFlightStatusCache(cache, new Set(['seg-1', 'seg-2']), now);
    expect(out.noticed).toEqual({ fresh: now - MAX_CHECK_AGE_MS });
  });

  it('keeps nothing past 7 days, matched or not', () => {
    const r = record({ checks: { 'seg-1': makeCheck(null) } });
    expect(
      pruneFlightStatusCache(r, live, checkedAt + MAX_CHECK_AGE_MS).checks['seg-1']
    ).toBeDefined();
    expect(pruneFlightStatusCache(r, live, checkedAt + MAX_CHECK_AGE_MS + 1).checks).toEqual({});
  });
});
