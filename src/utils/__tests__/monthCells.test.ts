import { describe, it, expect } from 'vitest';
import { monthCells, monthSpan } from '../monthCells';
import type { FamilyActivity, FamilyVacation, HolidayOccurrence } from '@/types/models';

// `monthCells` is the pure extraction of what used to be CalendarGrid's 180-line
// `calendarDays` computed. These tests pin the behaviour BOTH surfaces now share
// — the desktop grid and the mobile stream — so a regression here would be
// caught once rather than twice (or, before the extraction, never at scale).

function activity(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'Piano',
    category: 'music',
    date: '2026-08-10',
    isActive: true,
    recurrence: 'none',
    feeSchedule: 'none',
    reminderMinutes: 0,
    assigneeIds: [],
    createdBy: 'm1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  } as FamilyActivity;
}

const BASE = {
  year: 2026,
  month: 7, // August 2026 — starts on a Saturday
  weekStartDay: 0,
  todayStr: '2026-08-29',
  occurrences: [],
  segments: [],
  vacations: [] as FamilyVacation[],
  holidays: [] as HolidayOccurrence[],
};

describe('monthSpan', () => {
  it('covers the whole visible grid, not just the calendar month', () => {
    const { startYmd, endYmd } = monthSpan(2026, 7, 0);
    // August 2026 starts Saturday, so the grid opens with July padding.
    expect(startYmd < '2026-08-01').toBe(true);
    expect(endYmd > '2026-08-31').toBe(true);
  });
});

describe('monthCells — grid shape', () => {
  it('emits whole weeks with leading and trailing padding', () => {
    const { days } = monthCells(BASE);
    expect(days.length % 7).toBe(0);
    expect(days.filter((d) => d.isCurrentMonth)).toHaveLength(31);
    expect(days[0]!.isCurrentMonth).toBe(false); // July padding
  });

  it('marks today only within the current month', () => {
    const { days } = monthCells(BASE);
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
    expect(days.find((d) => d.isToday)!.date).toBe('2026-08-29');
  });

  it('never marks today on a padding cell that happens to match', () => {
    // September 2026 opens on a Tuesday, so its grid pads with Aug 30-31.
    // A padding cell carrying today's date must NOT claim the today styling —
    // that belongs to August's own grid.
    const { days } = monthCells({ ...BASE, month: 8, todayStr: '2026-08-30' });
    const padded = days.find((d) => d.date === '2026-08-30');
    expect(padded?.isCurrentMonth).toBe(false);
    expect(padded?.isToday).toBe(false);
    expect(days.some((d) => d.isToday)).toBe(false);
  });

  it('respects weekStartDay', () => {
    const sunday = monthCells(BASE);
    const monday = monthCells({ ...BASE, weekStartDay: 1 });
    expect(sunday.days[0]!.date).not.toBe(monday.days[0]!.date);
  });
});

describe('monthCells — occurrence partitioning', () => {
  it('puts timed activities on their day, sorted by start time', () => {
    const { days } = monthCells({
      ...BASE,
      occurrences: [
        { activity: activity({ id: 'late', startTime: '16:30' }), date: '2026-08-10' },
        { activity: activity({ id: 'early', startTime: '09:00' }), date: '2026-08-10' },
      ],
    });
    const cell = days.find((d) => d.date === '2026-08-10')!;
    expect(cell.timedOccurrences.map((o) => o.activity.id)).toEqual(['early', 'late']);
  });

  it('routes all-day activities to the all-day lane, not the timed row', () => {
    const { days } = monthCells({
      ...BASE,
      occurrences: [{ activity: activity({ isAllDay: true }), date: '2026-08-10' }],
    });
    const cell = days.find((d) => d.date === '2026-08-10')!;
    expect(cell.timedOccurrences).toHaveLength(0);
    expect(cell.allDayItems).toHaveLength(1);
  });

  it('excludes vacation-linked activities (they render as the trip bar)', () => {
    const { days } = monthCells({
      ...BASE,
      occurrences: [
        { activity: activity({ vacationId: 'v1', startTime: '09:00' }), date: '2026-08-10' },
      ],
    });
    expect(days.find((d) => d.date === '2026-08-10')!.timedOccurrences).toHaveLength(0);
  });

  it('populates padding cells too — a visible day that renders empty when it is not is worse than hiding it', () => {
    const { days } = monthCells({
      ...BASE,
      occurrences: [{ activity: activity({ startTime: '09:00' }), date: '2026-07-30' }],
    });
    const padding = days.find((d) => d.date === '2026-07-30');
    expect(padding?.isCurrentMonth).toBe(false);
    expect(padding?.timedOccurrences).toHaveLength(1);
  });
});

describe('monthCells — tint sets', () => {
  it('collects every date covered by a vacation', () => {
    const { vacationDates } = monthCells({
      ...BASE,
      vacations: [
        {
          id: 'v1',
          name: 'Japan',
          tripType: 'fly_and_stay',
          startDate: '2026-08-10',
          endDate: '2026-08-12',
        } as FamilyVacation,
      ],
    });
    expect([...vacationDates].sort()).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('ignores vacations missing either endpoint', () => {
    const { vacationDates } = monthCells({
      ...BASE,
      vacations: [{ id: 'v1', name: 'TBD', startDate: '2026-08-10' } as FamilyVacation],
    });
    expect(vacationDates.size).toBe(0);
  });

  it('collects holiday dates', () => {
    const { holidayDates, days } = monthCells({
      ...BASE,
      holidays: [{ date: '2026-08-09', name: 'National Day' } as HolidayOccurrence],
    });
    expect(holidayDates.has('2026-08-09')).toBe(true);
    expect(days.find((d) => d.date === '2026-08-09')!.holidays).toHaveLength(1);
  });
});

describe('monthCells — week separators (the mobile stream labels)', () => {
  it('places one separator per week, always on a current-month cell', () => {
    const { days, weekSeparatorIndexes } = monthCells(BASE);
    const rows = new Set(days.map((d) => d.weekRow));
    expect(weekSeparatorIndexes.size).toBe(rows.size);
    for (const i of weekSeparatorIndexes) {
      expect(days[i]!.isCurrentMonth).toBe(true);
    }
  });

  it('gives every week row label metadata, month-local so the stream labels each month independently', () => {
    const { days, weekRanges } = monthCells(BASE);
    const rows = new Set(days.map((d) => d.weekRow));
    for (const row of rows) expect(weekRanges.get(row)).toBeDefined();
    // weekRow restarts at 0 per month — that is what lets the stream render
    // several months without their separators colliding.
    expect(Math.min(...rows)).toBe(0);
  });

  it('flags the current week when today falls inside the month', () => {
    const { weekRanges } = monthCells(BASE);
    expect([...weekRanges.values()].some((w) => w.isCurrent)).toBe(true);
  });
});
