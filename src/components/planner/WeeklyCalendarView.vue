<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import CalendarNavBar from '@/components/planner/CalendarNavBar.vue';
import DayTimeline from '@/components/planner/DayTimeline.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import {
  useWeekNavigation,
  useTimeGrid,
  groupOverlapping,
} from '@/composables/useCalendarNavigation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useTranslation } from '@/composables/useTranslation';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTodoStore } from '@/stores/todoStore';
import { normalizeAssignees } from '@/utils/assignees';
import { toDateInputValue, extractDatePart, formatTime12 } from '@/utils/date';
import { tripTypeEmoji } from '@/utils/vacation';
import type { FamilyActivity, TodoItem } from '@/types/models';

defineProps<{ selectedDate?: string }>();
const emit = defineEmits<{
  'select-date': [date: string];
  'add-activity': [date: string, time?: string];
  'view-activity': [id: string, date: string];
  'view-todo': [todo: TodoItem];
  'vacation-click': [vacationId: string];
}>();

const { t } = useTranslation();
const { isMobile } = useBreakpoint();
const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const vacationStore = useVacationStore();
const todoStore = useTodoStore();

const referenceDate = ref(new Date());
const { weekDays, weekLabel, prevWeek, nextWeek, goToToday } = useWeekNavigation(referenceDate);

// Mobile: selected day within the week
const selectedMobileDay = ref(toDateInputValue(new Date()));

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

const activityCount = computed(() => {
  let count = 0;
  for (const arr of weekActivities.value.values()) count += arr.length;
  return count;
});

// Time grid
const allTimedActivities = computed(() => {
  const items: { startTime?: string; endTime?: string }[] = [];
  for (const arr of weekActivities.value.values()) {
    for (const occ of arr) {
      if (occ.activity.startTime) items.push(occ.activity);
    }
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
  return `${((nowMinutes.value - start * 60) / 60) * ROW_HEIGHT}px`;
});

const showNowIndicator = computed(() => {
  const h = Math.floor(nowMinutes.value / 60);
  const start = hours.value[0] ?? 7;
  const end = hours.value[hours.value.length - 1] ?? 19;
  return h >= start && h <= end;
});

// Auto-scroll to current time
const gridRef = ref<HTMLElement | null>(null);

onMounted(async () => {
  updateNow();
  nowTimer = setInterval(updateNow, 60000);
  await nextTick();
  // Only auto-scroll to current time on fresh page load (scrollTop near top).
  // Skip when switching views to avoid jarring scroll jumps.
  const mainEl = document.querySelector('main');
  if (gridRef.value && mainEl && mainEl.scrollTop < 100) {
    const scrollHour = Math.max(0, Math.floor(nowMinutes.value / 60) - 1);
    const start = hours.value[0] ?? 7;
    const offsetWithinGrid = Math.max(0, (scrollHour - start) * ROW_HEIGHT);
    const gridTop = gridRef.value.getBoundingClientRect().top + window.scrollY;
    mainEl.scrollTop = gridTop - mainEl.getBoundingClientRect().top + offsetWithinGrid - 80;
  }
});

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

// Multi-day all-day activities: compute spanning bars
interface SpanningActivity {
  activity: FamilyActivity;
  startCol: number; // 0-indexed column within the week (0–6)
  span: number; // number of columns to span
}

const spanningActivities = computed<SpanningActivity[]>(() => {
  const days = weekDays.value;
  if (days.length === 0) return [];

  // Collect unique multi-day all-day activities that appear this week
  const seen = new Set<string>();
  const spans: SpanningActivity[] = [];

  for (let col = 0; col < 7; col++) {
    const dateStr = days[col]!.dateStr;
    const occs = weekActivities.value.get(dateStr) ?? [];
    for (const occ of occs) {
      const a = occ.activity;
      if (!a.isAllDay || !a.endDate || seen.has(a.id)) continue;
      seen.add(a.id);

      // Find the column range this activity covers within the visible week
      const actStart = a.date;
      const actEnd = a.endDate;
      let startCol = 0;
      let endCol = 6;
      for (let i = 0; i < 7; i++) {
        if (days[i]!.dateStr >= actStart && startCol === 0 && i > 0) startCol = i;
        if (days[i]!.dateStr <= actEnd) endCol = i;
      }
      // Clamp: activity may start before or extend after the visible week
      startCol = days.findIndex((d) => d.dateStr >= actStart);
      if (startCol < 0) startCol = 0;
      const endIdx = [...days].reverse().findIndex((d) => d.dateStr <= actEnd);
      endCol = endIdx >= 0 ? 6 - endIdx : 6;

      const span = endCol - startCol + 1;
      if (span >= 2) {
        spans.push({ activity: a, startCol, span });
      }
    }
  }
  return spans;
});

// IDs of multi-day spanning activities (to exclude from per-day untimed lists)
const spanningActivityIds = computed(
  () => new Set(spanningActivities.value.map((s) => s.activity.id))
);

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
    getUntimedForDay(dateStr).length > 0 ||
    (weekTodos.value.get(dateStr)?.length ?? 0) > 0 ||
    spanningActivities.value.some((s) => {
      const days = weekDays.value;
      const dayCol = days.findIndex((d) => d.dateStr === dateStr);
      return dayCol >= s.startCol && dayCol < s.startCol + s.span;
    })
  );
}

// Check if there are ANY spanning activities, vacation spans, or per-day untimed content
const hasAnyUntimedContent = computed(
  () =>
    spanningActivities.value.length > 0 ||
    vacationSpans.value.length > 0 ||
    weekDays.value.some((d) => hasUntimedContent(d.dateStr))
);

function handleEmptySlotClick(dateStr: string, hour: number) {
  emit('add-activity', dateStr, `${String(hour).padStart(2, '0')}:00`);
}

// Mobile: activities for selected day (all, unsorted — DayTimeline handles positioning)
const mobileDayActivities = computed(() => weekActivities.value.get(selectedMobileDay.value) ?? []);

// Mobile: vacations active on the selected day (for DayTimeline)
const mobileDayVacations = computed(() =>
  vacationStore.vacations.filter((v) => {
    if (!v.startDate || !v.endDate) return false;
    const start = extractDatePart(v.startDate);
    const end = extractDatePart(v.endDate);
    return selectedMobileDay.value >= start && selectedMobileDay.value <= end;
  })
);

// Mobile: density data per day for the pill strip — unique member colors for
// events on that day + whether any vacation span covers it. Drives the dots +
// underline under each day pill so users see the shape of the week at a glance.
interface DayDensity {
  memberColors: string[]; // up to 3 distinct colors, deduped
  moreCount: number; // 4+ → render a "+N" hint beside the dots
  hasVacation: boolean;
}

const memberColorById = computed(() => {
  const map = new Map<string, string>();
  for (const m of familyStore.members) map.set(m.id, m.color);
  return map;
});

const dayDensities = computed(() => {
  const byDate = new Map<string, DayDensity>();
  for (const day of weekDays.value) {
    const occs = weekActivities.value.get(day.dateStr) ?? [];
    // Collect distinct member colors for timed + untimed events on this day.
    const seen = new Set<string>();
    const colors: string[] = [];
    for (const occ of occs) {
      for (const memberId of normalizeAssignees(occ.activity)) {
        const color = memberColorById.value.get(memberId);
        if (!color || seen.has(color)) continue;
        seen.add(color);
        colors.push(color);
      }
    }
    const hasVacation = vacationSpans.value.some(
      (s) =>
        day.dateStr >= weekDays.value[s.startCol]!.dateStr &&
        day.dateStr <= weekDays.value[Math.min(s.startCol + s.span - 1, 6)]!.dateStr
    );
    byDate.set(day.dateStr, {
      memberColors: colors.slice(0, 3),
      moreCount: Math.max(0, colors.length - 3),
      hasVacation,
    });
  }
  return byDate;
});

defineExpose({ weekLabel, activityCount });
</script>

<template>
  <div class="rounded-3xl bg-white p-5 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800">
    <CalendarNavBar :label="weekLabel" @prev="prevWeek" @next="nextWeek" @today="goToToday" />

    <!-- ── Desktop: Time Grid ──────────────────────────────────────────── -->
    <template v-if="!isMobile">
      <!-- Day headers -->
      <div class="mb-1 grid grid-cols-[56px_repeat(7,1fr)] gap-px">
        <div />
        <button
          v-for="day in weekDays"
          :key="day.dateStr"
          type="button"
          class="cursor-pointer rounded-xl py-2 text-center transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
          :class="selectedDate === day.dateStr ? 'ring-primary-500 ring-2 ring-inset' : ''"
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

        <!-- Spanning multi-day activities (positioned across columns) -->
        <div
          v-for="span in spanningActivities"
          :key="'span-' + span.activity.id"
          class="cursor-pointer truncate rounded-md px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80"
          :style="{
            gridColumn: `${span.startCol + 2} / span ${span.span}`,
            background: getActivityColor(span.activity) + '20',
            color: getActivityColor(span.activity),
            borderLeft: `3px solid ${getActivityColor(span.activity)}`,
          }"
          @click="emit('view-activity', span.activity.id, span.activity.date)"
        >
          {{ span.activity.title }}
        </div>

        <!-- Per-day single-day untimed activities + todos -->
        <template v-for="(day, di) in weekDays" :key="'untimed-' + day.dateStr">
          <div
            v-if="
              getUntimedForDay(day.dateStr).length > 0 ||
              (weekTodos.get(day.dateStr)?.length ?? 0) > 0
            "
            class="min-w-0 overflow-hidden px-0.5"
            :style="{ gridColumn: `${di + 2}` }"
          >
            <div
              v-for="occ in getUntimedForDay(day.dateStr)"
              :key="occ.activity.id"
              class="mb-0.5 cursor-pointer truncate rounded-md border-l-2 px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
              :style="{
                borderLeftColor: getActivityColor(occ.activity),
                background: getActivityColor(occ.activity) + '15',
              }"
              @click="emit('view-activity', occ.activity.id, day.dateStr)"
            >
              {{ occ.activity.title }}
            </div>
            <div
              v-for="todo in weekTodos.get(day.dateStr) ?? []"
              :key="todo.id"
              class="mb-0.5 cursor-pointer truncate rounded-md border-l-2 px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
              style="background: rgb(155 89 182 / 8%); border-left-color: #9b59b6"
              @click="emit('view-todo', todo)"
            >
              {{ todo.title }}
            </div>
          </div>
        </template>
      </div>

      <!-- Time grid — renders at full height, page scrolls naturally -->
      <div ref="gridRef" class="relative">
        <!-- Grid container: hour labels + 7 day columns -->
        <div
          class="grid grid-cols-[56px_repeat(7,1fr)] gap-px"
          :style="{ height: totalHeight + 'px' }"
        >
          <!-- Hour labels column -->
          <div class="relative">
            <div
              v-for="(hour, hi) in hours"
              :key="hour"
              class="absolute right-0 pr-2"
              :style="{ top: `${hi * ROW_HEIGHT}px`, height: ROW_HEIGHT + 'px' }"
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
              :style="{ top: `${hi * ROW_HEIGHT}px`, height: ROW_HEIGHT + 'px' }"
              @click="handleEmptySlotClick(day.dateStr, hour)"
            >
              <span
                class="from-primary-500/80 to-terracotta-400/80 pointer-events-none flex h-full flex-col items-center justify-center gap-0 rounded-xl bg-gradient-to-r bg-clip-text text-transparent opacity-0 transition-all group-hover/slot:scale-110 group-hover/slot:opacity-50"
              >
                <span class="text-xl leading-none font-black">+</span>
                <span class="font-outfit text-[9px] leading-tight font-bold">
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
                class="absolute z-10 flex cursor-pointer flex-wrap items-start gap-x-1.5 gap-y-0 overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-xs transition-shadow hover:shadow-md"
                :style="{
                  ...getPosition(activity.startTime!, activity.endTime),
                  left: `${(ai / group.length) * 100}%`,
                  width: `calc(${100 / group.length}% - 2px)`,
                  borderLeftColor: getActivityColor(activity),
                  background: getActivityColor(activity) + '18',
                }"
                @click.stop="emit('view-activity', activity.id, day.dateStr)"
              >
                <span
                  class="font-outfit w-full truncate text-xs font-semibold"
                  style="color: var(--color-text)"
                >
                  {{ activity.title }}
                </span>
                <span class="text-primary-500 text-xs leading-tight opacity-70">
                  {{ formatTime12(activity.startTime!)
                  }}{{ activity.endTime ? `-${formatTime12(activity.endTime)}` : '' }}
                </span>
                <div v-if="normalizeAssignees(activity).length > 0" class="flex gap-0.5">
                  <MemberChip
                    v-for="mid in normalizeAssignees(activity).slice(0, 2)"
                    :key="mid"
                    :member-id="mid"
                  />
                </div>
              </div>
            </template>
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

    <!-- ── Mobile: Enhanced Day Pills + Unified Timeline ─────────────────── -->
    <template v-else>
      <div class="mb-4 flex gap-1 overflow-x-auto pb-1">
        <button
          v-for="day in weekDays"
          :key="day.dateStr"
          type="button"
          class="font-outfit relative flex shrink-0 flex-col items-center rounded-2xl px-3 py-2 text-xs font-semibold transition-all"
          :class="
            selectedMobileDay === day.dateStr
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
              : day.isToday
                ? 'bg-primary-500/10 text-primary-500'
                : 'text-secondary-500/50 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-slate-700'
          "
          @click="selectedMobileDay = day.dateStr"
        >
          <span class="uppercase">{{ dayAbbrev(day.date) }}</span>
          <span class="mt-0.5 text-sm font-bold">{{ day.date.getDate() }}</span>

          <!-- Density: up to 3 member-colored dots + "+N" overflow hint -->
          <div
            v-if="(dayDensities.get(day.dateStr)?.memberColors?.length ?? 0) > 0"
            class="mt-1 flex h-1.5 items-center gap-[3px]"
          >
            <span
              v-for="(color, i) in dayDensities.get(day.dateStr)?.memberColors ?? []"
              :key="i"
              class="h-1.5 w-1.5 rounded-full"
              :style="{
                backgroundColor: color,
                opacity: selectedMobileDay === day.dateStr ? 1 : 0.85,
              }"
            />
            <span
              v-if="(dayDensities.get(day.dateStr)?.moreCount ?? 0) > 0"
              class="text-[8px] leading-none font-semibold"
              :class="
                selectedMobileDay === day.dateStr
                  ? 'text-white/90'
                  : 'text-secondary-500/50 dark:text-gray-500'
              "
            >
              +{{ dayDensities.get(day.dateStr)?.moreCount }}
            </span>
          </div>
          <!-- Fallback placeholder to keep pill heights consistent -->
          <div
            v-else-if="!dayDensities.get(day.dateStr)?.hasVacation"
            class="mt-1 h-1.5"
            aria-hidden="true"
          />

          <!-- Vacation span underline -->
          <div
            v-if="dayDensities.get(day.dateStr)?.hasVacation"
            class="absolute right-1.5 bottom-1 left-1.5 h-0.5 rounded-full"
            :style="{
              backgroundColor:
                selectedMobileDay === day.dateStr
                  ? 'rgba(255,255,255,0.9)'
                  : 'var(--vacation-teal)',
            }"
            aria-hidden="true"
          />
        </button>
      </div>

      <DayTimeline
        :date-str="selectedMobileDay"
        :activities="mobileDayActivities"
        :vacations="mobileDayVacations"
        :todos="weekTodos.get(selectedMobileDay) ?? []"
        :members="familyStore.sortedHumans"
        :is-today="selectedMobileDay === toDateInputValue(new Date())"
        @view-activity="(id, date) => emit('view-activity', id, date)"
        @view-todo="(todo) => emit('view-todo', todo)"
        @vacation-click="(vid) => emit('vacation-click', vid)"
        @add-activity="(date, time) => emit('add-activity', date, time)"
      />
    </template>
  </div>
</template>
