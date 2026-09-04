<script setup lang="ts">
/**
 * Desktop/tablet week board — days across the top, meal slots down the side.
 * Purely presentational: it lays out MealSlotCells (the shared seam) and bubbles
 * their intents up. Meals come from the store per cell. Each slot row carries a
 * colour-coded label chip + a top divider so the rows read distinctly.
 */
import { computed } from 'vue';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { MEAL_SLOTS, SLOT_EMOJI, SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import { useTranslation } from '@/composables/useTranslation';
import MealSlotCell from './MealSlotCell.vue';
import type { WeekDay } from '@/composables/useCalendarNavigation';
import type { MealPlanEntry, MealSlot } from '@/types/models';

const props = defineProps<{ weekDays: WeekDay[] }>();
const emit = defineEmits<{
  openMeal: [meal: MealPlanEntry];
  addMeal: [date: string, slot: MealSlot];
  clearDay: [date: string];
}>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();

const SLOTS = MEAL_SLOTS;

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
  breakfast: {
    emoji: SLOT_EMOJI.breakfast,
    band: 'bg-[rgba(230,166,74,0.07)] dark:bg-[rgba(230,166,74,0.10)]',
    ink: 'text-[#7d560f] dark:text-[#e3b063]',
  },
  lunch: {
    emoji: SLOT_EMOJI.lunch,
    band: 'bg-[rgba(174,214,241,0.16)] dark:bg-[rgba(174,214,241,0.10)]',
    ink: 'text-[#2c3e50] dark:text-[#aed6f1]',
  },
  dinner: {
    emoji: SLOT_EMOJI.dinner,
    band: 'bg-[rgba(241,93,34,0.06)] dark:bg-[rgba(241,93,34,0.10)]',
    ink: 'text-[#b8420f] dark:text-[#f2865a]',
  },
  snack: {
    emoji: SLOT_EMOJI.snack,
    band: 'bg-[rgba(39,174,96,0.06)] dark:bg-[rgba(39,174,96,0.11)]',
    ink: 'text-[#166534] dark:text-[#5fc98d]',
  },
};

// Fixed en-US to match the app's English-only date labels (utils/date.ts) — an
// undefined locale would follow the OS and mismatch the mobile/share labels.
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

function mealsFor(date: string, slot: MealSlot): MealPlanEntry[] {
  return mealPlanStore.mealsForDate(date).filter((m) => m.slot === slot);
}
/**
 * Emptiness only — deliberately NOT `mealsForDate(...).length`.
 *
 * That helper filters AND sorts the whole meal history to build an array this throws away,
 * seven times per render, purely to decide whether to show a ✕. `some` early-exits and
 * allocates nothing.
 */
function hasMeals(date: string): boolean {
  return mealPlanStore.meals.some((m) => m.date === date);
}

/** The rightmost day, for the row's rounded cap — see the cell's `rounded-r` note. */
const lastDayStr = computed(() => props.weekDays.at(-1)?.dateStr ?? '');
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
        class="group dark:border-l-surface-overlay/60 relative rounded-t-[14px] border-l border-l-[rgba(44,62,80,0.05)] pb-2 text-center"
        :class="day.isToday ? 'bg-[rgba(241,93,34,0.05)]' : ''"
      >
        <!--
          Clear-day is the FIRST thing in the column, in its own reserved strip.
          It began as an absolutely-positioned text button at `top-0 right-1`, over the
          centred day name — at "Clear day" width it covered the very label the column is
          identified by. Moving it into flow fixed the collision but put it under the date,
          which reads as belonging to the row beneath. Top-right is where a "remove this
          column" control is looked for.

          Not hover-only either: `opacity-0 group-hover` is a control that does not exist on
          a touch screen, and this planner's home is a tablet. The query is
          `any-pointer: coarse`, NOT `hover: none` — the latter describes only the PRIMARY
          pointer, so an iPad with a keyboard case (or any touch laptop) reports
          `hover: hover` and would have fallen back to the invisible state.
        -->
        <div class="flex h-5 items-start justify-end pr-1">
          <button
            v-if="hasMeals(day.dateStr)"
            type="button"
            class="font-outfit dark:text-ink-soft grid h-5 w-5 place-items-center rounded-full text-xs leading-none text-[rgba(44,62,80,0.4)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--tint-orange-8)] hover:text-[#F15D22] focus-visible:opacity-100 [@media(any-pointer:coarse)]:opacity-100"
            :aria-label="t('mealPlanner.clearDay')"
            :title="t('mealPlanner.clearDay')"
            @click="emit('clearDay', day.dateStr)"
          >
            <span aria-hidden="true">&#x2715;</span>
          </button>
        </div>
        <div
          class="font-outfit text-sm font-bold"
          :class="day.isToday ? 'text-[#F15D22]' : 'text-secondary-500 dark:text-ink'"
        >
          {{ WEEKDAY_FMT.format(day.date) }}
        </div>
        <div class="dark:text-ink-soft text-xs text-[rgba(44,62,80,0.45)]">
          {{ day.date.getDate() }}
        </div>
        <div
          v-if="day.isToday"
          class="font-outfit mt-0.5 inline-block rounded-full bg-[var(--tint-orange-15)] px-2 py-0.5 text-xs font-bold text-[#F15D22]"
        >
          {{ t('mealPlanner.today') }}
        </div>
      </div>

      <!-- Slot rows -->
      <template v-for="slot in SLOTS" :key="slot">
        <!--
          Stacked emoji over label, adopting the treatment the PRINT export already used —
          `MealPlanExportBody`'s `.slot-head` had a tinted band, a large icon and a readable
          label while the screen had a 9.6px pill. The paper version was the better design.
        -->
        <div
          class="dark:border-line flex items-center justify-center rounded-l-[14px] border-t border-[rgba(44,62,80,0.07)] py-2 pr-1"
          :class="SLOT_META[slot].band"
        >
          <span class="font-outfit flex flex-col items-center gap-0.5" :class="SLOT_META[slot].ink">
            <span class="text-lg leading-none" aria-hidden="true">{{ SLOT_META[slot].emoji }}</span>
            <span class="text-xs font-bold tracking-[0.04em] uppercase">
              {{ t(SLOT_LABEL_KEYS[slot]) }}
            </span>
          </span>
        </div>
        <div
          v-for="day in weekDays"
          :key="`${slot}-${day.dateStr}`"
          class="dark:border-t-surface-overlay min-h-[4rem] border-t border-l border-t-[rgba(44,62,80,0.07)] px-1 py-2"
          :class="[
            SLOT_META[slot].band,
            // TODAY IS AN EDGE, NOT A FILL. A cell can only have one background-color, so
            // the previous version stacked the today wash and the row band as two `bg-*`
            // utilities and Tailwind's emission order silently picked the winner per slot —
            // today's column came out orange on breakfast and snack and lost the wash
            // entirely on lunch and dinner. A border is a different property, so it layers.
            day.isToday
              ? 'border-l-2 border-l-[rgba(241,93,34,0.45)] dark:border-l-[rgba(241,93,34,0.55)]'
              : 'dark:border-l-surface-overlay/60 border-l border-l-[rgba(44,62,80,0.05)]',
            // FINDING: `last:` is `:last-child`, and `<template v-for>` makes every cell a
            // flat child of the one grid — so it matched cell 40 of 40 and rounded the
            // snack row alone. Index-tested instead.
            day.dateStr === lastDayStr ? 'rounded-r-[14px]' : '',
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
