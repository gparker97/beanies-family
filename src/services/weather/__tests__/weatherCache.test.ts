/**
 * The weather device cache (#134) against happy-dom's localStorage: one key, identity by
 * family and place, a corrupt record removed (so its warning fires once), and refused
 * writes and removals surfaced rather than swallowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));

import { STORAGE_KEYS } from '@/constants/storageKeys';
import type { WeatherReading } from '@/types/weather';
import {
  clearWeatherCache,
  placeKeyOf,
  readWeatherCache,
  writeWeatherCache,
} from '../weatherCache';

const KEY = placeKeyOf({ lat: 45.52, lon: -122.68 }, 'America/Los_Angeles');

const reading: WeatherReading = {
  v: 1,
  familyId: 'fam-1',
  placeKey: KEY,
  fetchedAt: 1_800_000_000_000,
  current: { tempC: 16.9, code: 0, isDay: false },
  daily: [{ ymd: '2026-10-16', code: 3, maxC: 25.1, minC: 13.4 }],
};

const cacheEvents = (code: string) =>
  h.logEvent.mock.calls.filter(([e]) => e.context?.error_code === code);

beforeEach(() => {
  localStorage.clear();
  h.logEvent.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('placeKeyOf', () => {
  it('is 2-decimal coordinates plus the home zone', () => {
    expect(KEY).toBe('45.52,-122.68|America/Los_Angeles');
    expect(placeKeyOf({ lat: 1, lon: -0.5 }, 'UTC')).toBe('1.00,-0.50|UTC');
  });

  it('changes with the zone, so a home-zone change is a cache miss', () => {
    expect(placeKeyOf({ lat: 45.52, lon: -122.68 }, 'America/Denver')).not.toBe(KEY);
  });
});

describe('weatherCache', () => {
  it('round-trips under the one device key', () => {
    expect(writeWeatherCache(reading)).toEqual({ ok: true });
    expect(localStorage.getItem(STORAGE_KEYS.WEATHER)).not.toBeNull();
    expect(readWeatherCache('fam-1', KEY)).toEqual({ kind: 'ok', value: reading });
  });

  it('is missing with nothing stored', () => {
    expect(readWeatherCache('fam-1', KEY)).toEqual({ kind: 'missing' });
  });

  it('another family is a miss, and its reading is never shown', () => {
    writeWeatherCache(reading);
    expect(readWeatherCache('fam-2', KEY)).toEqual({ kind: 'missing' });
  });

  it('another place (or zone) is a miss', () => {
    writeWeatherCache(reading);
    expect(readWeatherCache('fam-1', '45.52,-122.68|America/Denver')).toEqual({
      kind: 'missing',
    });
  });

  it.each([
    ['unparseable JSON', '{not json'],
    ['a wrong version', JSON.stringify({ ...reading, v: 2 })],
    [
      'a non-finite temperature',
      JSON.stringify({ ...reading, current: { ...reading.current, tempC: 'x' } }),
    ],
    ['no daily list', JSON.stringify({ ...reading, daily: null })],
    ['a bad daily entry', JSON.stringify({ ...reading, daily: [{ ymd: 1 }] })],
    ['no familyId', JSON.stringify({ ...reading, familyId: undefined })],
  ])('a corrupt record (%s) is removed and warned about once', (_name, raw) => {
    localStorage.setItem(STORAGE_KEYS.WEATHER, raw);
    expect(readWeatherCache('fam-1', KEY)).toEqual({ kind: 'corrupt' });
    expect(localStorage.getItem(STORAGE_KEYS.WEATHER)).toBeNull();
    expect(readWeatherCache('fam-1', KEY)).toEqual({ kind: 'missing' });
    expect(cacheEvents('cache_corrupt')).toHaveLength(1);
  });

  it('returns a refused write instead of throwing', () => {
    const error = new DOMException('full', 'QuotaExceededError');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw error;
    });
    expect(writeWeatherCache(reading)).toEqual({ ok: false, error });
  });

  it('clearWeatherCache removes the key', () => {
    writeWeatherCache(reading);
    clearWeatherCache();
    expect(localStorage.getItem(STORAGE_KEYS.WEATHER)).toBeNull();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('a refused removal is logged, never thrown', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => clearWeatherCache()).not.toThrow();
    expect(cacheEvents('cache_clear_failed')).toHaveLength(1);
    expect(cacheEvents('cache_clear_failed')[0]![0]).toMatchObject({
      level: 'warn',
      surface: 'weather',
      message: 'weather_cache',
    });
  });
});
