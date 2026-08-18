<script setup lang="ts">
/**
 * Edit an existing planned meal. Owns ONLY MealPlanEntry fields — it never edits
 * the recipe (RecipeFormModal) or the cook log (CookLogFormModal), so it can't
 * become a god-form. "Mark cooked" (recipe meals only) delegates to the existing
 * CookLogFormModal; the meal flips to cooked ONLY when a new cook-log actually
 * persisted (guards against a lost log with a wrong "cooked" state).
 */
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import CookLogFormModal from '@/components/pod/CookLogFormModal.vue';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { logEvent } from '@/services/telemetry/logEvent';
import type { MealPlanEntry, MealKind, UpdateMealPlanInput } from '@/types/models';

const props = defineProps<{ open: boolean; meal: MealPlanEntry | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();
const recipesStore = useRecipesStore();

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

// Plan-type toggle: only the non-recipe types are switchable here. A recipe meal
// stays a recipe (change it by removing + re-adding) — but it can be turned into a
// type. So the "recipe" option is shown+selected but disabled when it has a recipe.
const typeOptions = computed(() =>
  (['eat_out', 'leftovers', 'skip', 'other'] as const).map((k) => ({
    value: k,
    label: t(`mealPlanner.kind.${k}`),
  }))
);

watch(
  () => props.open,
  (open) => {
    if (!open || !props.meal) return;
    const m = props.meal;
    kind.value = m.kind;
    label.value = m.label ?? '';
    cookId.value = m.cookMemberId ?? '';
    eaterIds.value = [...(m.eaterMemberIds ?? [])];
    guestNames.value = [...(m.guestNames ?? [])];
    guestDraft.value = '';
    note.value = m.note ?? '';
    serveTime.value = m.serveTime ?? '';
  },
  { immediate: true }
);

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
  const patch: UpdateMealPlanInput = {
    kind: kind.value,
    // A non-recipe kind clears the recipe link; a recipe kind keeps it.
    recipeId: kind.value === 'recipe' ? props.meal.recipeId : undefined,
    label: label.value.trim() || undefined,
    cookMemberId: cookId.value || undefined,
    eaterMemberIds: eaterIds.value.length ? eaterIds.value : undefined,
    guestNames: guestNames.value.length ? guestNames.value : undefined,
    note: note.value.trim() || undefined,
    serveTime: serveTime.value || undefined,
  };
  await mealPlanStore.updateMeal(props.meal.id, patch);
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

// ── Mark cooked (recipe meals) ──────────────────────────────────────────────
const cookLogOpen = ref(false);
let preCookLogIds = new Set<string>();

function openMarkCooked(): void {
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
  // Detect a newly-created cook log; only THEN flip the meal to cooked (guards a
  // failed/cancelled save from marking it cooked with no cookLogId).
  const created = recipesStore
    .cookLogsByRecipe(m.recipeId)
    .value.find((c) => !preCookLogIds.has(c.id));
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
}
</script>

<template>
  <BeanieFormModal
    :open="open"
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
          class="flex items-center gap-2 rounded-xl border border-[rgba(44,62,80,0.12)] bg-white px-3 py-2.5 text-sm dark:bg-slate-800"
        >
          {{ recipe?.name ?? t('mealPlanner.card.recipeRemoved') }}
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
          <span class="ml-1 font-normal tracking-normal text-[rgba(44,62,80,0.4)] normal-case">
            · {{ t('mealPlanner.editor.cookHint') }}
          </span>
        </div>
        <FamilyChipPicker v-model="cookId" mode="single" />
      </div>

      <!-- Who's eating + guests -->
      <div>
        <div class="mp-label">{{ t('mealPlanner.editor.eaters') }}</div>
        <FamilyChipPicker v-model="eaterIds" mode="multi" />
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            v-for="(g, i) in guestNames"
            :key="`${g}-${i}`"
            class="font-outfit text-secondary-500 inline-flex items-center gap-1 rounded-full bg-[var(--tint-silk-20)] px-2.5 py-1 text-xs font-semibold"
          >
            {{ g }}
            <button
              type="button"
              class="text-[rgba(44,62,80,0.5)]"
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
            class="font-outfit text-secondary-500 flex-none rounded-xl bg-[var(--tint-slate-5)] px-3 text-sm font-semibold"
            @click="addGuest"
          >
            {{ t('mealPlanner.editor.addGuest') }}
          </button>
        </div>
      </div>

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

      <!-- Mark cooked (recipe meals, not yet cooked) -->
      <button
        v-if="isRecipe && meal && !meal.cooked && meal.recipeId"
        type="button"
        class="font-outfit w-full rounded-xl border border-[rgba(241,93,34,0.35)] bg-[var(--tint-orange-8)] py-2.5 text-sm font-semibold text-[#F15D22]"
        @click="openMarkCooked"
      >
        ✓ {{ t('mealPlanner.editor.markCooked') }}
      </button>
    </div>

    <CookLogFormModal
      v-if="meal?.recipeId"
      :open="cookLogOpen"
      :recipe-id="meal.recipeId"
      @close="onCookLogClosed"
    />
  </BeanieFormModal>
</template>

<style scoped>
.mp-label {
  color: rgb(44 62 80 / 42%);
  font-family: Outfit, sans-serif;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  margin-bottom: 0.375rem;
  text-transform: uppercase;
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

.mp-input:focus {
  border-color: #aed6f1;
  box-shadow: 0 0 0 3px rgb(174 214 241 / 50%);
}
</style>
