<script setup lang="ts">
/**
 * Desktop/tablet week board — days across the top, meal slots down the side.
 * Purely presentational: it lays out MealSlotCells (the shared seam) and bubbles
 * their intents up. Meals come from the store per cell.
 */
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useTranslation } from '@/composables/useTranslation';
import MealSlotCell from './MealSlotCell.vue';
import type { WeekDay } from '@/composables/useCalendarNavigation';
import type { MealPlanEntry, MealSlot } from '@/types/models';

defineProps<{ weekDays: WeekDay[] }>();
const emit = defineEmits<{
  openMeal: [meal: MealPlanEntry];
  addMeal: [date: string, slot: MealSlot];
}>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

function mealsFor(date: string, slot: MealSlot): MealPlanEntry[] {
  return mealPlanStore.mealsForDate(date).filter((m) => m.slot === slot);
}
</script>

<template>
  <div class="overflow-x-auto p-3">
    <div class="grid min-w-[46rem] grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] gap-1">
      <!-- Header row: empty corner + 7 days -->
      <div></div>
      <div v-for="day in weekDays" :key="day.dateStr" class="pb-2 text-center">
        <div
          class="font-outfit text-sm font-bold"
          :class="day.isToday ? 'text-[#F15D22]' : 'text-secondary-500 dark:text-slate-100'"
        >
          {{ WEEKDAY_FMT.format(day.date) }}
        </div>
        <div class="text-xs text-[rgba(44,62,80,0.45)] dark:text-slate-400">
          {{ day.date.getDate() }}
        </div>
        <div
          v-if="day.isToday"
          class="font-outfit mt-0.5 inline-block rounded-full bg-[var(--tint-orange-15)] px-2 py-0.5 text-[0.58rem] font-bold text-[#F15D22]"
        >
          {{ t('mealPlanner.thisWeek') }}
        </div>
      </div>

      <!-- Slot rows -->
      <template v-for="slot in SLOTS" :key="slot">
        <div
          class="font-outfit flex items-center justify-end pr-2 text-[0.62rem] font-semibold tracking-[0.06em] text-[rgba(44,62,80,0.4)] uppercase"
        >
          {{ t(`mealPlanner.slot.${slot}`) }}
        </div>
        <div
          v-for="day in weekDays"
          :key="`${slot}-${day.dateStr}`"
          class="min-h-[3.5rem]"
          :class="day.isToday ? 'rounded-[13px] bg-[rgba(241,93,34,0.035)]' : ''"
        >
          <MealSlotCell
            :meal-slot="slot"
            :date="day.dateStr"
            :meals="mealsFor(day.dateStr, slot)"
            @open-meal="emit('openMeal', $event)"
            @add-meal="(d, s) => emit('addMeal', d, s)"
          />
        </div>
      </template>
    </div>
  </div>
</template>
