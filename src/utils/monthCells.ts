// Pure per-month calendar-cell computation — no stores, no Vue, no I/O.
//
// Extracted from `CalendarGrid.vue`'s `calendarDays` computed so BOTH month
// surfaces can share one implementation: the desktop 7-column grid (one month)
// and the mobile continuous stream (a window of several months). Keeping it a
// pure module rather than a function inside either SFC is what stops the second
// consumer from importing the first's internals — or, worse, copying the maths.
//
// The caller passes PREFETCHED range data (one store query spanning the whole
// window) rather than the stores themselves. That is deliberate: the stream
// renders 3-5 months, and per-month store queries would triple-to-quintuple the
// scans on every recompute.

import type { ActivityOccurrence } from '@/utils/calendar/occurrence';
import {
  addDaysYmd,
  extractDatePart,
  formatNookDate,
  toDateInputValue,
  monthGridRange,
  MONTH_GRID_CELLS,
} from '@/utils/date';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { tripTypeEmoji, type TravelSegmentOccurrence } from '@/utils/vacation';
import { relativeWeekLabelKey, type RelativeWeekLabelKey } from '@/utils/calendarWeek';
import type { FamilyActivity, FamilyVacation } from '@/types/models';
import type { DayExtra } from '@/utils/calendarDay';
import { isAllDayActivity, spanOffsetDays } from '@/utils/calendar/activityDays';

// ── Cell types ─────────────────────────────────────────────────────────────
// The outputs of this module. They used to live in `MonthDayCard.vue`, which
// made a pure util import its types from a component; they live with the code
// that builds them now (#141).

/**
 * One all-day activity on one day: a slice of a run when the activity spans
 * several days, or the whole of a single-day one.
 */
export interface CellAllDayItem {
  activity: FamilyActivity;
  /**
   * The ONLY key that groups all-day slices into one run:
   * `${activity.id}:${span.startYmd}` for a span (a one-off's `date`, or the
   * repeat's own start, never the row-clipped start), `${activity.id}:${date}`
   * for a single day. `computeAllDaySpans` alone decides which days join.
   */
  spanKey: string;
  /** This cell is the run's true first day (not merely the first in its week row). True for singles. */
  isFirstDay: boolean;
  /** This cell is the run's true last day (not merely the last in its week row). True for singles. */
  isLastDay: boolean;
}

export interface CellVacation {
  id: string;
  name: string;
  emoji: string;
  /** First covered day of the trip (the unclipped trip start), so it is the true end. */
  isStart: boolean;
  /** Last covered day of the trip (the unclipped trip end), so a multi-day trip
   *  reads as one connected band across its cells. */
  isEnd: boolean;
  /** The trip's travellers (`FamilyVacation.assigneeIds`), resolved to members by
   *  `membersByIds` at the render site. */
  travellerIds: string[];
}

export interface CellTimedOccurrence {
  activity: FamilyActivity;
  date: string;
}

export interface MonthDayCellData {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  weekRow: number;
  timedOccurrences: CellTimedOccurrence[];
  vacations: CellVacation[];
  segments: TravelSegmentOccurrence[];
  allDayItems: CellAllDayItem[];
  /** Birthdays, public holidays, trips: one list, from `useDayExtras`. */
  extras: DayExtra[];
}

/**
 * Split a month's cells into week rows of 7. The ONE row split, shared by
 * `monthCellsFrom`'s per-row passes, `assignMonthLayout` and `CalendarGrid`.
 */
export function weekRows<T>(days: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return rows;
}

/** One activity occurrence as `activityStore.activitiesInRange` yields it: the
 *  shared shape (`calendar/occurrence.ts`), `repeatStart` included. */
export type ActivityOccurrenceInput = ActivityOccurrence;

/** Week-separator metadata for the mobile stream's per-week label rows. */
export interface WeekRangeMeta {
  range: string;
  labelKey: RelativeWeekLabelKey;
  isCurrent: boolean;
}

export interface MonthCellsInput {
  year: number;
  /** 0-indexed, matching `Date.getMonth()`. */
  month: number;
  weekStartDay: number;
  /** Reactive "today" as `YYYY-MM-DD` (from `useToday`), so cells mark today correctly. */
  todayStr: string;
  /** Prefetched over a span that CONTAINS this month's grid range (see `monthSpan`). */
  occurrences: ActivityOccurrenceInput[];
  segments: TravelSegmentOccurrence[];
  /** All vacations — filtered to the span (the store holds few). */
  vacations: FamilyVacation[];
  /**
   * Everything on these days that is NOT one of the family's own activities:
   * birthdays, public holidays, trips. ONE list, from `useDayExtras`, which the
   * beanie wall asks too — see `utils/calendarDay.ts` for why these stopped
   * being separate arrays.
   */
  extras: DayExtra[];
}

/**
 * Date-keyed lookups built ONCE for a whole window of months.
 *
 * The stream renders up to five months; partitioning the window's occurrences
 * inside each month's build made that work O(months x span) — five passes over
 * every occurrence, five maps each holding all of them, and a fresh day-by-day
 * expansion of every vacation per month. All of it inside the scroll rAF, where
 * `docs/PERFORMANCE.md` budgets a computed at <16ms. Prepare once, build many.
 */
export interface PreparedCellData {
  timed: Map<string, CellTimedOccurrence[]>;
  allDay: ActivityOccurrence[];
  segments: Map<string, TravelSegmentOccurrence[]>;
  vacations: Map<string, CellVacation[]>;
  vacationDates: Set<string>;
  extras: Map<string, DayExtra[]>;
  /** Dates carrying a public holiday — drives the cell tint, not the chips. */
  holidayDates: Set<string>;
}

export interface PrepareCellDataInput {
  occurrences: ActivityOccurrenceInput[];
  segments: TravelSegmentOccurrence[];
  vacations: FamilyVacation[];
  extras: DayExtra[];
  /** Inclusive window bounds — vacations are clipped to this, so a trip with a
   *  mistyped multi-decade end date cannot expand into a six-figure loop. */
  spanStart: string;
  spanEnd: string;
}

export function prepareCellData(input: PrepareCellDataInput): PreparedCellData {
  const timed = new Map<string, CellTimedOccurrence[]>();
  const allDay: ActivityOccurrence[] = [];
  for (const occ of input.occurrences) {
    // Vacation-linked activities render as the trailing vacation bar.
    if (occ.activity.vacationId) continue;
    // ⚠️ `isAllDayActivity`, NOT the raw `isAllDay` flag. An activity can carry
    // `isAllDay: true` AND a leftover `startTime`, and the week/day views split
    // on `!startTime` — so the same event was an all-day chip here and a timed
    // block there. One predicate, every surface.
    if (isAllDayActivity(occ.activity)) {
      // Whole occurrence: `repeatStart` groups a multi-day repeat's days.
      allDay.push(occ);
      continue;
    }
    if (!timed.has(occ.date)) timed.set(occ.date, []);
    timed.get(occ.date)!.push({ activity: occ.activity, date: occ.date });
  }
  for (const list of timed.values()) {
    list.sort((a, b) =>
      (a.activity.startTime ?? '99:99').localeCompare(b.activity.startTime ?? '99:99')
    );
  }

  const segments = new Map<string, TravelSegmentOccurrence[]>();
  for (const occ of input.segments) {
    if (!segments.has(occ.date)) segments.set(occ.date, []);
    segments.get(occ.date)!.push(occ);
  }

  const vacations = new Map<string, CellVacation[]>();
  const vacationDates = new Set<string>();
  for (const v of input.vacations) {
    if (!v.startDate || !v.endDate) continue;
    const vStart = extractDatePart(v.startDate);
    const vEnd = extractDatePart(v.endDate);
    if (vEnd < input.spanStart || vStart > input.spanEnd) continue; // outside the window
    const from = vStart < input.spanStart ? input.spanStart : vStart;
    const to = vEnd > input.spanEnd ? input.spanEnd : vEnd;
    const emoji = tripTypeEmoji(v.tripType, v.tripPurpose);
    const startD = new Date(from + 'T00:00:00');
    const endD = new Date(to + 'T00:00:00');
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const dateStr = toDateInputValue(d);
      if (!vacations.has(dateStr)) vacations.set(dateStr, []);
      vacations.get(dateStr)!.push({
        id: v.id,
        name: v.name,
        emoji,
        isStart: dateStr === vStart,
        isEnd: dateStr === vEnd,
        travellerIds: v.assigneeIds ?? [],
      });
      vacationDates.add(dateStr);
    }
  }

  const extras = new Map<string, DayExtra[]>();
  const holidayDates = new Set<string>();
  for (const extra of input.extras) {
    if (!extras.has(extra.ymd)) extras.set(extra.ymd, []);
    extras.get(extra.ymd)!.push(extra);
    // ONLY a holiday tints the cell. A birthday is a chip, not a reason to
    // repaint the day — the tint means "the country is off today".
    if (extra.kind === 'holiday') holidayDates.add(extra.ymd);
  }

  return {
    timed,
    allDay,
    segments,
    vacations,
    vacationDates,
    extras,
    holidayDates,
  };
}

export interface MonthCellsResult {
  days: MonthDayCellData[];
  /** Indexes in `days` that should be preceded by a week separator (mobile). */
  weekSeparatorIndexes: Set<number>;
  /** Per-weekRow label metadata for those separators. */
  weekRanges: Map<number, WeekRangeMeta>;
  /** Dates covered by a vacation — drives the cell tint. */
  vacationDates: Set<string>;
  /** Dates carrying a public holiday — drives the cell tint. */
  holidayDates: Set<string>;
}

/**
 * The full visible date span of one month's grid, INCLUDING the leading/trailing
 * padding days. Callers use this to size a single prefetch across a window of
 * months: take `monthSpan(first).startYmd` … `monthSpan(last).endYmd`.
 */
export function monthSpan(
  year: number,
  month: number,
  weekStartDay: number
): { startYmd: string; endYmd: string } {
  return monthGridRange(new Date(year, month, 1), weekStartDay);
}

/**
 * Build one month's day cells plus its week-separator metadata.
 *
 * Behaviour is preserved verbatim from the original `calendarDays` computed —
 * including that padding cells receive their occurrences too (a visible day that
 * renders empty when it isn't reads as "nothing on", which is worse than not
 * showing the day), and that `computeAllDaySpans` runs ONCE per week row rather
 * than once per cell.
 *
 * `weekRow` is month-local (0..5). For the stream that is correct and desirable:
 * each month's separators label that month's own weeks.
 */
export function monthCells(input: MonthCellsInput): MonthCellsResult {
  const { year, month, weekStartDay, todayStr } = input;
  const { startYmd, endYmd } = monthSpan(year, month, weekStartDay);
  return monthCellsFrom(
    { year, month, weekStartDay, todayStr },
    prepareCellData({
      occurrences: input.occurrences,
      segments: input.segments,
      vacations: input.vacations,
      extras: input.extras,
      spanStart: startYmd,
      spanEnd: endYmd,
    })
  );
}

/**
 * Build one month's cells from data already prepared for the whole window.
 * This is the hot path the stream calls once per rendered month.
 */
export function monthCellsFrom(
  meta: { year: number; month: number; weekStartDay: number; todayStr: string },
  data: PreparedCellData
): MonthCellsResult {
  const { year, month, weekStartDay, todayStr } = meta;
  const days: MonthDayCellData[] = [];
  const dateTimedOccurrences = data.timed;
  const allDayOccurrences = data.allDay;
  const dateSegments = data.segments;
  const dateVacations = data.vacations;
  const dateExtras = data.extras;

  const pushCell = (dateStr: string, day: number, isCurrentMonth: boolean): void => {
    days.push({
      date: dateStr,
      day,
      isCurrentMonth,
      isToday: isCurrentMonth && dateStr === todayStr,
      weekRow: Math.floor(days.length / 7),
      timedOccurrences: dateTimedOccurrences.get(dateStr) ?? [],
      vacations: dateVacations.get(dateStr) ?? [],
      segments: dateSegments.get(dateStr) ?? [],
      allDayItems: [],
      extras: dateExtras.get(dateStr) ?? [],
    });
  };

  // Walk the grid's own range rather than deriving the padding a second time:
  // `monthGridRange` is the one answer to "which days does the grid show", for
  // the grid, the clash window and the stream alike.
  const { startYmd } = monthGridRange(new Date(year, month, 1), weekStartDay);
  const monthKey = toDateInputValue(new Date(year, month, 1)).slice(0, 7);
  for (let i = 0; i < MONTH_GRID_CELLS; i++) {
    const date = addDaysYmd(startYmd, i);
    pushCell(date, Number(date.slice(8)), date.slice(0, 7) === monthKey);
  }

  const rows = weekRows(days);

  // ── All-day spans, once per week row ────────────────────────────────────
  for (const rowDays of rows) {
    const rowDateSet = new Set(rowDays.map((d) => d.date));
    const result = computeAllDaySpans(
      allDayOccurrences.filter((o) => rowDateSet.has(o.date)),
      rowDays.map((d) => ({ dateStr: d.date }))
    );
    for (const span of result.spans) {
      const spanKey = `${span.activity.id}:${span.startYmd}`;
      const lastYmd = addDaysYmd(span.startYmd, spanOffsetDays(span.activity));
      for (let i = 0; i < span.span; i++) {
        const cell = rowDays[span.startCol + i];
        if (!cell) continue;
        cell.allDayItems.push({
          activity: span.activity,
          spanKey,
          isFirstDay: cell.date === span.startYmd,
          isLastDay: cell.date === lastYmd,
        });
      }
    }
    for (const cell of rowDays) {
      for (const a of result.singleByDate.get(cell.date) ?? []) {
        cell.allDayItems.push({
          activity: a,
          spanKey: `${a.id}:${cell.date}`,
          isFirstDay: true,
          isLastDay: true,
        });
      }
    }
  }

  // ── Week separators (mobile) ────────────────────────────────────────────
  // A separator precedes the first CURRENT-month cell of each week, so week 0
  // still gets its label above the first visible card even when it opens with
  // padding days (which are hidden on mobile).
  const weekSeparatorIndexes = new Set<number>();
  let lastSepWeekRow = -1;
  for (let i = 0; i < days.length; i++) {
    const cell = days[i]!;
    if (cell.weekRow !== lastSepWeekRow && cell.isCurrentMonth) {
      weekSeparatorIndexes.add(i);
      lastSepWeekRow = cell.weekRow;
    }
  }

  // Every row gets an entry, including a sixth row made only of next-month
  // padding; the stream never reads that one, because it labels only rows that
  // hold a current-month day (the separator loop above).
  const weekRanges = new Map<number, WeekRangeMeta>();
  rows.forEach((rowDays, row) => {
    const startCell = rowDays[0]!;
    const endCell = rowDays[rowDays.length - 1]!;
    // Shared 5-way classifier (this/next/last/upcoming/earlier) — one source of
    // truth with the week-strip navigator's row labels.
    const labelKey = relativeWeekLabelKey(startCell.date, endCell.date, todayStr);
    weekRanges.set(row, {
      range: `${formatNookDate(startCell.date)} – ${formatNookDate(endCell.date)}`,
      labelKey,
      isCurrent: labelKey === 'planner.weekThis',
    });
  });

  // Tint sets are scoped to the cells this month actually rendered — the
  // window-wide sets would tint dates belonging to a neighbouring month.
  const cellDates = new Set(days.map((d) => d.date));
  const vacationDates = new Set([...data.vacationDates].filter((d) => cellDates.has(d)));
  const holidayDates = new Set([...data.holidayDates].filter((d) => cellDates.has(d)));

  return { days, weekSeparatorIndexes, weekRanges, vacationDates, holidayDates };
}
