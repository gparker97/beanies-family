import { describe, it, expect } from 'vitest';
import {
  assignMonthLayout,
  cellCapacity,
  faceCluster,
  fitCount,
  minRowPx,
  stepDensity,
} from '../monthGridLayout';
import { dayItemKey, dayItems } from '../monthDayItems';
import { monthCells, type MonthDayCellData } from '../monthCells';
import { MONTH_CELL_METRICS, PHONE_DENSITIES, monthCellCssVars } from '@/constants/calendarCaps';
import { addDaysYmd } from '@/utils/date';
import { allDay, cell, itemIds, member, timed, trip } from '@/test/monthCellFixtures';
import type { FamilyActivity, FamilyVacation } from '@/types/models';

const compact = MONTH_CELL_METRICS.compact;
const comfortable = MONTH_CELL_METRICS.comfortable;
const titles = MONTH_CELL_METRICS.titles;

// Worked numbers (plan §2). At a 16px root:
//   Compact:     base 22px, slot 22px, gap 2px, lane 22px, more 16px
//   Comfortable: base 26px, slot 30px, gap 2px, lane 26px, more 16px
//   Titles:      base 24px, slot 16.5px, gap 1.5px, lane 10.5px, more 12px
describe('fitCount', () => {
  const fit = (rowPx: number, metrics = compact, hasLane = false, remPx = 16) =>
    fitCount({ rowPx, remPx, metrics, hasLane });

  it('Compact: 3 chips for rows 86-107, 4 from 108 (both sides of each threshold)', () => {
    expect(fit(85)).toBe(2);
    expect(fit(86)).toBe(3);
    expect(fit(87)).toBe(3);
    expect(fit(107)).toBe(3);
    expect(fit(108)).toBe(4);
  });

  it('Compact with a lane: 2 for rows 86-107, 3 from 108', () => {
    expect(fit(85, compact, true)).toBe(1);
    expect(fit(86, compact, true)).toBe(2);
    expect(fit(87, compact, true)).toBe(2);
    expect(fit(107, compact, true)).toBe(2);
    expect(fit(108, compact, true)).toBe(3);
  });

  it('Comfortable: 2 chips at a 87px row, 1 with a lane', () => {
    // The formula gives 2 chips for rows 84-113 (the plan's table says 85-114, an
    // off-by-one in its prose; its formula and its 87px case agree with this).
    expect(fit(83, comfortable)).toBe(1);
    expect(fit(84, comfortable)).toBe(2);
    expect(fit(87, comfortable)).toBe(2);
    expect(fit(113, comfortable)).toBe(2);
    expect(fit(114, comfortable)).toBe(3);
    expect(fit(87, comfortable, true)).toBe(1);
  });

  it('Titles: 5 chips needs exactly a 104px row (the EPS case), 4 with a lane', () => {
    // padBottomRem 0.125 (the plan's lever, applied 2026-11-04): the exact threshold is 104.
    expect(fit(103, titles)).toBe(4);
    expect(fit(104, titles)).toBe(5);
    expect(fit(104, titles, true)).toBe(4);
  });

  it('Large mode (19px root) fits fewer: Compact 2 at an 87px row', () => {
    expect(fit(87, compact, false, 19)).toBe(2);
    expect(fit(87, compact, false, 19)).toBeLessThan(fit(87, compact, false, 16));
  });

  it('never goes negative for a tiny row', () => {
    expect(fit(10)).toBe(0);
  });
});

describe('cellCapacity', () => {
  const cap = (
    count: number,
    rowPx: number | null,
    metrics = compact,
    hasLane = false,
    remPx = 16
  ) => cellCapacity({ rowPx, remPx, metrics, hasLane, count });

  it('shows everything when it all fits', () => {
    expect(cap(3, 87)).toEqual({ shown: 3, hidden: 0 });
    expect(cap(0, 87)).toEqual({ shown: 0, hidden: 0 });
  });

  it('Compact overflow at 87px: 2 chips plus "+N more"', () => {
    expect(cap(5, 87)).toEqual({ shown: 2, hidden: 3 });
  });

  it('Compact overflow at 87px with a lane: 1 chip plus "+N more"', () => {
    expect(cap(4, 87, compact, true)).toEqual({ shown: 1, hidden: 3 });
  });

  it('Compact: one more than fits reserves the more line, so shows one fewer', () => {
    expect(cap(4, 87)).toEqual({ shown: 2, hidden: 2 });
    expect(cap(4, 108)).toEqual({ shown: 4, hidden: 0 });
    expect(cap(5, 108)).toEqual({ shown: 3, hidden: 2 });
  });

  it('Comfortable overflow at 87px: 1 chip plus more', () => {
    expect(cap(3, 87, comfortable)).toEqual({ shown: 1, hidden: 2 });
  });

  it('Comfortable overflow at 87px with a lane: 0 chips, only the bar and "+N more"', () => {
    expect(cap(2, 87, comfortable, true)).toEqual({ shown: 0, hidden: 2 });
  });

  it('Titles at 105px: 5 fit, 6 overflow to 4 + more; a lane leaves room for 4', () => {
    expect(cap(5, 105, titles)).toEqual({ shown: 5, hidden: 0 });
    expect(cap(6, 105, titles)).toEqual({ shown: 4, hidden: 2 });
    // With a lane 4 fit, but overflow also reserves the "+N" line: 3 chips + more.
    expect(cap(4, 105, titles, true)).toEqual({ shown: 4, hidden: 0 });
    expect(cap(5, 105, titles, true)).toEqual({ shown: 3, hidden: 2 });
  });

  it('Large mode recomputes: Compact at 87px overflows to 2 shown at 19px, never more than fits', () => {
    const large = cap(5, 87, compact, false, 19);
    const normal = cap(5, 87, compact, false, 16);
    expect(large.shown).toBeLessThanOrEqual(normal.shown);
    expect(large.shown + large.hidden).toBe(5);
  });

  it('falls back to metrics.fallbackSlots when the row is not measured', () => {
    expect(cap(10, null)).toEqual({ shown: 3, hidden: 7 });
    expect(cap(2, null)).toEqual({ shown: 2, hidden: 0 });
    expect(cap(10, null, comfortable)).toEqual({ shown: 2, hidden: 8 });
    expect(cap(10, null, MONTH_CELL_METRICS.faces)).toEqual({ shown: 0, hidden: 10 });
  });

  it('never shows a negative number of chips', () => {
    expect(cap(3, 20).shown).toBe(0);
  });
});

describe('minRowPx', () => {
  it('Compact at 16px: border + pads + numeral + lane + gap + chip', () => {
    // 1 + (0.125 + 0.0625 + 1.125 + 1.25 + 0.125 + 1.25) * 16
    expect(minRowPx(compact, 16)).toBe(64);
  });

  it('scales with the root size', () => {
    expect(minRowPx(compact, 19)).toBeCloseTo(1 + 3.9375 * 19);
  });

  it('Bars uses moreRem (0.75) because it exceeds chipRem (0.375)', () => {
    const bars = MONTH_CELL_METRICS.bars;
    expect(bars.moreRem).toBeGreaterThan(bars.chipRem);
    expect(minRowPx(bars, 16)).toBe(1 + 2.9375 * 16); // 48, not 42
  });

  it('Faces uses its tall chipRem (the face cluster)', () => {
    expect(minRowPx(MONTH_CELL_METRICS.faces, 16)).toBe(71);
  });
});

// ── assignMonthLayout ────────────────────────────────────────────────────────

/** Seven cells (a Sun-Sat week) starting 2026-05-17, each built by `build(col)`. */
function week(
  build: (col: number, date: string) => Partial<MonthDayCellData> = () => ({}),
  start = '2026-05-17'
): MonthDayCellData[] {
  return Array.from({ length: 7 }, (_, col) => {
    const date = addDaysYmd(start, col);
    return cell({ date, weekRow: 0, ...build(col, date) });
  });
}

/** All-day slices of one run over `cols`; `firstCol`/`lastCol` mark the true ends (default: ends of `cols`). */
function runOver(
  id: string,
  cols: number[],
  ends: { startsHere?: boolean; endsHere?: boolean } = {}
) {
  const { startsHere = true, endsHere = true } = ends;
  return (col: number, date: string) => {
    if (!cols.includes(col)) return null;
    return allDay(id, {
      spanKey: `${id}:run`,
      date,
      isFirstDay: startsHere && col === cols[0],
      isLastDay: endsHere && col === cols[cols.length - 1],
    });
  };
}

describe('assignMonthLayout', () => {
  it('returns one layout per cell, aligned to days, across several week rows', () => {
    const days = [...week(), ...week(() => ({}), '2026-05-24')];
    expect(assignMonthLayout(days)).toHaveLength(14);
  });

  it('gives a day with nothing on it no lane and an empty stack', () => {
    const [first] = assignMonthLayout(week());
    expect(first).toEqual({ lane: null, stack: [] });
  });

  it('a trip beats an all-day activity over the same columns', () => {
    const ad = runOver('ad', [1, 2, 3]);
    const days = week((col, date) => ({
      vacations: [1, 2, 3].includes(col)
        ? [trip('t', { isStart: col === 1, isEnd: col === 3 })]
        : [],
      allDayItems: [ad(col, date)].filter((x) => x !== null),
    }));
    const layouts = assignMonthLayout(days);
    for (const col of [1, 2, 3]) {
      expect(layouts[col]!.lane!.item.kind).toBe('trip');
      expect(itemIds(layouts[col]!.stack)).toEqual(['allday:ad']);
    }
    expect(layouts[0]!.lane).toBeNull();
  });

  it('on a collision the earlier-starting run wins and the other stays in the stack', () => {
    const a = runOver('a', [0, 1, 2]);
    const b = runOver('b', [1, 2, 3]);
    const days = week((col, date) => ({
      allDayItems: [a(col, date), b(col, date)].filter((x) => x !== null),
    }));
    const layouts = assignMonthLayout(days);
    expect(
      layouts
        .slice(0, 3)
        .map((l) => (l.lane!.item as { item: { activity: FamilyActivity } }).item.activity.id)
    ).toEqual(['a', 'a', 'a']);
    expect(itemIds(layouts[1]!.stack)).toEqual(['allday:b']);
    expect(itemIds(layouts[2]!.stack)).toEqual(['allday:b']);
    // The loser keeps the whole run in the stack, including the column where the lane is free.
    expect(layouts[3]!.lane).toBeNull();
    expect(itemIds(layouts[3]!.stack)).toEqual(['allday:b']);
  });

  it('with equal starts the longer run wins', () => {
    const short = runOver('short', [0, 1]);
    const long = runOver('long', [0, 1, 2, 3]);
    const days = week((col, date) => ({
      allDayItems: [short(col, date), long(col, date)].filter((x) => x !== null),
    }));
    const layouts = assignMonthLayout(days);
    expect(layouts[0]!.lane!.item.kind).toBe('allday');
    expect(itemIds(layouts[0]!.stack)).toEqual(['allday:short']);
    expect(layouts[3]!.lane).not.toBeNull();
  });

  it('a run that no longer collides takes a free lane on its own columns', () => {
    const a = runOver('a', [0, 1]);
    const b = runOver('b', [3, 4]);
    const layouts = assignMonthLayout(
      week((col, date) => ({ allDayItems: [a(col, date), b(col, date)].filter((x) => x !== null) }))
    );
    expect(layouts[0]!.lane).not.toBeNull();
    expect(layouts[3]!.lane).not.toBeNull();
    expect(layouts[3]!.stack).toEqual([]);
  });

  it('flags isStart/isEnd on the true ends only, and the label on the first day', () => {
    const r = runOver('r', [2, 3, 4]);
    const layouts = assignMonthLayout(
      week((col, date) => ({ allDayItems: [r(col, date)].filter((x) => x !== null) }))
    );
    expect(layouts[2]!.lane!.run).toEqual({ isStart: true, isEnd: false, showLabel: true });
    expect(layouts[3]!.lane!.run).toEqual({ isStart: false, isEnd: false, showLabel: false });
    expect(layouts[4]!.lane!.run).toEqual({ isStart: false, isEnd: true, showLabel: false });
  });

  it('shows the label at column 0 for a run that wrapped in from the previous week', () => {
    const r = runOver('r', [0, 1, 2], { startsHere: false });
    const layouts = assignMonthLayout(
      week((col, date) => ({ allDayItems: [r(col, date)].filter((x) => x !== null) }))
    );
    expect(layouts[0]!.lane!.run).toEqual({ isStart: false, isEnd: false, showLabel: true });
    expect(layouts[1]!.lane!.run.showLabel).toBe(false);
    expect(layouts[2]!.lane!.run).toEqual({ isStart: false, isEnd: true, showLabel: false });
  });

  it("shows a continuing run's end unrounded when it carries on into the next week", () => {
    const r = runOver('r', [4, 5, 6], { endsHere: false });
    const layouts = assignMonthLayout(
      week((col, date) => ({ allDayItems: [r(col, date)].filter((x) => x !== null) }))
    );
    expect(layouts[6]!.lane!.run.isEnd).toBe(false);
    expect(layouts[4]!.lane!.run).toMatchObject({ isStart: true, showLabel: true });
  });

  it('trips: label on the start day and at column 0, true ends from the trip', () => {
    const layouts = assignMonthLayout(
      week((col) => ({
        vacations: col <= 2 ? [trip('t', { isStart: false, isEnd: col === 2 })] : [],
      }))
    );
    expect(layouts[0]!.lane!.run).toEqual({ isStart: false, isEnd: false, showLabel: true });
    expect(layouts[1]!.lane!.run.showLabel).toBe(false);
    expect(layouts[2]!.lane!.run.isEnd).toBe(true);
  });

  it('carries a trip across the month edge into the padding cells', () => {
    // August 2026 (Sunday start) ends on a Monday; Aug 30 - Sep 3 crosses into September padding.
    const vacation = {
      id: 'v1',
      name: 'Japan',
      tripType: 'fly_and_stay',
      startDate: '2026-08-30',
      endDate: '2026-09-03',
    } as FamilyVacation;
    const { days } = monthCells({
      year: 2026,
      month: 7,
      weekStartDay: 0,
      todayStr: '2026-08-01',
      occurrences: [],
      segments: [],
      vacations: [vacation],
      extras: [],
    });
    const layouts = assignMonthLayout(days);
    const at = (date: string) => layouts[days.findIndex((d) => d.date === date)]!;
    expect(at('2026-08-30').lane!.run).toMatchObject({ isStart: true, showLabel: true });
    const sep1 = at('2026-09-01');
    expect(days.find((d) => d.date === '2026-09-01')!.isCurrentMonth).toBe(false);
    expect(sep1.lane!.item.kind).toBe('trip');
    expect(at('2026-09-03').lane!.run.isEnd).toBe(true);
    expect(at('2026-09-04').lane).toBeNull();
  });

  it('stack equals dayItems minus the lane winner, in dayItems order', () => {
    const win = runOver('win', [0, 1, 2]);
    const lose = runOver('lose', [1]);
    const days = week((col, date) => ({
      allDayItems: [win(col, date), lose(col, date)].filter((x) => x !== null),
      timedOccurrences: col === 1 ? [timed('t2', '10:00'), timed('t1', '08:00')] : [],
    }));
    const layouts = assignMonthLayout(days);
    const day = days[1]!;
    const laneKey = dayItemKey(layouts[1]!.lane!.item);
    expect(layouts[1]!.stack.map(dayItemKey)).toEqual(
      dayItems(day)
        .map(dayItemKey)
        .filter((k) => k !== laneKey)
    );
    expect(itemIds(layouts[1]!.stack)).toEqual(['allday:lose', 'timed:t1', 'timed:t2']);
  });
});

describe('stepDensity', () => {
  it('steps up and down through the phone densities', () => {
    expect(stepDensity('faces', 1)).toBe('bars');
    expect(stepDensity('bars', 1)).toBe('titles');
    expect(stepDensity('titles', -1)).toBe('bars');
    expect(stepDensity('bars', -1)).toBe('faces');
  });

  it('clamps at both ends', () => {
    expect(stepDensity('titles', 1)).toBe('titles');
    expect(stepDensity('faces', -1)).toBe('faces');
  });

  it('stays within PHONE_DENSITIES', () => {
    for (const d of PHONE_DENSITIES) {
      expect(PHONE_DENSITIES).toContain(stepDensity(d, 1));
      expect(PHONE_DENSITIES).toContain(stepDensity(d, -1));
    }
  });
});

describe('faceCluster', () => {
  const [a, b, c, d, e, f] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => member(id));

  it('returns the distinct members in first-seen order', () => {
    expect(faceCluster([[a!, b!], [b!, c!], [a!]])).toEqual({ shown: [a, b, c], extra: 0 });
  });

  it('caps at 4 by default and counts the extra', () => {
    expect(
      faceCluster([
        [a!, b!, c!],
        [d!, e!, f!],
      ])
    ).toEqual({ shown: [a, b, c, d], extra: 2 });
  });

  it('honours a custom max', () => {
    expect(faceCluster([[a!, b!, c!]], 2)).toEqual({ shown: [a, b], extra: 1 });
  });

  it('is empty for no members', () => {
    expect(faceCluster([])).toEqual({ shown: [], extra: 0 });
    expect(faceCluster([[], []])).toEqual({ shown: [], extra: 0 });
  });
});

describe('monthCellCssVars', () => {
  it('maps each metric to its custom property in rem', () => {
    expect(monthCellCssVars(compact)).toEqual({
      '--mg-pad-t': '0.125rem',
      '--mg-pad-b': '0.0625rem',
      '--mg-numeral-h': '1.125rem',
      '--mg-lane-h': '1.25rem',
      '--mg-chip-h': '1.25rem',
      '--mg-gap': '0.125rem',
      '--mg-more-h': '1rem',
    });
  });

  it('reads every density from its own metrics', () => {
    for (const m of Object.values(MONTH_CELL_METRICS)) {
      const vars = monthCellCssVars(m);
      expect(vars['--mg-chip-h']).toBe(`${m.chipRem}rem`);
      expect(vars['--mg-gap']).toBe(`${m.gapRem}rem`);
      expect(vars['--mg-more-h']).toBe(`${m.moreRem}rem`);
    }
  });
});
