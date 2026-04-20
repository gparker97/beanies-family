<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import CalendarNavBar from '@/components/planner/CalendarNavBar.vue';
import DayTimeline from '@/components/planner/DayTimeline.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import {
  useDayNavigation,
  useTimeGrid,
  groupOverlapping,
} from '@/composables/useCalendarNavigation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useTranslation } from '@/composables/useTranslation';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTodoStore } from '@/stores/todoStore';
import { normalizeAssignees } from '@/utils/assignees';
import { extractDatePart, formatTime12 } from '@/utils/date';
import { tripTypeEmoji } from '@/utils/vacation';
import type { FamilyActivity, FamilyMember, TodoItem } from '@/types/models';

/**
 * `selectedDate` lets the parent jump the daily view to a specific day —
 * used when the user clicks a cell in the monthly/weekly grid and we
 * switch views. Watched (not just used on mount) so repeat clicks from
 * the same parent re-navigate correctly. Prev/next/today buttons still
 * drive the internal `referenceDate`; the prop only fires when the
 * parent deliberately sets it.
 */
const props = defineProps<{ selectedDate?: string }>();

const emit = defineEmits<{
  'select-date': [date: string];
  'add-activity': [date: string, time?: string, memberId?: string];
  'view-activity': [id: string, date: string];
  'view-todo': [todo: TodoItem];
  'vacation-click': [vacationId: string];
  'open-agenda': [date: string];
}>();

const { t } = useTranslation();
const { isMobile, isTablet } = useBreakpoint();
const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const memberFilterStore = useMemberFilterStore();
const vacationStore = useVacationStore();
const todoStore = useTodoStore();

const referenceDate = ref(
  props.selectedDate ? new Date(props.selectedDate + 'T00:00:00') : new Date()
);
const { currentDay, dayLabel, prevDay, nextDay, goToToday } = useDayNavigation(referenceDate);

// Parent-driven date changes (e.g. user clicked a day in the monthly grid
// while we were already on day view). `immediate: false` — initial state
// is handled above.
watch(
  () => props.selectedDate,
  (newDate) => {
    if (newDate) referenceDate.value = new Date(newDate + 'T00:00:00');
  }
);

// ── Members (sorted, filtered) ─────────────────────────────────────────────

// Planner columns — humans only (pets aren't activity assignees).
const visibleMembers = computed<FamilyMember[]>(() =>
  familyStore.sortedHumans.filter(
    (m) => memberFilterStore.isAllSelected || memberFilterStore.isMemberSelected(m.id)
  )
);

// ── Data ────────────────────────────────────────────────────────────────────

type Occurrence = { activity: FamilyActivity; date: string };

const dayActivities = computed<Occurrence[]>(() => {
  const dateStr = currentDay.value.dateStr;
  const d = currentDay.value.date;
  const occs = activityStore.monthActivities(d.getFullYear(), d.getMonth());
  return occs.filter((o) => o.date === dateStr && !o.activity.vacationId);
});

// Mobile timeline honors the page-level member filter (same semantics as
// the desktop column hiding) so the in-view filter isn't duplicated.
const mobileDayActivities = computed<Occurrence[]>(() => {
  if (memberFilterStore.isAllSelected) return dayActivities.value;
  return dayActivities.value.filter((o) =>
    normalizeAssignees(o.activity).some((id) => memberFilterStore.isMemberSelected(id))
  );
});

const activityCount = computed(() => dayActivities.value.length);

// Activities for a specific member
function memberActivities(memberId: string): Occurrence[] {
  return dayActivities.value.filter((o) => normalizeAssignees(o.activity).includes(memberId));
}

function memberTimedActivities(memberId: string): FamilyActivity[] {
  return memberActivities(memberId)
    .filter((o) => o.activity.startTime)
    .sort((a, b) => (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? ''))
    .map((o) => o.activity);
}

function memberUntimedActivities(memberId: string): Occurrence[] {
  return memberActivities(memberId).filter((o) => !o.activity.startTime);
}

// Todos for today
const dayTodos = computed<TodoItem[]>(() =>
  todoStore.filteredScheduledTodos.filter(
    (todo) => (todo.dueDate?.slice(0, 10) ?? '') === currentDay.value.dateStr
  )
);

// Time grid
const allTimedActivities = computed(() =>
  dayActivities.value
    .filter((o) => o.activity.startTime)
    .map((o) => o.activity as { startTime?: string; endTime?: string })
);

const { hours, totalHeight, getPosition, formatHourLabel, ROW_HEIGHT } =
  useTimeGrid(allTimedActivities);

// Vacation bars active on this day
const activeVacations = computed(() =>
  vacationStore.vacations.filter((v) => {
    if (!v.startDate || !v.endDate) return false;
    const start = extractDatePart(v.startDate);
    const end = extractDatePart(v.endDate);
    const day = currentDay.value.dateStr;
    return day >= start && day <= end;
  })
);

const hasAnyUntimedContent = computed(
  () =>
    activeVacations.value.length > 0 ||
    dayTodos.value.length > 0 ||
    visibleMembers.value.some((m) => memberUntimedActivities(m.id).length > 0)
);

// ── Current time indicator ─────────────────────────────────────────────────

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
  if (!currentDay.value.isToday) return false;
  const h = Math.floor(nowMinutes.value / 60);
  const start = hours.value[0] ?? 7;
  const end = hours.value[hours.value.length - 1] ?? 19;
  return h >= start && h <= end;
});

const gridRef = ref<HTMLElement | null>(null);

onMounted(async () => {
  updateNow();
  nowTimer = setInterval(updateNow, 60000);
  await nextTick();
  // Only auto-scroll to current time on fresh page load (scrollTop near top).
  // Skip when switching views to avoid jarring scroll jumps.
  const mainEl = document.querySelector('main');
  if (gridRef.value && currentDay.value.isToday && mainEl && mainEl.scrollTop < 100) {
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

// ── Helpers ────────────────────────────────────────────────────────────────

function handleSlotClick(memberId: string, hour: number) {
  emit('add-activity', currentDay.value.dateStr, `${String(hour).padStart(2, '0')}:00`, memberId);
}

// Grid template columns (dynamic based on member count)
const gridCols = computed(() => `56px repeat(${visibleMembers.value.length}, 1fr)`);

defineExpose({ dayLabel, activityCount });
</script>

<template>
  <div class="rounded-3xl bg-white p-5 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800">
    <CalendarNavBar :label="dayLabel" @prev="prevDay" @next="nextDay" @today="goToToday">
      <template #actions>
        <button
          type="button"
          class="text-secondary-500/70 hover:text-primary-500 font-outfit inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
          :title="t('planner.openAgenda')"
          :aria-label="t('planner.openAgenda')"
          @click="emit('open-agenda', currentDay.dateStr)"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            stroke-width="2"
            aria-hidden="true"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span class="hidden sm:inline">{{ t('planner.agenda') }}</span>
        </button>
      </template>
    </CalendarNavBar>

    <!-- ── Desktop: Member Column Grid ──────────────────────────────────── -->
    <template v-if="!isMobile">
      <!-- Member headers -->
      <div class="mb-0" :style="{ display: 'grid', gridTemplateColumns: gridCols }">
        <div />
        <div
          v-for="member in visibleMembers"
          :key="'header-' + member.id"
          class="relative flex flex-col items-center gap-1 py-2.5"
        >
          <span
            class="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
            :style="{ backgroundColor: member.color }"
          >
            {{ member.name.charAt(0).toUpperCase() }}
          </span>
          <span
            class="font-outfit text-secondary-500/55 text-xs font-semibold lowercase dark:text-gray-400"
          >
            {{ member.name }}
          </span>
          <!-- Colored accent bar -->
          <div
            class="absolute right-2 bottom-0 left-2 h-0.5 rounded-full opacity-50"
            :style="{ backgroundColor: member.color }"
          />
        </div>
      </div>

      <!-- All-day / untimed row -->
      <div
        v-if="hasAnyUntimedContent"
        class="relative mb-1 rounded-xl border border-gray-200/60 bg-[var(--tint-slate-5)] py-1.5 dark:border-slate-600/40 dark:bg-slate-700/30"
        :style="{ display: 'grid', gridTemplateColumns: gridCols }"
      >
        <div class="flex items-center justify-center">
          <span
            class="font-outfit text-secondary-500/40 text-xs font-semibold uppercase dark:text-gray-500"
          >
            {{ t('planner.allDay') }}
          </span>
        </div>

        <!-- Vacation bars (span all member columns) -->
        <div
          v-for="v in activeVacations"
          :key="'vac-' + v.id"
          class="cursor-pointer truncate rounded-md px-2 py-0.5 text-xs font-semibold text-white transition-opacity hover:opacity-80"
          :style="{
            gridColumn: `2 / span ${visibleMembers.length}`,
            background: 'linear-gradient(to right, var(--vacation-teal), #0077B6)',
            borderLeft: '3px solid var(--vacation-teal)',
            opacity: 0.85,
          }"
          @click="emit('vacation-click', v.id)"
        >
          {{ tripTypeEmoji(v.tripType) }} {{ v.name }}
        </div>

        <!-- Per-member untimed activities + todos -->
        <template v-for="(member, mi) in visibleMembers" :key="'untimed-' + member.id">
          <div
            v-if="
              memberUntimedActivities(member.id).length > 0 || (mi === 0 && dayTodos.length > 0)
            "
            class="min-w-0 overflow-hidden border-l border-gray-200/40 px-0.5 dark:border-slate-600/30"
            :style="{ gridColumn: `${mi + 2}` }"
          >
            <div
              v-for="occ in memberUntimedActivities(member.id)"
              :key="occ.activity.id"
              class="mb-0.5 cursor-pointer truncate rounded-md border-l-2 px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
              :style="{
                borderLeftColor: getActivityColor(occ.activity),
                background: getActivityColor(occ.activity) + '15',
              }"
              @click="emit('view-activity', occ.activity.id, currentDay.dateStr)"
            >
              {{ occ.activity.title }}
            </div>
            <!-- Todos (show in first member column) -->
            <div
              v-for="todo in mi === 0 ? dayTodos : []"
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

      <!-- Time grid -->
      <div ref="gridRef" class="relative">
        <div
          :style="{ display: 'grid', gridTemplateColumns: gridCols, height: totalHeight + 'px' }"
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

          <!-- Member columns -->
          <div
            v-for="member in visibleMembers"
            :key="'col-' + member.id"
            class="relative border-l border-gray-200/40 dark:border-slate-600/30"
          >
            <!-- Subtle color gradient at top -->
            <div
              class="pointer-events-none absolute inset-x-0 top-0 z-[1] h-10"
              :style="{ background: `linear-gradient(to bottom, ${member.color}0A, transparent)` }"
            />

            <!-- Hour row borders (clickable to add activity) -->
            <div
              v-for="(hour, hi) in hours"
              :key="hour"
              class="group/slot absolute inset-x-0 cursor-pointer border-t border-gray-100 transition-all hover:bg-[rgba(241,93,34,0.08)] dark:border-slate-700/50 dark:hover:bg-[rgba(241,93,34,0.12)]"
              :style="{ top: `${hi * ROW_HEIGHT}px`, height: ROW_HEIGHT + 'px' }"
              @click="handleSlotClick(member.id, hour)"
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
              v-for="(group, gi) in groupOverlapping(memberTimedActivities(member.id))"
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
                @click.stop="emit('view-activity', activity.id, currentDay.dateStr)"
              >
                <div
                  class="font-outfit truncate text-xs font-semibold"
                  style="color: var(--color-text)"
                >
                  {{ activity.title }}
                </div>
                <div class="flex min-w-0 items-center gap-1">
                  <span class="text-primary-500 truncate text-[11px] leading-tight opacity-70">
                    {{ formatTime12(activity.startTime!)
                    }}{{ activity.endTime ? `-${formatTime12(activity.endTime)}` : '' }}
                  </span>
                  <span
                    v-if="activity.location"
                    class="text-secondary-500/60 min-w-0 flex-1 truncate text-[11px] leading-tight dark:text-gray-400"
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

    <!-- ── Mobile: Unified Timeline (page-level filter drives scope) ─────── -->
    <template v-else>
      <DayTimeline
        :date-str="currentDay.dateStr"
        :activities="mobileDayActivities"
        :vacations="activeVacations"
        :todos="dayTodos"
        :members="visibleMembers"
        :is-today="currentDay.isToday"
        @view-activity="(id, date) => emit('view-activity', id, date)"
        @view-todo="(todo) => emit('view-todo', todo)"
        @vacation-click="(vid) => emit('vacation-click', vid)"
        @add-activity="(date, time) => emit('add-activity', date, time)"
      />
    </template>
  </div>
</template>
