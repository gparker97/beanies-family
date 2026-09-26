<script setup lang="ts" generic="E extends string = never">
/**
 * The shared category-chip row for Beanie Lists — one wrapping row of bordered
 * pills over `LIST_CATEGORIES`. Replaces three copy-pasted blocks (NewListSheet,
 * ListDetailModal, BeanieListsPage). Differences between sites are explicit,
 * independent props rather than one overloaded enum:
 *  - `tone`     : active-state colour ('edit' = orange tint, 'filter' = foundation)
 *  - `short`    : short vs full category label
 *  - `clearable`: clicking the selected pill clears to null
 *  - `showAll`  : render a leading "All" pill (selected when modelValue is null)
 *  - `extras`   : caller-owned pills after the categories, same classes (e.g. the
 *                 Deck view's "Nobody yet" / "Skipped · N"). Their ids widen the
 *                 model type to `ListCategory | E`; without `extras`, E is `never`
 *                 and the model stays exactly `ListCategory | null`.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { LIST_CATEGORIES } from '@/constants/listCategories';
import type { ListCategory } from '@/types/models';

const props = withDefaults(
  defineProps<{
    modelValue: ListCategory | E | null;
    tone?: 'edit' | 'filter';
    short?: boolean;
    clearable?: boolean;
    showAll?: boolean;
    /** Extra pills rendered after the categories. `label` is already translated. */
    extras?: { id: E; label: string; emoji?: string }[];
  }>(),
  { tone: 'edit', short: false, clearable: false, showAll: false, extras: () => [] }
);
const emit = defineEmits<{ 'update:modelValue': [value: ListCategory | E | null] }>();

const { t } = useTranslation();
const { categoryLabel, categoryShortLabel } = useListCategoryLabel();

const labelFor = (id: ListCategory): string =>
  props.short ? categoryShortLabel(id) : categoryLabel(id);

const activeClass = computed(() =>
  props.tone === 'filter'
    ? 'border-transparent bg-[var(--color-foundation)] text-white'
    : 'border-[var(--color-primary-500)] bg-[var(--tint-orange-12)] text-[var(--color-primary-500)]'
);
const INACTIVE_CLASS =
  'border-[var(--color-border)] bg-white text-[var(--color-text-muted)] dark:bg-surface-raised';

function pick(id: ListCategory | E): void {
  emit('update:modelValue', props.clearable && props.modelValue === id ? null : id);
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-if="showAll"
      type="button"
      class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
      :class="modelValue === null ? activeClass : INACTIVE_CLASS"
      @click="emit('update:modelValue', null)"
    >
      {{ t('lists.filter.all') }}
    </button>
    <button
      v-for="cat in LIST_CATEGORIES"
      :key="cat.id"
      type="button"
      class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
      :class="modelValue === cat.id ? activeClass : INACTIVE_CLASS"
      @click="pick(cat.id)"
    >
      <span aria-hidden="true">{{ cat.emoji }}</span> {{ labelFor(cat.id) }}
    </button>
    <button
      v-for="extra in extras"
      :key="extra.id"
      type="button"
      class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
      :class="modelValue === extra.id ? activeClass : INACTIVE_CLASS"
      @click="pick(extra.id)"
    >
      <span v-if="extra.emoji" aria-hidden="true">{{ extra.emoji }}</span> {{ extra.label }}
    </button>
  </div>
</template>
