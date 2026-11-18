<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import ChipButton from '@/components/ui/ChipButton.vue';
import SearchField from '@/components/ui/SearchField.vue';
import { useTranslation } from '@/composables/useTranslation';
import { isSearchQuery, matchesQuery } from '@/utils/keywordSuggest';
import { fillTemplate } from '@/utils/fillTemplate';

export interface GroupedChipItem {
  value: string;
  label: string;
  icon: string;
  /** Extra words the search matches besides the label (never shown). */
  keywords?: readonly string[];
}

export interface ChipGroup {
  name: string;
  icon: string;
  items: GroupedChipItem[];
}

const props = defineProps<{
  modelValue: string;
  groups: ChipGroup[];
  autoExpandValue?: string;
  /**
   * A compact search pill as the first chip of the first row (#152). Opt-in: the category
   * pickers turn it on; the milestone picker leaves it off and renders as before.
   */
  searchable?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();
const expandedGroup = ref<string | null>(null);
const query = ref('');

// Auto-expand the group containing the current value
watchEffect(() => {
  const val = props.autoExpandValue ?? props.modelValue;
  if (val) {
    const group = props.groups.find((g) => g.items.some((i) => i.value === val));
    if (group) {
      expandedGroup.value = group.name;
    }
  }
});

function selectGroup(groupName: string) {
  expandedGroup.value = groupName;
}

function collapse() {
  expandedGroup.value = null;
}

function selectItem(value: string) {
  // A pick ends the search; the auto-expand then shows the picked chip in its group.
  query.value = '';
  emit('update:modelValue', value);
}

const expandedItems = () => props.groups.find((g) => g.name === expandedGroup.value)?.items ?? [];
const expandedIcon = () => props.groups.find((g) => g.name === expandedGroup.value)?.icon ?? '📦';

/**
 * True while a query is typed: the grouped rows give way to the flat results. The same
 * emptiness test `matchesQuery` applies, so the two never disagree.
 */
const searching = computed(() => props.searchable && isSearchQuery(query.value));
const results = computed<GroupedChipItem[]>(() =>
  searching.value
    ? props.groups.flatMap((g) =>
        g.items.filter((item) => matchesQuery(query.value, item.label, item.keywords ?? []))
      )
    : []
);
/**
 * The first row's layout. Searchable: one wrapping row whatever it holds. Otherwise exactly the
 * two rows the picker always had (the group chips wrap; the expanded chip and its hint do not).
 */
const firstRowClass = computed(() => {
  if (props.searchable) return 'flex flex-wrap items-center gap-2';
  return expandedGroup.value ? 'flex items-center gap-2' : 'flex flex-wrap gap-2';
});
const noMatch = computed(() =>
  fillTemplate(t('modal.noCategoryMatch'), { query: query.value.trim() })
);
</script>

<template>
  <div class="space-y-2">
    <!-- The first row. With search on, the search pill is its first item in every state (before
         the group chips, before the expanded-group chip, before the results), so it adds no row.
         One row element across the states keeps the SAME input mounted, so typing the first
         letter never drops the focus. Without search the classes are exactly the old rows'. -->
    <div :class="firstRowClass">
      <SearchField
        v-if="searchable"
        v-model="query"
        :placeholder="t('action.search')"
        :aria-label="t('modal.searchCategories')"
      />

      <!-- Search results: one flat row across every group -->
      <template v-if="searching">
        <ChipButton
          v-for="item in results"
          :key="item.value"
          :label="item.label"
          :icon="item.icon"
          :selected="modelValue === item.value"
          @click="selectItem(item.value)"
        />
      </template>

      <!-- All group chips (shown when no group is expanded) -->
      <template v-else-if="!expandedGroup">
        <button
          v-for="group in groups"
          :key="group.name"
          type="button"
          class="font-outfit dark:bg-surface-overlay dark:text-ink-soft rounded-full border-2 border-transparent bg-[var(--tint-slate-5)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--tint-slate-10)]"
          @click="selectGroup(group.name)"
        >
          <span class="mr-1">{{ group.icon }}</span>
          {{ group.name }}
        </button>
      </template>

      <!-- Expanded state: selected group chip + hint -->
      <template v-else>
        <button
          type="button"
          class="font-outfit border-primary-500 text-primary-500 dark:text-accent-lift dark:bg-primary-500/15 rounded-full border-2 bg-[var(--tint-orange-8)] px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          @click="collapse"
        >
          <span class="mr-1">{{ expandedIcon() }}</span>
          {{ expandedGroup }}
          <span class="ml-1 opacity-60">&times;</span>
        </button>
        <span class="font-outfit text-xs text-[var(--color-text-muted)]">
          {{ t('modal.selectSubcategory') }}
        </span>
      </template>
    </div>

    <p
      v-if="searching && !results.length"
      class="font-outfit dark:text-ink-faint m-0 text-xs font-medium text-[var(--color-text-muted)]"
    >
      {{ noMatch }}
    </p>

    <!-- The expanded group's sub-item chips -->
    <div v-if="!searching && expandedGroup" class="flex flex-wrap gap-2">
      <ChipButton
        v-for="item in expandedItems()"
        :key="item.value"
        :label="item.label"
        :icon="item.icon"
        :selected="modelValue === item.value"
        @click="selectItem(item.value)"
      />
    </div>
  </div>
</template>
