import { describe, expect, it } from 'vitest';
import {
  INTERVAL_DAY_MS,
  INTERVAL_FAR_MS,
  INTERVAL_NEAR_MS,
  INTERVAL_OVERDUE_FAR_MS,
  INTERVAL_OVERDUE_MS,
  WINDOW_CLOSES_AFTER_MS,
  WINDOW_OPENS_BEFORE_MS,
  arrivalInstant,
  checkWindow,
  departureInstant,
  flightTiming,
  windowArrival,
  minIntervalMs,
  MANUAL_CHECK_FLOOR_MS,
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

  describe('a delayed flight (the estimate is later than the schedule)', () => {
    // makeLeg: departs 09:00Z, scheduled to arrive 2026-12-13 23:10Z (so the plain window
    // closes at 01:10Z on the 14th).
    const delayed = (revisedLocal: string, status = 'Delayed') =>
      makeCheck(makeLeg({ status, arr: { revisedLocal } }));
    const at = (iso: string) => Date.parse(iso);

    it('stays in the window until 2 h after the estimate, checking faster as it nears', () => {
      const check = delayed('2026-12-14 06:00+00:00');
      const timing = flightTiming(makeFlight(), check, SG, at('2026-12-14T04:00:00Z'));
      expect(timing).toMatchObject({
        inWindow: true,
        past: false,
        minIntervalMs: INTERVAL_OVERDUE_MS,
      });
      // More than 3 h from the estimate: hourly. From 1 h before it: the near floor.
      const far = delayed('2026-12-14 12:00+00:00');
      expect(flightTiming(makeFlight(), far, SG, at('2026-12-14T02:00:00Z')).minIntervalMs).toBe(
        INTERVAL_OVERDUE_FAR_MS
      );
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T05:30:00Z')).minIntervalMs).toBe(
        INTERVAL_NEAR_MS
      );
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T07:30:00Z')).minIntervalMs).toBe(
        INTERVAL_NEAR_MS
      );
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T07:59:00Z')).inWindow).toBe(true);
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T08:01:00Z'))).toMatchObject({
        inWindow: false,
        past: true,
      });
    });

    it('keeps the near floor while the scheduled window is still open', () => {
      const check = delayed('2026-12-14 06:00+00:00');
      const timing = flightTiming(makeFlight(), check, SG, at('2026-12-13T23:30:00Z'));
      expect(timing).toMatchObject({ inWindow: true, minIntervalMs: INTERVAL_NEAR_MS });
    });

    it('an estimate reads its own offset, never the device zone', () => {
      // 14:00 at +08:00 is 06:00Z.
      const check = delayed('2026-12-14 14:00+08:00');
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T07:59:00Z')).inWindow).toBe(true);
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T08:01:00Z')).past).toBe(true);
    });

    it('an Arrived leg still ends it at once', () => {
      const check = delayed('2026-12-14 06:00+00:00', 'Arrived');
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T04:00:00Z'))).toMatchObject({
        inWindow: false,
        past: true,
      });
    });

    it('an estimate earlier than the schedule, or with no zone, changes nothing', () => {
      const plain = flightTiming(
        makeFlight(),
        makeCheck(makeLeg({})),
        SG,
        at('2026-12-14T00:30:00Z')
      );
      for (const revisedLocal of ['2026-12-13 22:00+00:00', '2026-12-14 06:00']) {
        expect(
          flightTiming(makeFlight(), delayed(revisedLocal), SG, at('2026-12-14T00:30:00Z'))
        ).toEqual(plain);
        expect(
          flightTiming(makeFlight(), delayed(revisedLocal), SG, at('2026-12-14T01:30:00Z')).past
        ).toBe(true);
      }
    });

    it('a departure delayed on the ground moves the arrival by the same delay', () => {
      // Departure revised from 09:00Z to 15:00Z (+6 h), no arrival estimate yet: lands 05:10Z.
      const check = makeCheck(
        makeLeg({ status: 'Delayed', dep: { revisedLocal: '2026-12-13 15:00+00:00' } })
      );
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T07:00:00Z')).inWindow).toBe(true);
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T07:20:00Z')).past).toBe(true);
    });

    it('an arrival estimate that only echoes the schedule does not hide a ground delay', () => {
      const check = makeCheck(
        makeLeg({
          status: 'Delayed',
          dep: { revisedLocal: '2026-12-13 15:00+00:00' },
          arr: { revisedLocal: '2026-12-13 23:10+00:00' },
        })
      );
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T07:00:00Z')).inWindow).toBe(true);
    });

    it('a multi-stop flight: the sector that lands gives the delay and the Arrived', () => {
      // First sector on time and Arrived at the stopover; the last sector leaves 5 h late.
      const first = makeLeg({ status: 'Arrived' });
      const last = makeLeg({
        status: 'Delayed',
        dep: { scheduledUtc: '2026-12-13 14:00Z', revisedLocal: '2026-12-13 19:00+00:00' },
      });
      const check = { ...makeCheck(first), arrivalLeg: last };
      // Scheduled 23:10Z + 5 h = 04:10Z, window to 06:10Z; not past although sector one landed.
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T05:00:00Z'))).toMatchObject({
        inWindow: true,
        past: false,
      });
      const landed = { ...check, arrivalLeg: { ...last, status: 'Arrived' } };
      expect(flightTiming(makeFlight(), landed, SG, at('2026-12-14T05:00:00Z')).past).toBe(true);
    });

    it('the floor follows the airline\u2019s estimate, not the capped window', () => {
      // Estimate 30 h late; the window is capped at 24 h + 2 h. At hour 23 the landing is still
      // 7 h away by the airline's own estimate: hourly, not every 10 minutes.
      const check = delayed('2026-12-15 05:10+00:00');
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T22:10:00Z')).minIntervalMs).toBe(
        INTERVAL_OVERDUE_FAR_MS
      );
    });

    it('a cancelled flight lends no estimate', () => {
      for (const status of ['Canceled', 'CanceledUncertain']) {
        const check = delayed('2026-12-14 06:00+00:00', status);
        expect(flightTiming(makeFlight(), check, SG, at('2026-12-14T01:30:00Z')).past).toBe(true);
      }
    });

    it('an estimate with no scheduled instant on its own leg is not compared with the plan', () => {
      const check = makeCheck(
        makeLeg({ arr: { scheduledUtc: undefined, revisedLocal: '2026-12-14 06:00+00:00' } })
      );
      expect(
        flightTiming(makeFlight(), check, SG, at('2026-12-14T04:00:00Z')).minIntervalMs
      ).not.toBe(INTERVAL_OVERDUE_MS);
    });

    it('an absurd estimate holds the window at most 24 h past the schedule', () => {
      const check = delayed('2026-12-20 06:00+00:00');
      // Scheduled 23:10Z on the 13th: capped at 23:10Z on the 14th, plus the 2 h close.
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-15T01:00:00Z')).inWindow).toBe(true);
      expect(flightTiming(makeFlight(), check, SG, at('2026-12-15T01:20:00Z')).past).toBe(true);
    });

    it('a check for another day\u2019s flight lends no estimate', () => {
      const moved = makeFlight({ departureDate: '2026-12-20', arrivalDate: '2026-12-20' });
      const timing = flightTiming(
        moved,
        delayed('2026-12-25 06:00+00:00'),
        SG,
        at('2026-12-21T12:00:00Z')
      );
      expect(timing.past).toBe(true);
    });
  });

  it('windowArrival: the later of the schedule and the estimate, capped', () => {
    expect(windowArrival(null, 5)).toBeNull();
    expect(windowArrival(100, null)).toBe(100);
    expect(windowArrival(100, 50)).toBe(100);
    expect(windowArrival(100, 200)).toBe(200);
    expect(windowArrival(100, 100 + 25 * 3_600_000)).toBe(100 + 24 * 3_600_000);
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
    entryDone: false,
    superseded: false,
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
    ['out_of_window', { inWindow: false, entryDone: true }],
    ['backoff', { backoffUntil: NOW + 1 }],
    ['fresh', { lastCheckedAt: NOW - INTERVAL_DAY_MS + 1 }],
  ] as const)('skips: %s', (reason, over) => {
    expect(pickFlightRefresh({ ...base, ...over })).toEqual({ action: 'skip', reason });
  });

  it('a manual check only lowers the freshness floor to five minutes; every refusal still holds', () => {
    const manual = { ...base, manual: true };
    expect(
      pickFlightRefresh({ ...manual, lastCheckedAt: NOW - MANUAL_CHECK_FLOOR_MS + 1 })
    ).toEqual({ action: 'skip', reason: 'fresh' });
    expect(pickFlightRefresh({ ...manual, lastCheckedAt: NOW - MANUAL_CHECK_FLOOR_MS })).toEqual({
      action: 'fetch',
      reason: 'stale',
    });
    // Never RAISES a floor that is already tighter.
    expect(
      pickFlightRefresh({ ...manual, minIntervalMs: 60_000, lastCheckedAt: NOW - 60_000 })
    ).toEqual({ action: 'fetch', reason: 'stale' });
    expect(pickFlightRefresh({ ...manual, backoffUntil: NOW + 1 })).toEqual({
      action: 'skip',
      reason: 'backoff',
    });
    expect(pickFlightRefresh({ ...manual, inWindow: false, entryDone: true })).toEqual({
      action: 'skip',
      reason: 'out_of_window',
    });
    expect(pickFlightRefresh({ ...manual, online: false })).toEqual({
      action: 'skip',
      reason: 'offline',
    });
  });

  it('out of window: fetches once per question (entry), with or without a usable check', () => {
    const far = { ...base, inWindow: false };
    expect(pickFlightRefresh(far)).toEqual({ action: 'fetch', reason: 'entry' });
    expect(pickFlightRefresh({ ...far, lastCheckedAt: NOW - 1_000 })).toEqual({
      action: 'fetch',
      reason: 'entry',
    });
    expect(pickFlightRefresh({ ...far, entryDone: true })).toEqual({
      action: 'skip',
      reason: 'out_of_window',
    });
    expect(pickFlightRefresh({ ...far, entryDone: true, lastCheckedAt: null })).toEqual({
      action: 'skip',
      reason: 'out_of_window',
    });
  });

  it('out of window: a backoff holds an entry check', () => {
    expect(pickFlightRefresh({ ...base, inWindow: false, backoffUntil: NOW + 1 })).toEqual({
      action: 'skip',
      reason: 'backoff',
    });
  });

  it('in window: entryDone is inert (same decision for either value)', () => {
    const cases: Array<Partial<FlightRefreshInput>> = [
      {},
      { lastCheckedAt: NOW - INTERVAL_DAY_MS },
      { lastCheckedAt: NOW - INTERVAL_DAY_MS + 1 },
      { backoffUntil: NOW + 1 },
    ];
    for (const over of cases) {
      expect(pickFlightRefresh({ ...base, ...over, entryDone: true })).toEqual(
        pickFlightRefresh({ ...base, ...over, entryDone: false })
      );
    }
  });

  it('freshness is by time only: a just-applied date move is still fresh', () => {
    // The store's own apply moved the date; the check it just wrote is seconds old.
    expect(pickFlightRefresh({ ...base, lastCheckedAt: NOW - 5_000 })).toEqual({
      action: 'skip',
      reason: 'fresh',
    });
  });

  describe('superseded (a cached answer that would write over a record this device has not seen)', () => {
    const sup = { ...base, superseded: true };

    it('every device gate, the flight gates and the backoff still hold', () => {
      for (const [reason, over] of [
        ['halted', { halted: true }],
        ['unentitled', { entitled: false, enabled: false }],
        ['disabled', { enabled: false }],
        ['not_configured', { configured: false }],
        ['offline', { online: false }],
        ['no_flight_number', { hasFlightNumber: false }],
        ['past', { past: true, inWindow: false }],
        ['backoff', { backoffUntil: NOW + 1 }],
        ['backoff', { backoffUntil: NOW + 1, inWindow: false, entryDone: true }],
      ] as const) {
        expect(pickFlightRefresh({ ...sup, ...over })).toEqual({ action: 'skip', reason });
      }
    });

    it('in the window it fetches, even with a fresh lastCheckedAt (manual or not)', () => {
      for (const over of [
        {},
        { lastCheckedAt: NOW - 5_000 },
        { lastCheckedAt: NOW - 5_000, manual: true },
        { lastCheckedAt: null },
        { entryDone: true },
      ]) {
        expect(pickFlightRefresh({ ...sup, ...over })).toEqual({
          action: 'fetch',
          reason: 'superseded',
        });
      }
    });

    it('out of the window it passes the entry stamp; with no stamp yet it is the entry check', () => {
      const far = { ...sup, inWindow: false };
      expect(pickFlightRefresh({ ...far, entryDone: true })).toEqual({
        action: 'fetch',
        reason: 'superseded',
      });
      expect(pickFlightRefresh({ ...far, entryDone: true, lastCheckedAt: NOW - 1_000 })).toEqual({
        action: 'fetch',
        reason: 'superseded',
      });
      expect(pickFlightRefresh({ ...far, entryDone: false })).toEqual({
        action: 'fetch',
        reason: 'entry',
      });
    });

    it('superseded: false changes no decision (the existing cases above run with it)', () => {
      const cases: Array<Partial<FlightRefreshInput>> = [
        {},
        { lastCheckedAt: NOW - 5_000 },
        { inWindow: false },
        { inWindow: false, entryDone: true },
      ];
      const { superseded: _s, ...withoutKey } = base;
      for (const over of cases) {
        expect(pickFlightRefresh({ ...base, ...over })).toEqual(
          pickFlightRefresh({ ...(withoutKey as FlightRefreshInput), ...over })
        );
      }
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
