<script setup lang="ts">
/**
 * The outlined, flex-filling secondary button a view modal puts in
 * BeanieFormModal's `#footer-start` (Close, ✏️ Edit). Label goes in the default
 * slot; `@click` and any other attrs fall through to the <button>.
 */
</script>

<template>
  <button
    type="button"
    class="font-outfit dark:border-line-strong dark:text-ink dark:hover:bg-surface-hover flex-1 rounded-[16px] border border-gray-200 py-3.5 text-sm font-bold text-[var(--color-text)] transition-all duration-300 hover:bg-gray-50"
  >
    <slot />
  </button>
</template>
