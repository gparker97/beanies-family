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
 * everywhere else in the app. What is in the textarea is what gets created.
 *
 * ## Why a textarea and not `ListItemRow`s
 *
 * State, not styling. Nothing is persisted yet. `ListItemRow` exists to edit a
 * SAVED `FamilyListItem` by id — it carries per-row draft state, `useInlineEdit`,
 * toggle/reorder/delete handlers and vuedraggable, all of which would have to be
 * re-implemented against a transient array with fabricated ids thrown away on
 * cancel. A textarea owns no per-item state, gives add/remove/reorder for free via
 * ordinary typing, and is the same control the user entered these ingredients with
 * (`RecipeFormModal`). Long lines also wrap in it — though note they still truncate
 * in `ListDetailModal` (`ListItemRow.vue`), which this change does not touch.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useFamilyStore } from '@/stores/familyStore';
import { useListStore } from '@/stores/listStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { buildRecipeListSeed, parseDraftItems, splitRecipeIngredients } from '@/utils/listSeed';
import type { RecipeIngredientSplit } from '@/utils/listSeed';
import { fillTemplate } from '@/utils/fillTemplate';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import type { Recipe } from '@/types/models';

const props = defineProps<{ open: boolean; recipe: Recipe }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const router = useRouter();
const familyStore = useFamilyStore();
const listStore = useListStore();
const recipesStore = useRecipesStore();

const draft = ref('');
const isSubmitting = ref(false);

/**
 * The recipe → draft map, SNAPSHOT at open. Never recomputed while the sheet is up.
 *
 * A `computed` over `props.recipe.ingredients` would look equivalent and is not: the
 * recipe can change under us (an edit on another device), and `draft` is seeded only
 * in the watcher below — so the skipped-count would drift to describe ingredients the
 * textarea no longer reflects, while claiming in the UI to describe what the user is
 * looking at.
 */
const split = ref<RecipeIngredientSplit>({ titles: [], headingsSkipped: 0 });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    split.value = splitRecipeIngredients(props.recipe.ingredients ?? []);
    draft.value = split.value.titles.join('\n');
    isSubmitting.value = false;
    logEvent({
      level: 'info',
      surface: 'list-from-recipe',
      message: 'recipe shopping-list sheet opened',
      context: { action: 'sheet_opened' },
    });
  },
  { immediate: true }
);

/** Past tense, and about the RECIPE — it does not move as the user edits. */
const skippedHint = computed(() => {
  const n = split.value.headingsSkipped;
  if (n === 0) return '';
  return n === 1
    ? t('lists.fromRecipe.headingsSkipped.one')
    : fillTemplate(t('lists.fromRecipe.headingsSkipped.other'), { count: String(n) });
});

/** Lists already built from this recipe. Offered, never enforced — a second shop is legitimate. */
const existing = computed(() =>
  listStore.lists.filter((l) => l.linkedRecipeId === props.recipe.id)
);

const items = computed(() => parseDraftItems(draft.value));
const saveDisabled = computed(() => items.value.length === 0);

function openExisting(id: string): void {
  // NAVIGATE, don't mount. `BeanieListsPage` already opens `?view=<id>` immediately
  // and strips the query on close, so this needs no component of its own — and the
  // route's own `requiresFlag: 'familyLists'` is a second, free flag check.
  emit('close');
  void router.push({ name: 'Lists', query: { view: id } });
}

async function onSave(): Promise<void> {
  // Guard AND the bound `is-submitting`: one write is atomic, which prevents a
  // partial list, not a second list. Without this a double-tap makes two.
  if (isSubmitting.value || saveDisabled.value) return;

  const memberId = familyStore.currentMember?.id;
  if (!memberId) {
    // A list with a dangling ownerId is worse than a failure the user can retry —
    // the same call `copyListForMembers` makes. Refuse, explain, report.
    showToast('error', t('lists.fromRecipe.noMemberError'), t('lists.fromRecipe.noMemberHelp'));
    reportError({
      surface: 'list-from-recipe',
      message:
        'no current member — refusing to create a list with an empty ownerId. Check familyStore.currentMember is resolved before this sheet can open.',
      severity: 'error',
      context: { action: 'no_current_member' },
    });
    return;
  }

  // The recipe can be deleted on another device while this sheet is open; its
  // cascade has already been and gone, so a link written now would dangle forever.
  // Read the STORE mirror the page renders, never the projection (MVO).
  if (!recipesStore.recipes.some((r) => r.id === props.recipe.id)) {
    showToast('error', t('lists.fromRecipe.recipeGoneError'), t('lists.fromRecipe.recipeGoneHelp'));
    return;
  }

  isSubmitting.value = true;
  try {
    const created = await listStore.createList(
      buildRecipeListSeed({
        recipeId: props.recipe.id,
        titles: items.value,
        title: fillTemplate(t('lists.fromRecipe.listTitle'), { recipe: props.recipe.name }),
        memberId,
      })
    );
    // Falsy, not `=== null`: the store folds a throw and a graceful stop into one
    // sentinel and has already toasted + reported either way. A second toast here
    // would page twice. Deliberately does NOT close — the draft survives for a retry.
    if (!created) return;
    logEvent({
      level: 'info',
      surface: 'list-from-recipe',
      message: 'shopping list created from recipe',
      context: {
        action: 'list_created',
        ingredient_count: items.value.length,
        count: split.value.headingsSkipped,
      },
    });
    showToast('success', t('lists.fromRecipe.created'));
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('lists.fromRecipe.title')"
    icon="🛒"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="t('lists.fromRecipe.save')"
    :save-disabled="saveDisabled"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onSave"
  >
    <div class="space-y-4">
      <p class="font-inter dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
        {{ t('lists.fromRecipe.body') }}
      </p>

      <!-- Only when a list already exists. Offered, not enforced: cooking the same
           dish again next month is a real case, so blocking would be wrong — but
           accumulating silent duplicates would be wrong too. -->
      <div v-if="existing.length" class="space-y-1">
        <p class="font-inter dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
          {{ t('lists.fromRecipe.existing') }}
        </p>
        <button
          v-for="l in existing"
          :key="l.id"
          type="button"
          class="font-inter text-primary-600 dark:text-accent-lift block text-left text-sm underline underline-offset-2"
          @click="openExisting(l.id)"
        >
          {{ l.emoji }} {{ l.title }}
        </button>
      </div>

      <textarea
        v-model="draft"
        rows="10"
        :aria-label="t('lists.fromRecipe.itemsLabel')"
        class="focus:border-primary-500 focus:ring-primary-500 font-inter dark:border-line-strong dark:bg-surface-overlay dark:text-ink w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-relaxed text-[var(--color-text)] outline-none focus:ring-1"
      ></textarea>

      <!-- Renders nothing when there is nothing to say, so no `v-if` here. -->
      <InferredHint :text="skippedHint" />
    </div>
  </BeanieFormModal>
</template>
