<script setup lang="ts">
import { computed } from 'vue';
import BaseSidePanel from '@/components/ui/BaseSidePanel.vue';
import ActivityListCard from '@/components/planner/ActivityListCard.vue';
import TodoItemRow from '@/components/todo/TodoItemRow.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTranslation } from '@/composables/useTranslation';
import { toDateInputValue } from '@/utils/date';
import type { TodoItem } from '@/types/models';

const props = defineProps<{
  date: string;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'add-activity': [];
  'edit-activity': [id: string, date: string];
  'view-todo': [todo: TodoItem];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const todoStore = useTodoStore();

/** Format the selected date as a readable header (e.g. "Saturday, March 15") */
const dateHeader = computed(() => {
  const d = new Date(props.date + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
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
</script>

<template>
  <BaseSidePanel :open="open" :title="t('planner.dayAgenda')" @close="emit('close')">
    <!-- Date header -->
    <div class="mb-5">
      <h3 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
        {{ dateHeader }}
      </h3>
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

      <div class="space-y-1.5">
        <ActivityListCard
          v-for="(occ, i) in upcomingActivities"
          :key="`upcoming-${occ.activity.id}-${occ.date}-${i}`"
          :activity="occ.activity"
          :date="occ.date"
          show-date
          @click="emit('edit-activity', occ.activity.id, occ.date)"
        />
      </div>
    </div>
  </BaseSidePanel>
</template>
