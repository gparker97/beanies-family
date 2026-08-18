<script setup lang="ts">
/**
 * Nook "Today's meals" card — mirrors the other nook section cards. Shows today's
 * planned meals (slot · name · cook) and emits `open-meal` so the FamilyNookPage's
 * single MealEditModal handles the edit (one editor host).
 */
import { computed } from 'vue';
import NookSectionCard from './NookSectionCard.vue';
import MealThumb from '@/components/mealplan/MealThumb.vue';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { mealDisplayName } from '@/utils/mealDisplayName';
import type { MealPlanEntry, MealSlot } from '@/types/models';

const emit = defineEmits<{ openMeal: [meal: MealPlanEntry] }>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();

const meals = computed(() => mealPlanStore.todaysMeals);

const SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: '🍳',
  lunch: '🥪',
  dinner: '🍽️',
  snack: '🍎',
};

function recipeFor(m: MealPlanEntry) {
  return m.recipeId ? recipesStore.recipes.find((r) => r.id === m.recipeId) : undefined;
}
function nameFor(m: MealPlanEntry): string {
  return mealDisplayName(m, recipesStore.recipes, t);
}
function cookFor(m: MealPlanEntry) {
  return m.cookMemberId ? familyStore.members.find((x) => x.id === m.cookMemberId) : undefined;
}
</script>

<template>
  <NookSectionCard :title="`🍲 ${t('mealPlanner.nook.title')}`">
    <p
      v-if="!meals.length"
      class="font-inter py-2 text-sm text-[rgba(44,62,80,0.5)] dark:text-slate-400"
    >
      {{ t('mealPlanner.nook.empty') }}
    </p>
    <ul v-else class="divide-y divide-[rgba(44,62,80,0.06)]">
      <li v-for="m in meals" :key="m.id">
        <button
          type="button"
          class="flex w-full items-center gap-2.5 py-2 text-left"
          @click="emit('openMeal', m)"
        >
          <span
            class="font-outfit w-14 flex-none text-[0.6rem] font-semibold tracking-[0.05em] text-[rgba(44,62,80,0.45)] uppercase"
          >
            {{ t(`mealPlanner.slot.${m.slot}`) }}
          </span>
          <MealThumb
            v-if="m.kind === 'recipe'"
            :photo-ids="recipeFor(m)?.photoIds"
            :fallback-emoji="SLOT_EMOJI[m.slot]"
            :size-rem="1.6"
          />
          <span
            class="font-outfit text-secondary-500 min-w-0 flex-1 truncate text-sm font-semibold dark:text-slate-100"
          >
            {{ nameFor(m) }}
          </span>
          <span
            v-if="cookFor(m)"
            class="font-outfit flex h-5 w-5 flex-none items-center justify-center rounded-full text-[0.6rem] font-bold text-white"
            :style="{ backgroundColor: cookFor(m)!.color }"
          >
            {{ (cookFor(m)!.name[0] ?? '?').toUpperCase() }}
          </span>
        </button>
      </li>
    </ul>
  </NookSectionCard>
</template>
