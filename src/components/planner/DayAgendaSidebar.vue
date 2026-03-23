<script setup lang="ts">
import { computed } from 'vue';
import BaseSidePanel from '@/components/ui/BaseSidePanel.vue';
import ActivityListCard from '@/components/planner/ActivityListCard.vue';
import TodoItemRow from '@/components/todo/TodoItemRow.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTranslation } from '@/composables/useTranslation';
import {
  toDateInputValue,
  isDateBetween,
  extractDatePart,
  formatDateWithDay,
  formatNookDate,
} from '@/utils/date';
import { tripTypeEmoji, tripDurationDays } from '@/utils/vacation';
import type { FamilyActivity, TodoItem } from '@/types/models';

const props = defineProps<{
  date: string;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'add-activity': [];
  'edit-activity': [id: string, date: string];
  'view-todo': [todo: TodoItem];
  'vacation-click': [vacationId: string];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const todoStore = useTodoStore();

/** Format the selected date as a readable header (e.g. "Wed, 6 Mar") */
const dateHeader = computed(() => {
  return formatDateWithDay(props.date);
});

/** Activities for the selected day, sorted by startTime */
const dayActivities = computed(() => {
  const d = new Date(props.date + 'T00:00:00');
  const year = d.getFullYear();
  const month = d.getMonth();
  const occurrences = activityStore.monthActivities(year, month);
  return occurrences
    .filter((o) => o.date === props.date)
    .sort((a, b) => (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? ''));
});

/** Todos due on the selected day */
const dayTodos = computed(() =>
  todoStore.filteredScheduledTodos.filter((t) => t.dueDate?.slice(0, 10) === props.date)
);

/** Active vacation on the selected day (if any) */
const activeVacation = computed(() => {
  for (const v of vacationStore.vacations) {
    if (!v.startDate || !v.endDate) continue;
    if (isDateBetween(props.date, v.startDate, v.endDate)) {
      return v;
    }
  }
  return null;
});

/** Day number within the vacation (1-based) */
const vacationDayNumber = computed(() => {
  if (!activeVacation.value?.startDate) return 0;
  const start = new Date(extractDatePart(activeVacation.value.startDate) + 'T00:00:00');
  const current = new Date(props.date + 'T00:00:00');
  return Math.floor((current.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
});

/** Total days for the active vacation */
const vacationTotalDays = computed(() => {
  if (!activeVacation.value?.startDate || !activeVacation.value?.endDate) return 0;
  return tripDurationDays(activeVacation.value.startDate, activeVacation.value.endDate);
});

/** Upcoming activities in the next 14 days after the selected date */
const upcomingActivities = computed(() => {
  const start = new Date(props.date + 'T00:00:00');
  const nextDay = new Date(start);
  nextDay.setDate(nextDay.getDate() + 1);
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + 14);

  const results: { activity: (typeof dayActivities.value)[0]['activity']; date: string }[] = [];

  // Check up to 2 months to cover the 14-day window
  for (let i = 0; i < 2; i++) {
    const y = nextDay.getFullYear();
    const m = nextDay.getMonth() + i;
    const occurrences = activityStore.monthActivities(y, m);
    for (const occ of occurrences) {
      if (occ.date > props.date && occ.date <= toDateInputValue(endDate)) {
        results.push(occ);
      }
    }
  }

  results.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? '');
  });

  // Deduplicate by activity id + date
  const seen = new Set<string>();
  return results
    .filter((r) => {
      const key = `${r.activity.id}-${r.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
});

/** Group upcoming activities by date for clearer visual separation */
const groupedUpcoming = computed(() => {
  const groups: {
    date: string;
    label: string;
    items: { activity: FamilyActivity; date: string }[];
  }[] = [];
  let currentDate = '';

  for (const occ of upcomingActivities.value) {
    if (occ.date !== currentDate) {
      currentDate = occ.date;
      groups.push({ date: occ.date, label: formatGroupDate(occ.date), items: [] });
    }
    groups[groups.length - 1]!.items.push(occ);
  }

  return groups;
});

function formatGroupDate(dateStr: string): string {
  const today = toDateInputValue(new Date());
  if (dateStr === today) return t('date.today');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === toDateInputValue(tomorrow)) return t('date.tomorrow');
  return formatNookDate(dateStr);
}
</script>

<template>
  <BaseSidePanel :open="open" :title="t('planner.dayAgenda')" @close="emit('close')">
    <!-- Date header -->
    <div class="mb-5">
      <h3 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
        {{ dateHeader }}
      </h3>
    </div>

    <!-- Vacation context banner -->
    <div
      v-if="activeVacation"
      class="mb-4 cursor-pointer rounded-2xl p-3 transition-opacity hover:opacity-90"
      style="background: var(--vacation-teal-tint)"
      @click="emit('vacation-click', activeVacation.id)"
    >
      <div class="flex items-center gap-2">
        <span class="text-lg">{{ tripTypeEmoji(activeVacation.tripType) }}</span>
        <div class="min-w-0 flex-1">
          <span
            class="font-outfit block truncate text-sm font-bold"
            style="color: var(--vacation-teal)"
          >
            {{ activeVacation.name }}
          </span>
          <span class="text-xs" style="color: var(--vacation-teal); opacity: 0.7">
            day {{ vacationDayNumber }} of {{ vacationTotalDays }}
          </span>
        </div>
        <span class="font-outfit text-xs font-semibold" style="color: var(--vacation-teal)">
          ›
        </span>
      </div>
    </div>

    <!-- Day's activities -->
    <div v-if="dayActivities.length > 0" class="space-y-1.5">
      <ActivityListCard
        v-for="(occ, i) in dayActivities"
        :key="`${occ.activity.id}-${i}`"
        :activity="occ.activity"
        :date="occ.date"
        @click="emit('edit-activity', occ.activity.id, occ.date)"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="rounded-2xl bg-gray-50 py-8 text-center dark:bg-slate-700/50">
      <p class="text-secondary-500/40 text-sm dark:text-gray-500">
        {{ t('planner.noActivitiesForDay') }}
      </p>
    </div>

    <!-- Tasks due on this day -->
    <div
      v-if="dayTodos.length > 0"
      class="mt-4 rounded-2xl border-l-4 p-3"
      style="
        background: linear-gradient(135deg, white 85%, rgb(155 89 182 / 6%));
        border-left-color: #9b59b6;
      "
    >
      <h4 class="font-outfit mb-2 text-sm font-semibold" style="color: #9b59b6">
        ✅ {{ t('planner.tasksDue') }}
      </h4>
      <div class="space-y-1.5">
        <TodoItemRow
          v-for="todo in dayTodos"
          :key="todo.id"
          :todo="todo"
          compact
          @toggle="() => {}"
          @view="emit('view-todo', todo)"
        />
      </div>
    </div>

    <!-- Add Activity button -->
    <button
      type="button"
      class="font-outfit from-primary-500 to-terracotta-400 mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
      @click="emit('add-activity')"
    >
      {{ t('planner.addActivity') }}
    </button>

    <!-- Upcoming activities after this day -->
    <div v-if="upcomingActivities.length > 0" class="mt-8">
      <h3 class="font-outfit text-secondary-500 mb-3 text-base font-bold dark:text-gray-100">
        {{ t('planner.upcomingAfterDay') }}
      </h3>

      <div class="space-y-3">
        <div v-for="group in groupedUpcoming" :key="group.date">
          <p
            class="font-outfit text-secondary-500/50 mb-1.5 text-xs font-semibold tracking-wide uppercase dark:text-gray-500"
          >
            {{ group.label }}
          </p>
          <div class="space-y-1.5">
            <ActivityListCard
              v-for="(occ, i) in group.items"
              :key="`upcoming-${occ.activity.id}-${occ.date}-${i}`"
              :activity="occ.activity"
              :date="occ.date"
              @click="emit('edit-activity', occ.activity.id, occ.date)"
            />
          </div>
        </div>
      </div>
    </div>
  </BaseSidePanel>
</template>
