<script setup lang="ts">
/**
 * What a re-read of the source would change — old beside new (#93).
 *
 * PRESENTATIONAL ONLY. It takes an already-computed `RecipeDiff` and emits `take` / `close`.
 * The fetch, the budget, the diff and the write all live in `useRecipeRefetch`.
 *
 * The whole point of showing this rather than re-seeding the edit form is that by the time
 * the user looks, the new values must NOT already have won. Nothing is written until they
 * choose, and the modal says so.
 *
 * No per-field toggles in v1: take all, or keep yours.
 */
import { BaseModal } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';
import { useRecipeCourseLabel } from '@/composables/useRecipeCourseLabel';
import { isMealSlot, SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import type { RecipeDiff, RecipeDiffField } from '@/utils/recipeDiff';
import type { UIStringKey } from '@/services/translation/uiStrings';

defineProps<{
  open: boolean;
  diff: RecipeDiff;
}>();

const emit = defineEmits<{ take: []; close: [] }>();

const { t } = useTranslation();
const { courseLabel } = useRecipeCourseLabel();

/** The diff's field names are exactly the form's, so its labels are reused rather than
 *  duplicated. `mealSlots` is the one that differs — the form calls it "Good for". */
const FIELD_LABEL_KEY: Record<RecipeDiffField, UIStringKey> = {
  name: 'recipes.field.name',
  subtitle: 'recipes.field.subtitle',
  prepTime: 'recipes.field.prepTime',
  cookTime: 'recipes.field.cookTime',
  servings: 'recipes.field.servings',
  ingredients: 'recipes.field.ingredients',
  steps: 'recipes.field.steps',
  notes: 'recipes.field.notes',
  course: 'recipes.field.course',
  mealSlots: 'recipes.field.meals',
};

/**
 * One readable line per value. Lists become one entry per line so the two sides line up.
 *
 * ⚠️ `course` and `mealSlots` are IDS, not display text, and this modal's whole job is to
 * put two values side by side. Rendering them raw would show `main` and `dinner` where the
 * badges, the shelf headings and the planner all show "🍲 Main" and "Dinner" — and would
 * put bare English ids in front of a Chinese-locale or beanie-mode user, which is the
 * ADR-008 hole the render-site resolvers exist to close. Both resolvers already exist.
 */
function render(field: RecipeDiffField, value: unknown): string {
  if (field === 'course') return typeof value === 'string' ? courseLabel(value) : '';
  if (field === 'mealSlots') {
    return Array.isArray(value)
      ? value
          .filter(isMealSlot)
          .map((s) => t(SLOT_LABEL_KEYS[s]))
          .join(', ')
      : '';
  }
  if (Array.isArray(value)) return value.join('\n');
  return typeof value === 'string' ? value : '';
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="t('recipes.refetch.title')"
    size="lg"
    layer="overlay"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <p class="font-inter text-secondary-500/80 dark:text-ink-soft text-sm">
        {{ t('recipes.refetch.subtitle') }}
      </p>

      <div
        v-for="row in diff.rows"
        :key="row.field"
        class="dark:border-line dark:bg-surface-raised rounded-2xl border border-gray-200 bg-white p-4"
        :data-testid="`refetch-row-${row.field}`"
      >
        <p
          class="font-outfit text-secondary-500/60 dark:text-ink-faint mb-2 text-xs font-semibold tracking-wide uppercase"
        >
          {{ t(FIELD_LABEL_KEY[row.field]) }}
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <p class="font-outfit text-secondary-500/50 dark:text-ink-faint mb-1 text-xs">
              {{ t('recipes.refetch.yours') }}
            </p>
            <p
              v-if="render(row.field, row.mine)"
              class="font-inter text-secondary-500/80 dark:text-ink-soft text-sm leading-relaxed whitespace-pre-line"
            >
              {{ render(row.field, row.mine) }}
            </p>
            <p v-else class="font-inter text-secondary-500/40 dark:text-ink-faint text-sm italic">
              {{ t('recipes.refetch.wasEmpty') }}
            </p>
          </div>
          <div
            class="dark:bg-surface-overlay/40 -m-2 rounded-xl bg-[var(--tint-orange-4)] p-2 sm:m-0 sm:bg-transparent sm:p-0 dark:sm:bg-transparent"
          >
            <p class="font-outfit text-primary-500 dark:text-accent-lift mb-1 text-xs">
              {{ t('recipes.refetch.theirs') }}
            </p>
            <p
              class="font-inter text-secondary-500 dark:text-ink text-sm leading-relaxed whitespace-pre-line"
            >
              {{ render(row.field, row.theirs) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Offered only when the recipe has no photo yet — see `diffRecipe`. -->
      <p
        v-if="diff.photo"
        class="dark:border-line dark:bg-surface-raised font-inter text-secondary-500/80 dark:text-ink-soft flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm"
        data-testid="refetch-photo-row"
      >
        <span aria-hidden="true">📷</span>
        <span>{{ t('recipes.refetch.photo') }}</span>
      </p>

      <p class="dark:text-ink-faint text-xs text-gray-400">
        {{ t('recipes.refetch.nothingSaved') }}
      </p>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="font-outfit text-secondary-500 dark:bg-surface-overlay dark:text-ink dark:hover:bg-surface-hover rounded-2xl bg-gray-100 px-4 py-2 text-sm font-semibold transition-colors hover:bg-gray-200"
          data-testid="refetch-keep-mine"
          @click="emit('close')"
        >
          {{ t('recipes.refetch.keepMine') }}
        </button>
        <button
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 rounded-2xl bg-gradient-to-r px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
          data-testid="refetch-take"
          @click="emit('take')"
        >
          {{ t('recipes.refetch.take') }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>
