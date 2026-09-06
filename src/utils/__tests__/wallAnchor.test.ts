import { describe, it, expect } from 'vitest';
import {
  MAX_ANCHOR_DRIFT_DAYS,
  anchorOffsetDays,
  anchorWeekDays,
  clampAnchorYmd,
  nextAnchorYmd,
  type WallStepUnit,
} from '../wallAnchor';

// 2026-09-06 is a Sunday. Monday-start weeks therefore begin 2026-08-31;
// Sunday-start weeks begin 2026-09-06 itself. Both are exercised below.
const TODAY = '2026-09-06';
const MONDAY = 1;
const SUNDAY = 0;

describe('anchorOffsetDays', () => {
  it('is signed — the property daysBetween does not have', () => {
    expect(anchorOffsetDays('2026-09-13', TODAY)).toBe(7);
    expect(anchorOffsetDays('2026-08-30', TODAY)).toBe(-7);
  });

  it('is zero on today', () => {
    expect(anchorOffsetDays(TODAY, TODAY)).toBe(0);
  });

  it('counts whole days across a month and a year boundary', () => {
    expect(anchorOffsetDays('2026-10-06', TODAY)).toBe(30);
    expect(anchorOffsetDays('2027-01-01', '2026-12-25')).toBe(7);
  });

  it('returns NaN rather than a wrong number for unparseable input', () => {
    expect(anchorOffsetDays('not-a-date', TODAY)).toBeNaN();
    expect(anchorOffsetDays(TODAY, 'not-a-date')).toBeNaN();
  });
});

describe('clampAnchorYmd', () => {
  it('passes a valid nearby date through unchanged', () => {
    expect(clampAnchorYmd('2026-09-10', TODAY)).toBe('2026-09-10');
    expect(clampAnchorYmd('2026-08-01', TODAY)).toBe('2026-08-01');
  });

  // The regression this function exists for: parseLocalDate never throws, it
  // yields an Invalid Date that toDateInputValue renders as "NaN-NaN-NaN", and
  // every downstream addDaysYmd then propagates that string forever.
  it.each([
    ['garbage', 'not-a-date'],
    ['the literal NaN string', 'NaN-NaN-NaN'],
    ['an empty string', ''],
    ['an impossible month', '2026-13-45'],
    ['a date that rolls over', '2026-02-30'],
    ['an unpadded date', '2026-9-1'],
    ['a full ISO timestamp', '2026-09-10T14:00:00.000Z'],
  ])('falls back to today for %s', (_label, input) => {
    expect(clampAnchorYmd(input, TODAY)).toBe(TODAY);
  });

  it('refuses a date beyond the drift limit in either direction', () => {
    expect(clampAnchorYmd('2028-01-01', TODAY)).toBe(TODAY);
    expect(clampAnchorYmd('2024-01-01', TODAY)).toBe(TODAY);
  });

  it('accepts a date exactly at the drift limit', () => {
    // Guards the boundary itself: `> MAX` must not be `>= MAX`.
    const edge = '2027-09-07'; // 366 days after 2026-09-06
    expect(anchorOffsetDays(edge, TODAY)).toBe(MAX_ANCHOR_DRIFT_DAYS);
    expect(clampAnchorYmd(edge, TODAY)).toBe(edge);
  });
});

describe('nextAnchorYmd', () => {
  describe('week steps from today (the forward-biased default)', () => {
    it('goes to the start of NEXT calendar week, Monday-start', () => {
      expect(nextAnchorYmd(TODAY, 'week', 1, MONDAY)).toBe('2026-09-07');
    });

    it('goes to the start of THIS calendar week going back, Monday-start', () => {
      // The first "back" shows the days already used, rather than jumping a
      // whole week past them.
      expect(nextAnchorYmd(TODAY, 'week', -1, MONDAY)).toBe('2026-08-31');
    });

    it('treats today as already week-aligned on a Sunday-start week', () => {
      // 2026-09-06 IS a Sunday, so with weekStartDay=0 it is the week start and
      // stepping is plain ±7 immediately.
      expect(nextAnchorYmd(TODAY, 'week', 1, SUNDAY)).toBe('2026-09-13');
      expect(nextAnchorYmd(TODAY, 'week', -1, SUNDAY)).toBe('2026-08-30');
    });
  });

  describe('week steps once aligned to a calendar week', () => {
    it('moves a plain seven days forward and back', () => {
      expect(nextAnchorYmd('2026-09-07', 'week', 1, MONDAY)).toBe('2026-09-14');
      expect(nextAnchorYmd('2026-09-07', 'week', -1, MONDAY)).toBe('2026-08-31');
    });

    it('crosses a month boundary', () => {
      expect(nextAnchorYmd('2026-09-28', 'week', 1, MONDAY)).toBe('2026-10-05');
    });

    it('crosses a year boundary', () => {
      expect(nextAnchorYmd('2026-12-28', 'week', 1, MONDAY)).toBe('2027-01-04');
    });
  });

  describe('week steps from an arbitrary day (after a day tap)', () => {
    it('enters the adjacent calendar week rather than preserving the offset', () => {
      // Anchored on Thursday 2026-09-10 (greg's day-tap case). Forward goes to
      // the start of next week, not to the following Thursday.
      expect(nextAnchorYmd('2026-09-10', 'week', 1, MONDAY)).toBe('2026-09-14');
      expect(nextAnchorYmd('2026-09-10', 'week', -1, MONDAY)).toBe('2026-09-07');
    });
  });

  describe('day steps', () => {
    it('moves exactly one day and never snaps to a week', () => {
      expect(nextAnchorYmd('2026-09-10', 'day', 1, MONDAY)).toBe('2026-09-11');
      expect(nextAnchorYmd('2026-09-10', 'day', -1, MONDAY)).toBe('2026-09-09');
      // Same answer regardless of week-start: a day is a day.
      expect(nextAnchorYmd('2026-09-10', 'day', 1, SUNDAY)).toBe('2026-09-11');
    });

    it('crosses month and year boundaries', () => {
      expect(nextAnchorYmd('2026-09-30', 'day', 1, MONDAY)).toBe('2026-10-01');
      expect(nextAnchorYmd('2027-01-01', 'day', -1, MONDAY)).toBe('2026-12-31');
    });
  });

  describe('daylight saving', () => {
    // Northern-hemisphere DST ends 2026-10-25 in most of Europe and
    // 2026-11-01 in the US. Stepping across either must still be whole days —
    // a naive +7*86400000 lands an hour out and can round to the wrong date.
    it.each([
      ['a spring transition', '2026-03-29'],
      ['an autumn transition', '2026-10-25'],
      ['the US autumn transition', '2026-11-01'],
    ])('steps whole days across %s', (_label, ymd) => {
      const forward = nextAnchorYmd(ymd, 'day', 1, MONDAY);
      const back = nextAnchorYmd(forward, 'day', -1, MONDAY);
      expect(back).toBe(ymd);
      expect(anchorOffsetDays(forward, ymd)).toBe(1);
    });

    it('keeps a week step exactly seven days across a transition', () => {
      const from = '2026-10-19'; // a Monday, one week before the transition
      expect(nextAnchorYmd(from, 'week', 1, MONDAY)).toBe('2026-10-26');
    });
  });

  describe('round-tripping', () => {
    it.each<[WallStepUnit, number]>([
      ['week', MONDAY],
      ['week', SUNDAY],
      ['day', MONDAY],
    ])('forward then back returns to the week start (%s, weekStart=%i)', (unit, weekStart) => {
      // From an already-aligned anchor, a step out and back is symmetric.
      const start = weekStart === MONDAY ? '2026-09-07' : '2026-09-06';
      const out = nextAnchorYmd(start, unit, 1, weekStart);
      expect(nextAnchorYmd(out, unit, -1, weekStart)).toBe(start);
    });
  });
});

describe('anchorWeekDays', () => {
  it('returns seven consecutive days starting at the anchor', () => {
    expect(anchorWeekDays(TODAY)).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
  });

  it('preserves the wall default: anchored on today means today + 6', () => {
    const days = anchorWeekDays(TODAY);
    expect(days[0]).toBe(TODAY);
    expect(days).toHaveLength(7);
    expect(anchorOffsetDays(days[6]!, TODAY)).toBe(6);
  });

  it('crosses a month boundary', () => {
    expect(anchorWeekDays('2026-09-28')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });
});
