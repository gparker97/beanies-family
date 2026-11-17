<script setup lang="ts">
/**
 * Where a view-only event comes from: a hollow dot in the calendar's color and the
 * calendar's name, truncating (plan 2026-11-17, C1). Every view-only surface and the
 * details modal use it, so the source always reads the same way.
 *
 * The color is only ever the dot's ring, never text: the name is always an ink
 * (`ink-faint` semantics, AA on every surface it sits on). On the stripes the
 * utility's `--vo-ink-faint` applies; elsewhere (the details modal) the standard
 * pair. `suffix` appends "view only" where the surface has room to spell it out.
 */
withDefaults(
  defineProps<{
    name: string;
    color: string;
    /** Extra words after the name, e.g. "View only" on the agenda row. */
    suffix?: string;
    /** On the stripes (`.view-only-stripes`): read the utility's faint ink. */
    onStripes?: boolean;
  }>(),
  { suffix: '', onStripes: false }
);
</script>

<template>
  <span
    class="flex min-w-0 items-center gap-1 text-xs leading-tight font-normal"
    :class="onStripes ? 'text-[var(--vo-ink-faint)]' : 'text-secondary-400 dark:text-ink-faint'"
    data-testid="external-source-label"
  >
    <span
      class="view-only-dot h-2 w-2 flex-none rounded-full border-2 border-solid"
      :style="{ '--vo-hue': color }"
      aria-hidden="true"
    />
    <span class="min-w-0 truncate"
      >{{ name }}<template v-if="suffix"> · {{ suffix }}</template></span
    >
  </span>
</template>
