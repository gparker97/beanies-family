<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import DayTimeline from '@/components/planner/DayTimeline.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import {
  useWeekNavigation,
  useTimeGrid,
  groupOverlapping,
} from '@/composables/useCalendarNavigation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useCalendarSlide } from '@/composables/useCalendarSlide';
import { useTranslation } from '@/composables/useTranslation';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTodoStore } from '@/stores/todoStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { normalizeAssignees } from '@/utils/assignees';
import {
  toDateInputValue,
  extractDatePart,
  formatTime12,
  addHourToTime,
  addDays,
  parseLocalDate,
} from '@/utils/date';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { tripTypeEmoji, splitTimedUntimed, type TravelSegmentOccurrence } from '@/utils/vacation';
import TravelSegmentChip from '@/components/planner/TravelSegmentChip.vue';
import AllDayActivityChip from '@/components/planner/AllDayActivityChip.vue';
import HolidayChip from '@/components/planner/HolidayChip.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';
import WeekStripNav, {
  type WeekStripDay,
  type WeekStripWeek,
} from '@/components/planner/WeekStripNav.vue';
import { useActivityChipClass } from '@/composables/useActivityChipClass';
import { relativeWeekLabelKey } from '@/utils/calendarWeek';
import type { FamilyActivity, TodoItem, HolidayOccurrence } from '@/types/models';

const props = defineProps<{
  /** Controlled period — the page owns the canonical date (props down). */
  referenceDate: Date;
  selectedDate?: string;
  /** Bumped by the page on every "Today" tap — re-scrolls the timeline to the
   *  current hour even when the reference date is unchanged (already on this
   *  week), which a `watch(referenceDate)` alone would miss. */
  todayTick?: number;
}>();
const emit = defineEmits<{
  /** Desktop day-header click → drill into Day view (page switches view). */
  'select-date': [date: string];
  /** Mobile strip day-pill tap → change the focused day, staying in Week view. */
  'select-day': [date: string];
  'add-activity': [date: string, time?: string];
  'view-activity': [id: string, date: string];
  'view-todo': [todo: TodoItem];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'holiday-click': [holiday: HolidayOccurrence];
  /** Swipe navigation — the page advances the shared reference date. */
  prev: [];
  next: [];
}>();

const { t } = useTranslation();
const { isMobile, isTablet } = useBreakpoint();
const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const memberFilterStore = useMemberFilterStore();
const vacationStore = useVacationStore();
const todoStore = useTodoStore();
const holidayStore = useHolidayStore();

// Controlled period — the page owns the canonical date; we derive the
// timeline week + label from it and never mutate it (one-way data flow).
const referenceDate = computed(() => props.referenceDate);
const { weekDays } = useWeekNavigation(referenceDate);

/**
 * Strip-anchor date — the date whose week is the FIRST row of the 2-week
 * navigator strip. Internal + independent of the page-owned `referenceDate`
 * so the strip stays STATIC when the user taps a day inside it. It re-anchors
 * (via the watcher below) ONLY when the focused day leaves the visible
 * fortnight — i.e. on prev/next/today that pages beyond the two shown weeks.
 */
const stripAnchorDate = ref<Date>(props.referenceDate);

// ── Swipe gesture ──────────────────────────────────────────────────────────
// Horizontal swipe emits the navigation intent; the page advances the shared
// reference date (the view never mutates the date itself).
const swipeRef = ref<HTMLElement | null>(null);
useCalendarSlide(swipeRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
});

// Mobile: the focused day within the week (drives the single-day timeline +
// the strip's strongest "selected" pill). Derived from the page-owned date.
const selectedMobileDay = computed(() => toDateInputValue(props.referenceDate));

// Public holidays in the visible week, keyed by date (read-only reference data;
// empty when no country is set or holidays are hidden). Almost always ≤1/day.
const holidaysByDate = computed(() => {
  const days = weekDays.value;
  const map = new Map<string, HolidayOccurrence>();
  if (days.length === 0) return map;
  for (const h of holidayStore.holidaysInRange(days[0]!.dateStr, days[days.length - 1]!.dateStr)) {
    if (!map.has(h.date)) map.set(h.date, h);
  }
  return map;
});
function holidayForDay(dateStr: string): HolidayOccurrence | undefined {
  return holidaysByDate.value.get(dateStr);
}

// ── Data ────────────────────────────────────────────────────────────────────

type Occurrence = { activity: FamilyActivity; date: string };

const weekActivities = computed(() => {
  const days = weekDays.value;
  if (days.length === 0) return new Map<string, Occurrence[]>();

  const months = new Set<string>();
  for (const d of days) months.add(`${d.date.getFullYear()}-${d.date.getMonth()}`);

  const allOccurrences: Occurrence[] = [];
  for (const key of months) {
    const [y, m] = key.split('-').map(Number);
    allOccurrences.push(...activityStore.monthActivities(y!, m!));
  }

  // Skip vacation-linked activities — they render as vacation span bars instead
  const dateSet = new Set(days.map((d) => d.dateStr));
  const map = new Map<string, Occurrence[]>();
  for (const d of days) map.set(d.dateStr, []);
  for (const occ of allOccurrences) {
    if (occ.activity.vacationId) continue;
    if (dateSet.has(occ.date)) map.get(occ.date)!.push(occ);
  }
  return map;
});

const weekTodos = computed(() => {
  const dateSet = new Set(weekDays.value.map((d) => d.dateStr));
  const map = new Map<string, TodoItem[]>();
  for (const d of weekDays.value) map.set(d.dateStr, []);
  for (const todo of todoStore.filteredScheduledTodos) {
    const dueDate = todo.dueDate?.slice(0, 10) ?? '';
    if (dateSet.has(dueDate)) map.get(dueDate)!.push(todo);
  }
  return map;
});

// Travel-segment occurrences for the visible week (flights, trains, etc).
// Pure derivation — vacationStore exposes the reactive list, we filter once
// per render. Cross-month segments naturally fall into their own week range.
const weekSegments = computed<TravelSegmentOccurrence[]>(() => {
  const days = weekDays.value;
  if (days.length === 0) return [];
  return vacationStore.travelSegmentOccurrencesInRange(
    days[0]!.dateStr,
    days[days.length - 1]!.dateStr
  );
});

// Cache the bucketed split once per render so timed/untimed lookups are O(1).
const weekSegmentBuckets = computed(() => splitTimedUntimed(weekSegments.value));

function getTimedSegmentsForDay(dateStr: string): TravelSegmentOccurrence[] {
  return weekSegmentBuckets.value.timed.filter((o) => o.date === dateStr);
}

function getUntimedSegmentsForDay(dateStr: string): TravelSegmentOccurrence[] {
  return weekSegmentBuckets.value.untimed.filter((o) => o.date === dateStr);
}

// Time grid — caller-side union of activities + segments-as-1h-blocks.
// Keeps `useTimeGrid` agnostic to segment shape; the composable just sees a
// list of `{ startTime, endTime }` entries and auto-extends its hour range
// to fit (so a 22:00 flight expands the grid past the 7am-7pm default).
const allTimedActivities = computed(() => {
  const items: { startTime?: string; endTime?: string }[] = [];
  for (const arr of weekActivities.value.values()) {
    for (const occ of arr) {
      if (occ.activity.startTime) items.push(occ.activity);
    }
  }
  for (const occ of weekSegments.value) {
    if (occ.time) items.push({ startTime: occ.time, endTime: addHourToTime(occ.time) });
  }
  return items;
});

const { hours, totalHeight, getPosition, formatHourLabel, ROW_HEIGHT } =
  useTimeGrid(allTimedActivities);

// Current time indicator
const nowMinutes = ref(0);
let nowTimer: ReturnType<typeof setInterval> | null = null;

function updateNow() {
  const now = new Date();
  nowMinutes.value = now.getHours() * 60 + now.getMinutes();
}

const nowIndicatorTop = computed(() => {
  const start = hours.value[0] ?? 7;
  return `${((nowMinutes.value - start * 60) / 60) * ROW_HEIGHT}rem`;
});

const showNowIndicator = computed(() => {
  const h = Math.floor(nowMinutes.value / 60);
  const start = hours.value[0] ?? 7;
  const end = hours.value[hours.value.length - 1] ?? 19;
  return h >= start && h <= end;
});

// Auto-scroll to current time
const gridRef = ref<HTMLElement | null>(null);

// Scroll the timeline so the current hour sits near the top. On first mount
// (no `force`) only when the user hasn't already scrolled (don't disturb a
// deliberate scroll / view switch); `force` (the command bar's "Today")
// always re-centres on now.
async function scrollToCurrentHour(opts: { force?: boolean } = {}) {
  await nextTick();
  const mainEl = document.querySelector('main');
  if (!gridRef.value || !mainEl) return;
  if (!opts.force && mainEl.scrollTop >= 100) return;
  const scrollHour = Math.max(0, Math.floor(nowMinutes.value / 60) - 1);
  const start = hours.value[0] ?? 7;
  // ROW_HEIGHT is in rem units (so calendar cells participate in the Large
  // text-size mode); convert to px here because scrollTop wants pixels.
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const offsetWithinGrid = Math.max(0, (scrollHour - start) * ROW_HEIGHT * rootPx);
  const gridTop = gridRef.value.getBoundingClientRect().top + window.scrollY;
  const top = gridTop - mainEl.getBoundingClientRect().top + offsetWithinGrid - 80;
  mainEl.scrollTo({ top, behavior: opts.force ? 'smooth' : 'auto' });
}

onMounted(async () => {
  updateNow();
  nowTimer = setInterval(updateNow, 60000);
  await scrollToCurrentHour();
});

// Re-centre on now on every command-bar "Today" tap, even when already on the
// current week (reference date unchanged, so a `watch(referenceDate)` wouldn't
// fire). The mobile single-day timeline follows `referenceDate`, which the
// page resets to today alongside this tick.
watch(
  () => props.todayTick,
  () => void scrollToCurrentHour({ force: true })
);

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer);
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayAbbrev(date: Date): string {
  return DAY_ABBREVS[date.getDay()]!;
}

function getTimedForDay(dateStr: string): Occurrence[] {
  return (weekActivities.value.get(dateStr) ?? [])
    .filter((o) => o.activity.startTime)
    .sort((a, b) => (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? ''));
}

// Multi-day all-day activities + single-day buckets — delegated to the
// shared `computeAllDaySpans` util (`@/utils/allDaySpans.ts`) that the
// monthly view also consumes. Keeps weekly + monthly span logic in one
// place: any future changes to the algorithm land once.
const allDayResult = computed(() => {
  const days = weekDays.value;
  if (days.length === 0) {
    return {
      spans: [] as ReturnType<typeof computeAllDaySpans>['spans'],
      singleByDate: new Map<string, FamilyActivity[]>(),
      spanningIds: new Set<string>(),
    };
  }
  // Flatten all per-day occurrences for the week into one list. The util
  // dedupes by activity.id so multi-day activities (one occurrence per
  // covered day) collapse to a single span entry.
  const occurrences: Array<{ activity: FamilyActivity; date: string }> = [];
  for (const day of days) {
    const occs = weekActivities.value.get(day.dateStr) ?? [];
    for (const occ of occs) occurrences.push({ activity: occ.activity, date: day.dateStr });
  }
  return computeAllDaySpans(occurrences, days);
});

const spanningActivities = computed(() => allDayResult.value.spans);
const spanningActivityIds = computed(() => allDayResult.value.spanningIds);

// Vacation span bars — read directly from vacationStore (matches CalendarGrid approach)
interface VacationSpan {
  vacationId: string;
  name: string;
  emoji: string;
  startCol: number;
  span: number;
}

const vacationSpans = computed<VacationSpan[]>(() => {
  const days = weekDays.value;
  if (days.length === 0) return [];

  const spans: VacationSpan[] = [];
  for (const v of vacationStore.vacations) {
    if (!v.startDate || !v.endDate) continue;
    const vStart = extractDatePart(v.startDate);
    const vEnd = extractDatePart(v.endDate);

    const startIdx = days.findIndex((d) => d.dateStr >= vStart);
    if (startIdx < 0) continue; // vacation starts after this week
    if (days[days.length - 1]!.dateStr < vStart) continue;
    if (days[0]!.dateStr > vEnd) continue; // vacation ended before this week

    const startCol = startIdx;
    const endIdx = [...days].reverse().findIndex((d) => d.dateStr <= vEnd);
    const endCol = endIdx >= 0 ? days.length - 1 - endIdx : days.length - 1;

    spans.push({
      vacationId: v.id,
      name: v.name,
      emoji: tripTypeEmoji(v.tripType),
      startCol,
      span: endCol - startCol + 1,
    });
  }
  return spans;
});

function getUntimedForDay(dateStr: string): Occurrence[] {
  return (weekActivities.value.get(dateStr) ?? []).filter(
    (o) => !o.activity.startTime && !spanningActivityIds.value.has(o.activity.id)
  );
}

function hasUntimedContent(dateStr: string): boolean {
  return (
    holidaysByDate.value.has(dateStr) ||
    getUntimedForDay(dateStr).length > 0 ||
    (weekTodos.value.get(dateStr)?.length ?? 0) > 0 ||
    getUntimedSegmentsForDay(dateStr).length > 0 ||
    spanningActivities.value.some((s) => {
      const days = weekDays.value;
      const dayCol = days.findIndex((d) => d.dateStr === dateStr);
      return dayCol >= s.startCol && dayCol < s.startCol + s.span;
    })
  );
}

// Check if there are ANY spanning activities, vacation spans, untimed segments, or per-day untimed content
const hasAnyUntimedContent = computed(
  () =>
    spanningActivities.value.length > 0 ||
    vacationSpans.value.length > 0 ||
    weekSegmentBuckets.value.untimed.length > 0 ||
    holidaysByDate.value.size > 0 ||
    weekDays.value.some((d) => hasUntimedContent(d.dateStr))
);

function handleEmptySlotClick(dateStr: string, hour: number) {
  emit('add-activity', dateStr, `${String(hour).padStart(2, '0')}:00`);
}

// Mobile: activities for selected day, filtered by the page-level member
// filter (so the mobile timeline matches what the filter chips show and
// density dots below reflect what's actually rendered).
const mobileDayActivities = computed(() => {
  const occs = weekActivities.value.get(selectedMobileDay.value) ?? [];
  if (memberFilterStore.isAllSelected) return occs;
  return occs.filter((o) =>
    normalizeAssignees(o.activity).some((id) => memberFilterStore.isMemberSelected(id))
  );
});

// Mobile: vacations active on the selected day (for DayTimeline)
const mobileDayVacations = computed(() =>
  vacationStore.vacations.filter((v) => {
    if (!v.startDate || !v.endDate) return false;
    const start = extractDatePart(v.startDate);
    const end = extractDatePart(v.endDate);
    return selectedMobileDay.value >= start && selectedMobileDay.value <= end;
  })
);

// Mobile: travel-segment occurrences on the selected day (for DayTimeline)
const mobileDaySegments = computed(() =>
  vacationStore.travelSegmentOccurrencesInRange(selectedMobileDay.value, selectedMobileDay.value)
);

// ── 2-week navigator strip ─────────────────────────────────────────────────
// Anchored to `stripAnchorDate` — independent of `referenceDate`. The strip
// stays static when the user taps a day inside it; only the prev/next nav
// arrows (which call `advanceBoth`) move both refs together.
// Reuses the classifier from `useActivityChipClass` so colors stay
// consistent with the monthly chip rule (no parallel implementation).

const DOW_KEYS = [
  'planner.day.sun',
  'planner.day.mon',
  'planner.day.tue',
  'planner.day.wed',
  'planner.day.thu',
  'planner.day.fri',
  'planner.day.sat',
] as const;

const { classify: classifyStripChip } = useActivityChipClass();

/**
 * Week 1 of the strip (7 days anchored to `stripAnchorDate`'s week). Used
 * as the basis for week 2 (= these days + 7).
 */
const { weekDays: stripWeek1Days } = useWeekNavigation(stripAnchorDate);

// Re-anchor the 2-week strip only when the focused day leaves the visible
// fortnight — day-pill taps within view never shuffle the strip (a deliberate,
// regression-guarded behaviour), while prev/next/today that pages beyond the
// two shown weeks scrolls the window.
watch(
  () => props.referenceDate,
  (d) => {
    const dayStr = toDateInputValue(d);
    const winStart = stripWeek1Days.value[0]?.dateStr;
    if (!winStart) {
      stripAnchorDate.value = d;
      return;
    }
    const winEnd = toDateInputValue(addDays(parseLocalDate(winStart), 13));
    if (dayStr < winStart || dayStr > winEnd) stripAnchorDate.value = d;
  }
);

// The sticky mobile strip defaults to a single (this) week to save space;
// the user reveals the next week on demand via the strip's peek toggle.
// (Chosen over a scroll-driven collapse, which fought the "keep it to just
// this week" goal.) Render-only — never feeds any date computation.
const peeked = ref(false);

/**
 * Density map covering 14 days from the strip's anchor week — distinct
 * from the timeline below which only renders the focused week.
 */
const stripDensities = computed(() => {
  const byDate = new Map<string, { memberColors: string[]; moreCount: number }>();
  const startDate = stripWeek1Days.value[0]?.date;
  if (!startDate) return byDate;

  const stripDates: string[] = [];
  for (let i = 0; i < 14; i++) {
    stripDates.push(toDateInputValue(addDays(startDate, i)));
  }
  const stripDateSet = new Set(stripDates);

  // Fetch occurrences across the months this 14-day window touches
  const months = new Set<string>();
  for (const dateStr of stripDates) {
    const d = parseLocalDate(dateStr);
    months.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  const occByDate = new Map<string, FamilyActivity[]>();
  for (const key of months) {
    const [y, m] = key.split('-').map(Number);
    const occs = activityStore.monthActivities(y!, m!);
    for (const occ of occs) {
      if (occ.activity.vacationId) continue;
      if (!stripDateSet.has(occ.date)) continue;
      if (!occByDate.has(occ.date)) occByDate.set(occ.date, []);
      occByDate.get(occ.date)!.push(occ.activity);
    }
  }

  // For each strip date, build the per-day distinct color set. Family
  // events (0 assignees) project as the Heritage-Orange dot via the
  // shared classifier so the strip mirrors the chip color grammar.
  for (const dateStr of stripDates) {
    const activities = occByDate.get(dateStr) ?? [];
    const seen = new Set<string>();
    const colors: string[] = [];
    for (const a of activities) {
      const cls = classifyStripChip(a);
      if (!seen.has(cls.color)) {
        seen.add(cls.color);
        colors.push(cls.color);
      }
    }
    byDate.set(dateStr, {
      memberColors: colors.slice(0, 3),
      moreCount: Math.max(0, colors.length - 3),
    });
  }
  return byDate;
});

const todayDateStr = computed(() => toDateInputValue(new Date()));

/**
 * Build the WeekStripWeek[] structure for `<WeekStripNav>`. Always two
 * weeks pinned to the strip anchor — they only move when the user uses
 * prev/next nav (NOT when clicking a day inside).
 *
 * `isFocused` marks whichever of the 2 rows contains the timeline's
 * currently-visible week (so the orange accent strip moves between rows
 * as the user clicks across the strip).
 *
 * Row labels are anchored to *today's* position relative to the row —
 * "this week" if the row contains today, "next week" if today is in the
 * week immediately before, otherwise "upcoming". That way labels make
 * sense whether or not the user has paged forward with the arrows.
 */
const weekStripData = computed<WeekStripWeek[]>(() => {
  const week1Start = stripWeek1Days.value[0]?.date;
  if (!week1Start) return [];

  const focusedWeekFirstDateStr = weekDays.value[0]?.dateStr ?? '';

  function buildDay(date: Date): WeekStripDay {
    const dateStr = toDateInputValue(date);
    const dow = DOW_KEYS[date.getDay()]!;
    const density = stripDensities.value.get(dateStr);
    return {
      dateStr,
      dayNum: date.getDate(),
      dowLabel: t(dow),
      isToday: dateStr === todayDateStr.value,
      memberColors: density?.memberColors ?? [],
      moreCount: density?.moreCount ?? 0,
    };
  }

  const week1Days = stripWeek1Days.value.map((d) => buildDay(d.date));
  const week2Days = Array.from({ length: 7 }, (_, i) => buildDay(addDays(week1Start, 7 + i)));

  /**
   * Resolve the row's label key by its position relative to today's week:
   *   - contains today               → "this week"
   *   - immediately after today's    → "next week"
   *   - immediately before today's   → "last week"
   *   - further forward              → "upcoming"
   *   - further back                 → "earlier"
   *
   * Rows are always week-aligned (7 contiguous days starting on the
   * settings-configured first day), so comparing the row's first vs.
   * last day to today gives a clean past/future split.
   */
  function labelFor(rowDays: WeekStripDay[]): WeekStripWeek['labelKey'] {
    // Shared 5-way classifier — single source of truth with the month-view
    // week dividers (see utils/calendarWeek).
    return relativeWeekLabelKey(
      rowDays[0]!.dateStr,
      rowDays[rowDays.length - 1]!.dateStr,
      todayDateStr.value
    );
  }

  const week1FocusedDateStr = stripWeek1Days.value[0]?.dateStr ?? '';
  const week2FocusedDateStr = toDateInputValue(addDays(week1Start, 7));

  return [
    {
      labelKey: labelFor(week1Days),
      isFocused: week1FocusedDateStr === focusedWeekFirstDateStr,
      days: week1Days,
    },
    {
      labelKey: labelFor(week2Days),
      isFocused: week2FocusedDateStr === focusedWeekFirstDateStr,
      days: week2Days,
    },
  ];
});

/**
 * Click handler for a day pill on the strip. The strip stays static —
 * only the timeline (`referenceDate`) moves. selectedMobileDay updates
 * so the strip pill highlight follows the tap and the mobile DayTimeline
 * shows the chosen day's events.
 *
 * Deliberately does NOT emit `select-date` — the strip is for week-
 * internal navigation. Routing the click to the parent's select-date
 * handler would open the day-agenda sidebar and pull the user out of
 * weekly mode (the exact friction the strip is meant to avoid). To
 * open the agenda, the user clicks an event chip directly.
 */
function onStripDayClick(dateStr: string) {
  // Picking a day in the strip changes the focused day but STAYS in week view
  // (distinct from a desktop day-header click, which drills into Day view).
  // The page sets the shared reference date; the strip stays static unless the
  // new day leaves the visible fortnight (see the watcher above).
  emit('select-day', dateStr);
}
</script>

<template>
  <div
    ref="swipeRef"
    class="rounded-3xl bg-white p-5 pt-3 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    style="touch-action: pan-y; will-change: transform"
  >
    <!-- 2-week date navigator — MOBILE ONLY. Desktop already shows the
         full week in the time grid below + has prev/next arrows for week
         navigation, so the strip is redundant there. Stays static when
         tapping a day inside — only the prev/next arrows on the nav bar
         move it. The orange "selected" pill follows `selectedMobileDay`
         so the user sees which day's events are showing in the timeline
         below. -->
    <div
      v-if="isMobile"
      class="sticky z-20 -mx-5 bg-white px-5 dark:bg-slate-800"
      style="top: var(--planner-cmdbar-h, 0)"
    >
      <WeekStripNav
        :weeks="weekStripData"
        :selected-date="selectedMobileDay"
        :collapsed="!peeked"
        @select-date="onStripDayClick"
        @toggle-peek="peeked = !peeked"
      />
    </div>

    <!-- ── Desktop: Time Grid ──────────────────────────────────────────── -->
    <template v-if="!isMobile">
      <!-- Day headers — sticky just beneath the command bar so the weekday +
           date context never scrolls away. Wrapper bleeds over the card
           padding (bg) while the inner grid stays aligned with the timeline. -->
      <div
        class="sticky z-20 -mx-5 bg-white px-5 dark:bg-slate-800"
        style="top: var(--planner-cmdbar-h, 0)"
      >
        <div class="mb-1 grid grid-cols-[56px_repeat(7,1fr)] gap-px">
          <div />
          <button
            v-for="day in weekDays"
            :key="day.dateStr"
            type="button"
            class="cursor-pointer rounded-xl py-2 text-center transition-colors"
            :class="[
              holidayForDay(day.dateStr)
                ? 'bg-[var(--holiday-clay-tint)]'
                : 'hover:bg-gray-50 dark:hover:bg-slate-700/50',
              selectedDate === day.dateStr ? 'ring-primary-500 ring-2 ring-inset' : '',
            ]"
            :title="holidayForDay(day.dateStr)?.name"
            @click="emit('select-date', day.dateStr)"
          >
            <span
              class="font-outfit text-secondary-500/50 block text-xs font-semibold uppercase dark:text-gray-500"
            >
              {{ dayAbbrev(day.date) }}
            </span>
            <span
              class="font-outfit mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
              :class="
                day.isToday
                  ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white shadow-[0_2px_6px_rgba(241,93,34,0.3)]'
                  : 'text-secondary-500 dark:text-gray-200'
              "
            >
              {{ day.date.getDate() }}
            </span>
          </button>
        </div>
      </div>

      <!-- Untimed / all-day items row -->
      <div
        v-if="hasAnyUntimedContent"
        class="relative mb-1 grid grid-cols-[56px_repeat(7,1fr)] gap-px rounded-xl border border-gray-200/60 bg-[var(--tint-slate-5)] py-1.5 dark:border-slate-600/40 dark:bg-slate-700/30"
      >
        <div class="flex items-center justify-center">
          <span
            class="font-outfit text-secondary-500/40 text-xs font-semibold uppercase dark:text-gray-500"
          >
            {{ t('planner.allDay') }}
          </span>
        </div>

        <!-- Vacation span bars (from vacationStore directly) -->
        <div
          v-for="vs in vacationSpans"
          :key="'vacation-' + vs.vacationId"
          class="cursor-pointer truncate rounded-md px-2 py-0.5 text-xs font-semibold text-white transition-opacity hover:opacity-80"
          :style="{
            gridColumn: `${vs.startCol + 2} / span ${vs.span}`,
            background: 'linear-gradient(to right, var(--vacation-teal), #0077B6)',
            borderLeft: '3px solid var(--vacation-teal)',
            opacity: 0.85,
          }"
          @click="emit('vacation-click', vs.vacationId)"
        >
          {{ vs.emoji }} {{ vs.name }}
        </div>

        <!-- Spanning multi-day activities — wrapper handles cross-column
             grid placement; the chip component owns the visual treatment
             (single source of truth shared with the monthly view). -->
        <div
          v-for="span in spanningActivities"
          :key="'span-' + span.activity.id"
          class="min-w-0"
          :style="{ gridColumn: `${span.startCol + 2} / span ${span.span}` }"
        >
          <AllDayActivityChip
            :activity="span.activity"
            :is-start="true"
            :is-end="true"
            class="block w-full"
            @click="emit('view-activity', span.activity.id, span.activity.date)"
          />
        </div>

        <!-- Per-day public holiday + single-day untimed activities + todos + untimed travel segments -->
        <template v-for="(day, di) in weekDays" :key="'untimed-' + day.dateStr">
          <div
            v-if="
              holidayForDay(day.dateStr) ||
              getUntimedForDay(day.dateStr).length > 0 ||
              (weekTodos.get(day.dateStr)?.length ?? 0) > 0 ||
              getUntimedSegmentsForDay(day.dateStr).length > 0
            "
            class="min-w-0 overflow-hidden px-0.5"
            :style="{ gridColumn: `${di + 2}` }"
          >
            <HolidayChip
              v-if="holidayForDay(day.dateStr)"
              :holiday="holidayForDay(day.dateStr)!"
              :is-start="true"
              :is-end="true"
              class="mb-0.5 block w-full"
              @click="emit('holiday-click', holidayForDay(day.dateStr)!)"
            />
            <AllDayActivityChip
              v-for="occ in getUntimedForDay(day.dateStr)"
              :key="occ.activity.id"
              :activity="occ.activity"
              :is-start="true"
              :is-end="true"
              class="mb-0.5 block w-full"
              @click="emit('view-activity', occ.activity.id, day.dateStr)"
            />
            <div
              v-for="todo in weekTodos.get(day.dateStr) ?? []"
              :key="todo.id"
              class="mb-0.5 cursor-pointer truncate rounded-md border-l-2 px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
              style="background: rgb(155 89 182 / 8%); border-left-color: #9b59b6"
              @click="emit('view-todo', todo)"
            >
              {{ todo.title }}
            </div>
            <TravelSegmentChip
              v-for="seg in getUntimedSegmentsForDay(day.dateStr)"
              :key="'seg-untimed-' + seg.segmentId + '-' + seg.kind"
              :occurrence="seg"
              class="mb-0.5"
              @click="(vid: string, idx: number) => emit('view-segment', vid, idx)"
            />
          </div>
        </template>
      </div>

      <!-- Time grid — renders at full height, page scrolls naturally -->
      <div ref="gridRef" class="relative">
        <!-- Grid container: hour labels + 7 day columns -->
        <div
          class="grid grid-cols-[56px_repeat(7,1fr)] gap-px"
          :style="{ height: totalHeight + 'rem' }"
        >
          <!-- Hour labels column -->
          <div class="relative">
            <div
              v-for="(hour, hi) in hours"
              :key="hour"
              class="absolute right-0 pr-2"
              :style="{ top: `${hi * ROW_HEIGHT}rem`, height: ROW_HEIGHT + 'rem' }"
            >
              <span class="text-secondary-500/30 text-xs leading-none dark:text-gray-600">
                {{ formatHourLabel(hour) }}
              </span>
            </div>
          </div>

          <!-- Day columns -->
          <div v-for="day in weekDays" :key="'col-' + day.dateStr" class="relative">
            <!-- Hour row borders (clickable to add activity) -->
            <div
              v-for="(hour, hi) in hours"
              :key="hour"
              class="group/slot absolute inset-x-0 cursor-pointer border-t border-gray-100 transition-all hover:bg-[rgba(241,93,34,0.08)] dark:border-slate-700/50 dark:hover:bg-[rgba(241,93,34,0.12)]"
              :style="{ top: `${hi * ROW_HEIGHT}rem`, height: ROW_HEIGHT + 'rem' }"
              @click="handleEmptySlotClick(day.dateStr, hour)"
            >
              <span
                class="from-primary-500/80 to-terracotta-400/80 pointer-events-none flex h-full flex-col items-center justify-center gap-0 rounded-xl bg-gradient-to-r bg-clip-text text-transparent opacity-0 transition-all group-hover/slot:scale-110 group-hover/slot:opacity-50"
              >
                <span class="text-xl leading-none font-black">+</span>
                <span class="font-outfit text-[0.5625rem] leading-tight font-bold">
                  {{ formatHourLabel(hour) }} &ndash; {{ formatHourLabel(hour + 1) }}
                </span>
              </span>
            </div>

            <!-- Activity blocks -->
            <template
              v-for="(group, gi) in groupOverlapping(
                getTimedForDay(day.dateStr).map((o) => o.activity)
              )"
              :key="gi"
            >
              <div
                v-for="(activity, ai) in group"
                :key="activity.id"
                class="absolute z-10 flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-xs transition-shadow hover:shadow-md"
                :style="{
                  ...getPosition(activity.startTime!, activity.endTime),
                  left: `${(ai / group.length) * 100}%`,
                  width: `calc(${100 / group.length}% - 2px)`,
                  borderLeftColor: getActivityColor(activity),
                  background: getActivityColor(activity) + '18',
                }"
                @click.stop="emit('view-activity', activity.id, day.dateStr)"
              >
                <div
                  class="font-outfit flex items-center truncate text-xs font-semibold"
                  style="color: var(--color-text)"
                >
                  <span class="truncate">{{ activity.title }}</span>
                  <PhotoIndicator :photo-ids="activity.photoIds" />
                </div>
                <div class="flex min-w-0 items-center gap-1">
                  <span class="text-primary-500 truncate text-[0.6875rem] leading-tight opacity-70">
                    {{ formatTime12(activity.startTime!)
                    }}{{ activity.endTime ? `-${formatTime12(activity.endTime)}` : '' }}
                  </span>
                  <span
                    v-if="activity.location"
                    class="text-secondary-500/60 min-w-0 flex-1 truncate text-[0.6875rem] leading-tight dark:text-gray-400"
                  >
                    · 📍 {{ activity.location }}
                  </span>
                  <div
                    v-if="normalizeAssignees(activity).length > 0"
                    class="ml-auto flex flex-shrink-0 -space-x-1"
                    aria-label="Assigned to"
                  >
                    <MemberChip
                      v-for="mid in normalizeAssignees(activity).slice(0, isTablet ? 3 : 2)"
                      :key="mid"
                      :member-id="mid"
                      :size="isTablet ? 'dot' : 'sm'"
                    />
                  </div>
                </div>
              </div>
            </template>

            <!-- Timed travel-segment chips (1h synthetic block, positioned at
                 the segment time). The wrapper is `pointer-events-none` and the
                 chip itself remains clickable — without this, the wrapper's
                 empty area below the chip would block clicks on activities
                 underneath (e.g. a flight chip at 10am over a 1h activity at
                 10am: clicks on the bottom half of the activity card would
                 hit the empty wrapper, not the activity). DO NOT REMOVE. -->
            <div
              v-for="seg in getTimedSegmentsForDay(day.dateStr)"
              :key="'seg-timed-' + seg.segmentId + '-' + seg.kind"
              class="pointer-events-none absolute z-10"
              :style="{
                ...getPosition(seg.time!, addHourToTime(seg.time!)),
                left: '0%',
                width: 'calc(100% - 2px)',
              }"
            >
              <TravelSegmentChip
                :occurrence="seg"
                class="pointer-events-auto"
                @click="(vid: string, idx: number) => emit('view-segment', vid, idx)"
              />
            </div>
          </div>
        </div>

        <!-- Current time indicator -->
        <div
          v-if="showNowIndicator"
          class="bg-primary-500 pointer-events-none absolute right-0 z-20 h-[2px]"
          :style="{ top: nowIndicatorTop, left: '56px' }"
        >
          <div
            class="bg-primary-500 absolute -top-[4px] -left-[4px] h-[10px] w-[10px] rounded-full"
          />
        </div>
      </div>
    </template>

    <!-- ── Mobile: focused-day timeline (navigator strip lives above the
         desktop/mobile branch, see WeekStripNav above). The legacy 7-day
         pill strip that used to live here was removed during the Phase B
         calendar refactor — the 2-week navigator strip replaces it. -->
    <template v-else>
      <DayTimeline
        :date-str="selectedMobileDay"
        :activities="mobileDayActivities"
        :vacations="mobileDayVacations"
        :segments="mobileDaySegments"
        :todos="weekTodos.get(selectedMobileDay) ?? []"
        :members="familyStore.sortedHumans"
        :is-today="selectedMobileDay === toDateInputValue(new Date())"
        :holiday="holidayForDay(selectedMobileDay) ?? null"
        @view-activity="(id, date) => emit('view-activity', id, date)"
        @view-todo="(todo) => emit('view-todo', todo)"
        @vacation-click="(vid) => emit('vacation-click', vid)"
        @view-segment="(vid: string, idx: number) => emit('view-segment', vid, idx)"
        @add-activity="(date, time) => emit('add-activity', date, time)"
        @holiday-click="(h) => emit('holiday-click', h)"
      />
    </template>
  </div>
</template>
