<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';

import { monthCells, monthSpan } from '@/utils/monthCells';

import MonthDayCard, { type MonthDayCellData } from '@/components/planner/MonthDayCard.vue';
import { useCalendarSlide } from '@/composables/useCalendarSlide';
import { useWheelMonthPaging } from '@/composables/useWheelMonthPaging';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { ALL_DAY_VISIBLE_CAP, TIMED_VISIBLE_CAP } from '@/constants/calendarCaps';
import { useToday } from '@/composables/useToday';
import type { HolidayOccurrence } from '@/types/models';

const props = defineProps<{
  /** Controlled period — the page owns the canonical date; the grid derives
   *  its displayed month from it (props down, no internal nav state). */
  referenceDate: Date;
  selectedDate?: string;
}>();

const emit = defineEmits<{
  selectDate: [date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'view-activity': [activityId: string, date: string];
  'holiday-click': [holiday: HolidayOccurrence];
  /** Swipe navigation — the page advances the shared reference date. */
  prev: [];
  next: [];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const settingsStore = useSettingsStore();
const holidayStore = useHolidayStore();

// Reactive "today" from the app-wide singleton — updates on a DST-safe midnight
// timer + visibilitychange + bfcache restore. Using a frozen `new Date()` here
// caused the "ghost today border": a tab left open across midnight kept marking
// yesterday as today (and denied today its border). See issue #25.
const { today: todayStr, startOfToday } = useToday();
const currentYear = computed(() => props.referenceDate.getFullYear());
const currentMonth = computed(() => props.referenceDate.getMonth());

// Visible caps for each cell row. Cells grow naturally with content but
// `+N more` overflow keeps any one day from ballooning a whole row's
// height beyond reason on busy days.

const allDayLabels = [
  () => t('planner.day.sun'),
  () => t('planner.day.mon'),
  () => t('planner.day.tue'),
  () => t('planner.day.wed'),
  () => t('planner.day.thu'),
  () => t('planner.day.fri'),
  () => t('planner.day.sat'),
];

const dayLabels = computed(() => {
  const start = settingsStore.weekStartDay;
  return Array.from({ length: 7 }, (_, i) => allDayLabels[(i + start) % 7]!());
});

// Single source of truth for "the reactive today falls inside the month the grid
// is currently showing." Both the today-week-row tint and the mobile
// scroll-to-today helper read this so the predicate can never drift between them.
// Degrades to `false` (no row tint, no scroll) rather than throwing —
// `startOfToday` is always a valid local-midnight Date.
const todayInView = computed(() => {
  const t = startOfToday.value;
  return t.getMonth() === currentMonth.value && t.getFullYear() === currentYear.value;
});

// Get the week number (0-indexed row) of a date within the month
function getWeekRow(dayDate: Date): number {
  const firstDayOfMonth = new Date(currentYear.value, currentMonth.value, 1);
  const firstDayOffset = (firstDayOfMonth.getDay() - settingsStore.weekStartDay + 7) % 7;
  return Math.floor((dayDate.getDate() + firstDayOffset - 1) / 7);
}

const todayWeekRow = computed(() => {
  if (!todayInView.value) return -1;
  return getWeekRow(startOfToday.value);
});

// Desktop month grid cells. The heavy lifting lives in the pure `monthCells`
// module, shared with the mobile stream (`CalendarMonthStream.vue`) — one
// implementation of the calendar maths, two surfaces rendering it.
const monthData = computed(() => {
  const year = currentYear.value;
  const month = currentMonth.value;
  const weekStartDay = settingsStore.weekStartDay;
  // Full grid span INCLUDING padding cells, so the greyed prev/next-month days
  // still show their items: a visible day that renders empty when it isn't
  // reads as "nothing on", which is worse than not showing the day at all.
  const { startYmd, endYmd } = monthSpan(year, month, weekStartDay);
  return monthCells({
    year,
    month,
    weekStartDay,
    todayStr: todayStr.value,
    occurrences: activityStore.activitiesInRange(startYmd, endYmd),
    segments: vacationStore.travelSegmentOccurrencesInRange(startYmd, endYmd),
    vacations: vacationStore.vacations,
    holidays: holidayStore.holidaysInRange(startYmd, endYmd),
  });
});

const calendarDays = computed<MonthDayCellData[]>(() => monthData.value.days);

// Tint sets, derived by the same pure pass that built the cells.
const vacationDateSet = computed(() => monthData.value.vacationDates);
const holidayDateSet = computed(() => monthData.value.holidayDates);

/**
 * Background class for a day cell. Precedence (highest first): vacation > holiday
 * > today's week-row > default. (A holiday during a trip still surfaces — via the
 * holiday chip — just not via the cell background.)
 */
function cellBgClass(cell: { date: string; weekRow: number; isCurrentMonth: boolean }): string {
  if (vacationDateSet.value.has(cell.date)) return 'md:bg-[var(--vacation-teal-tint)]';
  if (holidayDateSet.value.has(cell.date)) return 'md:bg-[var(--holiday-clay-tint)]';
  if (cell.weekRow === todayWeekRow.value && cell.isCurrentMonth)
    return 'md:bg-[rgba(241,93,34,0.04)]';
  return 'md:hover:bg-gray-50 md:dark:hover:bg-slate-700/50';
}

function handleDayClick(date: string) {
  emit('selectDate', date);
}

// ── Swipe gesture ──────────────────────────────────────────────────────────
// Swipe emits the navigation intent; the page advances the shared reference
// date (one-way data flow — the grid never mutates the date itself).
const swipeRef = ref<HTMLElement | null>(null);
/** The grid body — the wheel pager's own element, deliberately NOT `swipeRef`.
 *  Both composables animate `style.transform`; sharing one element let a wheel
 *  slide and a mouse-drag swipe overwrite each other's transform (and left the
 *  grid stuck at `opacity: 0` when a swipe's cleanup landed after a commit). */
const gridBodyRef = ref<HTMLElement | null>(null);

// ── Desktop wheel paging ───────────────────────────────────────────────────
// Continuing to scroll at the grid's own edge turns the month (approved mockup
// variant B1). Mobile never reaches this component — the page mounts
// `CalendarMonthStream` below `md` — so the composable is gated on the same
// breakpoint singleton rather than a second matchMedia call.
const { isMobile } = useBreakpoint();
const { isPaging } = useWheelMonthPaging(gridBodyRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
  enabled: computed(() => !isMobile.value),
});

// Swipe emits the navigation intent; the page advances the shared reference
// date (one-way data flow — the grid never mutates the date itself).
// Disabled while the wheel pager owns a transition, so a mouse drag during the
// slide cannot emit a SECOND `next` for what the user felt as one gesture.
useCalendarSlide(swipeRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
  enabled: computed(() => !isPaging.value),
});
</script>

<template>
  <div
    ref="swipeRef"
    class="rounded-3xl bg-white p-5 pt-3 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    style="touch-action: pan-y; will-change: transform"
  >
    <!-- Desktop-only day-of-week column headers -->
    <div class="mb-1 grid grid-cols-7 gap-0">
      <div
        v-for="label in dayLabels"
        :key="label"
        class="font-outfit text-secondary-500/40 py-2 text-center text-xs font-semibold tracking-wide uppercase dark:text-gray-500"
      >
        {{ label }}
      </div>
    </div>

    <!-- Calendar body — the desktop 7-column grid. (Below `md` the page mounts
         `CalendarMonthStream` instead, which renders the continuous day-stack.) -->
    <div ref="gridBodyRef" class="grid grid-cols-7 gap-0">
      <template v-for="cell in calendarDays" :key="cell.date">
        <!-- Day card. Outside-month cells render faded to keep the grid aligned. -->
        <MonthDayCard
          :cell="cell"
          :all-day-cap="ALL_DAY_VISIBLE_CAP"
          :timed-cap="TIMED_VISIBLE_CAP"
          :selected="props.selectedDate === cell.date"
          :bg-class="cellBgClass(cell)"
          @select-date="handleDayClick"
          @view-activity="(id, date) => emit('view-activity', id, date)"
          @holiday-click="(h) => emit('holiday-click', h)"
          @vacation-click="(vid) => emit('vacation-click', vid)"
          @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
        />
      </template>
    </div>
  </div>
</template>
