<script setup lang="ts">
/**
 * Edit an existing planned meal. Owns ONLY MealPlanEntry fields — it never edits
 * the recipe (RecipeFormModal) or the cook log (CookLogFormModal), so it can't
 * become a god-form. "Mark cooked" (recipe meals only) delegates to the existing
 * CookLogFormModal; the meal flips to cooked ONLY when a new cook-log actually
 * persisted (guards against a lost log with a wrong "cooked" state).
 *
 * Offers the meal's Shopping List (#116) as a row under Who's eating that opens the
 * cookbook's shared `RecipeListSheet` with this meal's live eater count (Cook ×N); the
 * sheet owns its own list write, so this form still saves only MealPlanEntry fields.
 */
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import CookLogFormModal from '@/components/pod/CookLogFormModal.vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import RecipeListSheet from '@/components/pod/RecipeListSheet.vue';
import CookCountPill from '@/components/mealplan/CookCountPill.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useCardDefaultHint } from '@/composables/useCardDefaultHint';
import { confirm } from '@/composables/useConfirm';
import { logEvent } from '@/services/telemetry/logEvent';
import { isFlagEnabled } from '@/config/flags';
import { useFamilyStore } from '@/stores/familyStore';
import { servingsOf } from '@/utils/recipeServings';
import {
  batchesFor,
  eaterIdsToStore,
  eatingCount,
  hasShoppableIngredients,
  seedEaterIds,
} from '@/utils/mealShoppingList';
import type { MealPlanEntry, MealKind, UpdateMealPlanInput } from '@/types/models';

const props = defineProps<{ open: boolean; meal: MealPlanEntry | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();

/** Every human member: who "everyone" means (pets never eat from the recipe). */
const humanIds = computed(() => familyStore.humans.map((m) => m.id));

// Local edit state (reset from `meal` on open).
const kind = ref<MealKind>('recipe');
const label = ref('');
const cookId = ref('');
const eaterIds = ref<string[]>([]);
const guestNames = ref<string[]>([]);
const guestDraft = ref('');
const note = ref('');
const serveTime = ref('');

const recipe = computed(() =>
  props.meal?.recipeId ? recipesStore.recipes.find((r) => r.id === props.meal!.recipeId) : undefined
);
const isRecipe = computed(() => kind.value === 'recipe');

// Ingredients (#116): Cook ×N for the LIVE picker, before Save. Same gate as the recipe
// page's Shopping List (#88): the familyLists flag, and something to shop for.
const showIngredients = computed(
  () =>
    isRecipe.value &&
    !!recipe.value &&
    isFlagEnabled('familyLists') &&
    hasShoppableIngredients(recipe.value)
);
const eating = computed(
  () =>
    eatingCount({ eaterMemberIds: eaterIds.value, guestNames: guestNames.value }, humanIds.value)
      .eating
);

/** Cook ×N for the LIVE picker, shown on the Shopping List row. */
const batches = computed(() =>
  recipe.value ? batchesFor(eating.value, servingsOf(recipe.value)) : 1
);
const shoppingOpen = ref(false);

// Who Owns What (#109): derived, nothing stored. Shows while the chosen cook is the
// single holder of the slot's card ("Sofia holds Cooking Dinner in Who Owns What.").
const { holderFor, holdsHint } = useCardDefaultHint();
const cookHint = computed(() =>
  props.meal ? holdsHint({ kind: 'mealSlot', slot: props.meal.slot }, cookId.value) : ''
);

// Plan-type toggle: only the non-recipe types are switchable here. A recipe meal
// stays a recipe (change it by removing + re-adding) — but it can be turned into a
// type. So the "recipe" option is shown+selected but disabled when it has a recipe.
const typeOptions = computed(() =>
  (['eat_out', 'leftovers', 'skip', 'other'] as const).map((k) => ({
    value: k,
    label: t(`mealPlanner.kind.${k}`),
  }))
);

// Edit-only: this form never creates, so `onNew` has nothing to seed. The snapshot taken after
// `onEdit` is the baseline `save` diffs against, so untouched fields are never written (a
// concurrent edit to the same meal from another device survives).
const { formDiff } = useFormModal<MealPlanEntry, UpdateMealPlanInput>(
  () => props.meal,
  () => props.open,
  {
    onEdit: (m) => {
      kind.value = m.kind;
      label.value = m.label ?? '';
      cookId.value = m.cookMemberId ?? '';
      // No stored eaters has always meant everyone, so the chips SHOW everyone picked.
      eaterIds.value = seedEaterIds(m.eaterMemberIds, humanIds.value);
      guestNames.value = [...(m.guestNames ?? [])];
      guestDraft.value = '';
      note.value = m.note ?? '';
      serveTime.value = m.serveTime ?? '';
    },
    onNew: () => {},
    snapshot: { build: buildPayload, name: 'MealEditModal' },
  }
);

function buildPayload(): UpdateMealPlanInput {
  return {
    kind: kind.value,
    // A non-recipe kind clears the recipe link; a recipe kind keeps it.
    recipeId: kind.value === 'recipe' ? props.meal?.recipeId : undefined,
    label: label.value.trim() || undefined,
    cookMemberId: cookId.value || undefined,
    // Everyone (all picked) or nobody (cleared) both save as "everyone": no stored ids.
    eaterMemberIds: eaterIdsToStore(eaterIds.value, humanIds.value),
    guestNames: guestNames.value.length ? guestNames.value : undefined,
    note: note.value.trim() || undefined,
    serveTime: serveTime.value || undefined,
  };
}

function addGuest(): void {
  const name = guestDraft.value.trim();
  if (name) {
    guestNames.value = [...guestNames.value, name];
    guestDraft.value = '';
  }
}
function removeGuest(i: number): void {
  guestNames.value = guestNames.value.filter((_, idx) => idx !== i);
}

async function save(): Promise<void> {
  if (!props.meal) return;
  const patch = formDiff.changes(buildPayload());
  const holderId = holderFor({ kind: 'mealSlot', slot: props.meal.slot })?.memberId;
  const overridden =
    !!holderId && props.meal.cookMemberId === holderId && cookId.value !== holderId;
  const saved = await mealPlanStore.updateMeal(props.meal.id, patch);
  if (saved && overridden) {
    logEvent({
      level: 'info',
      surface: 'meal-planner',
      message: 'card_default_overridden',
      context: { action: 'card_default_overridden', slot: props.meal.slot },
    });
  }
  emit('close');
}

async function remove(): Promise<void> {
  if (!props.meal) return;
  const ok = await confirm({
    title: 'mealPlanner.editor.deleteConfirmTitle',
    message: 'mealPlanner.editor.deleteConfirmMessage',
    variant: 'danger',
  });
  if (!ok) return;
  await mealPlanStore.deleteMeal(props.meal.id);
  emit('close');
}

// Edit the underlying recipe from the planner — opens the cookbook's existing
// RecipeFormModal as an overlay (drawer-over-drawer); the meal card/name update
// reactively on save. Keeps recipe editing in one place (not duplicated here).
const recipeEditOpen = ref(false);

// ── Cook log (recipe meals) — mark cooked, then view / edit / delete ─────────
const cookLogOpen = ref(false);
let preCookLogIds = new Set<string>();

/** The saved cook-log entry for a cooked meal (edit mode); null → new-log mode. */
const cookLog = computed(() =>
  props.meal?.cookLogId
    ? (recipesStore.cookLogs.find((c) => c.id === props.meal!.cookLogId) ?? null)
    : null
);

function openCookLog(): void {
  if (!props.meal?.recipeId) return;
  preCookLogIds = new Set(
    recipesStore.cookLogsByRecipe(props.meal.recipeId).value.map((c) => c.id)
  );
  cookLogOpen.value = true;
}

async function onCookLogClosed(): Promise<void> {
  cookLogOpen.value = false;
  const m = props.meal;
  if (!m?.recipeId) return;
  const logs = recipesStore.cookLogsByRecipe(m.recipeId).value;
  if (!m.cooked) {
    // Was marking new — flip to cooked only if a log actually got created (guards a
    // cancelled/failed save from marking cooked with no cookLogId).
    const created = logs.find((c) => !preCookLogIds.has(c.id));
    if (created) {
      await mealPlanStore.updateMeal(m.id, { cooked: true, cookLogId: created.id });
      logEvent({
        level: 'info',
        surface: 'meal-planner',
        message: 'meal marked cooked',
        context: { action: 'marked-cooked', slot: m.slot },
      });
      emit('close');
    }
  } else if (m.cookLogId && !logs.some((c) => c.id === m.cookLogId)) {
    // Was viewing/editing and the user DELETED the log — un-mark the meal as cooked.
    await mealPlanStore.updateMeal(m.id, { cooked: false, cookLogId: undefined });
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    variant="drawer"
    :title="t('mealPlanner.editor.editTitle')"
    icon="🍽️"
    :save-label="t('mealPlanner.editor.save')"
    show-delete
    @close="emit('close')"
    @save="save"
    @delete="remove"
  >
    <div class="space-y-5">
      <!-- Recipe (recipe meals) or type toggle -->
      <div v-if="isRecipe">
        <div class="mp-label">{{ t('mealPlanner.editor.recipe') }}</div>
        <div
          class="dark:bg-surface-raised flex items-center gap-2 rounded-xl border border-[rgba(44,62,80,0.12)] bg-white px-3 py-2.5 text-sm"
        >
          <span class="min-w-0 flex-1 truncate">
            {{ recipe?.name ?? t('mealPlanner.card.recipeRemoved') }}
          </span>
          <button
            v-if="recipe"
            type="button"
            class="font-outfit dark:text-accent-lift flex-none text-xs font-semibold text-[#F15D22]"
            @click="recipeEditOpen = true"
          >
            {{ t('mealPlanner.editor.editRecipe') }}
          </button>
        </div>
      </div>
      <div v-else>
        <div class="mp-label">{{ t('mealPlanner.editor.plan') }}</div>
        <TogglePillGroup v-model="kind" :options="typeOptions" />
        <input
          v-model="label"
          type="text"
          :placeholder="t('mealPlanner.editor.labelPlaceholder')"
          class="mp-input mt-2"
        />
      </div>

      <!-- Cook (shown on the card) -->
      <div>
        <div class="mp-label">
          {{ t('mealPlanner.editor.cook') }}
          <span
            class="dark:text-ink-faint ml-1 font-normal tracking-normal text-[rgba(44,62,80,0.4)] normal-case"
          >
            · {{ t('mealPlanner.editor.cookHint') }}
          </span>
        </div>
        <FamilyChipPicker v-model="cookId" mode="single" />
        <InferredHint :text="cookHint" />
      </div>

      <!-- Who's eating + guests -->
      <div>
        <div class="mp-label">{{ t('mealPlanner.editor.eaters') }}</div>
        <FamilyChipPicker v-model="eaterIds" mode="multi" all-toggle />
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            v-for="(g, i) in guestNames"
            :key="`${g}-${i}`"
            class="font-outfit text-secondary-500 dark:text-ink inline-flex items-center gap-1 rounded-full bg-[var(--tint-silk-20)] px-2.5 py-1 text-xs font-semibold"
          >
            {{ g }}
            <button
              type="button"
              class="dark:text-ink-faint text-[rgba(44,62,80,0.5)]"
              :aria-label="t('common.remove')"
              @click="removeGuest(i)"
            >
              ×
            </button>
          </span>
        </div>
        <div class="mt-2 flex gap-2">
          <input
            v-model="guestDraft"
            type="text"
            :placeholder="t('mealPlanner.editor.guestName')"
            class="mp-input"
            @keydown.enter.prevent="addGuest"
          />
          <button
            type="button"
            class="font-outfit text-secondary-500 dark:text-ink flex-none rounded-xl bg-[var(--tint-slate-5)] px-3 text-sm font-semibold"
            @click="addGuest"
          >
            {{ t('mealPlanner.editor.addGuest') }}
          </button>
        </div>
      </div>

      <!-- Shopping List (#116): opens the cookbook's sheet with this meal's Cook ×N. -->
      <button
        v-if="showIngredients && recipe"
        type="button"
        class="font-inter dark:bg-surface-hover dark:text-ink-soft inline-flex w-full items-center gap-2 rounded-xl bg-[var(--tint-slate-5)] px-3 py-2.5 text-left text-sm text-[var(--color-text-muted)]"
        data-testid="meal-shopping-open"
        @click="shoppingOpen = true"
      >
        <span class="dark:text-ink min-w-0 flex-1 font-semibold text-[var(--color-text)]">
          <span aria-hidden="true">🛒</span>
          {{ t('mealPlanner.shopping.button') }}
        </span>
        <CookCountPill :count="batches" />
        <BeanieIcon name="chevron-right" size="sm" />
      </button>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div class="mp-label">{{ t('mealPlanner.editor.note') }}</div>
          <input
            v-model="note"
            type="text"
            :placeholder="t('mealPlanner.editor.notePlaceholder')"
            class="mp-input"
          />
        </div>
        <div>
          <div class="mp-label">{{ t('mealPlanner.editor.serveTime') }}</div>
          <TimePresetPicker v-model="serveTime" />
        </div>
      </div>

      <!-- Cook log: mark cooked when open, view/edit/delete once cooked -->
      <button
        v-if="isRecipe && meal?.recipeId && !meal.cooked"
        type="button"
        class="font-outfit dark:text-accent-lift w-full rounded-xl border border-[rgba(241,93,34,0.35)] bg-[var(--tint-orange-8)] py-2.5 text-sm font-semibold text-[#F15D22]"
        @click="openCookLog"
      >
        ✓ {{ t('mealPlanner.editor.markCooked') }}
      </button>
      <button
        v-else-if="isRecipe && meal?.recipeId && meal.cooked"
        type="button"
        class="font-outfit dark:text-success-lift w-full rounded-xl border border-[rgba(39,174,96,0.35)] bg-[rgba(39,174,96,0.1)] py-2.5 text-sm font-semibold text-[#1e7a45]"
        @click="openCookLog"
      >
        📖 {{ t('mealPlanner.editor.viewCookLog') }}
      </button>
    </div>

    <CookLogFormModal
      v-if="meal?.recipeId"
      :open="cookLogOpen"
      :recipe-id="meal.recipeId"
      :entry="meal.cooked ? cookLog : null"
      :preset-cooked-on="meal.date"
      :preset-cooked-by="meal.cookMemberId"
      @close="onCookLogClosed"
    />

    <RecipeFormModal
      v-if="recipe"
      :open="recipeEditOpen"
      :recipe="recipe"
      layer="overlay"
      @close="recipeEditOpen = false"
    />

    <RecipeListSheet
      v-if="recipe"
      :open="shoppingOpen"
      :recipe="recipe"
      :eating="eating"
      layer="overlay"
      @close="shoppingOpen = false"
    />
  </BeanieFormModal>
</template>

<style scoped>
.mp-label {
  color: var(--color-text-muted);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  margin-bottom: 0.375rem;
  text-transform: uppercase;
}

html.dark .mp-label {
  color: var(--color-ink-faint);
}

.mp-input {
  border: 1.5px solid rgb(44 62 80 / 14%);
  border-radius: 0.75rem;
  color: var(--color-secondary-500);
  font-family: Inter, sans-serif;
  font-size: 0.875rem;
  outline: none;
  padding: 0.5rem 0.75rem;
  width: 100%;
}

.mp-input::placeholder {
  color: var(--color-text-muted);
}

.mp-input:focus {
  border-color: #aed6f1;
  box-shadow: 0 0 0 3px rgb(174 214 241 / 50%);
}

/* Dark partner: the guest-name and note fields kept Deep Slate text and a 14% slate
   border on the dark drawer, so typed text was near-invisible. */
html.dark .mp-input {
  background: var(--color-surface-raised);
  border-color: var(--color-line-strong);
  color: var(--color-ink);
}

html.dark .mp-input::placeholder {
  color: var(--color-ink-faint);
}
</style>
