<script setup lang="ts">
/**
 * Single-day vertical timeline for mobile (daily + weekly views).
 *
 * Renders an hour grid with events positioned by their `startTime` /
 * `endTime`. Overlapping events split the column into side-by-side
 * lanes so conflicts are visually obvious. Each event card carries a
 * thick left border in its primary assignee's color so "who" is
 * clear without needing per-member columns.
 *
 * Kept presentation-only — the parent queries stores and passes in
 * the filtered activity/vacation/todo lists. This lets DailyCalendarView
 * and WeeklyCalendarView use one timeline with their own navigation
 * wrappers (prev/next arrows vs. day-pill strip).
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useTimeGrid, groupOverlapping } from '@/composables/useCalendarNavigation';
import { useTranslation } from '@/composables/useTranslation';
import { getActivityColor } from '@/stores/activityStore';
import { formatTime12 } from '@/utils/date';
import { tripTypeEmoji } from '@/utils/vacation';
import type { FamilyActivity, FamilyMember, FamilyVacation, TodoItem } from '@/types/models';

type Occurrence = { activity: FamilyActivity; date: string };

interface Props {
  /** ISO date `YYYY-MM-DD` this timeline represents. */
  dateStr: string;
  /** Timed + untimed activity occurrences for this day (parent pre-filters
   *  by the page-level member filter — this component just renders). */
  activities: Occurrence[];
  /** Vacations active on this day. */
  vacations: FamilyVacation[];
  /** Todos due on this day. */
  todos: TodoItem[];
  /** All members, used for color lookup on events. */
  members: FamilyMember[];
  /** Show a "now" indicator line if the date matches today. */
  isToday?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isToday: false,
});

const emit = defineEmits<{
  'view-activity': [id: string, date: string];
  'view-todo': [todo: TodoItem];
  'vacation-click': [vacationId: string];
  'add-activity': [date: string, time?: string];
}>();

const { t } = useTranslation();

// ── Time grid sizing — driven by timed activities on this day ──
const timedRef = computed(() =>
  props.activities
    .filter((o) => o.activity.startTime)
    .map((o) => o.activity as { startTime?: string; endTime?: string })
);
const { hours, totalHeight, getPosition, formatHourLabel, ROW_HEIGHT } = useTimeGrid(timedRef);

// ── Untimed content (all-day row) ──
const untimedActivities = computed(() => props.activities.filter((o) => !o.activity.startTime));
const hasUntimedRow = computed(
  () => props.vacations.length > 0 || props.todos.length > 0 || untimedActivities.value.length > 0
);

// ── Timed activities, lane-packed per overlap cluster ──
interface PositionedEvent {
  occurrence: Occurrence;
  lane: number;
  totalLanes: number;
  top: string;
  height: string;
}

const positionedEvents = computed<PositionedEvent[]>(() => {
  const timed = props.activities.filter((o) => o.activity.startTime);
  if (timed.length === 0) return [];
  // groupOverlapping works on the bare activity shape
  const clusters = groupOverlapping(timed.map((o) => o.activity));
  // Rebuild an index: activity.id → occurrence (preserves per-day date key)
  const occByActivityId = new Map(timed.map((o) => [o.activity.id, o]));
  const result: PositionedEvent[] = [];

  for (const cluster of clusters) {
    // Greedy lane assignment inside the cluster.
    const laneEnd: number[] = []; // minute offset when each lane becomes free
    const laneOfEvent: number[] = [];
    for (const act of cluster) {
      const [sh, sm] = (act.startTime ?? '0:0').split(':').map(Number);
      const start = (sh ?? 0) * 60 + (sm ?? 0);
      const [eh, em] = (act.endTime ?? '').split(':').map(Number);
      const end =
        act.endTime !== undefined && !Number.isNaN(eh) ? (eh ?? 0) * 60 + (em ?? 0) : start + 60;
      let placed = -1;
      for (let l = 0; l < laneEnd.length; l++) {
        if ((laneEnd[l] ?? 0) <= start) {
          laneEnd[l] = end;
          placed = l;
          break;
        }
      }
      if (placed === -1) {
        laneEnd.push(end);
        placed = laneEnd.length - 1;
      }
      laneOfEvent.push(placed);
    }
    const totalLanes = laneEnd.length;
    cluster.forEach((act, i) => {
      const occ = occByActivityId.get(act.id);
      if (!occ) return;
      const pos = getPosition(act.startTime!, act.endTime);
      result.push({
        occurrence: occ,
        lane: laneOfEvent[i] ?? 0,
        totalLanes,
        top: pos.top,
        height: pos.height,
      });
    });
  }
  return result;
});

// ── Now indicator ──
const nowMinutes = ref(0);
let nowTimer: ReturnType<typeof setInterval> | null = null;

function updateNow() {
  const now = new Date();
  nowMinutes.value = now.getHours() * 60 + now.getMinutes();
}

onMounted(() => {
  updateNow();
  nowTimer = setInterval(updateNow, 60_000);
});

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer);
});

const nowIndicatorTop = computed(() => {
  const start = hours.value[0] ?? 7;
  return `${((nowMinutes.value - start * 60) / 60) * ROW_HEIGHT}px`;
});

const showNowIndicator = computed(() => {
  if (!props.isToday) return false;
  const h = Math.floor(nowMinutes.value / 60);
  const start = hours.value[0] ?? 7;
  const end = hours.value[hours.value.length - 1] ?? 19;
  return h >= start && h <= end;
});

// ── Helpers ──
function eventTimeLabel(act: FamilyActivity): string {
  if (!act.startTime) return '';
  const start = formatTime12(act.startTime);
  if (!act.endTime) return start;
  return `${start} – ${formatTime12(act.endTime)}`;
}

function handleSlotClick(hour: number): void {
  emit('add-activity', props.dateStr, `${String(hour).padStart(2, '0')}:00`);
}
</script>

<template>
  <div class="day-timeline">
    <!-- Untimed / all-day row -->
    <div
      v-if="hasUntimedRow"
      class="mb-3 space-y-1.5 rounded-xl border border-gray-200/60 bg-[var(--tint-slate-5)] p-2 dark:border-slate-600/40 dark:bg-slate-700/30"
    >
      <div
        class="font-outfit text-secondary-500/40 text-[10px] font-semibold tracking-[0.14em] uppercase dark:text-gray-500"
      >
        {{ t('planner.allDay') }}
      </div>

      <!-- Vacations -->
      <div
        v-for="v in vacations"
        :key="'vac-' + v.id"
        class="cursor-pointer truncate rounded-md px-2.5 py-1 text-xs font-semibold text-white"
        style="background: linear-gradient(to right, var(--vacation-teal), #0077b6)"
        @click="emit('vacation-click', v.id)"
      >
        {{ tripTypeEmoji(v.tripType) }} {{ v.name }}
      </div>

      <!-- Untimed activities -->
      <div
        v-for="occ in untimedActivities"
        :key="'untimed-' + occ.activity.id"
        class="cursor-pointer truncate rounded-md border-l-[3px] px-2 py-1 text-xs font-medium transition-opacity hover:opacity-80"
        :style="{
          borderLeftColor: getActivityColor(occ.activity),
          background: getActivityColor(occ.activity) + '15',
        }"
        @click="emit('view-activity', occ.activity.id, occ.date)"
      >
        {{ occ.activity.title }}
      </div>

      <!-- Todos due today -->
      <div
        v-for="todo in todos"
        :key="'todo-' + todo.id"
        class="cursor-pointer truncate rounded-md border-l-[3px] px-2 py-1 text-xs font-medium transition-opacity hover:opacity-80"
        style="background: rgb(155 89 182 / 8%); border-left-color: #9b59b6"
        @click="emit('view-todo', todo)"
      >
        ✅ {{ todo.title }}
      </div>
    </div>

    <!-- Timed grid -->
    <div
      class="relative"
      :style="{
        display: 'grid',
        gridTemplateColumns: '56px 1fr',
        height: totalHeight + 'px',
      }"
    >
      <!-- Hour label column -->
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

      <!-- Single event column -->
      <div class="relative border-l border-gray-200/40 dark:border-slate-600/30">
        <!-- Hour row borders (tappable to add) -->
        <div
          v-for="(hour, hi) in hours"
          :key="'slot-' + hour"
          class="group/slot absolute inset-x-0 cursor-pointer border-t border-gray-100 transition-all hover:bg-[rgba(241,93,34,0.06)] dark:border-slate-700/50 dark:hover:bg-[rgba(241,93,34,0.12)]"
          :style="{ top: `${hi * ROW_HEIGHT}px`, height: ROW_HEIGHT + 'px' }"
          @click="handleSlotClick(hour)"
        />

        <!-- Now indicator -->
        <div
          v-if="showNowIndicator"
          class="pointer-events-none absolute inset-x-0 z-[4] flex items-center"
          :style="{ top: nowIndicatorTop }"
        >
          <div class="bg-primary-500 h-1.5 w-1.5 rounded-full shadow-sm" />
          <div class="bg-primary-500 h-0.5 flex-1 opacity-75" />
        </div>

        <!-- Positioned event cards -->
        <button
          v-for="ev in positionedEvents"
          :key="ev.occurrence.activity.id"
          type="button"
          class="absolute z-[2] overflow-hidden rounded-lg border-l-[3px] bg-white px-2 py-1 text-left shadow-sm transition-all hover:-translate-y-[1px] hover:shadow-md dark:bg-slate-800"
          :style="{
            top: ev.top,
            height: ev.height,
            left: `calc(${(ev.lane / ev.totalLanes) * 100}% + 2px)`,
            width: `calc(${(1 / ev.totalLanes) * 100}% - 4px)`,
            borderLeftColor: getActivityColor(ev.occurrence.activity),
            background: getActivityColor(ev.occurrence.activity) + '12',
          }"
          @click="emit('view-activity', ev.occurrence.activity.id, ev.occurrence.date)"
        >
          <div class="font-outfit truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
            {{ ev.occurrence.activity.title }}
          </div>
          <div class="text-secondary-500/60 truncate text-[10px] dark:text-gray-400">
            {{ eventTimeLabel(ev.occurrence.activity) }}
          </div>
        </button>

        <!-- Empty state -->
        <div
          v-if="positionedEvents.length === 0 && !hasUntimedRow"
          class="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <p class="font-outfit text-secondary-500/30 text-sm dark:text-gray-500">
            {{ t('planner.noActivities') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
