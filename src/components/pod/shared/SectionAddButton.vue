<script setup lang="ts">
/**
 * Small "+ Add X" pill used in Care & Safety section headers. Extracted
 * so the three sections (allergies / medications / key contacts) share
 * one markup + token set rather than copy-pasting the class string.
 */
defineProps<{ label: string }>();
defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    class="font-outfit text-primary-500 inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[var(--tint-orange-8)] px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--tint-orange-15)]"
    @click="$emit('click')"
  >
    <span aria-hidden="true">+</span>
    {{ label }}
  </button>
</template>
