import { describe, it, expect } from 'vitest';
import {
  monthKeyOf,
  stepMonthKey,
  sameMonth,
  monthKeyId,
  windowAround,
  windowContains,
  monthInViewFrom,
  MAX_WINDOW_MONTHS,
  type MonthKey,
} from '../useMonthStream';

// The window arithmetic and the month-in-view probe are the parts of the stream
// that can be reasoned about without a DOM — so they are pure and tested here.
// The scroll wiring itself (listener, compensation) is exercised in the
// component test and, honestly, only fully verifiable by hand: jsdom has no
// layout, so `scrollHeight` compensation cannot be simulated truthfully.

const AUG_2026: MonthKey = { y: 2026, m: 7 };

describe('month key arithmetic', () => {
  it('reads a month key off a Date', () => {
    expect(monthKeyOf(new Date(2026, 7, 29))).toEqual(AUG_2026);
  });

  it('steps forward across a year boundary', () => {
    expect(stepMonthKey({ y: 2026, m: 11 }, 1)).toEqual({ y: 2027, m: 0 });
  });

  it('steps backward across a year boundary', () => {
    expect(stepMonthKey({ y: 2026, m: 0 }, -1)).toEqual({ y: 2025, m: 11 });
  });

  it('steps by more than one month', () => {
    expect(stepMonthKey({ y: 2026, m: 10 }, 3)).toEqual({ y: 2027, m: 1 });
  });

  it('compares and ids months', () => {
    expect(sameMonth(AUG_2026, { y: 2026, m: 7 })).toBe(true);
    expect(sameMonth(AUG_2026, { y: 2025, m: 7 })).toBe(false);
    expect(monthKeyId(AUG_2026)).toBe('2026-7');
  });
});

describe('window', () => {
  it('opens with one month either side of the anchor', () => {
    const w = windowAround(AUG_2026);
    expect(w).toHaveLength(3);
    expect(w[0]).toEqual({ y: 2026, m: 6 });
    expect(w[1]).toEqual(AUG_2026);
    expect(w[2]).toEqual({ y: 2026, m: 8 });
  });

  it('wraps the year at both ends', () => {
    expect(windowAround({ y: 2026, m: 0 })[0]).toEqual({ y: 2025, m: 11 });
    expect(windowAround({ y: 2026, m: 11 })[2]).toEqual({ y: 2027, m: 0 });
  });

  it('reports membership — this is what decides whether an anchor needs a window reset', () => {
    const w = windowAround(AUG_2026);
    expect(windowContains(w, { y: 2026, m: 8 })).toBe(true);
    expect(windowContains(w, { y: 2026, m: 10 })).toBe(false);
  });

  it('bounds the DOM at a sane number of months', () => {
    // The cap is what stops an afternoon of scrolling from mounting a year of
    // day cards; the value itself is a judgement call, its existence is not.
    expect(MAX_WINDOW_MONTHS).toBeGreaterThanOrEqual(3);
    expect(MAX_WINDOW_MONTHS).toBeLessThanOrEqual(7);
  });
});

describe('monthInViewFrom — the probe that keeps the command-bar label honest', () => {
  const offsets = [
    { key: { y: 2026, m: 6 }, offsetTop: 0 },
    { key: AUG_2026, offsetTop: 1000 },
    { key: { y: 2026, m: 8 }, offsetTop: 2000 },
  ];

  it('returns the last month at or above the probe line', () => {
    expect(monthInViewFrom(offsets, 1500)).toEqual(AUG_2026);
  });

  it('switches exactly when the boundary crosses the line', () => {
    expect(monthInViewFrom(offsets, 999)).toEqual({ y: 2026, m: 6 });
    expect(monthInViewFrom(offsets, 1000)).toEqual(AUG_2026);
  });

  it('holds the last month when scrolled past every boundary', () => {
    expect(monthInViewFrom(offsets, 99999)).toEqual({ y: 2026, m: 8 });
  });

  it('falls back to the first month above the first boundary rather than reporting nothing', () => {
    // Scrolled above the first header (possible mid-prepend): the first month
    // is still the honest answer — a null here would blank the label.
    expect(monthInViewFrom(offsets, -50)).toEqual({ y: 2026, m: 6 });
  });

  it('returns null only when there is genuinely nothing rendered', () => {
    expect(monthInViewFrom([], 100)).toBeNull();
  });
});
