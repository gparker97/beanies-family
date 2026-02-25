<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { toISODateString } from '@/utils/date';

const { t } = useTranslation();
const todoStore = useTodoStore();

const todayStr = computed(() => toISODateString(new Date()).split('T')[0] ?? '');

const todayFormatted = computed(() =>
  new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
);

const todayTodos = computed(() =>
  todoStore.filteredOpenTodos.filter(
    (todo) => todo.dueDate && todo.dueDate.split('T')[0] === todayStr.value
  )
);

const weekTodos = computed(() => {
  const today = new Date();
  const start = todayStr.value;
  const end = new Date(today);
  end.setDate(end.getDate() + 7);
  const endStr = toISODateString(end).split('T')[0] ?? '';
  return todoStore.filteredOpenTodos.filter((todo) => {
    if (!todo.dueDate) return false;
    const dateStr = todo.dueDate.split('T')[0] ?? '';
    return dateStr >= start && dateStr <= endStr;
  });
});

function formatTodoTime(dueDate: string, dueTime?: string): string {
  if (dueTime) return dueTime;
  const date = new Date(dueDate);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
</script>

<template>
  <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
    <!-- Left — Today's Schedule -->
    <div
      class="nook-schedule-today rounded-[var(--sq)] border-l-4 border-[#AED6F1] p-6 shadow-[var(--card-shadow)]"
    >
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base">📆</span>
          <span
            class="font-outfit text-secondary-500 text-[0.8rem] font-semibold tracking-[0.06em] uppercase dark:text-gray-200"
          >
            {{ t('nook.todaySchedule') }}
          </span>
        </div>
        <span
          class="rounded-full bg-[var(--tint-silk-20)] px-2 py-0.5 text-[0.65rem] font-semibold text-[#3A7BAD]"
        >
          {{ todayFormatted }}
        </span>
      </div>

      <!-- Content -->
      <div v-if="todayTodos.length > 0" class="flex flex-col gap-3">
        <div v-for="todo in todayTodos" :key="todo.id" class="flex items-center gap-3">
          <div
            class="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--tint-silk-20)]"
          >
            <span class="text-sm">✅</span>
          </div>
          <div class="min-w-0">
            <div
              class="text-secondary-500 truncate text-[0.8rem] leading-tight font-semibold dark:text-gray-200"
            >
              {{ todo.title }}
            </div>
            <div class="text-[0.65rem] opacity-35">
              {{ formatTodoTime(todo.dueDate!, todo.dueTime) }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-secondary-500/40 py-4 text-center text-[0.8rem] dark:text-gray-500">
        {{ t('nook.noEvents') }}
      </div>
    </div>

    <!-- Right — This Week -->
    <div
      class="nook-schedule-week rounded-[var(--sq)] border-l-4 border-[#F15D22] p-6 shadow-[var(--card-shadow)]"
    >
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base">🗓️</span>
          <span
            class="font-outfit text-secondary-500 text-[0.8rem] font-semibold tracking-[0.06em] uppercase dark:text-gray-200"
          >
            {{ t('nook.thisWeek') }}
          </span>
        </div>
        <router-link
          to="/planner"
          class="text-[0.75rem] font-semibold text-[#F15D22] hover:underline"
        >
          {{ t('nook.fullCalendar') }} &rarr;
        </router-link>
      </div>

      <!-- Content -->
      <div v-if="weekTodos.length > 0" class="flex flex-col gap-3">
        <div v-for="todo in weekTodos" :key="todo.id" class="flex items-center gap-3">
          <div
            class="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[12px] bg-[rgba(241,93,34,0.08)]"
          >
            <span class="text-sm">📋</span>
          </div>
          <div class="min-w-0">
            <div
              class="text-secondary-500 truncate text-[0.8rem] leading-tight font-semibold dark:text-gray-200"
            >
              {{ todo.title }}
            </div>
            <div class="text-[0.65rem] opacity-35">
              {{ formatTodoTime(todo.dueDate!, todo.dueTime) }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-secondary-500/40 py-4 text-center text-[0.8rem] dark:text-gray-500">
        {{ t('nook.comingSoon') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.nook-schedule-today {
  background: linear-gradient(135deg, white 85%, rgb(174 214 241 / 12%));
}

.nook-schedule-week {
  background: linear-gradient(135deg, white 85%, rgb(241 93 34 / 4%));
}

:global(.dark) .nook-schedule-today,
:global(.dark) .nook-schedule-week {
  background: rgb(30 41 59);
}
</style>
