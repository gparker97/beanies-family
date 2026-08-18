<script setup lang="ts">
/**
 * The tap / keyboard-accessible path for choosing what goes in a slot (mobile
 * primary; also the a11y equivalent of the desktop drag). Search the cookbook and
 * tap a recipe, quick-add a NAME-ONLY recipe when it isn't in the cookbook yet, or
 * tap a non-recipe type. Any choice creates the meal and closes.
 */
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import BaseModal from '@/components/ui/BaseModal.vue';
import MealThumb from './MealThumb.vue';
import { useRecipesStore } from '@/stores/recipesStore';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipeSearch } from '@/composables/useRecipeSearch';
import { useTranslation } from '@/composables/useTranslation';
import type { MealKind, MealSlot } from '@/types/models';

const props = defineProps<{ open: boolean; date: string; mealSlot: MealSlot }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const recipesStore = useRecipesStore();
const mealPlanStore = useMealPlanStore();
const { recipes } = storeToRefs(recipesStore);

const query = ref('');
const quickName = ref('');
const { results } = useRecipeSearch(recipes, query);
const busy = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      query.value = '';
      quickName.value = '';
    }
  }
);

const ALT_TYPES: Exclude<MealKind, 'recipe'>[] = ['eat_out', 'leftovers', 'skip', 'other'];
const canQuickAdd = computed(() => quickName.value.trim().length > 0);

async function pickRecipe(recipeId: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  await mealPlanStore.createMeal({
    date: props.date,
    slot: props.mealSlot,
    kind: 'recipe',
    recipeId,
    cooked: false,
  });
  busy.value = false;
  emit('close');
}

async function quickAdd(): Promise<void> {
  const name = quickName.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  const recipe = await recipesStore.createRecipe({ name, ingredients: [], steps: [] });
  if (recipe) {
    const meal = await mealPlanStore.createMeal(
      {
        date: props.date,
        slot: props.mealSlot,
        kind: 'recipe',
        recipeId: recipe.id,
        cooked: false,
      },
      { quickAdd: true }
    );
    // Only close on a real success — otherwise the sheet stays open so the user
    // can retry rather than leaving the just-created recipe orphaned with no meal.
    if (meal) emit('close');
  }
  busy.value = false;
}

async function pickType(kind: Exclude<MealKind, 'recipe'>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  await mealPlanStore.createMeal({ date: props.date, slot: props.mealSlot, kind, cooked: false });
  busy.value = false;
  emit('close');
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="t('mealPlanner.picker.title')"
    size="md"
    fullscreen-mobile
    @close="emit('close')"
  >
    <div class="space-y-4">
      <input
        v-model="query"
        type="search"
        :placeholder="t('mealPlanner.search')"
        class="font-inter w-full rounded-xl border border-[rgba(44,62,80,0.14)] px-3 py-2.5 text-sm outline-none focus:border-[#AED6F1] focus:ring-2 focus:ring-[#AED6F1] dark:bg-slate-900 dark:text-slate-100"
      />

      <div class="grid max-h-64 gap-1.5 overflow-y-auto">
        <button
          v-for="recipe in results"
          :key="recipe.id"
          type="button"
          class="flex items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-[var(--tint-orange-8)]"
          :disabled="busy"
          @click="pickRecipe(recipe.id)"
        >
          <MealThumb :photo-ids="recipe.photoIds" fallback-emoji="🍽️" :size-rem="2" />
          <span class="font-outfit text-secondary-500 text-sm font-semibold dark:text-slate-100">
            {{ recipe.name }}
          </span>
        </button>
      </div>

      <div
        class="rounded-[14px] border border-[rgba(241,93,34,0.3)] bg-white p-3 shadow-[var(--card-shadow)] dark:bg-slate-800"
      >
        <p class="quick-hint text-[#F15D22]">{{ t('mealPlanner.picker.quickAddHint') }}</p>
        <div class="mt-2 flex gap-2">
          <input
            v-model="quickName"
            type="text"
            :placeholder="t('mealPlanner.picker.quickAddPlaceholder')"
            class="font-inter w-full rounded-xl border border-[rgba(44,62,80,0.14)] px-3 py-2 text-sm outline-none focus:border-[#AED6F1] focus:ring-2 focus:ring-[#AED6F1] dark:bg-slate-900 dark:text-slate-100"
            @keydown.enter.prevent="quickAdd"
          />
          <button
            type="button"
            class="from-primary-500 to-terracotta-400 font-outfit flex-none rounded-xl bg-gradient-to-r px-4 text-sm font-bold text-white disabled:opacity-50"
            :disabled="!canQuickAdd || busy"
            :aria-label="t('mealPlanner.addMeal')"
            @click="quickAdd"
          >
            ＋
          </button>
        </div>
      </div>

      <div>
        <div
          class="font-outfit text-[0.62rem] font-semibold tracking-[0.09em] text-[rgba(44,62,80,0.4)] uppercase"
        >
          {{ t('mealPlanner.picker.alternatives') }}
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="kind in ALT_TYPES"
            :key="kind"
            type="button"
            class="font-outfit text-secondary-500 rounded-full bg-[var(--tint-slate-5)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:text-slate-100"
            :disabled="busy"
            @click="pickType(kind)"
          >
            {{ t(`mealPlanner.kind.${kind}`) }}
          </button>
        </div>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.quick-hint {
  font-family: Caveat, cursive;
  font-size: 1.02rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
}
</style>
