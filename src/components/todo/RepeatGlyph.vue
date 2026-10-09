<script setup lang="ts">
/**
 * #123: the purple ↻ tile that marks a repeating to-do (the form's Repeat row, the drawer's
 * Repeats block, the reminders roster). Decorative: the text beside it carries the meaning.
 * Dark: `surface-hover` is one step above the overlay surfaces it sits on.
 */
</script>

<template>
  <span
    class="font-outfit dark:bg-surface-hover dark:text-purple-lift flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--tint-purple-12)] text-base font-bold text-purple-500"
    aria-hidden="true"
    >↻</span
  >
</template>
