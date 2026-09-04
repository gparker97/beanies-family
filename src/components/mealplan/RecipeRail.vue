<script setup lang="ts">
/**
 * Desktop/tablet cookbook rail — the drag SOURCE for the meal board. Search the
 * cookbook, drag a recipe onto a day+slot, or drag one of the non-recipe "type"
 * chips (Eat out / Leftovers / Skip / Other). Drag-and-drop is a pointer-only
 * enhancement; the same actions are available by tapping a slot (MealPickerSheet).
 */
import { ref } from 'vue';
import { MEAL_TYPE_STYLE } from '@/constants/mealTypes';
import { storeToRefs } from 'pinia';
import MealThumb from './MealThumb.vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import { useRecipesStore } from '@/stores/recipesStore';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipeSearch } from '@/composables/useRecipeSearch';
import { useMealDrag } from '@/composables/useMealDrag';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { logEvent } from '@/services/telemetry/logEvent';
import type { MealKind } from '@/types/models';

const { t } = useTranslation();
const recipesStore = useRecipesStore();
const mealPlanStore = useMealPlanStore();
const { recipes } = storeToRefs(recipesStore);
const { dragged, startDrag, endDrag } = useMealDrag();

const query = ref('');
const { results } = useRecipeSearch(recipes, query);

// Add a full cookbook recipe (photo/ingredients/steps) without leaving the
// planner — reuses the existing RecipeFormModal in create mode. The new recipe
// appears in the rail reactively (recipesStore), ready to drag. This is the
// richer sibling of MealPickerSheet's name-only slot quick-add.
const addOpen = ref(false);

// Drag a planned meal back onto the rail to remove it from its day. The rail is
// a drop target ONLY while a meal (not a recipe/type) is being dragged, so a
// recipe drag never accidentally "removes" anything. Mirror the board's drop:
// read the singleton payload, act, endDrag. deleteMeal wraps its own error
// toast (wrapAsync); we add a success toast + telemetry so removals are visible.
const removeOver = ref(false);
const isRemovable = () => dragged.value?.source === 'meal';

function onRemoveDragOver(e: DragEvent): void {
  if (!isRemovable()) return;
  e.preventDefault();
  removeOver.value = true;
}

async function onRemoveDrop(): Promise<void> {
  removeOver.value = false;
  const payload = dragged.value;
  endDrag();
  if (payload?.source !== 'meal') return;
  const ok = await mealPlanStore.deleteMeal(payload.mealId);
  if (ok) {
    showToast('success', t('mealPlanner.removed'));
    logEvent({
      level: 'info',
      surface: 'meal-planner',
      message: 'meal removed via rail drag',
      context: { action: 'removed-drag' },
    });
  }
}

const ALT_TYPES: { kind: Exclude<MealKind, 'recipe'>; emoji: string; tile: string }[] = [
  // Icons and tints come from `MEAL_TYPE_STYLE` — they used to live only here, which is
  // why a type dragged onto the board arrived with no icon at all.
  { kind: 'eat_out', emoji: MEAL_TYPE_STYLE.eat_out.emoji, tile: MEAL_TYPE_STYLE.eat_out.tint },
  {
    kind: 'leftovers',
    emoji: MEAL_TYPE_STYLE.leftovers.emoji,
    tile: MEAL_TYPE_STYLE.leftovers.tint,
  },
  { kind: 'skip', emoji: MEAL_TYPE_STYLE.skip.emoji, tile: MEAL_TYPE_STYLE.skip.tint },
  { kind: 'other', emoji: MEAL_TYPE_STYLE.other.emoji, tile: MEAL_TYPE_STYLE.other.tint },
];
</script>

<template>
  <aside
    class="dark:border-line relative flex h-full flex-col border-b border-[rgba(44,62,80,0.06)] p-4 transition-colors md:border-r md:border-b-0"
    @dragover="onRemoveDragOver"
    @dragenter="onRemoveDragOver"
    @dragleave="removeOver = false"
    @drop="onRemoveDrop"
  >
    <div class="font-outfit text-secondary-500 dark:text-ink text-sm font-bold">
      📖 {{ t('mealPlanner.cookbook') }}
    </div>
    <p class="welcome-hint mt-0.5 text-[#F15D22]">{{ t('mealPlanner.railHint') }}</p>

    <input
      v-model="query"
      type="search"
      :placeholder="t('mealPlanner.search')"
      class="font-inter text-secondary-500 dark:bg-surface-ground dark:text-ink mt-3 w-full rounded-xl border border-[rgba(44,62,80,0.14)] bg-white px-3 py-2 text-sm outline-none focus:border-[#AED6F1] focus:ring-2 focus:ring-[#AED6F1]"
    />

    <button
      type="button"
      class="font-outfit mt-2.5 w-full rounded-[14px] border-[1.5px] border-dashed border-[rgba(241,93,34,0.5)] bg-[var(--tint-orange-8)] py-2.5 text-sm font-bold text-[#F15D22]"
      @click="addOpen = true"
    >
      ＋ {{ t('mealPlanner.newRecipe') }}
    </button>

    <!-- content-start: a grid's default align-content is stretch, which would
         balloon a lone search result to fill the tall list. Pack rows at the top
         so every card keeps its natural height whether 1 or 20 match. -->
    <div class="mt-3 grid min-h-0 flex-1 content-start gap-2 overflow-y-auto">
      <div
        v-for="recipe in results"
        :key="recipe.id"
        draggable="true"
        class="dark:bg-surface-raised flex cursor-grab items-center gap-2.5 rounded-[14px] border border-[rgba(44,62,80,0.08)] bg-white p-2 shadow-[var(--card-shadow)] transition-transform hover:-translate-y-px"
        @dragstart="startDrag({ source: 'recipe', recipeId: recipe.id }, $event)"
        @dragend="endDrag"
      >
        <MealThumb :photo-ids="recipe.photoIds" fallback-emoji="🍽️" :size-rem="2.125" />
        <div class="min-w-0">
          <div class="font-outfit text-secondary-500 dark:text-ink text-sm font-semibold">
            {{ recipe.name }}
          </div>
          <div class="dark:text-ink-soft truncate text-xs text-[rgba(44,62,80,0.45)]">
            {{ recipe.subtitle }}
          </div>
        </div>
      </div>
    </div>

    <!-- Alternatives are flex-none so they always reserve their full height —
         the scrollable recipe list above (flex-1) is what yields when the rail
         runs short, never these. Full-width rows (one per line) match the recipe
         cards, so they read as the same draggable object and never truncate. -->
    <div class="flex-none">
      <div
        class="font-outfit dark:text-ink-faint mt-4 text-xs font-semibold tracking-[0.09em] text-[rgba(44,62,80,0.4)] uppercase"
      >
        {{ t('mealPlanner.picker.alternatives') }}
      </div>
      <div class="mt-2 grid gap-2">
        <div
          v-for="alt in ALT_TYPES"
          :key="alt.kind"
          draggable="true"
          class="dark:bg-surface-raised flex cursor-grab items-center gap-2.5 rounded-[14px] border border-[rgba(44,62,80,0.08)] bg-white p-2 shadow-[var(--card-shadow)] transition-transform hover:-translate-y-px"
          @dragstart="startDrag({ source: 'type', kind: alt.kind }, $event)"
          @dragend="endDrag"
        >
          <span class="mp-grip" aria-hidden="true"></span>
          <span
            class="flex h-7 w-7 flex-none items-center justify-center rounded-[9px] text-base"
            :class="alt.tile"
            aria-hidden="true"
            >{{ alt.emoji }}</span
          >
          <span class="font-outfit text-secondary-500 dark:text-ink text-sm font-semibold">
            {{ t(`mealPlanner.kind.${alt.kind}`) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Remove drop-zone: the rail becomes a "drop here to remove" target the
         moment a planned meal is picked up (never for a recipe/type drag). The
         overlay is pointer-events-none so drag events fall through to the aside's
         handlers; it just signals where to drop to delete. -->
    <div
      v-if="dragged?.source === 'meal'"
      class="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-1.5 rounded-[var(--sq)] border-2 border-dashed transition-colors"
      :class="
        removeOver
          ? 'border-[#F15D22] bg-[rgba(241,93,34,0.14)]'
          : 'border-[rgba(241,93,34,0.4)] bg-[rgba(248,249,250,0.88)] dark:bg-[rgba(30,41,59,0.88)]'
      "
    >
      <span class="text-2xl" aria-hidden="true">🗑️</span>
      <span class="font-outfit text-sm font-bold text-[#F15D22]">
        {{ t('mealPlanner.removeHint') }}
      </span>
    </div>

    <RecipeFormModal :open="addOpen" @close="addOpen = false" />
  </aside>
</template>

<style scoped>
.welcome-hint {
  font-family: Caveat, cursive;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.2;
}

/* Drag-handle grip — a 2×3 dot pad that reads as "grab me" on the alternative
   cards, so they feel draggable rather than pill-like. Pure CSS, no glyph. */
.mp-grip {
  background-image: radial-gradient(circle, rgb(44 62 80 / 30%) 1.1px, transparent 1.2px);
  background-size: 0.28rem 0.3rem;
  flex: none;
  height: 0.85rem;
  width: 0.5rem;
}
</style>
