<script setup lang="ts">
/**
 * The ingredient checklist (#116): ONE control behind every shopping-list surface (the
 * recipe page's sheet, the edit-meal drawer, each recipe section of the week's list and
 * its "In More Than One Meal" section).
 *
 * Every line starts ticked. Untick what you already have, edit any line in place, add
 * your own. v-model is a `ChecklistLine[]` (`buildShoppingLines`); every change emits a
 * NEW array (lines are never mutated in place), so a caller's `rebatchLines` can tell a
 * hand edit apart (`isUneditedLine`).
 *
 * Lines are PLAIN editable text, exactly as written; a ` (×3)` batch suffix is part of
 * that text, because a textarea cannot style part of its value.
 *
 * Lines standing behind a merged line (`mergedInto`) are hidden: `visible` is computed
 * once and drives the rows, the tick-all toggle and what it toggles. A section whose
 * every line is merged collapses to its header with "All in More Than One Meal".
 *
 * Emptied lines stay on screen and are dropped on save, and pasted multi-line text
 * becomes several items (both by `linesToTitles`). Headings the recipe had are never
 * dropped silently: the "N headings skipped" hint says so (`listSeed` requires it).
 *
 * The header holds the ONE tick-all toggle (the `ListDetailModal` pattern: one control
 * whose label says which way it goes) and an optional `title` slot. A scoped
 * `#line-extra="{ line }"` slot renders under a line's text (the week drawer's recipe
 * pills, ✨ and Split), so this stays free of domain props. No store access: this is a
 * view over its v-model.
 */
import { computed, ref } from 'vue';
import AutoGrowTextarea from '@/components/ui/AutoGrowTextarea.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import TickButton from '@/components/ui/TickButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { generateUUID } from '@/utils/id';
import type { ChecklistLine } from '@/utils/mealShoppingList';

const props = withDefaults(
  defineProps<{
    modelValue: ChecklistLine[];
    /** Headings dropped from the recipe; shown as a hint, never silent. */
    headingsSkipped?: number;
    /** Offer the "Add an item" row (off for the merged section: an added line has no recipe). */
    addable?: boolean;
  }>(),
  { headingsSkipped: 0, addable: true }
);

const emit = defineEmits<{ 'update:modelValue': [lines: ChecklistLine[]] }>();

const { t } = useTranslation();

/** The rows shown: every line not standing behind a merged line. */
const visible = computed(() => props.modelValue.filter((l) => l.mergedInto === undefined));
/** Every line of this section went into "In More Than One Meal". */
const allMerged = computed(() => props.modelValue.length > 0 && visible.value.length === 0);

const allChecked = computed(
  () => visible.value.length > 0 && visible.value.every((l) => l.checked)
);

function update(id: string, patch: Partial<ChecklistLine>): void {
  emit(
    'update:modelValue',
    props.modelValue.map((l) => (l.id === id ? { ...l, ...patch } : l))
  );
}

/** Ticks or unticks the VISIBLE lines only; a hidden merged part keeps its state. */
function toggleAll(): void {
  const checked = !allChecked.value;
  emit(
    'update:modelValue',
    props.modelValue.map((l) =>
      l.mergedInto !== undefined || l.checked === checked ? l : { ...l, checked }
    )
  );
}

/**
 * Enter on a line finishes the edit: the text is already live (every keystroke updates the
 * line), so this only lets go of the field. An emptied line needs nothing here: it stays on
 * screen and is dropped on save, the same as when the field is tapped away from.
 */
function finishEdit(e: KeyboardEvent | InputEvent): void {
  (e.target as HTMLElement | null)?.blur();
}

const draft = ref('');

/** Append the typed line, ticked (you typed it because you need it). */
function addLine(): void {
  const text = draft.value.trim();
  if (!text) return;
  emit('update:modelValue', [
    ...props.modelValue,
    { id: generateUUID(), text, checked: true, batches: 1 },
  ]);
  draft.value = '';
}

/** Past tense, and about the RECIPE: it does not move as the user edits. */
const skippedHint = computed(() => {
  const n = props.headingsSkipped;
  if (n <= 0) return '';
  return n === 1
    ? t('lists.fromRecipe.headingsSkipped.one')
    : fillTemplate(t('lists.fromRecipe.headingsSkipped.other'), { count: String(n) });
});
</script>

<template>
  <div>
    <div class="flex items-start gap-2 pb-1.5">
      <div class="min-w-0 flex-1">
        <slot name="title" />
      </div>
      <button
        v-if="visible.length"
        type="button"
        class="font-outfit text-primary-600 dark:text-accent-lift flex-shrink-0 text-xs font-semibold underline underline-offset-2"
        data-testid="ingredients-toggle-all"
        @click="toggleAll"
      >
        {{ allChecked ? t('ingredients.untickAll') : t('ingredients.tickAll') }}
      </button>
    </div>

    <p
      v-if="allMerged"
      class="font-inter dark:text-ink-soft pb-2 text-xs text-[var(--color-text-muted)]"
      data-testid="ingredients-all-merged"
    >
      {{ t('ingredients.allMerged') }}
    </p>

    <ul>
      <li
        v-for="l in visible"
        :key="l.id"
        class="dark:border-line flex items-start gap-2.5 border-b border-[var(--tint-slate-10)] py-2"
        data-testid="ingredient-line"
      >
        <TickButton
          :selected="l.checked"
          :label="fillTemplate(t('ingredients.include'), { item: l.text })"
          @toggle="update(l.id, { checked: !l.checked })"
        />
        <div class="min-w-0 flex-1">
          <AutoGrowTextarea
            :model-value="l.text"
            wrapper-class="font-inter text-base leading-snug sm:text-sm"
            :aria-label="fillTemplate(t('ingredients.edit'), { item: l.text })"
            class="dark:hover:bg-surface-hover rounded-md border-transparent bg-transparent hover:bg-[var(--tint-slate-5)] focus:ring-2 focus:ring-[#AED6F1] focus:outline-none"
            :class="
              l.checked
                ? 'dark:text-ink text-[var(--color-text)]'
                : 'dark:text-ink-faint text-[var(--color-text-muted)]'
            "
            enterkeyhint="done"
            data-testid="ingredient-text"
            @update:model-value="update(l.id, { text: $event })"
            @enter="finishEdit"
          />
          <slot name="line-extra" :line="l" />
        </div>
      </li>
    </ul>

    <!-- Add your own line. Enter adds it (and never submits the surrounding form). -->
    <div v-if="addable" class="flex items-center gap-2.5 pt-2.5 pb-0.5">
      <span
        class="dark:border-line-strong dark:text-ink-faint grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg border-2 border-dashed border-[var(--tint-slate-10)] text-xs font-bold text-[var(--color-text-muted)]"
        aria-hidden="true"
        >+</span
      >
      <input
        v-model="draft"
        type="text"
        :placeholder="t('ingredients.addPlaceholder')"
        :aria-label="t('ingredients.addPlaceholder')"
        class="font-inter dark:text-ink dark:placeholder:text-ink-faint min-w-0 flex-1 bg-transparent px-1 text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] sm:text-sm"
        data-testid="ingredient-add"
        @keydown.enter.prevent="addLine"
        @blur="addLine"
      />
    </div>

    <!-- Renders nothing when there is nothing to say. -->
    <InferredHint :text="skippedHint" />
  </div>
</template>
