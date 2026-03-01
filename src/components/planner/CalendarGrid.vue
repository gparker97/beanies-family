<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore, CATEGORY_COLORS } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import type { ActivityCategory } from '@/types/models';

const props = defineProps<{
  selectedDate?: string;
}>();

const emit = defineEmits<{ selectDate: [date: string] }>();

const { t } = useTranslation();
const activityStore = useActivityStore();

const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

const dayLabels = computed(() => [
  t('planner.day.sun'),
  t('planner.day.mon'),
  t('planner.day.tue'),
  t('planner.day.wed'),
  t('planner.day.thu'),
  t('planner.day.fri'),
  t('planner.day.sat'),
]);

const monthLabel = computed(() => {
  const date = new Date(currentYear.value, currentMonth.value, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
});

const todayStr = computed(() => formatDate(today));

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Get the week number (0-indexed row) of a date within the month
function getWeekRow(dayDate: Date): number {
  const firstDayOfMonth = new Date(currentYear.value, currentMonth.value, 1);
  const firstDayOffset = firstDayOfMonth.getDay();
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
  const startOffset = firstDay.getDay(); // 0=Sun

  const days: Array<{
    date: string;
    day: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    weekRow: number;
    activities: Array<{ category: ActivityCategory; color?: string }>;
  }> = [];

  // Get activity occurrences for this month
  const monthOccurrences = activityStore.monthActivities(year, month);

  // Build a map of date -> activity info (category + optional color override)
  const dateActivities = new Map<string, Array<{ category: ActivityCategory; color?: string }>>();
  for (const occ of monthOccurrences) {
    if (!dateActivities.has(occ.date)) {
      dateActivities.set(occ.date, []);
    }
    dateActivities
      .get(occ.date)!
      .push({ category: occ.activity.category, color: occ.activity.color });
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
      });
    }
  }

  return days;
});

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
defineExpose({ monthLabel, activityCount, currentYear, currentMonth });
</script>

<template>
  <div class="rounded-3xl bg-white p-5 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800">
    <!-- Navigation -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="text-secondary-500/50 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
          @click="prevMonth"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            stroke-width="2"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3
          class="font-outfit text-secondary-500 min-w-[160px] text-center text-lg font-bold dark:text-gray-100"
        >
          {{ monthLabel }}
        </h3>
        <button
          type="button"
          class="text-secondary-500/50 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
          @click="nextMonth"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            stroke-width="2"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        class="font-outfit text-primary-500 hover:bg-primary-500/10 cursor-pointer rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors"
        @click="goToToday"
      >
        {{ t('planner.today') }}
      </button>
    </div>

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
          cell.weekRow === todayWeekRow && cell.isCurrentMonth
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
            class="text-secondary-500/30 text-[0.5rem] dark:text-gray-500"
          >
            +{{ cell.activities.length - 4 }}
          </span>
        </div>
      </button>
    </div>
  </div>
</template>
