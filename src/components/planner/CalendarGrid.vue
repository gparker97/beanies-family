<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore, CATEGORY_COLORS } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { extractDatePart } from '@/utils/date';
import { tripTypeEmoji } from '@/utils/vacation';
import CalendarNavBar from '@/components/planner/CalendarNavBar.vue';
import type { ActivityCategory } from '@/types/models';

const props = defineProps<{
  selectedDate?: string;
}>();

const emit = defineEmits<{
  selectDate: [date: string];
  'vacation-click': [vacationId: string];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const settingsStore = useSettingsStore();

const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth());

const allDayLabels = [
  () => t('planner.day.sun'),
  () => t('planner.day.mon'),
  () => t('planner.day.tue'),
  () => t('planner.day.wed'),
  () => t('planner.day.thu'),
  () => t('planner.day.fri'),
  () => t('planner.day.sat'),
];

const dayLabels = computed(() => {
  const start = settingsStore.weekStartDay;
  return Array.from({ length: 7 }, (_, i) => allDayLabels[(i + start) % 7]!());
});

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
  const firstDayOffset = (firstDayOfMonth.getDay() - settingsStore.weekStartDay + 7) % 7;
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
  const startOffset = (firstDay.getDay() - settingsStore.weekStartDay + 7) % 7;

  const days: Array<{
    date: string;
    day: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    weekRow: number;
    activities: Array<{ category: ActivityCategory; color?: string }>;
    vacations: Array<{ id: string; name: string; emoji: string; isStart: boolean }>;
  }> = [];

  // Get activity occurrences for this month
  const monthOccurrences = activityStore.monthActivities(year, month);

  // Build a map of date -> activity info (category + optional color override)
  // Skip vacation-linked activities — they render as span bars instead
  const dateActivities = new Map<string, Array<{ category: ActivityCategory; color?: string }>>();
  for (const occ of monthOccurrences) {
    if (occ.activity.vacationId) continue;
    if (!dateActivities.has(occ.date)) {
      dateActivities.set(occ.date, []);
    }
    dateActivities
      .get(occ.date)!
      .push({ category: occ.activity.category, color: occ.activity.color });
  }

  // Build a map of date -> vacations covering that date
  const dateVacations = new Map<
    string,
    Array<{ id: string; name: string; emoji: string; isStart: boolean }>
  >();
  for (const v of vacationStore.vacations) {
    if (!v.startDate || !v.endDate) continue;
    const vStart = extractDatePart(v.startDate);
    const vEnd = extractDatePart(v.endDate);
    const emoji = tripTypeEmoji(v.tripType, v.tripPurpose);
    // Walk each day of the vacation
    const startD = new Date(vStart + 'T00:00:00');
    const endD = new Date(vEnd + 'T00:00:00');
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const dateStr = formatDate(d);
      if (!dateVacations.has(dateStr)) dateVacations.set(dateStr, []);
      dateVacations.get(dateStr)!.push({
        id: v.id,
        name: v.name,
        emoji,
        isStart: dateStr === vStart,
      });
    }
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
      vacations: dateVacations.get(dateStr) ?? [],
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
      vacations: dateVacations.get(dateStr) ?? [],
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
        vacations: dateVacations.get(dateStr) ?? [],
      });
    }
  }

  return days;
});

// Set of date strings that fall within any vacation (for tinting cells)
const vacationDateSet = computed(() => {
  const set = new Set<string>();
  for (const v of vacationStore.vacations) {
    if (!v.startDate || !v.endDate) continue;
    const start = extractDatePart(v.startDate);
    const end = extractDatePart(v.endDate);
    for (const cell of calendarDays.value) {
      if (cell.date >= start && cell.date <= end) {
        set.add(cell.date);
      }
    }
  }
  return set;
});

// Vacation span bars for each week row
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
    <CalendarNavBar :label="monthLabel" @prev="prevMonth" @next="nextMonth" @today="goToToday" />

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
    <div>
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
            vacationDateSet.has(cell.date)
              ? 'bg-[var(--vacation-teal-tint)]'
              : cell.weekRow === todayWeekRow && cell.isCurrentMonth
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
              class="text-secondary-500/30 text-xs dark:text-gray-500"
            >
              +{{ cell.activities.length - 4 }}
            </span>
          </div>

          <!-- Spacer pushes vacation bars to bottom of cell (aligned across columns) -->
          <div class="flex-1" />

          <!-- Vacation indicators (anchored to bottom of cell) -->
          <div
            v-for="vac in cell.vacations"
            :key="vac.id"
            class="mt-0.5 w-full cursor-pointer overflow-hidden rounded-sm px-0.5"
            style="background: rgb(0 180 216 / 12%)"
            @click.stop="emit('vacation-click', vac.id)"
          >
            <span
              v-if="vac.isStart"
              class="font-outfit block truncate text-[8px] leading-tight font-bold text-[#0077B6] dark:text-[#00B4D8]"
            >
              {{ vac.emoji }} {{ vac.name }}
            </span>
            <span v-else class="block h-[10px]" />
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
