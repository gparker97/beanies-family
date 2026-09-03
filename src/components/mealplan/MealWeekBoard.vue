<script setup lang="ts">
/**
 * Desktop/tablet week board — days across the top, meal slots down the side.
 * Purely presentational: it lays out MealSlotCells (the shared seam) and bubbles
 * their intents up. Meals come from the store per cell. Each slot row carries a
 * colour-coded label chip + a top divider so the rows read distinctly.
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
  clearDay: [date: string];
}>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Per-slot emoji + tinted chip classes, so each row is instantly distinguishable. */
/**
 * A slot's hue belongs to its whole ROW, not to a chip in the gutter.
 *
 * The board is a table and tables are read by their headers, but the slot — the identity
 * of its row — was a 9.6px pill while the photos and cook chips inside the cells were the
 * loudest things on screen. Hierarchy inverted. Each slot already owned a colour; it was
 * only ever spent on the pill. `band` runs that hue across the row so the row IS breakfast,
 * and `ink` keeps the label legible on it.
 *
 * Alphas are deliberately under a meal card's own tint: a full-width band reads far
 * stronger than a chip at the same value.
 */
const SLOT_META: Record<MealSlot, { emoji: string; band: string; ink: string }> = {
  breakfast: { emoji: '🍳', band: 'bg-[rgba(230,166,74,0.07)]', ink: 'text-[#9a6a1a]' },
  lunch: { emoji: '🥪', band: 'bg-[var(--tint-silk-10)]', ink: 'text-secondary-500' },
  dinner: { emoji: '🍽️', band: 'bg-[var(--tint-orange-4)]', ink: 'text-[#D14D1A]' },
  snack: { emoji: '🍎', band: 'bg-[rgba(39,174,96,0.06)]', ink: 'text-[#1e7a45]' },
};

// Fixed en-US to match the app's English-only date labels (utils/date.ts) — an
// undefined locale would follow the OS and mismatch the mobile/share labels.
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

function mealsFor(date: string, slot: MealSlot): MealPlanEntry[] {
  return mealPlanStore.mealsForDate(date).filter((m) => m.slot === slot);
}
function hasMeals(date: string): boolean {
  return mealPlanStore.mealsForDate(date).length > 0;
}
</script>

<template>
  <div class="flex h-full flex-col overflow-auto p-3">
    <div
      class="grid min-h-0 min-w-[56rem] flex-1 grid-cols-[6rem_repeat(7,minmax(7rem,1fr))] grid-rows-[auto_repeat(4,minmax(min-content,1fr))]"
    >
      <!-- Header row: empty corner + 7 days -->
      <div></div>
      <div
        v-for="day in weekDays"
        :key="day.dateStr"
        class="group relative rounded-t-[14px] border-l border-l-[rgba(44,62,80,0.05)] pb-2 text-center dark:border-l-slate-700/60"
        :class="day.isToday ? 'bg-[rgba(241,93,34,0.05)]' : ''"
      >
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
          class="font-outfit mt-0.5 inline-block rounded-full bg-[var(--tint-orange-15)] px-2 py-0.5 text-xs font-bold text-[#F15D22]"
        >
          {{ t('mealPlanner.thisWeek') }}
        </div>
        <!-- Clear-day: appears on hover when the day has meals -->
        <button
          v-if="hasMeals(day.dateStr)"
          type="button"
          class="font-outfit absolute top-0 right-1 rounded-full px-1.5 text-xs font-semibold text-[rgba(44,62,80,0.35)] opacity-0 transition group-hover:opacity-100 hover:text-[#F15D22]"
          :aria-label="t('mealPlanner.clearDay')"
          @click="emit('clearDay', day.dateStr)"
        >
          {{ t('mealPlanner.clearDay') }}
        </button>
      </div>

      <!-- Slot rows -->
      <template v-for="slot in SLOTS" :key="slot">
        <!--
          Stacked emoji over label, adopting the treatment the PRINT export already used —
          `MealPlanExportBody`'s `.slot-head` had a tinted band, a large icon and a readable
          label while the screen had a 9.6px pill. The paper version was the better design.
        -->
        <div
          class="flex items-center justify-center rounded-l-[14px] border-t border-[rgba(44,62,80,0.07)] py-2 pr-1 dark:border-slate-700"
          :class="SLOT_META[slot].band"
        >
          <span class="font-outfit flex flex-col items-center gap-0.5" :class="SLOT_META[slot].ink">
            <span class="text-lg leading-none" aria-hidden="true">{{ SLOT_META[slot].emoji }}</span>
            <span class="text-xs font-bold tracking-[0.04em] uppercase">
              {{ t(`mealPlanner.slot.${slot}`) }}
            </span>
          </span>
        </div>
        <div
          v-for="day in weekDays"
          :key="`${slot}-${day.dateStr}`"
          class="min-h-[4rem] border-t border-l border-t-[rgba(44,62,80,0.07)] border-l-[rgba(44,62,80,0.05)] px-1 py-2 last:rounded-r-[14px] dark:border-t-slate-700 dark:border-l-slate-700/60"
          :class="[
            SLOT_META[slot].band,
            // Today stays the strongest column cue, over the row band rather than instead
            // of it — the two are answering different questions.
            day.isToday ? 'bg-[rgba(241,93,34,0.05)]' : '',
          ]"
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
