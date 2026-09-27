import { computed, watch, type Ref } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToday } from '@/composables/useToday';
import {
  addDays,
  toDateInputValue,
  formatTime12,
  formatDateShort,
  formatDayLong,
} from '@/utils/date';
import {
  clusterOverlapping,
  MINUTES_PER_DAY,
  timedSpanMinutes,
  type TimedSpan,
} from '@/utils/calendar/timeSpans';
import { createChangeGate } from '@/services/telemetry/emitPolicy';
import { logEvent } from '@/services/telemetry/logEvent';

// ── Day Navigation ─────────────────────────────────────────────────────────

export interface DayInfo {
  date: Date;
  dateStr: string;
  isToday: boolean;
}

export function useDayNavigation(referenceDate: Ref<Date>) {
  const { today } = useToday();
  const currentDay = computed<DayInfo>(() => {
    const d = referenceDate.value;
    const dateStr = toDateInputValue(d);
    return { date: d, dateStr, isToday: dateStr === today.value };
  });

  const dayLabel = computed(() => formatDayLong(currentDay.value.dateStr));

  function prevDay() {
    referenceDate.value = addDays(referenceDate.value, -1);
  }
  function nextDay() {
    referenceDate.value = addDays(referenceDate.value, 1);
  }
  function goToToday() {
    referenceDate.value = new Date();
  }

  return { currentDay, dayLabel, prevDay, nextDay, goToToday };
}

// ── Week Navigation ────────────────────────────────────────────────────────

export interface WeekDay {
  date: Date;
  dateStr: string;
  isToday: boolean;
}

/**
 * Format a week's span as a human label, e.g. "18 – 24 May, 2026",
 * "28 May – 3 Jun, 2026", or "30 Dec, 2025 – 5 Jan, 2026". Pure — shared
 * by `useWeekNavigation.weekLabel` and the page-level `usePlannerNavigation`
 * so the command-bar period label and the week view never drift apart.
 */
export function formatWeekRange(first: Date, last: Date): string {
  const sameMonth = first.getMonth() === last.getMonth();
  const sameYear = first.getFullYear() === last.getFullYear();
  const fmtDay = (d: Date) => formatDateShort(toDateInputValue(d));

  if (sameMonth) {
    return `${fmtDay(first)} – ${last.getDate()}, ${first.getFullYear()}`;
  }
  if (sameYear) {
    return `${fmtDay(first)} – ${fmtDay(last)}, ${first.getFullYear()}`;
  }
  return `${fmtDay(first)}, ${first.getFullYear()} – ${fmtDay(last)}, ${last.getFullYear()}`;
}

export function useWeekNavigation(referenceDate: Ref<Date>) {
  const settingsStore = useSettingsStore();
  const { today } = useToday();

  function getWeekStart(date: Date): Date {
    const dayOfWeek = date.getDay();
    const offset = (dayOfWeek - settingsStore.weekStartDay + 7) % 7;
    return addDays(date, -offset);
  }

  const weekDays = computed<WeekDay[]>(() => {
    const start = getWeekStart(referenceDate.value);
    const todayStr = today.value;
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const dateStr = toDateInputValue(d);
      return { date: d, dateStr, isToday: dateStr === todayStr };
    });
  });

  const weekLabel = computed(() => {
    const days = weekDays.value;
    return formatWeekRange(days[0]!.date, days[6]!.date);
  });

  function prevWeek() {
    referenceDate.value = addDays(referenceDate.value, -7);
  }
  function nextWeek() {
    referenceDate.value = addDays(referenceDate.value, 7);
  }
  function goToToday() {
    referenceDate.value = new Date();
  }

  return { weekDays, weekLabel, prevWeek, nextWeek, goToToday, getWeekStart };
}

// ── Time Grid Utilities ────────────────────────────────────────────────────

// Per-hour row height in rem units. 3.75rem = 60px at the default 16px root —
// preserves the original pixel rendering — and grows proportionally in Large
// reading mode (3.75rem × 19px root = 71.25px) so time labels never clip.
// Consumers of this constant must render with the `rem` unit, not `px`.
const ROW_HEIGHT = 3.75;
const MIN_CARD_HEIGHT = 1.5; // rem — minimum for short activities (1.5rem = 24px at default root)
/**
 * The minimum card height expressed as a duration: 24 minutes today. Grouping
 * and lane packing must use the RENDERED extent, or a 15-minute card drawn 24
 * minutes tall covers the event that starts right after it. Multiplied before
 * dividing so the value is exact and the `>=` touching test sees no float error.
 */
const MIN_CARD_MINUTES = (MIN_CARD_HEIGHT * 60) / ROW_HEIGHT;
/** How long an activity with no end time is assumed to run on the planner. */
const PLANNER_ASSUMED_DURATION_MIN = 60;

const SURFACE = 'planner-time-grid';

interface TimedFields {
  startTime?: string;
  endTime?: string;
}

/**
 * The planner's span of a timed activity: the shared `timedSpanMinutes` with the
 * planner's 60-minute default, and an overnight end CLAMPED to midnight, because
 * the planner's day axis ends there (the tail on the next morning is not drawn;
 * a follow-up in `docs/plans/2026-09-27-calendar-time-grid-span-fixes.md`).
 */
function plannerSpan(item: TimedFields): TimedSpan | null {
  const span = timedSpanMinutes(item.startTime, item.endTime, PLANNER_ASSUMED_DURATION_MIN);
  // A start AT midnight-end ('24:00', which `minutesOfDay` accepts) has no row on
  // this axis; drawn literally it sits below the grid. Treat it as unreadable, so
  // it renders at the top and is counted, rather than silently vanishing.
  if (!span || span.start >= MINUTES_PER_DAY) return null;
  return { ...span, end: Math.min(span.end, MINUTES_PER_DAY) };
}

/**
 * The extent a card actually OCCUPIES on the planner grid: its span, floored to
 * the minimum card height. The one definition used by `groupOverlapping` and by
 * `DayTimeline`'s lane packing. `null` when the start cannot be read.
 */
export function plannerExtent(item: TimedFields): { start: number; end: number } | null {
  const span = plannerSpan(item);
  if (!span) return null;
  return { start: span.start, end: Math.max(span.end, span.start + MIN_CARD_MINUTES) };
}

export interface TimeGridConfig {
  timeRange: { start: number; end: number };
  hours: number[];
  totalHeight: number;
}

/** Which planner grid a `useTimeGrid` belongs to, so CloudWatch can tell them apart. */
export type PlannerGridView = 'week' | 'day-lanes' | 'day-mobile';

export function useTimeGrid(timedItems: Ref<TimedFields[]>, viewId?: PlannerGridView) {
  // Parsed once, shared by the range and the diagnostics below.
  const spans = computed(() => timedItems.value.map((item) => plannerSpan(item)));

  const timeRange = computed(() => {
    const startHours: number[] = [];
    const endHours: number[] = [];
    for (const span of spans.value) {
      if (!span) continue; // unreadable: excluded, never allowed to turn the range into NaN
      startHours.push(Math.floor(span.start / 60));
      // An end of exactly 1440 floors to 24 and is capped at 23 below.
      endHours.push(Math.floor(span.end / 60));
    }
    const min = startHours.length ? Math.max(0, Math.min(7, ...startHours) - 1) : 7;
    const max = endHours.length ? Math.min(23, Math.max(19, ...endHours) + 1) : 19;
    return { start: min, end: max };
  });

  const hours = computed(() => {
    const arr: number[] = [];
    for (let h = timeRange.value.start; h <= timeRange.value.end; h++) arr.push(h);
    return arr;
  });

  const totalHeight = computed(() => hours.value.length * ROW_HEIGHT);

  function getPosition(startTime: string, endTime?: string) {
    const span = plannerSpan({ startTime, endTime });
    // Unreadable start: the card still renders (never dropped). Before, a `NaN` top
    // was discarded by the browser and it sat at the top; now that is explicit.
    if (!span) return { top: '0rem', height: `${MIN_CARD_HEIGHT}rem` };
    const offset = timeRange.value.start * 60;
    const top = ((span.start - offset) / 60) * ROW_HEIGHT;
    const height = Math.max(((span.end - span.start) / 60) * ROW_HEIGHT, MIN_CARD_HEIGHT);
    return { top: `${top}rem`, height: `${height}rem` };
  }

  function formatHourLabel(hour: number): string {
    return formatTime12(`${String(hour).padStart(2, '0')}:00`);
  }

  // Diagnostics: the two data shapes this grid has to paper over. Deduped with a
  // change gate so a re-render never floods the firehose; mirrors WallTimeGrid.
  // The signature is the offending raw values (never logged), so a different bad
  // record on the next week is reported rather than suppressed as "same count".
  const overnightGate = createChangeGate();
  const unreadableStartGate = createChangeGate();
  const unreadableEndGate = createChangeGate();
  watch(
    spans,
    (list) => {
      const items = timedItems.value;
      const overnight: string[] = [];
      const badStart: string[] = [];
      const badEnd: string[] = [];
      list.forEach((span, i) => {
        const item = items[i];
        if (!span) badStart.push(String(item?.startTime));
        else if (span.endUnreadable) badEnd.push(String(item?.endTime));
        else if (span.overnight) overnight.push(`${item?.startTime}-${item?.endTime}`);
      });
      const kind = viewId ?? 'unknown';
      const emit = (
        values: string[],
        gate: ReturnType<typeof createChangeGate>,
        level: 'info' | 'warn',
        message: string,
        errorCode: string,
        stage?: string
      ) => {
        if (!values.length || !gate(`${kind}:${values.sort().join('|')}`)) return;
        logEvent({
          level,
          surface: SURFACE,
          message,
          context: {
            action: 'layout',
            kind,
            error_code: errorCode,
            count: values.length,
            ...(stage ? { stage } : {}),
          },
        });
      };
      // Card drawn to midnight; its tail on the next morning is not shown.
      emit(overnight, overnightGate, 'info', 'planner_grid_overnight_clamped', 'overnight_clamped');
      // Card pinned to the top of the grid: its position is unknown.
      emit(
        badStart,
        unreadableStartGate,
        'warn',
        'planner_grid_unreadable_time',
        'unreadable_time',
        'start'
      );
      // Card drawn with the assumed 60 minutes: its length is unknown.
      emit(
        badEnd,
        unreadableEndGate,
        'warn',
        'planner_grid_unreadable_time',
        'unreadable_time',
        'end'
      );
    },
    { immediate: true }
  );

  return { timeRange, hours, totalHeight, getPosition, formatHourLabel, ROW_HEIGHT };
}

/**
 * Group items into clusters that must share a column side by side.
 *
 * Built on the shared sweep (`clusterOverlapping`, `calendar/timeSpans.ts`, which
 * the beanie wall also uses) over each card's RENDERED extent (`plannerExtent`),
 * so a short card drawn taller than its duration, a zero-length pair, and an
 * overnight event all group with what they visually overlap. The planner SPLITS
 * a collision the minimum height causes; the wall nudges it instead (RULE 3,
 * `wallTimeGrid.ts`).
 *
 * Within a group: by start, then longest first. Items whose start cannot be read
 * are never dropped: they all render at the top of the grid (`getPosition`), so
 * they come back as ONE group, after the others, in input order, and sit side by
 * side instead of covering one another.
 */
export function groupOverlapping<T extends TimedFields>(items: T[]): T[][] {
  const parsed: { item: T; start: number; end: number }[] = [];
  const unreadable: T[] = [];
  for (const item of items) {
    if (!item.startTime) continue;
    const extent = plannerExtent(item);
    if (extent) parsed.push({ item, ...extent });
    else unreadable.push(item);
  }
  const groups = clusterOverlapping(parsed).map((c) => c.map((p) => p.item));
  return unreadable.length ? [...groups, unreadable] : groups;
}
