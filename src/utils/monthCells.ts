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

import { extractDatePart, formatNookDate, toDateInputValue, monthGridRange } from '@/utils/date';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { tripTypeEmoji, type TravelSegmentOccurrence } from '@/utils/vacation';
import { relativeWeekLabelKey, type RelativeWeekLabelKey } from '@/utils/calendarWeek';
import type {
  MonthDayCellData,
  CellAllDayItem,
  CellTimedOccurrence,
  CellVacation,
} from '@/components/planner/MonthDayCard.vue';
import type { FamilyActivity, FamilyVacation, HolidayOccurrence } from '@/types/models';

/** One activity occurrence as `activityStore.activitiesInRange` yields it. */
export interface ActivityOccurrenceInput {
  activity: FamilyActivity;
  date: string;
}

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
  holidays: HolidayOccurrence[];
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
  allDay: Array<{ activity: FamilyActivity; date: string }>;
  segments: Map<string, TravelSegmentOccurrence[]>;
  vacations: Map<string, CellVacation[]>;
  vacationDates: Set<string>;
  holidays: Map<string, HolidayOccurrence[]>;
  holidayDates: Set<string>;
}

export interface PrepareCellDataInput {
  occurrences: ActivityOccurrenceInput[];
  segments: TravelSegmentOccurrence[];
  vacations: FamilyVacation[];
  holidays: HolidayOccurrence[];
  /** Inclusive window bounds — vacations are clipped to this, so a trip with a
   *  mistyped multi-decade end date cannot expand into a six-figure loop. */
  spanStart: string;
  spanEnd: string;
}

export function prepareCellData(input: PrepareCellDataInput): PreparedCellData {
  const timed = new Map<string, CellTimedOccurrence[]>();
  const allDay: Array<{ activity: FamilyActivity; date: string }> = [];
  for (const occ of input.occurrences) {
    // Vacation-linked activities render as the trailing vacation bar.
    if (occ.activity.vacationId) continue;
    if (occ.activity.isAllDay) {
      allDay.push({ activity: occ.activity, date: occ.date });
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
      });
      vacationDates.add(dateStr);
    }
  }

  const holidays = new Map<string, HolidayOccurrence[]>();
  const holidayDates = new Set<string>();
  for (const h of input.holidays) {
    if (!holidays.has(h.date)) holidays.set(h.date, []);
    holidays.get(h.date)!.push(h);
    holidayDates.add(h.date);
  }

  return { timed, allDay, segments, vacations, vacationDates, holidays, holidayDates };
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
      holidays: input.holidays,
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
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() - weekStartDay + 7) % 7;
  const days: MonthDayCellData[] = [];
  const dateTimedOccurrences = data.timed;
  const allDayOccurrences = data.allDay;
  const dateSegments = data.segments;
  const dateVacations = data.vacations;
  const dateHolidays = data.holidays;

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
      holidays: dateHolidays.get(dateStr) ?? [],
    });
  };

  // Previous-month padding
  const prevMonth = new Date(year, month, 0);
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = prevMonth.getDate() - i;
    pushCell(toDateInputValue(new Date(year, month - 1, d)), d, false);
  }
  // Current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    pushCell(toDateInputValue(new Date(year, month, d)), d, true);
  }
  // Next-month padding (complete the final row)
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      pushCell(toDateInputValue(new Date(year, month + 1, d)), d, false);
    }
  }

  // ── All-day spans, once per week row ────────────────────────────────────
  const numRows = Math.ceil(days.length / 7);
  for (let row = 0; row < numRows; row++) {
    const rowDays = days.slice(row * 7, row * 7 + 7);
    if (rowDays.length === 0) continue;
    const rowDateSet = new Set(rowDays.map((d) => d.date));
    const result = computeAllDaySpans(
      allDayOccurrences.filter((o) => rowDateSet.has(o.date)),
      rowDays.map((d) => ({ dateStr: d.date }))
    );
    for (const span of result.spans) {
      for (let i = 0; i < span.span; i++) {
        const cell = rowDays[span.startCol + i];
        if (!cell) continue;
        const item: CellAllDayItem = {
          activity: span.activity,
          isStart: i === 0,
          isEnd: i === span.span - 1,
        };
        cell.allDayItems.push(item);
      }
    }
    for (const cell of rowDays) {
      for (const a of result.singleByDate.get(cell.date) ?? []) {
        cell.allDayItems.push({ activity: a, isStart: true, isEnd: true });
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

  const weekRanges = new Map<number, WeekRangeMeta>();
  for (let row = 0; row < numRows; row++) {
    const rowDays = days.slice(row * 7, row * 7 + 7);
    if (rowDays.length === 0) continue;
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
  }

  // Tint sets are scoped to the cells this month actually rendered — the
  // window-wide sets would tint dates belonging to a neighbouring month.
  const cellDates = new Set(days.map((d) => d.date));
  const vacationDates = new Set([...data.vacationDates].filter((d) => cellDates.has(d)));
  const holidayDates = new Set([...data.holidayDates].filter((d) => cellDates.has(d)));

  return { days, weekSeparatorIndexes, weekRanges, vacationDates, holidayDates };
}
