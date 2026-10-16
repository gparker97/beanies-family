import { describe, expect, it } from 'vitest';
import {
  REFRESH_AFTER_MS,
  nextBackoffMs,
  pickWeatherRefresh,
  type WeatherRefreshInput,
} from '../weatherRefresh';

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const base: WeatherRefreshInput = {
  halted: false,
  docReady: true,
  hasFamily: true,
  enabled: true,
  hasPlace: true,
  online: true,
  ageMs: null,
  now: NOW,
  backoffUntil: 0,
};

describe('pickWeatherRefresh', () => {
  it('fetches when there is no reading', () => {
    expect(pickWeatherRefresh(base)).toEqual({ action: 'fetch', reason: 'no-reading' });
  });

  it('fetches a reading 30 minutes old or more, skips a younger one as fresh', () => {
    expect(pickWeatherRefresh({ ...base, ageMs: REFRESH_AFTER_MS })).toEqual({
      action: 'fetch',
      reason: 'stale',
    });
    expect(pickWeatherRefresh({ ...base, ageMs: REFRESH_AFTER_MS - 1 })).toEqual({
      action: 'skip',
      reason: 'fresh',
    });
  });

  it.each([
    ['halted', { halted: true }],
    ['pre-hydration', { docReady: false }],
    ['pre-hydration', { hasFamily: false }],
    ['disabled', { enabled: false }],
    ['no-place', { hasPlace: false }],
    ['offline', { online: false }],
    ['backoff', { backoffUntil: NOW + 1 }],
  ] as const)('skips with %s', (reason, over) => {
    expect(pickWeatherRefresh({ ...base, ...over })).toEqual({ action: 'skip', reason });
  });

  it('checks the reasons in order: halted before everything, backoff before fresh', () => {
    expect(
      pickWeatherRefresh({ ...base, halted: true, docReady: false, enabled: false, online: false })
    ).toEqual({ action: 'skip', reason: 'halted' });
    expect(pickWeatherRefresh({ ...base, docReady: false, enabled: false })).toEqual({
      action: 'skip',
      reason: 'pre-hydration',
    });
    expect(pickWeatherRefresh({ ...base, enabled: false, hasPlace: false })).toEqual({
      action: 'skip',
      reason: 'disabled',
    });
    expect(pickWeatherRefresh({ ...base, hasPlace: false, online: false })).toEqual({
      action: 'skip',
      reason: 'no-place',
    });
    expect(pickWeatherRefresh({ ...base, online: false, backoffUntil: NOW + 1 })).toEqual({
      action: 'skip',
      reason: 'offline',
    });
    expect(pickWeatherRefresh({ ...base, backoffUntil: NOW + 1, ageMs: 0 })).toEqual({
      action: 'skip',
      reason: 'backoff',
    });
  });

  it('a backoff that has run out no longer holds', () => {
    expect(pickWeatherRefresh({ ...base, backoffUntil: NOW }).action).toBe('fetch');
  });
});

describe('nextBackoffMs', () => {
  it('grows 5, 10, 20, 40, then holds at 60 minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => nextBackoffMs(n, 'http_5xx') / MIN)).toEqual([
      5, 10, 20, 40, 60, 60, 60,
    ]);
  });

  it('waits the full hour straight away after a 429', () => {
    expect(nextBackoffMs(1, 'rate_limited')).toBe(60 * MIN);
  });

  it('is the same ladder for every non-quota failure', () => {
    for (const code of ['network', 'timeout', 'http_4xx', 'parse'] as const) {
      expect(nextBackoffMs(1, code)).toBe(5 * MIN);
      expect(nextBackoffMs(3, code)).toBe(20 * MIN);
    }
  });
});
