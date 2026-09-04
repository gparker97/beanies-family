<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecipeCourseLabel } from '@/composables/useRecipeCourseLabel';
import FrequencyChips, { type ChipOption } from '@/components/ui/FrequencyChips.vue';
import SortMenu, { type SortMenuOption } from '@/components/ui/SortMenu.vue';
import { COURSE_DEFS } from '@/constants/recipeCourses';
import { COOKBOOK_GROUPS, type CookbookGroup, type RecipeSort } from '@/utils/recipeOrdering';
import type { RecipeCourse } from '@/types/models';

/**
 * The cookbook's divider tabs + tray (approved mockup, direction A).
 *
 * Props in, events out — no store, no `useCookbookView`. The page owns the state and passes
 * it down, so these controls stay renderable in isolation and testable without a Pinia.
 */
const props = defineProps<{
  groupBy: CookbookGroup;
  sortBy: RecipeSort;
  course: RecipeCourse | null;
  /** Per-course totals from the UNFILTERED list, so the counts do not move when filtering. */
  courseCounts: Record<RecipeCourse | 'unset', number>;
  totalCount: number;
}>();

const emit = defineEmits<{
  'update:groupBy': [value: CookbookGroup];
  'update:sortBy': [value: RecipeSort];
  'update:course': [value: RecipeCourse | null];
}>();

const { t } = useTranslation();
const { courseLabel, courseEmoji } = useRecipeCourseLabel();

const GROUP_LABEL_KEYS = {
  none: 'cookbook.group.none',
  meal: 'cookbook.group.meal',
  course: 'cookbook.group.course',
} as const;

const groupTabs = computed(() =>
  COOKBOOK_GROUPS.map((g) => ({ value: g, label: t(GROUP_LABEL_KEYS[g]) }))
);

const SORT_OPTIONS: readonly SortMenuOption<RecipeSort>[] = [
  { value: 'name', labelKey: 'cookbook.sort.name', icon: '🔤' },
  { value: 'recent', labelKey: 'cookbook.sort.recent', icon: '↓' },
  { value: 'cooked', labelKey: 'cookbook.sort.cooked', icon: '🔥' },
];

/**
 * A leading "all" pill, then one per course. Courses with no recipes are DISABLED rather than
 * hidden: a row whose contents shuffle as recipes are added is harder to use than a stable one
 * with some options greyed, and the counts explain why.
 */
const courseOptions = computed<ChipOption[]>(() => [
  { value: '', label: t('cookbook.filter.all'), badge: props.totalCount },
  ...COURSE_DEFS.map((c) => ({
    value: c.id,
    label: courseLabel(c.id),
    icon: courseEmoji(c.id),
    badge: props.courseCounts[c.id],
    disabled: props.courseCounts[c.id] === 0,
  })),
]);

// The chips speak `string`; `null` is how the rest of the app spells "no filter".
const selectedCourse = computed(() => props.course ?? '');

function onCourse(value: string) {
  emit('update:course', value === '' ? null : (value as RecipeCourse));
}
</script>

<template>
  <div class="mb-5">
    <!--
      Divider tabs. `aria-pressed` toggle buttons rather than role="tablist": honest tab
      semantics would oblige roving tabindex and arrow-key traversal, and this is a filter, not
      a tab set. Visually identical, semantics correct, nothing extra to maintain.
    -->
    <div
      class="flex [scrollbar-width:none] flex-nowrap gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
      role="group"
      :aria-label="t('cookbook.groupLabel')"
    >
      <button
        v-for="tab in groupTabs"
        :key="tab.value"
        type="button"
        class="font-outfit shrink-0 rounded-t-2xl border border-b-0 px-4 py-2 text-sm font-semibold transition-colors"
        :class="
          groupBy === tab.value
            ? 'dark:bg-surface-raised dark:border-line-strong border-gray-200 bg-white text-[#F15D22]'
            : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
        "
        :aria-pressed="groupBy === tab.value"
        @click="emit('update:groupBy', tab.value)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- The tray the selected tab joins onto — one object, not a toolbar stacked on a grid. -->
    <div
      class="dark:border-line-strong dark:bg-surface-raised flex flex-col gap-3 rounded-2xl rounded-tl-none border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <FrequencyChips
        :model-value="selectedCourse"
        :options="courseOptions"
        layout="scroll"
        class="min-w-0 flex-1"
        @update:model-value="onCourse"
      />
      <SortMenu
        :model-value="sortBy"
        :options="SORT_OPTIONS"
        trigger-label-key="cookbook.sortLabel"
        class="w-full sm:w-auto"
        @update:model-value="emit('update:sortBy', $event)"
      />
    </div>
  </div>
</template>
