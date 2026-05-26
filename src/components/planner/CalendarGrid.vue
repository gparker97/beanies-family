<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { extractDatePart, formatNookDate } from '@/utils/date';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { tripTypeEmoji, type TravelSegmentOccurrence } from '@/utils/vacation';
import { relativeWeekLabelKey, type RelativeWeekLabelKey } from '@/utils/calendarWeek';
import MonthDayCard, {
  type MonthDayCellData,
  type CellAllDayItem,
  type CellTimedOccurrence,
  type CellVacation,
} from '@/components/planner/MonthDayCard.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import { useCalendarSlide } from '@/composables/useCalendarSlide';
import type { FamilyActivity, HolidayOccurrence } from '@/types/models';

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
const familyStore = useFamilyStore();

const today = new Date();
const currentYear = computed(() => props.referenceDate.getFullYear());
const currentMonth = computed(() => props.referenceDate.getMonth());

// Visible caps for each cell row. Cells grow naturally with content but
// `+N more` overflow keeps any one day from ballooning a whole row's
// height beyond reason on busy days.
const ALL_DAY_VISIBLE_CAP = 2;
const TIMED_VISIBLE_CAP = 4;

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

const todayStr = computed(() => formatDate(today));

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Get the week number (0-indexed row) of a date within the month
function getWeekRow(dayDate: Date): number {
  const firstDayOfMonth = new Date(currentYear.value, currentMonth.value, 1);
  const firstDayOffset = (firstDayOfMonth.getDay() - settingsStore.weekStartDay + 7) % 7;
  return Math.floor((dayDate.getDate() + firstDayOffset - 1) / 7);
}

const todayWeekRow = computed(() => {
  if (today.getMonth() !== currentMonth.value || today.getFullYear() !== currentYear.value)
    return -1;
  return getWeekRow(today);
});

// Build grid cells
const calendarDays = computed<MonthDayCellData[]>(() => {
  const year = currentYear.value;
  const month = currentMonth.value;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() - settingsStore.weekStartDay + 7) % 7;
  // Full grid date span (including the prev/next-month padding cells) — used
  // to query derived overlays (public holidays) that should show on padding
  // days too, not just within the calendar month.
  const totalGridCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
  const gridStartStr = formatDate(new Date(year, month, 1 - startOffset));
  const gridEndStr = formatDate(new Date(year, month, 1 - startOffset + totalGridCells - 1));

  const days: MonthDayCellData[] = [];

  // Activity occurrences for this month — fetched once, partitioned below.
  const monthOccurrences = activityStore.monthActivities(year, month);

  // Map date → full timed occurrences (replaces the old {category, color}
  // shape — MonthChip needs the full activity to resolve member color,
  // emoji, time and title).
  const dateTimedOccurrences = new Map<string, CellTimedOccurrence[]>();
  const allDayOccurrences: Array<{ activity: FamilyActivity; date: string }> = [];
  for (const occ of monthOccurrences) {
    // Vacation-linked activities render as the trailing vacation bar.
    if (occ.activity.vacationId) continue;
    // All-day activities feed the all-day lane, not the timed chip row.
    if (occ.activity.isAllDay) {
      allDayOccurrences.push({ activity: occ.activity, date: occ.date });
      continue;
    }
    if (!dateTimedOccurrences.has(occ.date)) {
      dateTimedOccurrences.set(occ.date, []);
    }
    dateTimedOccurrences.get(occ.date)!.push({ activity: occ.activity, date: occ.date });
  }

  // Sort timed occurrences chronologically within each day (earliest first).
  for (const list of dateTimedOccurrences.values()) {
    list.sort((a, b) => {
      const ta = a.activity.startTime ?? '99:99';
      const tb = b.activity.startTime ?? '99:99';
      return ta.localeCompare(tb);
    });
  }

  // Build a map of date -> travel-segment occurrences (flights, trains, etc).
  const monthStartStr = formatDate(new Date(year, month, 1));
  const monthEndStr = formatDate(new Date(year, month + 1, 0));
  const dateSegments = new Map<string, TravelSegmentOccurrence[]>();
  for (const occ of vacationStore.travelSegmentOccurrencesInRange(monthStartStr, monthEndStr)) {
    if (!dateSegments.has(occ.date)) dateSegments.set(occ.date, []);
    dateSegments.get(occ.date)!.push(occ);
  }

  // Build a map of date -> vacations covering that date
  const dateVacations = new Map<string, CellVacation[]>();
  for (const v of vacationStore.vacations) {
    if (!v.startDate || !v.endDate) continue;
    const vStart = extractDatePart(v.startDate);
    const vEnd = extractDatePart(v.endDate);
    const emoji = tripTypeEmoji(v.tripType, v.tripPurpose);
    const startD = new Date(vStart + 'T00:00:00');
    const endD = new Date(vEnd + 'T00:00:00');
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const dateStr = formatDate(d);
      if (!dateVacations.has(dateStr)) dateVacations.set(dateStr, []);
      dateVacations.get(dateStr)!.push({
        id: v.id,
        name: v.name,
        emoji,
        isStart: dateStr === vStart,
        isEnd: dateStr === vEnd,
      });
    }
  }

  // Build a map of date -> public holidays
  const dateHolidays = new Map<string, HolidayOccurrence[]>();
  for (const h of holidayStore.holidaysInRange(gridStartStr, gridEndStr)) {
    if (!dateHolidays.has(h.date)) dateHolidays.set(h.date, []);
    dateHolidays.get(h.date)!.push(h);
  }

  // Previous month padding
  const prevMonth = new Date(year, month, 0);
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = prevMonth.getDate() - i;
    const dateStr = formatDate(new Date(year, month - 1, d));
    days.push({
      date: dateStr,
      day: d,
      isCurrentMonth: false,
      isToday: false,
      weekRow: days.length < 7 ? 0 : Math.floor(days.length / 7),
      timedOccurrences: dateTimedOccurrences.get(dateStr) ?? [],
      vacations: dateVacations.get(dateStr) ?? [],
      segments: dateSegments.get(dateStr) ?? [],
      allDayItems: [],
      holidays: dateHolidays.get(dateStr) ?? [],
    });
  }

  // Current month days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = formatDate(new Date(year, month, d));
    days.push({
      date: dateStr,
      day: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr.value,
      weekRow: Math.floor(days.length / 7),
      timedOccurrences: dateTimedOccurrences.get(dateStr) ?? [],
      vacations: dateVacations.get(dateStr) ?? [],
      segments: dateSegments.get(dateStr) ?? [],
      allDayItems: [],
      holidays: dateHolidays.get(dateStr) ?? [],
    });
  }

  // Next month padding (fill to complete last row)
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      const dateStr = formatDate(new Date(year, month + 1, d));
      days.push({
        date: dateStr,
        day: d,
        isCurrentMonth: false,
        isToday: false,
        weekRow: Math.floor(days.length / 7),
        timedOccurrences: dateTimedOccurrences.get(dateStr) ?? [],
        vacations: dateVacations.get(dateStr) ?? [],
        segments: dateSegments.get(dateStr) ?? [],
        allDayItems: [],
        holidays: dateHolidays.get(dateStr) ?? [],
      });
    }
  }

  // Compute per-week-row all-day spans + single-day chips. Run the util
  // ONCE per week (not once per cell) — each invocation handles one row's
  // worth of days and the activity occurrences in the same range.
  const numRows = Math.ceil(days.length / 7);
  for (let row = 0; row < numRows; row++) {
    const rowDays = days.slice(row * 7, row * 7 + 7);
    if (rowDays.length === 0) continue;
    const rowDateSet = new Set(rowDays.map((d) => d.date));
    const rowOccurrences = allDayOccurrences.filter((o) => rowDateSet.has(o.date));
    const result = computeAllDaySpans(
      rowOccurrences,
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
      const singles = result.singleByDate.get(cell.date) ?? [];
      for (const a of singles) {
        cell.allDayItems.push({ activity: a, isStart: true, isEnd: true });
      }
    }
  }

  return days;
});

// Set of date strings that fall within any vacation (for tinting cells)
const vacationDateSet = computed(() => {
  const set = new Set<string>();
  for (const v of vacationStore.vacations) {
    if (!v.startDate || !v.endDate) continue;
    const start = extractDatePart(v.startDate);
    const end = extractDatePart(v.endDate);
    for (const cell of calendarDays.value) {
      if (cell.date >= start && cell.date <= end) {
        set.add(cell.date);
      }
    }
  }
  return set;
});

// Set of date strings that are a public holiday (for the clay cell tint).
const holidayDateSet = computed(() => {
  const set = new Set<string>();
  for (const cell of calendarDays.value) {
    if (cell.holidays.length) set.add(cell.date);
  }
  return set;
});

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

/**
 * Set of indexes in `calendarDays` that should be preceded by a mobile-only
 * week separator. A separator appears before the first current-month cell
 * of each week — that way week 0 (which may start with prev-month padding
 * hidden on mobile) still gets its label above the first visible card.
 */
const weekSeparatorIndexes = computed(() => {
  const set = new Set<number>();
  const days = calendarDays.value;
  let lastSepWeekRow = -1;
  for (let i = 0; i < days.length; i++) {
    const cell = days[i]!;
    if (cell.weekRow !== lastSepWeekRow && cell.isCurrentMonth) {
      set.add(i);
      lastSepWeekRow = cell.weekRow;
    }
  }
  return set;
});

/**
 * Per-weekRow metadata for the mobile separator labels: human-friendly
 * range ("May 18 – 24") + a flag for whether this is the current week.
 */
const weekRangeByRow = computed(() => {
  const map = new Map<
    number,
    { range: string; labelKey: RelativeWeekLabelKey; isCurrent: boolean }
  >();
  const days = calendarDays.value;
  const todayStrVal = todayStr.value;
  for (let row = 0; row < Math.ceil(days.length / 7); row++) {
    const rowDays = days.slice(row * 7, row * 7 + 7);
    if (rowDays.length === 0) continue;
    const startCell = rowDays[0]!;
    const endCell = rowDays[rowDays.length - 1]!;
    // Shared 5-way classifier (this/next/last/upcoming/earlier) — single
    // source of truth with the week-strip navigator's row labels.
    const labelKey = relativeWeekLabelKey(startCell.date, endCell.date, todayStrVal);
    map.set(row, {
      range: `${formatNookDate(startCell.date)} – ${formatNookDate(endCell.date)}`,
      labelKey,
      isCurrent: labelKey === 'planner.weekThis',
    });
  }
  return map;
});

function handleDayClick(date: string) {
  emit('selectDate', date);
}

// ── Swipe gesture ──────────────────────────────────────────────────────────
// Swipe emits the navigation intent; the page advances the shared reference
// date (one-way data flow — the grid never mutates the date itself).
const swipeRef = ref<HTMLElement | null>(null);
useCalendarSlide(swipeRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
});

// When the page jumps the reference date to today (the command bar's "Today"),
// scroll the mobile day-stack to today's card. Plain month prev/next lands on
// the 1st of another month, so this only fires for the genuine "Today" action.
watch(
  () => props.referenceDate,
  (d) => {
    if (formatDate(d) !== todayStr.value) return;
    void nextTick().then(() => scrollMobileToToday({ force: true }));
  }
);

/**
 * Mobile scroll-to-today helper. Used in two ways:
 *  - **On first mount** (no `force`): scrolls only when the user hasn't
 *    already scrolled past ~100px. Mirrors `WeeklyCalendarView.vue`'s
 *    scroll-to-current-hour behaviour — don't disturb a user who's
 *    deliberately landed somewhere mid-month.
 *  - **From `goToToday()`** (`force: true`): always scrolls, since the
 *    user explicitly tapped "today" and expects to land on it whether
 *    or not they were already scrolled somewhere else.
 *
 * Today's MonthDayCard carries a `data-date` attribute we can query.
 * `<main>` is the scroll container in `App.vue` / `FamilyPlannerPage`.
 * Skipped on desktop (`md+`) where the 7-column grid keeps today visible.
 */
function scrollMobileToToday(options: { force?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(min-width: 768px)').matches) return; // md+ = desktop
  if (today.getMonth() !== currentMonth.value || today.getFullYear() !== currentYear.value) {
    return;
  }
  const root = swipeRef.value;
  const mainEl = document.querySelector('main');
  if (!root || !mainEl) return;
  if (!options.force && mainEl.scrollTop > 100) return; // first-mount guard
  const card = root.querySelector<HTMLElement>(`[data-date="${todayStr.value}"]`);
  if (!card) return;
  const cardOffsetWithinMain =
    card.getBoundingClientRect().top - mainEl.getBoundingClientRect().top + mainEl.scrollTop;
  // 80px headroom so today's card has breathing room under the topbar.
  // Smooth-scroll on force (user-initiated) so the jump is visible;
  // instant on first mount so the page lands at today without animation.
  mainEl.scrollTo({
    top: Math.max(0, cardOffsetWithinMain - 80),
    behavior: options.force ? 'smooth' : 'auto',
  });
}

onMounted(async () => {
  await nextTick();
  scrollMobileToToday();
});
</script>

<template>
  <div
    ref="swipeRef"
    class="rounded-3xl bg-white p-3 shadow-[0_4px_20px_rgba(44,62,80,0.05)] md:p-5 dark:bg-slate-800"
    style="touch-action: pan-y; will-change: transform"
  >
    <!-- Mobile-only avatar legend strip — one row of dots, never wraps.
         The avatars themselves carry the color grammar of the chips below,
         so this IS the legend (no name labels needed at this size). -->
    <div
      v-if="familyStore.humans.length > 0"
      class="mt-1 mb-3 flex items-center gap-2 overflow-x-auto pb-1 md:hidden"
    >
      <span
        class="font-outfit text-secondary-500/50 flex-shrink-0 text-[0.625rem] font-bold tracking-[0.14em] uppercase dark:text-gray-500"
      >
        {{ t('planner.legendShow') }}
      </span>
      <MemberChip
        v-for="m in familyStore.humans"
        :key="m.id"
        :member-id="m.id"
        size="dot"
        class="!h-7 !w-7 !text-xs"
      />
      <span
        class="from-primary-500 to-terracotta-400 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white"
        :title="t('planner.legendFamily')"
      >
        ★
      </span>
    </div>

    <!-- Desktop-only day-of-week column headers -->
    <div class="hidden md:mb-1 md:grid md:grid-cols-7 md:gap-0">
      <div
        v-for="label in dayLabels"
        :key="label"
        class="font-outfit text-secondary-500/40 py-2 text-center text-xs font-semibold tracking-wide uppercase dark:text-gray-500"
      >
        {{ label }}
      </div>
    </div>

    <!-- Calendar body. Mobile = vertical day-stack (`flex flex-col`) with
         week separators between weeks; desktop = 7-column grid. Outside-
         month cells hide on mobile and show faded on desktop. -->
    <div class="flex flex-col gap-1.5 md:grid md:grid-cols-7 md:gap-0">
      <template v-for="(cell, idx) in calendarDays" :key="cell.date">
        <!-- Mobile-only week separator before the first visible cell of each week -->
        <div
          v-if="weekSeparatorIndexes.has(idx)"
          class="flex items-center gap-2 px-1 pt-1 pb-0.5 md:hidden"
          :class="
            weekRangeByRow.get(cell.weekRow)?.isCurrent
              ? 'text-primary-500'
              : 'text-secondary-500/50 dark:text-gray-500'
          "
        >
          <span class="font-outfit text-[0.625rem] font-bold tracking-[0.14em] uppercase">
            {{ t(weekRangeByRow.get(cell.weekRow)?.labelKey ?? 'planner.weekUpcoming') }}
          </span>
          <span
            class="font-outfit text-[0.625rem] font-medium normal-case"
            :class="weekRangeByRow.get(cell.weekRow)?.isCurrent ? 'opacity-90' : 'opacity-70'"
          >
            · {{ weekRangeByRow.get(cell.weekRow)?.range }}
          </span>
          <span
            class="h-px flex-1"
            :class="
              weekRangeByRow.get(cell.weekRow)?.isCurrent
                ? 'bg-primary-500/30'
                : 'bg-gray-200 dark:bg-slate-700'
            "
          />
        </div>

        <!-- Day card. Outside-month cells hide on mobile to keep the
             day-stack focused; they still render (faded) on desktop to
             keep the 7-column grid aligned. -->
        <MonthDayCard
          :cell="cell"
          :all-day-cap="ALL_DAY_VISIBLE_CAP"
          :timed-cap="TIMED_VISIBLE_CAP"
          :selected="props.selectedDate === cell.date"
          :bg-class="cellBgClass(cell)"
          :class="cell.isCurrentMonth ? '' : 'hidden md:flex'"
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
