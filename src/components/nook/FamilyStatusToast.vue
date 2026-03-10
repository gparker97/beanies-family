<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useCriticalItems, type CriticalItem } from '@/composables/useCriticalItems';
import { toDateInputValue } from '@/utils/date';

const { t } = useTranslation();
const todoStore = useTodoStore();
const activityStore = useActivityStore();
const { criticalItems, overflowCount } = useCriticalItems();

const emit = defineEmits<{
  'open-todo': [id: string];
  'open-activity': [id: string, date: string];
}>();

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

function handleItemClick(item: CriticalItem) {
  if (item.type === 'todo') emit('open-todo', item.id);
  else emit('open-activity', item.id, item.occurrenceDate ?? '');
}
</script>

<template>
  <div
    class="rounded-[18px] px-6 py-4 text-white"
    style="
      background: linear-gradient(135deg, #f15d22, #e67e22);
      box-shadow: 0 8px 32px rgb(241 93 34 / 20%);
    "
  >
    <!-- Header row: icon + quote -->
    <div class="flex items-center gap-4">
      <div
        class="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px]"
        style="background: rgb(255 255 255 / 20%)"
      >
        <span class="text-xl">🌳</span>
      </div>
      <div class="min-w-0">
        <p class="font-outfit truncate text-sm leading-snug font-semibold">
          {{ title }}
        </p>
        <p class="mt-0.5 truncate text-xs opacity-70">
          {{ subtitle }}
        </p>
      </div>
    </div>

    <!-- Critical items for today -->
    <div v-if="criticalItems.length" class="mt-3 space-y-1.5 border-t border-white/20 pt-3">
      <button
        v-for="item in criticalItems"
        :key="item.id + item.type + item.time"
        class="flex w-full items-center gap-3 rounded-xl bg-white/10 px-3 py-2 text-left transition-colors hover:bg-white/20 active:bg-white/25"
        @click="handleItemClick(item)"
      >
        <span class="shrink-0 text-base">{{ item.icon }}</span>
        <span class="line-clamp-2 text-xs leading-snug font-medium">{{ item.message }}</span>
      </button>
      <p v-if="overflowCount > 0" class="px-3 text-xs opacity-60">
        +{{ overflowCount }} {{ t('nook.criticalMore') }}
      </p>
    </div>
  </div>
</template>
