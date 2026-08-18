<script setup lang="ts">
/**
 * One planned meal on the board. Leads with the meal name (prominent), the cook
 * clearly beneath (secondary), a leading recipe-photo thumbnail (emoji fallback),
 * a state dot (orange to-cook / green cooked), and meta glyphs (note / guests /
 * serve-time) only when present. Non-recipe types render as tinted chips. Clicking
 * opens the editor; draggable on pointer devices (the tap click is the accessible path).
 */
import { computed } from 'vue';
import MealThumb from './MealThumb.vue';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { useMealDrag } from '@/composables/useMealDrag';
import { fillTemplate } from '@/utils/fillTemplate';
import { mealDisplayName } from '@/utils/mealDisplayName';
import type { MealPlanEntry, MealSlot } from '@/types/models';

const props = defineProps<{ meal: MealPlanEntry }>();
const emit = defineEmits<{ open: [] }>();

const { t } = useTranslation();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();
const { startDrag, endDrag } = useMealDrag();

const SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: '🍳',
  lunch: '🥪',
  dinner: '🍽️',
  snack: '🍎',
};

const recipe = computed(() =>
  props.meal.recipeId ? recipesStore.recipes.find((r) => r.id === props.meal.recipeId) : undefined
);

const isType = computed(() => props.meal.kind !== 'recipe');

const name = computed(() => mealDisplayName(props.meal, recipesStore.recipes, t));

const cook = computed(() =>
  props.meal.cookMemberId
    ? familyStore.members.find((m) => m.id === props.meal.cookMemberId)
    : undefined
);
const cookInitial = computed(() => (cook.value?.name?.[0] ?? '?').toUpperCase());

const guestCount = computed(() => props.meal.guestNames?.length ?? 0);

const typeClass = computed(() => {
  switch (props.meal.kind) {
    case 'eat_out':
      return 'bg-[var(--tint-silk-20)]';
    case 'leftovers':
      return 'bg-[var(--tint-slate-5)]';
    case 'skip':
      return 'border border-dashed border-[rgba(44,62,80,0.18)] opacity-70';
    default:
      return 'bg-[var(--tint-orange-8)]';
  }
});

function onDragStart(e: DragEvent): void {
  startDrag({ source: 'meal', mealId: props.meal.id }, e);
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    draggable="true"
    class="cursor-pointer rounded-[13px] p-2 transition-transform duration-150 hover:-translate-y-px"
    :class="
      isType
        ? typeClass
        : 'border border-[rgba(44,62,80,0.09)] bg-white shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800'
    "
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
    @dragstart="onDragStart"
    @dragend="endDrag"
  >
    <div class="flex items-start gap-2">
      <MealThumb
        v-if="!isType"
        :photo-ids="recipe?.photoIds"
        :fallback-emoji="SLOT_EMOJI[meal.slot]"
      />
      <div class="min-w-0 flex-1">
        <div
          class="font-outfit text-secondary-500 text-sm leading-tight font-bold break-words dark:text-slate-100"
        >
          {{ name }}
        </div>
        <div class="mt-1 flex items-center gap-1.5">
          <span
            v-if="cook"
            class="font-outfit flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.55rem] font-bold text-white ring-2 ring-white dark:ring-slate-800"
            :style="{ backgroundColor: cook.color }"
            >{{ cookInitial }}</span
          >
          <span
            class="font-outfit text-xs font-semibold text-[rgba(44,62,80,0.6)] dark:text-slate-400"
          >
            {{ cook ? cook.name : isType ? '' : t('mealPlanner.card.anyone') }}
          </span>
          <span
            v-if="meal.kind === 'recipe'"
            class="ml-auto h-2 w-2 flex-none rounded-full"
            :class="meal.cooked ? 'bg-[#27AE60]' : 'bg-[#F15D22]'"
            :aria-label="meal.cooked ? t('mealPlanner.card.cooked') : t('mealPlanner.card.toCook')"
          />
        </div>
        <div
          v-if="meal.note || guestCount || meal.serveTime"
          class="mt-1 flex flex-wrap items-center gap-1.5 text-[0.6rem] text-[rgba(44,62,80,0.5)] dark:text-slate-400"
        >
          <span v-if="meal.note" aria-hidden="true">📝</span>
          <span v-if="meal.serveTime" class="font-outfit font-semibold"
            >⏰ {{ meal.serveTime }}</span
          >
          <span v-if="guestCount" class="font-outfit font-semibold">
            👥 {{ fillTemplate(t('mealPlanner.card.guests'), { count: guestCount }) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
