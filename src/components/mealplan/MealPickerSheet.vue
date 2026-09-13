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

/**
 * Closes only on a REAL add — the same rule `quickAdd` already followed.
 *
 * `createMeal` returns `null` when it refuses a duplicate in the cell, and this discarded
 * that and closed regardless, so a refused add looked like it worked: the toast fired
 * behind a sheet that was already dismissing. Newly reachable now that a filled slot shows
 * a `+` at all, which is exactly the case where picking the dish already there is likely.
 */
async function pickRecipe(recipeId: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  const meal = await mealPlanStore.createMeal({
    date: props.date,
    slot: props.mealSlot,
    kind: 'recipe',
    recipeId,
    cooked: false,
  });
  busy.value = false;
  if (meal) emit('close');
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

/** Same rule as `pickRecipe` — a refused add must not look like a successful one. */
async function pickType(kind: Exclude<MealKind, 'recipe'>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  const meal = await mealPlanStore.createMeal({
    date: props.date,
    slot: props.mealSlot,
    kind,
    cooked: false,
  });
  busy.value = false;
  if (meal) emit('close');
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
    <!-- A flex COLUMN, not `space-y-4`, so the recipe list can take whatever room
         the modal actually has. On mobile and native `fullscreen-mobile` makes the
         modal full height, and a fixed `max-h-64` list left most of that screen
         empty below the quick-add card while the recipes themselves were cut off
         after a few rows.

         `h-full` resolves against BaseModal's `flex-1` body, which has a definite
         height only when the modal is fullscreen — exactly when we want the list
         to shrink into. On desktop the body is content-sized and `h-full` degrades
         to auto, so the list falls back to the `md:` cap below. Measured in a
         browser at 390×760 and 1280×820, with a long cookbook and a short one. -->
    <div class="flex h-full flex-col gap-4">
      <input
        v-model="query"
        type="search"
        :placeholder="t('mealPlanner.search')"
        class="font-inter dark:bg-surface-ground dark:text-ink w-full flex-none rounded-xl border border-[rgba(44,62,80,0.14)] px-3 py-2.5 text-sm outline-none focus:border-[#AED6F1] focus:ring-2 focus:ring-[#AED6F1]"
      />

      <!-- Sizes to its CONTENT and shrinks only when it has to — `min-h-0` is what
           allows that (a flex child's default `min-height: auto` refuses to shrink
           below its content, which is why the list used to need a hard cap).
           Deliberately NOT `flex-1`: growing it would strand the quick-add card at
           the bottom of the screen with a gap above it whenever the cookbook has
           only a few recipes.

           The `md:` cap is the desktop half. There the modal is content-sized
           rather than fullscreen, so nothing bounds the column and the list would
           otherwise run to its full height and push the quick-add below the fold.
           `md` is min-width 768px, the exact complement of BaseModal's
           `isMobile` (`max-width: 767px`), so the cap applies precisely when the
           modal is NOT fullscreen. -->
      <div class="grid min-h-0 content-start gap-1.5 overflow-y-auto md:max-h-[50vh]">
        <button
          v-for="recipe in results"
          :key="recipe.id"
          type="button"
          class="flex items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-[var(--tint-orange-8)]"
          :disabled="busy"
          @click="pickRecipe(recipe.id)"
        >
          <MealThumb :photo-ids="recipe.photoIds" fallback-emoji="🍽️" :size-rem="2" />
          <span class="font-outfit text-secondary-500 dark:text-ink text-sm font-semibold">
            {{ recipe.name }}
          </span>
        </button>
      </div>

      <div
        class="dark:bg-surface-raised flex-none rounded-[14px] border border-[rgba(241,93,34,0.3)] bg-white p-3 shadow-[var(--card-shadow)]"
      >
        <p class="quick-hint dark:text-accent-lift text-[#F15D22]">
          {{ t('mealPlanner.picker.quickAddHint') }}
        </p>
        <div class="mt-2 flex gap-2">
          <input
            v-model="quickName"
            type="text"
            :placeholder="t('mealPlanner.picker.quickAddPlaceholder')"
            class="font-inter dark:bg-surface-ground dark:text-ink w-full rounded-xl border border-[rgba(44,62,80,0.14)] px-3 py-2 text-sm outline-none focus:border-[#AED6F1] focus:ring-2 focus:ring-[#AED6F1]"
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

      <div class="flex-none">
        <div
          class="font-outfit dark:text-ink-faint text-xs font-semibold tracking-[0.09em] text-[rgba(44,62,80,0.4)] uppercase"
        >
          {{ t('mealPlanner.picker.alternatives') }}
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="kind in ALT_TYPES"
            :key="kind"
            type="button"
            class="font-outfit text-secondary-500 dark:text-ink rounded-full bg-[var(--tint-slate-5)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
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
