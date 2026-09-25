<script setup lang="ts">
/**
 * The square tick used to pick rows in a review list (calendar import, statement
 * import). Extracted from the two identical copies in `CalendarImportModal.vue`
 * and `CalendarImportRow.vue`; the markup and classes are unchanged.
 *
 * Unticked, the check glyph is `text-transparent` rather than removed, so the box
 * keeps its size and the tick does not shift the row when it appears. Ticked, dark
 * mode uses the `-lift` accent with `surface-ground` ink, per the CIG ladder.
 */
const props = withDefaults(
  defineProps<{
    selected: boolean;
    disabled?: boolean;
    /** Accessible name, rendered as `aria-label`. Named `label`, not `ariaLabel`:
     *  vue-tsc does not map a template `aria-label` onto an `ariaLabel` prop, and
     *  `:ariaLabel` fails `vue/attribute-hyphenation`. */
    label: string;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    class="grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 text-xs"
    :class="
      props.selected
        ? 'border-primary-500 bg-primary-500 dark:border-accent-lift dark:bg-accent-lift dark:text-surface-ground text-white'
        : 'border-secondary-100 dark:border-line-strong text-transparent'
    "
    :disabled="props.disabled"
    :aria-pressed="props.selected"
    :aria-label="props.label"
    @click="emit('toggle')"
  >
    <span aria-hidden="true">✓</span>
  </button>
</template>
