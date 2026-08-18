<script setup lang="ts">
/**
 * The ONE slot-cell used by BOTH the desktop week board and the mobile day-stack,
 * so their slot rendering / add affordance / drop handling can never drift. Renders
 * the meals for a given date+slot as MealCards, plus a dashed "add" target. Handles
 * pointer drops (recipe / type / move) directly via the store; the tap "add" and card
 * clicks bubble up so the page hosts a single editor + picker.
 */
import { ref, computed } from 'vue';
import MealCard from './MealCard.vue';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useMealDrag } from '@/composables/useMealDrag';
import { useTranslation } from '@/composables/useTranslation';
import type { MealPlanEntry, MealSlot } from '@/types/models';

const props = defineProps<{ date: string; mealSlot: MealSlot; meals: MealPlanEntry[] }>();
const emit = defineEmits<{
  openMeal: [meal: MealPlanEntry];
  addMeal: [date: string, slot: MealSlot];
}>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();
const { dragged, endDrag } = useMealDrag();

const isOver = ref(false);
const showAdd = computed(() => props.meals.length === 0 || props.mealSlot === 'snack');

function onDragOver(e: DragEvent): void {
  if (!dragged.value) return;
  e.preventDefault();
  isOver.value = true;
}

async function onDrop(): Promise<void> {
  isOver.value = false;
  const payload = dragged.value;
  endDrag();
  if (!payload) return;
  if (payload.source === 'recipe') {
    await mealPlanStore.createMeal({
      date: props.date,
      slot: props.mealSlot,
      kind: 'recipe',
      recipeId: payload.recipeId,
      cooked: false,
    });
  } else if (payload.source === 'type') {
    await mealPlanStore.createMeal({
      date: props.date,
      slot: props.mealSlot,
      kind: payload.kind,
      cooked: false,
    });
  } else if (payload.source === 'meal') {
    await mealPlanStore.moveMeal(payload.mealId, props.date, props.mealSlot);
  }
}
</script>

<template>
  <div
    class="grid gap-1.5 rounded-[13px] transition-colors"
    :class="isOver ? 'bg-[var(--tint-orange-15)] ring-2 ring-[#F15D22]' : ''"
    @dragover="onDragOver"
    @dragenter="onDragOver"
    @dragleave="isOver = false"
    @drop="onDrop"
  >
    <MealCard v-for="meal in meals" :key="meal.id" :meal="meal" @open="emit('openMeal', meal)" />
    <button
      v-if="showAdd"
      type="button"
      class="font-outfit flex min-h-[2.75rem] items-center justify-center rounded-[13px] border border-dashed border-[rgba(44,62,80,0.18)] text-xs font-semibold text-[rgba(44,62,80,0.42)] transition-colors hover:border-[#F15D22] hover:bg-[var(--tint-orange-8)] hover:text-[#F15D22] dark:border-slate-600 dark:text-slate-500"
      :aria-label="t('mealPlanner.addMeal')"
      @click="emit('addMeal', date, mealSlot)"
    >
      ＋
    </button>
  </div>
</template>
