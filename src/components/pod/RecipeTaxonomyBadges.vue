<script setup lang="ts">
import { computed } from 'vue';
import { useRecipeCourseLabel } from '@/composables/useRecipeCourseLabel';
import type { RecipeCourse } from '@/types/models';

/**
 * A recipe's course badge and tag pills — used by BOTH the cookbook card and the detail page's
 * meta row, so the two cannot drift into showing the same data two different ways.
 *
 * ⚠️ Every visibility test is `?.length`, never truthiness: `[]` is the COMMON case (the form
 * always sends arrays), and `v-if="tags"` would render an empty pill row on every untagged
 * recipe.
 */
const props = withDefaults(
  defineProps<{
    course?: RecipeCourse;
    tags?: string[];
    /**
     * How many tags to show before collapsing the rest into a `+N`.
     *
     * Lives here as a prop, not in `utils/recipeTags.ts`: it is a presentational overflow
     * threshold for THIS card layout, with no relationship to the normalisation caps, and it
     * will change the next time the grid does.
     */
    maxTags?: number;
  }>(),
  { maxTags: 3 }
);

const { courseLabel, courseEmoji } = useRecipeCourseLabel();

// Array.isArray rather than `?? []`: a corrupt stored string satisfies `.slice` and `.length`
// and would render one pill PER CHARACTER.
const safeTags = computed(() => (Array.isArray(props.tags) ? props.tags : []));
const shownTags = computed(() => safeTags.value.slice(0, props.maxTags));
const overflow = computed(() => Math.max(0, safeTags.value.length - props.maxTags));
const hasAnything = computed(() => Boolean(props.course) || safeTags.value.length > 0);
</script>

<template>
  <div v-if="hasAnything" class="mt-1.5 flex flex-wrap items-center gap-1">
    <span
      v-if="course"
      class="font-outfit dark:bg-primary-500/15 dark:text-accent-lift inline-flex items-center gap-1 rounded-full bg-[var(--tint-orange-8)] px-2 py-0.5 text-xs font-semibold text-[#F15D22]"
    >
      <span aria-hidden="true">{{ courseEmoji(course) }}</span>
      {{ courseLabel(course) }}
    </span>
    <span
      v-for="tag in shownTags"
      :key="tag"
      class="font-inter dark:bg-surface-overlay dark:text-ink-soft max-w-[8rem] truncate rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
      :title="tag"
      >{{ tag }}</span
    >
    <span v-if="overflow > 0" class="font-inter text-xs text-[var(--color-text-muted)]"
      >+{{ overflow }}</span
    >
  </div>
</template>
