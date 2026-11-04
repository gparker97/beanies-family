// How the month grid lays a day out (#141): its presentation input, the trip and
// all-day lane, the chip capacity of a measured row, and the phone face cluster.
// Pure: no stores, no Vue, no I/O. What a day HOLDS, and in what order, is
// `monthDayItems.ts`; this module only decides where those items go in the grid.

import {
  MONTH_CELL_BORDER_PX,
  PHONE_DENSITIES,
  type DesktopDensity,
  type MonthCellMetrics,
  type PhoneDensity,
} from '@/constants/calendarCaps';
import type { FamilyMember } from '@/types/models';
import { weekRows, type MonthDayCellData } from '@/utils/monthCells';
import {
  allDayItems,
  dayItemKey,
  dayItems,
  type DayItem,
  type SpanningDayItem,
} from '@/utils/monthDayItems';

/**
 * The grid's single presentation input, built once by the page. Combinations that
 * cannot happen (a phone in Compact, times on a phone) cannot be expressed.
 */
export type MonthGridDisplay =
  | { variant: 'desktop'; density: DesktopDensity; showTime: boolean; hideSoloFace: boolean }
  | { variant: 'phone'; density: PhoneDensity };

/** Step through `PHONE_DENSITIES`, clamped at both ends (spread = +1, pinch = -1). */
export function stepDensity(current: PhoneDensity, dir: 1 | -1): PhoneDensity {
  const index = PHONE_DENSITIES.indexOf(current);
  const next = Math.min(PHONE_DENSITIES.length - 1, Math.max(0, index + dir));
  return PHONE_DENSITIES[next]!;
}

/** One cell's slice of a lane run. */
export interface LaneRun {
  /** The run's true first day: round the left end. */
  isStart: boolean;
  /** The run's true last day: round the right end. */
  isEnd: boolean;
  /** Draw the name: the true first day, or column 0 of a row the run wraps into. */
  showLabel: boolean;
}

/** What can win a lane: a trip or an all-day activity. */
export type LaneItem = SpanningDayItem;

export interface CellLayout {
  /** The spanning bar on this cell's lane, if a run won it. */
  lane: { item: LaneItem; run: LaneRun } | null;
  /** Everything else on the day, in `dayItems` order. */
  stack: DayItem[];
}

/** A run of one trip or one all-day activity across contiguous columns of a week row. */
interface RowRun {
  isTrip: boolean;
  startCol: number;
  /** One entry per covered column, in column order. */
  items: LaneItem[];
}

/** The key that groups a lane item's per-day slices into one run. */
function runKey(item: LaneItem): string {
  return item.kind === 'trip' ? `trip:${item.vacation.id}` : `allday:${item.item.spanKey}`;
}

function laneRun(item: LaneItem, col: number): LaneRun {
  if (item.kind === 'trip') {
    const v = item.vacation;
    return { isStart: v.isStart, isEnd: v.isEnd, showLabel: v.isStart || col === 0 };
  }
  const a = item.item;
  return { isStart: a.isFirstDay, isEnd: a.isLastDay, showLabel: a.isFirstDay || col === 0 };
}

/** Build the row's runs: one per trip id and one per `spanKey`, split where a gap breaks them. */
function rowRuns(row: readonly MonthDayCellData[]): RowRun[] {
  const runs: RowRun[] = [];
  const open = new Map<string, RowRun>();
  row.forEach((cell, col) => {
    for (const entry of allDayItems(cell)) {
      const key = runKey(entry);
      const current = open.get(key);
      if (current && current.startCol + current.items.length === col) {
        current.items.push(entry);
        continue;
      }
      const run: RowRun = { isTrip: entry.kind === 'trip', startCol: col, items: [entry] };
      runs.push(run);
      open.set(key, run);
    }
  });
  return runs;
}

/**
 * Assign each week row's lane, aligned to `days`.
 *
 * Per row: trips first, then earlier start, then longer run. A run whose columns
 * are all still free takes the lane on every cell it covers; otherwise it stays in
 * each cell's stack. A cell's stack is `dayItems(cell)` without its lane winner,
 * so a losing trip or all-day item leads the stack, as `dayItems` orders them.
 */
export function assignMonthLayout(days: readonly MonthDayCellData[]): CellLayout[] {
  const layouts: CellLayout[] = [];
  for (const row of weekRows(days)) {
    const lanes: CellLayout['lane'][] = row.map(() => null);
    const runs = rowRuns(row).sort(
      (a, b) =>
        Number(b.isTrip) - Number(a.isTrip) ||
        a.startCol - b.startCol ||
        b.items.length - a.items.length
    );
    for (const run of runs) {
      const cols = run.items.map((_, i) => run.startCol + i);
      if (cols.some((c) => lanes[c] !== null)) continue;
      run.items.forEach((item, i) => {
        const col = run.startCol + i;
        lanes[col] = { item, run: laneRun(item, col) };
      });
    }
    row.forEach((cell, col) => {
      const lane = lanes[col] ?? null;
      const laneKey = lane ? dayItemKey(lane.item) : null;
      layouts.push({
        lane,
        stack: dayItems(cell).filter((item) => dayItemKey(item) !== laneKey),
      });
    });
  }
  return layouts;
}

/** Absorbs floating-point error at an exact threshold; never admits a chip that does not fit. */
const EPS = 1e-6;

interface CapacityInput {
  /** The measured row height in whole pixels. */
  rowPx: number;
  /** The root font size in pixels (16, or 19 in Large reading mode). */
  remPx: number;
  metrics: MonthCellMetrics;
  /** The row's lane is drawn on this cell, so its height (plus a gap) is reserved. */
  hasLane: boolean;
}

/** Height left for chips below the numeral (and the lane, when drawn). */
function innerPx({ rowPx, remPx, metrics: m, hasLane }: CapacityInput): number {
  return (
    rowPx -
    MONTH_CELL_BORDER_PX -
    (m.padTopRem + m.padBottomRem + m.numeralRem) * remPx -
    (hasLane ? (m.laneRem + m.gapRem) * remPx : 0)
  );
}

function slotPx({ remPx, metrics: m }: CapacityInput): number {
  return (m.chipRem + m.gapRem) * remPx;
}

/** How many chips fit with no "+N more" line: n chips plus (n - 1) gaps. */
export function fitCount(input: CapacityInput): number {
  const inner = innerPx(input);
  const fitAll = Math.floor((inner + input.metrics.gapRem * input.remPx) / slotPx(input) + EPS);
  return Math.max(0, fitAll);
}

/**
 * How many of `count` chips a cell shows, and how many go behind "+N more".
 *
 * Everything fits → all shown. Otherwise the "+N more" line is reserved and the
 * chips that still fit above it are shown (n x (chip + gap) plus the line). Not
 * measured (`rowPx === null`, or measurement failed) → `metrics.fallbackSlots`.
 */
export function cellCapacity(
  input: Omit<CapacityInput, 'rowPx'> & { rowPx: number | null; count: number }
): { shown: number; hidden: number } {
  const { rowPx, count } = input;
  if (rowPx === null) {
    const shown = Math.min(count, input.metrics.fallbackSlots);
    return { shown, hidden: count - shown };
  }
  const measured = { ...input, rowPx };
  if (count <= fitCount(measured)) return { shown: count, hidden: 0 };
  const shown = Math.max(
    0,
    Math.floor((innerPx(measured) - input.metrics.moreRem * input.remPx) / slotPx(measured) + EPS)
  );
  return { shown, hidden: count - shown };
}

/**
 * The row height at which the grid stops shrinking: border, pads, numeral, lane,
 * gap and one slot. The slot is `max(chip, more)` because a Bars chip (6px) is
 * shorter than its "+N" line (12px); without the `max` a Bars cell at the floor
 * would clip its "+N".
 */
export function minRowPx(m: MonthCellMetrics, remPx: number): number {
  return (
    MONTH_CELL_BORDER_PX +
    (m.padTopRem +
      m.padBottomRem +
      m.numeralRem +
      m.laneRem +
      m.gapRem +
      Math.max(m.chipRem, m.moreRem)) *
      remPx
  );
}

/**
 * The phone Faces density: the day's distinct members in first-seen order, at most
 * `max`, plus how many more there are. It wraps faces rather than overlapping them,
 * so it does not use `ActivityOwnerStack`.
 */
export function faceCluster(
  memberLists: readonly (readonly FamilyMember[])[],
  max = 4
): { shown: FamilyMember[]; extra: number } {
  const seen = new Map<string, FamilyMember>();
  for (const list of memberLists) {
    for (const member of list) if (!seen.has(member.id)) seen.set(member.id, member);
  }
  const all = [...seen.values()];
  const shown = all.slice(0, Math.max(0, max));
  return { shown, extra: all.length - shown.length };
}
