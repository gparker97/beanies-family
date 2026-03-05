<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { toDateInputValue } from '@/utils/date';

const { t } = useTranslation();
const todoStore = useTodoStore();
const activityStore = useActivityStore();

const emit = defineEmits<{
  'open-todo': [id: string];
  'open-activity': [id: string];
}>();

interface ScheduleItem {
  id: string;
  type: 'todo' | 'activity';
  title: string;
  time: string;
  icon: string;
}

const CATEGORY_FALLBACK_ICON: Record<string, string> = {
  lesson: '📚',
  sport: '⚽',
  appointment: '🏥',
  social: '👥',
  pickup: '🚗',
  other: '📌',
};

const todayStr = computed(() => toDateInputValue(new Date()));

const todayFormatted = computed(() =>
  new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
);

function formatTime(dueDate: string, dueTime?: string): string {
  if (dueTime) return dueTime;
  const date = new Date(dueDate);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Today's items (todos + activities merged) ────────────────────────────────
const todayItems = computed<ScheduleItem[]>(() => {
  const items: ScheduleItem[] = [];

  // Todos due today
  for (const todo of todoStore.filteredOpenTodos) {
    if (todo.dueDate && todo.dueDate.split('T')[0] === todayStr.value) {
      items.push({
        id: todo.id,
        type: 'todo',
        title: todo.title,
        time: formatTime(todo.dueDate, todo.dueTime),
        icon: '✅',
      });
    }
  }

  // Activities today (from upcomingActivities which already expands recurring)
  for (const { activity, date } of activityStore.upcomingActivities) {
    if (date === todayStr.value) {
      items.push({
        id: activity.id,
        type: 'activity',
        title: activity.title,
        time: activity.startTime ?? formatTime(date),
        icon: activity.icon ?? CATEGORY_FALLBACK_ICON[activity.category] ?? '📌',
      });
    }
  }

  // Sort by time string (HH:mm sorts correctly, formatted dates sort after)
  items.sort((a, b) => a.time.localeCompare(b.time));
  return items;
});

// ── This week's items (todos + activities merged) ────────────────────────────
const weekItems = computed<ScheduleItem[]>(() => {
  const items: ScheduleItem[] = [];
  const start = todayStr.value;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 7);
  const endStr = toDateInputValue(endDate);

  // Todos this week
  for (const todo of todoStore.filteredOpenTodos) {
    if (!todo.dueDate) continue;
    const dateStr = todo.dueDate.split('T')[0] ?? '';
    if (dateStr >= start && dateStr <= endStr) {
      items.push({
        id: todo.id,
        type: 'todo',
        title: todo.title,
        time: formatTime(todo.dueDate, todo.dueTime),
        icon: '📋',
      });
    }
  }

  // Activities this week
  for (const { activity, date } of activityStore.upcomingActivities) {
    if (date >= start && date <= endStr) {
      items.push({
        id: activity.id,
        type: 'activity',
        title: activity.title,
        time: activity.startTime ?? formatTime(date),
        icon: activity.icon ?? CATEGORY_FALLBACK_ICON[activity.category] ?? '📌',
      });
    }
  }

  items.sort((a, b) => a.time.localeCompare(b.time));
  return items;
});

function handleClick(item: ScheduleItem) {
  if (item.type === 'todo') emit('open-todo', item.id);
  else emit('open-activity', item.id);
}
</script>

<template>
  <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
    <!-- Left — Today's Schedule -->
    <div
      class="nook-schedule-today nook-card-dark border-sky-silk-300 rounded-[var(--sq)] border-l-4 p-6 shadow-[var(--card-shadow)]"
    >
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base">📆</span>
          <span
            class="font-outfit text-secondary-500 text-sm font-semibold tracking-[0.06em] uppercase dark:text-gray-200"
          >
            {{ t('nook.todaySchedule') }}
          </span>
        </div>
        <span
          class="rounded-full bg-[var(--tint-silk-20)] px-2 py-0.5 text-xs font-semibold text-[#3A7BAD]"
        >
          {{ todayFormatted }}
        </span>
      </div>

      <!-- Content -->
      <div v-if="todayItems.length > 0" class="flex flex-col gap-3">
        <div
          v-for="item in todayItems"
          :key="`${item.type}-${item.id}`"
          class="flex cursor-pointer items-center gap-3 rounded-xl transition-colors hover:bg-[var(--tint-silk-20)]"
          @click="handleClick(item)"
        >
          <div
            class="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--tint-silk-20)]"
          >
            <span class="text-sm">{{ item.icon }}</span>
          </div>
          <div class="min-w-0">
            <div
              class="text-secondary-500 truncate text-sm leading-tight font-semibold dark:text-gray-200"
            >
              {{ item.title }}
            </div>
            <div class="text-xs opacity-35">
              {{ item.time }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-secondary-500/40 py-4 text-center text-sm dark:text-gray-500">
        {{ t('nook.noEvents') }}
      </div>
    </div>

    <!-- Right — This Week -->
    <div
      class="nook-schedule-week nook-card-dark border-primary-500 rounded-[var(--sq)] border-l-4 p-6 shadow-[var(--card-shadow)]"
    >
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base">🗓️</span>
          <span
            class="font-outfit text-secondary-500 text-sm font-semibold tracking-[0.06em] uppercase dark:text-gray-200"
          >
            {{ t('nook.thisWeek') }}
          </span>
        </div>
        <router-link to="/planner" class="text-primary-500 text-xs font-semibold hover:underline">
          {{ t('nook.fullCalendar') }} &rarr;
        </router-link>
      </div>

      <!-- Content -->
      <div v-if="weekItems.length > 0" class="flex flex-col gap-3">
        <div
          v-for="item in weekItems"
          :key="`${item.type}-${item.id}`"
          class="flex cursor-pointer items-center gap-3 rounded-xl transition-colors hover:bg-[rgba(241,93,34,0.08)]"
          @click="handleClick(item)"
        >
          <div
            class="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[12px] bg-[rgba(241,93,34,0.08)]"
          >
            <span class="text-sm">{{ item.icon }}</span>
          </div>
          <div class="min-w-0">
            <div
              class="text-secondary-500 truncate text-sm leading-tight font-semibold dark:text-gray-200"
            >
              {{ item.title }}
            </div>
            <div class="text-xs opacity-35">
              {{ item.time }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-secondary-500/40 py-4 text-center text-sm dark:text-gray-500">
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
</style>
