<script setup lang="ts">
/**
 * This meal's ingredients, as written (#116): the checklist inside the edit-meal drawer,
 * with this meal's Cook ×N and an Add that writes straight to a shopping list.
 *
 * The count follows the drawer's LIVE picker: `eating` is the drawer's unsaved eaters +
 * guests (`eatingCount`, nobody picked = everyone), so the batches (`batchesFor(eating,
 * servings)`) change as the picker does, before any Save. A change re-suffixes the lines
 * with `rebatchLines` (` (×2)`), which keeps every hand edit, added line and tick.
 *
 * ⚠️ Owns its OWN list write and never touches the meal: Add goes through
 * `useShoppingListCommit` immediately and does not depend on the drawer's Save or Cancel
 * (it uses the eaters shown, even if the meal edit is then cancelled). That is what keeps
 * `MealEditModal` owning only `MealPlanEntry` fields.
 *
 * Add to defaults to the newest one-off, unfiled shopping list (typically this week's),
 * else a New List. After an Add the destination switches to the list just written and the
 * button reads "Added" until the lines or the destination change, so a second tap never
 * makes a second list.
 *
 * The host keys this on `recipe.id` ONLY, so an unrelated recipe update (a rename, a sync
 * from another device) keeps every untick, edit, the destination and "Added". The lines
 * are rebuilt here only when the recipe's INGREDIENTS change; a servings change flows
 * through `batches` → `rebatchLines` like a picker change.
 *
 * Passive: opening the drawer is not a "sheet opened" (that metric belongs to the sheets
 * a user opens on purpose). Add still logs `items_added` / `list_created` with kind 'meal'.
 */
import { computed, ref, useId, watch } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import IngredientChecklist from '@/components/pod/IngredientChecklist.vue';
import ShoppingListDestination from '@/components/pod/ShoppingListDestination.vue';
import CookCountPill from '@/components/mealplan/CookCountPill.vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  newListDestination,
  useShoppingListCommit,
  type ShoppingDestination,
} from '@/composables/useShoppingListCommit';
import { useFamilyStore } from '@/stores/familyStore';
import { useListStore } from '@/stores/listStore';
import {
  batchesFor,
  buildShoppingLines,
  linesToTitles,
  rebatchLines,
} from '@/utils/mealShoppingList';
import { servingsOf } from '@/utils/recipeServings';
import { fillTemplate } from '@/utils/fillTemplate';
import type { Recipe } from '@/types/models';

const props = defineProps<{
  recipe: Recipe;
  /** People eating at this meal, from the drawer's live picker (`eatingCount`). */
  eating: number;
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const listStore = useListStore();
const { commit, isSubmitting } = useShoppingListCommit();

const servings = computed(() => servingsOf(props.recipe));
const batches = computed(() => batchesFor(props.eating, servings.value));

const built = buildShoppingLines(props.recipe, batches.value);
const lines = ref(built.lines);
const headingsSkipped = ref(built.headingsSkipped);

watch(batches, (n) => {
  lines.value = rebatchLines(lines.value, n);
});

// Rebuild only when the ingredient lines themselves change (the recipe was edited), never
// on any other recipe update. The joined text is a primitive, so an identical re-save or a
// synced copy with the same ingredients does not fire.
watch(
  () => (props.recipe.ingredients ?? []).join('\n'),
  () => {
    const rebuilt = buildShoppingLines(props.recipe, batches.value);
    lines.value = rebuilt.lines;
    headingsSkipped.value = rebuilt.headingsSkipped;
  }
);

/** Newest one-off unfiled shopping list, else a New List. */
function defaultDestination(): ShoppingDestination {
  const out = listStore.shoppingDestinations.find((l) => l.category === 'out');
  return out
    ? { mode: 'existing', listId: out.id }
    : newListDestination(familyStore.currentMember?.id ?? '');
}
const destination = ref<ShoppingDestination>(defaultDestination());
const destOpen = ref(false);
const destId = `meal-ingredients-dest-${useId()}`;

const defaultTitle = computed(() =>
  fillTemplate(t('lists.fromRecipe.listTitle'), { recipe: props.recipe.name })
);
const titles = computed(() => linesToTitles(lines.value));

/** "Add to 🛒 Weekly Groceries", or "Add to a New List". */
const summary = computed(() => {
  const d = destination.value;
  if (d.mode === 'new') return t('lists.destination.addToNew');
  const list = listStore.lists.find((l) => l.id === d.listId);
  return list
    ? fillTemplate(t('lists.destination.addTo'), { list: `${list.emoji} ${list.title}` })
    : t('lists.destination.addToList');
});

/** "For 5, serves 4", or "No servings set, so one batch per meal." */
const whyLine = computed(() => {
  if (servings.value === undefined) return t('mealPlanner.shopping.noServingsPerMeal');
  return fillTemplate(t('mealPlanner.shopping.forEating'), {
    n: String(props.eating),
    s: String(servings.value),
  });
});

/** The state last written. "Added" holds only while nothing has changed since. */
const addedAt = ref<string | null>(null);
const stateKey = (linesJson: string, d: ShoppingDestination): string =>
  `${linesJson}\n${JSON.stringify(d)}`;
const snapshot = computed(() => stateKey(JSON.stringify(lines.value), destination.value));
const added = computed(() => addedAt.value !== null && addedAt.value === snapshot.value);

const addLabel = computed(() =>
  added.value
    ? t('lists.destination.added')
    : fillTemplate(t('lists.destination.addShort'), { n: String(titles.value.length) })
);

async function onAdd(): Promise<void> {
  if (added.value || titles.value.length === 0) return;
  // What is actually sent, captured BEFORE the await: a change made while the write is in
  // flight (an eater picked, a line ticked) was not written, so it must not read Added.
  const sentLines = JSON.stringify(lines.value);
  const sentDestination = JSON.stringify(destination.value);
  const written = await commit({
    destination: destination.value,
    titles: titles.value,
    defaultTitle: defaultTitle.value,
    linkedRecipeId: props.recipe.id,
    kind: 'meal',
    headingsSkipped: headingsSkipped.value,
    sections: 1,
  });
  if (!written) return; // already toasted + reported
  const writtenTo: ShoppingDestination = { mode: 'existing', listId: written.id };
  // Point at the list just written, so a second Add appends to it instead of making
  // another New List, unless another destination was picked while the write was in flight.
  if (JSON.stringify(destination.value) === sentDestination) {
    destination.value = writtenTo;
    destOpen.value = false;
  }
  addedAt.value = stateKey(sentLines, writtenTo);
}
</script>

<template>
  <section data-testid="meal-ingredients-panel">
    <IngredientChecklist v-model="lines" :headings-skipped="headingsSkipped">
      <template #title>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            class="font-outfit dark:text-ink-faint text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase"
          >
            {{ t('mealPlanner.shopping.ingredients') }}
          </span>
          <CookCountPill :count="batches" />
        </div>
        <p class="font-inter dark:text-ink-soft mt-0.5 text-xs text-[var(--color-text-muted)]">
          {{ whyLine }}
        </p>
      </template>
    </IngredientChecklist>

    <div class="mt-2.5 flex items-center gap-2">
      <button
        type="button"
        class="font-inter dark:bg-surface-hover dark:text-ink-soft inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-xl bg-[var(--tint-slate-5)] px-3 py-2 text-left text-sm text-[var(--color-text-muted)]"
        :aria-expanded="destOpen"
        :aria-controls="destOpen ? destId : undefined"
        data-testid="meal-ingredients-dest-toggle"
        @click="destOpen = !destOpen"
      >
        <span
          class="dark:text-ink min-w-0 flex-1 font-semibold wrap-anywhere text-[var(--color-text)]"
        >
          {{ summary }}
        </span>
        <BeanieIcon :name="destOpen ? 'chevron-up' : 'chevron-down'" size="sm" />
      </button>
      <button
        type="button"
        class="font-outfit flex-shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold whitespace-nowrap transition-colors"
        :class="
          added
            ? 'dark:text-success-lift bg-[var(--tint-success-10)] text-[#1e8449]'
            : 'dark:disabled:bg-surface-hover dark:disabled:text-ink-faint bg-[#1e8449] text-white disabled:bg-[var(--tint-slate-10)] disabled:text-[var(--color-text-muted)] dark:bg-[#1e8449]'
        "
        :disabled="added || isSubmitting || titles.length === 0"
        data-testid="meal-ingredients-add"
        @click="onAdd"
      >
        {{ addLabel }}
      </button>
    </div>

    <div v-if="destOpen" :id="destId" class="mt-2.5">
      <ShoppingListDestination v-model="destination" :default-title="defaultTitle" />
    </div>
  </section>
</template>
