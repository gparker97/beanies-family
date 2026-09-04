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
import { SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
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
/**
 * Adding is ALWAYS available. It used to be `meals.length === 0 || slot === 'snack'`, so a
 * breakfast, lunch or dinner that already had something in it offered no way to add a
 * second — most visibly on mobile, where the cell is the whole row and there is nowhere
 * else to tap. Nothing else enforced one-per-slot: the store holds an array, and the print
 * export already styles a second dish in a cell (`.dish.divided`), so the button was the
 * only thing saying no.
 *
 * `isEmpty` decides how LOUD it is, not whether it exists — a full-height dashed panel is
 * an invitation on an empty slot and clutter under a meal that is already planned.
 */
/**
 * How LOUD the add button is, not whether it exists.
 *
 * Two earlier mistakes are corrected here. The compact branch was `opacity-55` on a 24px
 * box, which composited the ink to about 1.5:1 and put its only recovery behind `hover` —
 * on the touch surface this change was made for. And `snack` regressed: it was the ONE
 * slot that already allowed multi-add, so a filled snack cell used to get the full panel
 * and this demoted it to the faded stub. Both branches now keep full contrast and a 44px
 * target; the compact one is simply narrower.
 */
const isEmpty = computed(() => props.meals.length === 0);

/**
 * Every add button announced the same "Add a meal", and there are 28 of them on the board —
 * one indistinguishable name, 28 times, for a screen-reader user. Naming the slot and the
 * day is what makes them tellable apart.
 */
const addLabel = computed(() =>
  fillTemplate(t('mealPlanner.addMealTo'), {
    slot: t(SLOT_LABEL_KEYS[props.mealSlot]),
    day: new Date(`${props.date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  })
);

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
    class="flex h-full min-h-[3.5rem] flex-col gap-1.5 rounded-[13px] transition-colors"
    :class="isOver ? 'bg-[var(--tint-orange-15)] ring-2 ring-[#F15D22]' : ''"
    @dragover="onDragOver"
    @dragenter="onDragOver"
    @dragleave="isOver = false"
    @drop="onDrop"
  >
    <MealCard v-for="meal in meals" :key="meal.id" :meal="meal" @open="emit('openMeal', meal)" />
    <!-- Add/drop affordance: the trailing element grows to fill the cell, so the
         WHOLE day+slot area is a drop target — not just the card. When the slot
         is full (a filled non-snack), a transparent grow-filler keeps the empty
         space droppable (it inherits the root's drag handlers). -->
    <button
      type="button"
      class="font-outfit dark:border-line-strong dark:text-ink-soft flex min-h-[2.75rem] items-center justify-center rounded-[13px] border border-dashed border-[rgba(44,62,80,0.18)] text-xs font-semibold text-[rgba(44,62,80,0.55)] transition-colors hover:border-[#F15D22] hover:bg-[var(--tint-orange-8)] hover:text-[#F15D22] focus-visible:border-[#F15D22] focus-visible:text-[#F15D22]"
      :class="isEmpty ? 'flex-1' : 'shrink-0'"
      :aria-label="addLabel"
      @click="emit('addMeal', date, mealSlot)"
    >
      ＋
    </button>
    <!-- Keeps the rest of the cell droppable when the add button no longer fills it. -->
    <div v-if="!isEmpty" class="min-h-[0.75rem] flex-1" aria-hidden="true"></div>
  </div>
</template>
