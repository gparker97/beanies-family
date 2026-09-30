<script setup lang="ts">
/**
 * One family list as a tappable row: emoji, title and progress (extracted from
 * `RecipeListSheet`'s review rows for #116).
 *
 * Two shapes, one row:
 *   - default: the house "Open list ›" affordance at the end, for a row that takes you
 *     TO the list (without it the row is a button that does not look like one).
 *   - `selectable`: a pick among several (the shopping list destination), shown by a
 *     Heritage Orange outline and `aria-pressed`, with no "open" affordance.
 *
 * The click is the caller's (`@click` falls through to the button). No domain imports,
 * which is what lets it live in `components/lists/`.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { listProgress } from '@/utils/listLifecycle';
import type { FamilyList } from '@/types/models';

const props = withDefaults(
  defineProps<{
    list: FamilyList;
    /** A pick among several rather than a way to open the list. */
    selectable?: boolean;
    selected?: boolean;
  }>(),
  { selectable: false, selected: false }
);

const { t } = useTranslation();

/**
 * Progress, so a finished shop is obvious without opening it. Routed through the shared
 * `listProgress` + `lists.progress` rather than interpolating "3/5" here, so the
 * translator sees it and every surface renders it the same way.
 */
const progress = computed(() => {
  const { done, total } = listProgress(props.list);
  return fillTemplate(t('lists.progress'), { done: String(done), total: String(total) });
});
</script>

<template>
  <button
    type="button"
    class="dark:hover:bg-surface-hover flex w-full items-center gap-2 rounded-xl border-2 px-3 py-2 text-left transition-colors hover:bg-[var(--tint-slate-5)]"
    :class="
      selected
        ? 'border-primary-500 dark:border-accent-lift dark:bg-surface-overlay bg-white'
        : 'dark:border-line dark:bg-surface-overlay border-[var(--tint-slate-10)] bg-white'
    "
    :aria-pressed="selectable ? selected : undefined"
    data-testid="list-choice-row"
  >
    <span aria-hidden="true">{{ list.emoji }}</span>
    <span class="min-w-0 flex-1">
      <span
        class="font-inter dark:text-ink block text-sm font-semibold wrap-anywhere text-[var(--color-text)]"
      >
        {{ list.title }}
      </span>
      <span class="font-inter dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        {{ progress }}
      </span>
    </span>
    <span
      v-if="!selectable"
      class="font-outfit text-primary-600 dark:text-accent-lift inline-flex flex-shrink-0 items-center gap-0.5 text-xs font-semibold"
      >{{ t('lists.embed.open') }}<span aria-hidden="true">›</span></span
    >
  </button>
</template>
