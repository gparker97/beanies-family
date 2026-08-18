<script setup lang="ts">
/**
 * Desktop/tablet cookbook rail — the drag SOURCE for the meal board. Search the
 * cookbook, drag a recipe onto a day+slot, or drag one of the non-recipe "type"
 * chips (Eat out / Leftovers / Skip / Other). Drag-and-drop is a pointer-only
 * enhancement; the same actions are available by tapping a slot (MealPickerSheet).
 */
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import MealThumb from './MealThumb.vue';
import { useRecipesStore } from '@/stores/recipesStore';
import { useRecipeSearch } from '@/composables/useRecipeSearch';
import { useMealDrag } from '@/composables/useMealDrag';
import { useTranslation } from '@/composables/useTranslation';
import type { MealKind } from '@/types/models';

const { t } = useTranslation();
const recipesStore = useRecipesStore();
const { recipes } = storeToRefs(recipesStore);
const { startDrag, endDrag } = useMealDrag();

const query = ref('');
const { results } = useRecipeSearch(recipes, query);

const ALT_TYPES: { kind: Exclude<MealKind, 'recipe'>; emoji: string; cls: string }[] = [
  { kind: 'eat_out', emoji: '🍜', cls: 'bg-[var(--tint-silk-20)] text-secondary-500' },
  { kind: 'leftovers', emoji: '♻️', cls: 'bg-[var(--tint-slate-5)] text-secondary-500' },
  {
    kind: 'skip',
    emoji: '—',
    cls: 'border border-[rgba(44,62,80,0.14)] text-[rgba(44,62,80,0.6)]',
  },
  { kind: 'other', emoji: '✎', cls: 'bg-[var(--tint-orange-8)] text-[#D14D1A]' },
];
</script>

<template>
  <aside
    class="border-b border-[rgba(44,62,80,0.06)] p-4 md:border-r md:border-b-0 dark:border-slate-700"
  >
    <div class="font-outfit text-secondary-500 text-sm font-bold dark:text-slate-100">
      📖 {{ t('mealPlanner.cookbook') }}
    </div>
    <p class="welcome-hint mt-0.5 text-[#F15D22]">{{ t('mealPlanner.railHint') }}</p>

    <input
      v-model="query"
      type="search"
      :placeholder="t('mealPlanner.search')"
      class="font-inter text-secondary-500 mt-3 w-full rounded-xl border border-[rgba(44,62,80,0.14)] bg-white px-3 py-2 text-sm outline-none focus:border-[#AED6F1] focus:ring-2 focus:ring-[#AED6F1] dark:bg-slate-900 dark:text-slate-100"
    />

    <div class="mt-3 grid max-h-80 gap-2 overflow-y-auto">
      <div
        v-for="recipe in results"
        :key="recipe.id"
        draggable="true"
        class="flex cursor-grab items-center gap-2.5 rounded-[14px] border border-[rgba(44,62,80,0.08)] bg-white p-2 shadow-[var(--card-shadow)] transition-transform hover:-translate-y-px dark:bg-slate-800"
        @dragstart="startDrag({ source: 'recipe', recipeId: recipe.id })"
        @dragend="endDrag"
      >
        <MealThumb :photo-ids="recipe.photoIds" fallback-emoji="🍽️" :size-rem="2.125" />
        <div class="min-w-0">
          <div class="font-outfit text-secondary-500 text-sm font-semibold dark:text-slate-100">
            {{ recipe.name }}
          </div>
          <div class="truncate text-xs text-[rgba(44,62,80,0.45)] dark:text-slate-400">
            {{ recipe.subtitle }}
          </div>
        </div>
      </div>
    </div>

    <div
      class="font-outfit mt-4 text-[0.62rem] font-semibold tracking-[0.09em] text-[rgba(44,62,80,0.4)] uppercase"
    >
      {{ t('mealPlanner.picker.alternatives') }}
    </div>
    <div class="mt-2 flex flex-wrap gap-1.5">
      <span
        v-for="alt in ALT_TYPES"
        :key="alt.kind"
        draggable="true"
        class="font-outfit inline-flex cursor-grab items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold"
        :class="alt.cls"
        @dragstart="startDrag({ source: 'type', kind: alt.kind })"
        @dragend="endDrag"
      >
        {{ alt.emoji }} {{ t(`mealPlanner.kind.${alt.kind}`) }}
      </span>
    </div>
  </aside>
</template>

<style scoped>
.welcome-hint {
  font-family: Caveat, cursive;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.2;
}
</style>
