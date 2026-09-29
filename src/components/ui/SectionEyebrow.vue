<script setup lang="ts">
/**
 * The small uppercase label that heads a drawer section ("To-dos", "Lists"), with an
 * optional decorative icon. The default slot sits inline after the label (e.g. an
 * "N open" count); `#end` is pushed to the right edge (e.g. section actions).
 *
 * Text is `ink-faint` in dark (never an opacity modifier on readable text), rem sizes only.
 */
defineProps<{
  /** Decorative glyph shown before the label (hidden from assistive tech). */
  icon?: string;
  /** Already-translated label. */
  label: string;
}>();
</script>

<template>
  <div
    class="font-outfit dark:text-ink-faint mb-2.5 flex items-center gap-1.5 text-xs font-bold tracking-[0.09em] text-[var(--color-text-muted)] uppercase"
  >
    <span v-if="icon" aria-hidden="true" class="flex-none">{{ icon }}</span>
    <span class="min-w-0 truncate">{{ label }}</span>
    <span v-if="$slots.default" class="flex-none font-semibold tracking-normal normal-case"
      ><slot
    /></span>
    <span
      v-if="$slots.end"
      class="ms-auto inline-flex flex-none items-center gap-1.5 tracking-normal normal-case"
      ><slot name="end"
    /></span>
  </div>
</template>
