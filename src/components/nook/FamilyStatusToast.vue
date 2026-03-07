<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { toDateInputValue } from '@/utils/date';

const { t } = useTranslation();
const todoStore = useTodoStore();
const activityStore = useActivityStore();

const todayActivitiesCount = computed(() => {
  const todayStr = toDateInputValue(new Date());
  return activityStore.upcomingActivities.filter(({ date }) => date === todayStr).length;
});

const openTodosCount = computed(() => todoStore.filteredOpenTodos.length);

const subtitle = computed(() => {
  return t('nook.statusSummary')
    .replace('{activities}', String(todayActivitiesCount.value))
    .replace('{tasks}', String(openTodosCount.value));
});

// Cycle through motivational messages based on day of year
const motivationalKeys = [
  'nook.motto0',
  'nook.motto1',
  'nook.motto2',
  'nook.motto3',
  'nook.motto4',
  'nook.motto5',
  'nook.motto6',
  'nook.motto7',
  'nook.motto8',
  'nook.motto9',
  'nook.motto10',
  'nook.motto11',
  'nook.motto12',
  'nook.motto13',
  'nook.motto14',
  'nook.motto15',
  'nook.motto16',
  'nook.motto17',
  'nook.motto18',
  'nook.motto19',
  'nook.motto20',
  'nook.motto21',
  'nook.motto22',
  'nook.motto23',
  'nook.motto24',
  'nook.motto25',
  'nook.motto26',
  'nook.motto27',
] as const;

const title = computed(() => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const key = motivationalKeys[dayOfYear % motivationalKeys.length] ?? 'nook.motto0';
  return t(key);
});
</script>

<template>
  <div
    class="flex items-center gap-4 rounded-[18px] px-6 py-4 text-white"
    style="
      background: linear-gradient(135deg, #f15d22, #e67e22);
      box-shadow: 0 8px 32px rgb(241 93 34 / 20%);
    "
  >
    <!-- Icon -->
    <div
      class="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px]"
      style="background: rgb(255 255 255 / 20%)"
    >
      <span class="text-xl">🌳</span>
    </div>

    <!-- Text -->
    <div class="min-w-0">
      <p class="font-outfit truncate text-sm leading-snug font-semibold">
        {{ title }}
      </p>
      <p class="mt-0.5 truncate text-xs opacity-70">
        {{ subtitle }}
      </p>
    </div>
  </div>
</template>
