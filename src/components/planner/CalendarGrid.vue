<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore, CATEGORY_COLORS } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { extractDatePart, formatMonthYear, formatTime12 } from '@/utils/date';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { tripTypeEmoji, transportEmoji, type TravelSegmentOccurrence } from '@/utils/vacation';
import CalendarNavBar from '@/components/planner/CalendarNavBar.vue';
import AllDayActivityChip from '@/components/planner/AllDayActivityChip.vue';
import { useHorizontalSwipe } from '@/composables/useHorizontalSwipe';
import type { ActivityCategory, FamilyActivity } from '@/types/models';

/**
 * Per-cell all-day item — either a slice of a multi-day run or a single-day
 * chip. The view layer doesn't need to distinguish them; both render via
 * `<AllDayActivityChip>` with the right isStart/isEnd flags. Carrying the
 * activity reference (not just an id) lets the chip resolve color + title
 * without a second store lookup.
 */
interface CellAllDayItem {
  activity: FamilyActivity;
  isStart: boolean;
  isEnd: boolean;
}

const props = defineProps<{
  selectedDate?: string;
}>();

const emit = defineEmits<{
  selectDate: [date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'view-activity': [activityId: string, date: string];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const settingsStore = useSettingsStore();

const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

// Visible cap for the all-day lane in each cell. Cells are tight (60–72 px
// at default root) — 2 chips + the dots row + travel chips + vacation bar
// is the practical ceiling before overflow. Overflow falls into the
// existing day-click handler.
const ALL_DAY_VISIBLE_CAP = 2;

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

const monthLabel = computed(() => {
  return formatMonthYear(new Date(currentYear.value, currentMonth.value, 1));
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
const calendarDays = computed(() => {
  const year = currentYear.value;
  const month = currentMonth.value;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() - settingsStore.weekStartDay + 7) % 7;

  const days: Array<{
    date: string;
    day: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    weekRow: number;
    activities: Array<{ category: ActivityCategory; color?: string }>;
    vacations: Array<{ id: string; name: string; emoji: string; isStart: boolean }>;
    segments: TravelSegmentOccurrence[];
    allDayItems: CellAllDayItem[];
  }> = [];

  // Get activity occurrences for this month
  const monthOccurrences = activityStore.monthActivities(year, month);

  // Build a map of date -> activity info (category + optional color override)
  // for the timed-dot row. Skip vacation-linked activities (they render as
  // vacation bars at the bottom) AND skip all-day activities (they render
  // as category-colored chips in the all-day lane, not as dots — that's
  // the entire point of this lane).
  const dateActivities = new Map<string, Array<{ category: ActivityCategory; color?: string }>>();
  // All-day occurrences for the all-day lane. Same vacation-linked skip
  // (those land in the vacation bar). The util dedupes multi-day per-id.
  const allDayOccurrences: Array<{ activity: FamilyActivity; date: string }> = [];
  for (const occ of monthOccurrences) {
    if (occ.activity.vacationId) continue;
    if (occ.activity.isAllDay) {
      allDayOccurrences.push({ activity: occ.activity, date: occ.date });
      continue;
    }
    if (!dateActivities.has(occ.date)) {
      dateActivities.set(occ.date, []);
    }
    dateActivities
      .get(occ.date)!
      .push({ category: occ.activity.category, color: occ.activity.color });
  }

  // Build a map of date -> travel-segment occurrences (flights, trains, etc).
  // Visible window = first padded day of the grid through the last; we pull
  // a generous month-bounded range and let per-cell filter handle the rest.
  // (Cross-month occurrences appear in their own month — see validation tests.)
  const monthStartStr = formatDate(new Date(year, month, 1));
  const monthEndStr = formatDate(new Date(year, month + 1, 0));
  const dateSegments = new Map<string, TravelSegmentOccurrence[]>();
  for (const occ of vacationStore.travelSegmentOccurrencesInRange(monthStartStr, monthEndStr)) {
    if (!dateSegments.has(occ.date)) dateSegments.set(occ.date, []);
    dateSegments.get(occ.date)!.push(occ);
  }

  // Build a map of date -> vacations covering that date
  const dateVacations = new Map<
    string,
    Array<{ id: string; name: string; emoji: string; isStart: boolean }>
  >();
  for (const v of vacationStore.vacations) {
    if (!v.startDate || !v.endDate) continue;
    const vStart = extractDatePart(v.startDate);
    const vEnd = extractDatePart(v.endDate);
    const emoji = tripTypeEmoji(v.tripType, v.tripPurpose);
    // Walk each day of the vacation
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
      });
    }
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
      activities: dateActivities.get(dateStr) ?? [],
      vacations: dateVacations.get(dateStr) ?? [],
      segments: dateSegments.get(dateStr) ?? [],
      allDayItems: [], // populated below, per week-row
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
      activities: dateActivities.get(dateStr) ?? [],
      vacations: dateVacations.get(dateStr) ?? [],
      segments: dateSegments.get(dateStr) ?? [],
      allDayItems: [], // populated below, per week-row
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
        activities: dateActivities.get(dateStr) ?? [],
        vacations: dateVacations.get(dateStr) ?? [],
        segments: dateSegments.get(dateStr) ?? [],
        allDayItems: [], // populated below, per week-row
      });
    }
  }

  // Compute per-week-row all-day spans + single-day chips. Run the util
  // ONCE per week (not once per cell) — each invocation handles one row's
  // worth of days and the activity occurrences in the same range. The util
  // dedupes multi-day activities by id, so a 3-day activity that produces
  // 3 occurrences becomes one span entry.
  const numRows = Math.ceil(days.length / 7);
  for (let row = 0; row < numRows; row++) {
    const rowDays = days.slice(row * 7, row * 7 + 7);
    if (rowDays.length === 0) continue;
    const rowDateSet = new Set(rowDays.map((d) => d.date));
    // Filter occurrences down to this row's visible dates so the util's
    // dedup-by-id doesn't see a multi-day activity from a different row
    // first and skip later rows.
    const rowOccurrences = allDayOccurrences.filter((o) => rowDateSet.has(o.date));
    // Util expects `{ dateStr }` keyed days (matches WeeklyCalendarView's
    // `weekDays` shape); CalendarGrid uses `{ date }`. Map once per row.
    const result = computeAllDaySpans(
      rowOccurrences,
      rowDays.map((d) => ({ dateStr: d.date }))
    );

    // Attach multi-day slices: walk each span's covered cells, marking
    // isStart on the first cell of the run and isEnd on the last.
    for (const span of result.spans) {
      for (let i = 0; i < span.span; i++) {
        const cell = rowDays[span.startCol + i];
        if (!cell) continue;
        cell.allDayItems.push({
          activity: span.activity,
          isStart: i === 0,
          isEnd: i === span.span - 1,
        });
      }
    }
    // Attach single-day chips: each is its own start AND end.
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

// Vacation span bars for each week row
const activityCount = computed(() => {
  return activityStore.monthActivities(currentYear.value, currentMonth.value).length;
});

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else {
    currentMonth.value--;
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value++;
  }
}

function goToToday() {
  currentYear.value = today.getFullYear();
  currentMonth.value = today.getMonth();
}

function handleDayClick(date: string) {
  emit('selectDate', date);
}

// ── Swipe gesture ──────────────────────────────────────────────────────────
// Horizontal swipe on the calendar surface advances/retreats by one month.
const swipeRef = ref<HTMLElement | null>(null);
useHorizontalSwipe(swipeRef, {
  onSwipeLeft: nextMonth,
  onSwipeRight: prevMonth,
});

defineExpose({ monthLabel, activityCount, currentYear, currentMonth });
</script>

<template>
  <div
    ref="swipeRef"
    class="rounded-3xl bg-white p-5 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    style="touch-action: pan-y"
  >
    <CalendarNavBar :label="monthLabel" @prev="prevMonth" @next="nextMonth" @today="goToToday" />

    <!-- Day headers -->
    <div class="mb-1 grid grid-cols-7 gap-0">
      <div
        v-for="label in dayLabels"
        :key="label"
        class="font-outfit text-secondary-500/40 py-2 text-center text-xs font-semibold tracking-wide uppercase dark:text-gray-500"
      >
        {{ label }}
      </div>
    </div>

    <!-- Calendar grid -->
    <div>
      <div class="grid grid-cols-7 gap-0">
        <button
          v-for="(cell, idx) in calendarDays"
          :key="idx"
          type="button"
          class="relative flex h-[60px] cursor-pointer flex-col items-center justify-start rounded-xl pt-1.5 transition-colors md:h-[72px]"
          :class="[
            cell.isCurrentMonth
              ? 'text-secondary-500 dark:text-gray-200'
              : 'text-secondary-500/20 dark:text-gray-600',
            vacationDateSet.has(cell.date)
              ? 'bg-[var(--vacation-teal-tint)]'
              : cell.weekRow === todayWeekRow && cell.isCurrentMonth
                ? 'bg-[rgba(241,93,34,0.04)]'
                : 'hover:bg-gray-50 dark:hover:bg-slate-700/50',
            props.selectedDate === cell.date ? 'ring-primary-500 ring-2 ring-inset' : '',
          ]"
          @click="handleDayClick(cell.date)"
        >
          <!-- Day number -->
          <span
            class="font-outfit flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold"
            :class="
              cell.isToday
                ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white shadow-[0_2px_6px_rgba(241,93,34,0.3)]'
                : ''
            "
          >
            {{ cell.day }}
          </span>

          <!-- All-day lane: multi-day slices + single-day chips, capped at
               2 visible with `+N` overflow (overflow falls back to the
               existing day-click handler that opens the day-detail surface).
               Per-cell slices form a continuous bar across adjacent cells
               via rounded-corner CSS conditional on isStart/isEnd. -->
          <div v-if="cell.allDayItems.length > 0" class="mt-0.5 flex w-full flex-col gap-px px-px">
            <AllDayActivityChip
              v-for="(item, i) in cell.allDayItems.slice(0, ALL_DAY_VISIBLE_CAP)"
              :key="item.activity.id + ':' + i"
              :activity="item.activity"
              :is-start="item.isStart"
              :is-end="item.isEnd"
              class="block w-full"
              @click.stop="emit('view-activity', item.activity.id, cell.date)"
            />
            <span
              v-if="cell.allDayItems.length > ALL_DAY_VISIBLE_CAP"
              class="text-secondary-500/40 px-0.5 text-[0.5625rem] leading-tight dark:text-gray-500"
            >
              +{{ cell.allDayItems.length - ALL_DAY_VISIBLE_CAP }}
            </span>
          </div>

          <!-- Activity dots -->
          <div v-if="cell.activities.length > 0" class="mt-0.5 flex items-center gap-[3px]">
            <span
              v-for="(act, i) in cell.activities.slice(0, 4)"
              :key="i"
              class="inline-block h-[5px] w-[5px] rounded-full"
              :style="{ backgroundColor: act.color ?? CATEGORY_COLORS[act.category] }"
            />
            <span
              v-if="cell.activities.length > 4"
              class="text-secondary-500/30 text-xs dark:text-gray-500"
            >
              +{{ cell.activities.length - 4 }}
            </span>
          </div>

          <!-- Travel-segment chips (compact emoji + time; click → opens segment editor) -->
          <div
            v-if="cell.segments.length > 0"
            class="mt-0.5 flex w-full items-center gap-[2px] px-0.5"
          >
            <span
              v-for="seg in cell.segments.slice(0, 2)"
              :key="seg.segmentId + '-' + seg.kind"
              class="font-outfit truncate rounded-sm px-0.5 text-[0.5625rem] leading-tight font-bold text-[#0077B6] dark:text-[#00B4D8]"
              :class="
                seg.status === 'pending'
                  ? 'border border-dashed border-[var(--vacation-teal)] bg-[var(--vacation-teal-5)] italic opacity-80'
                  : 'border-l-2 border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)]'
              "
              :title="seg.title"
              @click.stop="emit('view-segment', seg.vacationId, seg.segmentIndex)"
            >
              {{ transportEmoji(seg.transportType, seg.kind) }}
              <span class="opacity-80">{{
                seg.kind === 'departure'
                  ? t('planner.segmentDepartureShort')
                  : t('planner.segmentArrivalShort')
              }}</span>
              <template v-if="seg.time">
                {{ ' ' + formatTime12(seg.time) }}
              </template>
              <span class="sr-only">{{
                seg.kind === 'departure'
                  ? t('planner.segmentDeparture')
                  : t('planner.segmentArrival')
              }}</span>
            </span>
            <span
              v-if="cell.segments.length > 2"
              class="text-secondary-500/40 text-[0.5625rem]"
              aria-hidden="true"
            >
              +{{ cell.segments.length - 2 }}
            </span>
          </div>

          <!-- Spacer pushes vacation bars to bottom of cell (aligned across columns) -->
          <div class="flex-1" />

          <!-- Vacation indicators (anchored to bottom of cell) -->
          <div
            v-for="vac in cell.vacations"
            :key="vac.id"
            class="mt-0.5 w-full cursor-pointer overflow-hidden rounded-sm px-0.5"
            style="background: rgb(0 180 216 / 12%)"
            @click.stop="emit('vacation-click', vac.id)"
          >
            <span
              v-if="vac.isStart"
              class="font-outfit block truncate text-[0.5rem] leading-tight font-bold text-[#0077B6] dark:text-[#00B4D8]"
            >
              {{ vac.emoji }} {{ vac.name }}
            </span>
            <span v-else class="block h-[10px]" />
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
