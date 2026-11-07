import { describe, expect, it } from 'vitest';
import {
  INTERVAL_DAY_MS,
  INTERVAL_FAR_MS,
  INTERVAL_NEAR_MS,
  WINDOW_CLOSES_AFTER_MS,
  WINDOW_OPENS_BEFORE_MS,
  arrivalInstant,
  checkWindow,
  departureInstant,
  flightTiming,
  minIntervalMs,
  pickFlightRefresh,
  zonedInstant,
  type FlightRefreshInput,
} from './window';
import { makeCheck, makeFlight, makeLeg } from './__tests__/fixtures';

const HOUR = 3_600_000;
const SG = 'Asia/Singapore';

describe('zonedInstant', () => {
  it('reads a wall clock in the given zone', () => {
    expect(zonedInstant('2026-12-13', '17:00', SG)).toBe(Date.parse('2026-12-13T09:00:00Z'));
    expect(zonedInstant('2026-07-01', '09:00', 'America/Los_Angeles')).toBe(
      Date.parse('2026-07-01T16:00:00Z')
    );
  });

  it('null for a malformed date or an unknown zone', () => {
    expect(zonedInstant('2026-13', '17:00', SG)).toBeNull();
    expect(zonedInstant('2026-12-13', '17:00', 'Not/AZone')).toBeNull();
  });
});

describe('departureInstant / arrivalInstant: the single rule', () => {
  it('the cached leg UTC wins when it is on the segment date', () => {
    const leg = makeLeg({ dep: { scheduledUtc: '2026-12-13 10:30Z' } });
    expect(departureInstant(makeFlight(), makeCheck(leg), 'UTC')).toBe(
      Date.parse('2026-12-13T10:30:00Z')
    );
    expect(arrivalInstant(makeFlight(), makeCheck(leg), 'UTC')).toBe(
      Date.parse('2026-12-13T23:10:00Z')
    );
  });

  it('a leg cached for another day is not used', () => {
    const leg = makeLeg({ dep: { scheduledLocal: '2026-12-12 17:00+08:00' } });
    expect(departureInstant(makeFlight(), makeCheck(leg), SG)).toBe(
      Date.parse('2026-12-13T09:00:00Z')
    );
  });

  it('without a check: the segment wall clock in the home zone, else midnight', () => {
    expect(departureInstant(makeFlight(), undefined, SG)).toBe(Date.parse('2026-12-13T09:00:00Z'));
    expect(departureInstant(makeFlight({ departureTime: undefined }), undefined, SG)).toBe(
      Date.parse('2026-12-12T16:00:00Z')
    );
    expect(departureInstant(makeFlight({ departureDate: undefined }), undefined, SG)).toBeNull();
  });

  it('arrival falls back to the departure date, and to null without a time', () => {
    expect(arrivalInstant(makeFlight({ arrivalDate: undefined }), undefined, 'UTC')).toBe(
      Date.parse('2026-12-13T23:10:00Z')
    );
    expect(arrivalInstant(makeFlight({ arrivalTime: undefined }), undefined, 'UTC')).toBeNull();
  });

  it('a multi-stop check takes the arrival from arrivalLeg', () => {
    const second = makeLeg({ arr: { scheduledUtc: '2026-12-14 03:00Z' } });
    expect(arrivalInstant(makeFlight(), makeCheck(makeLeg({}), { arrivalLeg: second }), SG)).toBe(
      Date.parse('2026-12-14T03:00:00Z')
    );
  });
});

describe('checkWindow', () => {
  const dep = Date.parse('2026-12-13T09:00:00Z');
  const arr = dep + 14 * HOUR;

  it('opens 72 h before departure', () => {
    expect(checkWindow(dep, arr, dep - WINDOW_OPENS_BEFORE_MS - 1)).toMatchObject({
      inWindow: false,
      past: false,
      opensAt: dep - WINDOW_OPENS_BEFORE_MS,
    });
    expect(checkWindow(dep, arr, dep - WINDOW_OPENS_BEFORE_MS).inWindow).toBe(true);
  });

  it('closes 2 h after arrival', () => {
    expect(checkWindow(dep, arr, arr + WINDOW_CLOSES_AFTER_MS).inWindow).toBe(true);
    expect(checkWindow(dep, arr, arr + WINDOW_CLOSES_AFTER_MS + 1)).toMatchObject({
      inWindow: false,
      past: true,
    });
  });

  it('an unknown arrival closes on the departure', () => {
    expect(checkWindow(dep, null, dep + WINDOW_CLOSES_AFTER_MS + 1).past).toBe(true);
  });
});

describe('minIntervalMs', () => {
  const dep = Date.parse('2026-12-13T09:00:00Z');
  it.each([
    [25 * HOUR, INTERVAL_FAR_MS],
    [24 * HOUR, INTERVAL_DAY_MS],
    [4 * HOUR, INTERVAL_DAY_MS],
    [3 * HOUR, INTERVAL_NEAR_MS],
    [-1 * HOUR, INTERVAL_NEAR_MS],
  ])('%d ms before departure → %d ms', (left, want) => {
    expect(minIntervalMs(dep, dep - left)).toBe(want);
  });

  it('is 6 h / 30 min / 10 min', () => {
    expect([INTERVAL_FAR_MS, INTERVAL_DAY_MS, INTERVAL_NEAR_MS]).toEqual([
      6 * HOUR,
      30 * 60_000,
      10 * 60_000,
    ]);
  });
});

describe('flightTiming', () => {
  it('an Arrived leg is past even inside the window', () => {
    const now = Date.parse('2026-12-13T12:00:00Z');
    const timing = flightTiming(makeFlight(), makeCheck(makeLeg({ status: 'Arrived' })), SG, now);
    expect(timing).toMatchObject({ past: true, inWindow: false, departed: true });
  });

  it('no departure date: not in window, not past, the far interval', () => {
    expect(flightTiming(makeFlight({ departureDate: undefined }), undefined, SG, 0)).toMatchObject({
      departureMs: null,
      inWindow: false,
      past: false,
      minIntervalMs: INTERVAL_FAR_MS,
    });
  });
});

describe('pickFlightRefresh', () => {
  const NOW = Date.parse('2026-12-12T09:00:00Z');
  const base: FlightRefreshInput = {
    halted: false,
    entitled: true,
    enabled: true,
    configured: true,
    online: true,
    hasFlightNumber: true,
    past: false,
    inWindow: true,
    nowMs: NOW,
    lastCheckedAt: null,
    minIntervalMs: INTERVAL_DAY_MS,
    backoffUntil: 0,
  };

  it('fetches a flight never checked, and a stale one', () => {
    expect(pickFlightRefresh(base)).toEqual({ action: 'fetch', reason: 'no-check' });
    expect(pickFlightRefresh({ ...base, lastCheckedAt: NOW - INTERVAL_DAY_MS })).toEqual({
      action: 'fetch',
      reason: 'stale',
    });
  });

  it.each([
    ['halted', { halted: true }],
    ['unentitled', { entitled: false, enabled: false }],
    ['disabled', { enabled: false }],
    ['not_configured', { configured: false }],
    ['offline', { online: false }],
    ['no_flight_number', { hasFlightNumber: false }],
    ['past', { past: true, inWindow: false }],
    ['out_of_window', { inWindow: false }],
    ['backoff', { backoffUntil: NOW + 1 }],
    ['fresh', { lastCheckedAt: NOW - INTERVAL_DAY_MS + 1 }],
  ] as const)('skips: %s', (reason, over) => {
    expect(pickFlightRefresh({ ...base, ...over })).toEqual({ action: 'skip', reason });
  });

  it('freshness is by time only: a just-applied date move is still fresh', () => {
    // The store's own apply moved the date; the check it just wrote is seconds old.
    expect(pickFlightRefresh({ ...base, lastCheckedAt: NOW - 5_000 })).toEqual({
      action: 'skip',
      reason: 'fresh',
    });
  });
});

describe('the shared backoff ladder (utils/backoff.ts)', () => {
  it('weather re-exports the one ladder', async () => {
    const { nextBackoffMs } = await import('@/utils/backoff');
    const weather = await import('@/utils/weather/weatherRefresh');
    expect(weather.nextBackoffMs).toBe(nextBackoffMs);
  });

  it('5, 10, 20, 40, then 60 min; rate_limited waits the hour at once', async () => {
    const { nextBackoffMs } = await import('@/utils/backoff');
    const min = 60_000;
    expect([1, 2, 3, 4, 5, 9].map((n) => nextBackoffMs(n, 'http_5xx') / min)).toEqual([
      5, 10, 20, 40, 60, 60,
    ]);
    expect(nextBackoffMs(1, 'rate_limited')).toBe(60 * min);
  });
});
