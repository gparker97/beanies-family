<script setup lang="ts">
/**
 * A shopping list from a recipe (#88) — review, then create.
 *
 * ⚠️ Lives in `components/pod/`, NOT `components/lists/`. No file in
 * `components/lists/` imports a domain component outside `lists/` and `ui/`; the
 * dependency direction is strictly one-way today, and a component taking a
 * `Recipe` prop would be the first edge back the other way.
 *
 * Nothing is created until the user saves, matching how document capture works
 * everywhere else in the app. What is ticked in the checklist is what gets written.
 *
 * Since #116 the create step is the shared `IngredientChecklist` (at the recipe's own
 * amounts, ×1, or ×N for one planned meal, see below) plus the shared `ShoppingListDestination` (New List, or Add to a List the
 * family already has), and saving is `useShoppingListCommit`, the same path the meal
 * planner uses, so the guards, toasts and telemetry live in one place. The checklist's
 * line ids are transient by design: nothing is persisted until save, and they are thrown
 * away on cancel.
 *
 * The edit-meal drawer opens this same sheet (#116) by passing `eating` (its live count of
 * people at the meal): the lines are then batched for that meal (`batchesFor`), the title
 * shows "Ingredients" + Cook ×N + the why line, and the kind logged/committed is 'meal'.
 * Without `eating` the sheet is the cookbook's, byte for byte (×1, kind 'recipe'). `layer`
 * is forwarded to the modal so the drawer can stack it as an overlay. The lines are still
 * a snapshot at open; the sheet is modal over the drawer, so the eaters cannot change
 * while it is up.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import ListChoiceRow from '@/components/lists/ListChoiceRow.vue';
import IngredientChecklist from '@/components/pod/IngredientChecklist.vue';
import ShoppingListDestination from '@/components/pod/ShoppingListDestination.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useRecipeShoppingLists } from '@/composables/useRecipeShoppingLists';
import { useOpenList } from '@/composables/useOpenList';
import {
  logShoppingSheetOpened,
  newListDestination,
  shoppingSaveLabel,
  useShoppingListCommit,
  type ShoppingDestination,
} from '@/composables/useShoppingListCommit';
import CookCountPill from '@/components/mealplan/CookCountPill.vue';
import {
  batchesFor,
  buildShoppingLines,
  linesToTitles,
  type ChecklistLine,
} from '@/utils/mealShoppingList';
import { servingsOf } from '@/utils/recipeServings';
import { fillTemplate } from '@/utils/fillTemplate';
import type { Recipe } from '@/types/models';

const props = withDefaults(
  defineProps<{
    open: boolean;
    recipe: Recipe;
    /** People eating at one planned meal; omitted for the cookbook's plain ×1 list. */
    eating?: number;
    /** Modal stacking layer, for when this opens over another drawer. */
    layer?: 'base' | 'overlay' | 'top' | 'gate';
  }>(),
  { eating: undefined, layer: 'base' }
);
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const { commit, isSubmitting } = useShoppingListCommit();

/**
 * The checklist, SNAPSHOT at open and never recomputed while the sheet is up: the
 * recipe can change under us (an edit on another device), and from the moment the
 * lines are shown they are the user's to edit.
 */
const lines = ref<ChecklistLine[]>([]);
const headingsSkipped = ref(0);

const servings = computed(() => servingsOf(props.recipe));
/** Batches to cook for this meal (1 for the cookbook). Live, but the lines are not. */
const batches = computed(() =>
  props.eating === undefined ? 1 : batchesFor(props.eating, servings.value)
);
const kind = computed(() => (props.eating === undefined ? 'recipe' : 'meal'));
/** "For 5, serves 4", or "No servings set, so one batch per meal." */
const whyLine = computed(() => {
  if (servings.value === undefined) return t('mealPlanner.shopping.noServingsPerMeal');
  return fillTemplate(t('mealPlanner.shopping.forEating'), {
    n: String(props.eating ?? 1),
    s: String(servings.value),
  });
});

/** Who shops and by when (or which list). Reset on every open. */
const destination = ref<ShoppingDestination>(newListDestination(''));

/**
 * `review` when this recipe already has a list, `create` otherwise.
 *
 * The ingredients are shown either way — that is the point. A family arriving
 * here wants to know what is already on the list before deciding between opening
 * it and starting another, and answering that by navigating them out of the
 * cookbook made the choice for them. In `review` the lines are read-only, because
 * editing text that is not going to be saved anywhere is a lie.
 */
const mode = ref<'review' | 'create'>('create');

// Offered, never enforced — a second shop for the same dish is legitimate.
// ⚠️ Declared ABOVE the `immediate: true` watch below, which reads `existing` on
// mount. `<script setup>` is ordinary top-to-bottom execution, so a later `const`
// is in its temporal dead zone and the watch throws.
const { lists: existing, activeList } = useRecipeShoppingLists(computed(() => props.recipe.id));
const { openList } = useOpenList();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const built = buildShoppingLines(props.recipe, batches.value);
    lines.value = built.lines;
    headingsSkipped.value = built.headingsSkipped;
    // Reset on every open, not just the first: the sheet instance is reused across
    // recipes, and inheriting the last recipe's due date would silently schedule a
    // reminder for a shop the user never dated.
    destination.value = newListDestination(familyStore.currentMember?.id ?? '');
    // Any existing list counts, finished or not: a done shop is still the answer
    // to "have I already made one of these?", and the row shows its progress so
    // the user can tell at a glance.
    mode.value = existing.value.length > 0 ? 'review' : 'create';
    logShoppingSheetOpened({
      kind: kind.value,
      sections: 1,
      lines: built.lines.length,
      exactMerges: 0,
    });
  },
  { immediate: true }
);

const titles = computed(() => linesToTitles(lines.value));
const defaultTitle = computed(() =>
  fillTemplate(t('lists.fromRecipe.listTitle'), { recipe: props.recipe.name })
);

/** The list the primary action opens: the newest still being shopped, else the newest. */
const openTarget = computed(() => activeList.value ?? existing.value[0] ?? null);

const saveDisabled = computed(() =>
  mode.value === 'review' ? !openTarget.value : titles.value.length === 0
);
const saveLabel = computed(() =>
  mode.value === 'review'
    ? t('lists.fromRecipe.openExisting')
    : shoppingSaveLabel(destination.value, titles.value.length, t)
);

/** Leave review and let the user edit — the lines become theirs to change. */
function startNewList(): void {
  mode.value = 'create';
}

/** The modal's one primary action, whichever mode we are in. */
function onPrimary(): void {
  if (mode.value === 'review') {
    if (openTarget.value) openExisting(openTarget.value.id);
    return;
  }
  void onSave();
}

function openExisting(id: string): void {
  emit('close');
  openList(id);
}

async function onSave(): Promise<void> {
  if (saveDisabled.value) return;
  const written = await commit({
    destination: destination.value,
    titles: titles.value,
    defaultTitle: defaultTitle.value,
    linkedRecipeId: props.recipe.id,
    kind: kind.value,
    headingsSkipped: headingsSkipped.value,
    sections: 1,
  });
  // A refusal or failure is already toasted + reported. Deliberately does NOT close
  // then: the checklist the user just edited survives for a retry.
  if (written) emit('close');
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('lists.fromRecipe.title')"
    icon="🛒"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :layer="layer"
    :save-label="saveLabel"
    :save-disabled="saveDisabled"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onPrimary"
  >
    <div class="space-y-4">
      <p class="font-inter dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
        {{ mode === 'review' ? t('lists.fromRecipe.reviewBody') : t('lists.fromRecipe.body') }}
      </p>

      <!-- The lists this recipe has already produced. Each row carries its own
           progress, so a shop that is finished is obvious without opening it. -->
      <div v-if="mode === 'review'" class="space-y-1">
        <ListChoiceRow v-for="l in existing" :key="l.id" :list="l" @click="openExisting(l.id)" />
      </div>

      <!-- Read-only in review: these lines are not going anywhere, and an editable
           box that discards what you type is worse than a plain one. -->
      <div v-if="mode === 'review'" class="space-y-1">
        <p
          class="font-inter dark:text-ink-faint text-xs font-semibold text-[var(--color-text-muted)] uppercase"
        >
          {{ t('lists.fromRecipe.ingredientsLabel') }}
          <span class="font-inter normal-case">· {{ t('lists.fromRecipe.readOnly') }}</span>
        </p>
        <!-- ⚠️ Deliberately NOT the checklist's look. A tinted fill, a 1px border and
             no tick boxes are what say "you cannot change this". Muted INK rather than
             an opacity, because this is text the user is meant to READ (CLAUDE.md:
             never put an opacity modifier on readable text). It disappears the moment
             they start another list and the checklist takes its place. -->
        <ul
          class="dark:border-line dark:bg-surface-ground max-h-56 overflow-y-auto rounded-xl border border-[var(--tint-slate-10)] bg-[var(--tint-slate-5)] px-4 py-3"
          aria-readonly="true"
        >
          <li
            v-for="line in lines"
            :key="line.id"
            class="font-inter dark:text-ink-soft py-0.5 text-sm leading-relaxed text-[var(--color-text-muted)]"
          >
            {{ line.text }}
          </li>
        </ul>
      </div>

      <template v-else>
        <IngredientChecklist v-model="lines" :headings-skipped="headingsSkipped">
          <template v-if="eating !== undefined" #title>
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
        <ShoppingListDestination v-model="destination" :default-title="defaultTitle" />
      </template>

      <!-- The quieter half of the choice. Editing is unlocked in place: no second
           modal, no navigation, and the lines they were just reading stay put. -->
      <button
        v-if="mode === 'review'"
        type="button"
        class="font-inter text-primary-600 dark:text-accent-lift text-sm font-semibold underline underline-offset-2"
        data-testid="recipe-list-start-another"
        @click="startNewList"
      >
        {{ t('lists.fromRecipe.startAnother') }}
      </button>
    </div>
  </BeanieFormModal>
</template>
