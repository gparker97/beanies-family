<script setup lang="ts">
/**
 * Mobile layout — a single day's meals stacked by slot. Consumes the SAME
 * MealSlotCell as the desktop board (shared seam), so behaviour can't drift.
 */
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { MEAL_SLOTS, SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import { useTranslation } from '@/composables/useTranslation';
import MealSlotCell from './MealSlotCell.vue';
import type { MealPlanEntry, MealSlot } from '@/types/models';

const props = defineProps<{ date: string }>();
const emit = defineEmits<{
  openMeal: [meal: MealPlanEntry];
  addMeal: [date: string, slot: MealSlot];
}>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();

const SLOTS = MEAL_SLOTS;

function mealsFor(slot: MealSlot): MealPlanEntry[] {
  return mealPlanStore.mealsForDate(props.date).filter((m) => m.slot === slot);
}
</script>

<template>
  <div class="space-y-4 p-3">
    <div v-for="slot in SLOTS" :key="slot">
      <div
        class="font-outfit dark:text-ink-faint mb-1.5 text-xs font-semibold tracking-[0.06em] text-[rgba(44,62,80,0.4)] uppercase"
      >
        {{ t(SLOT_LABEL_KEYS[slot]) }}
      </div>
      <MealSlotCell
        :meal-slot="slot"
        :date="date"
        :meals="mealsFor(slot)"
        @open-meal="emit('openMeal', $event)"
        @add-meal="(d, s) => emit('addMeal', d, s)"
      />
    </div>
  </div>
</template>
