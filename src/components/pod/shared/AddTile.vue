<script setup lang="ts">
/**
 * Dashed-border "+ Add X" tile for grid surfaces that let the user
 * append a new item inline (favorites grid, saying rail, photo
 * gallery, etc.). The caller passes the label and listens for click;
 * this component stays domain-free.
 */
defineProps<{
  label: string;
  /** Minimum height — tiles in the same grid should share this. */
  minHeight?: string;
}>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    type="button"
    class="group flex flex-col items-center justify-center gap-1 rounded-[var(--sq)] border-2 border-dashed border-[var(--tint-slate-10)] bg-white/40 px-4 py-6 transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--tint-orange-4)] dark:bg-slate-800/40"
    :style="{ minHeight: minHeight ?? '7rem' }"
    @click="$emit('click')"
  >
    <span
      class="text-secondary-500/40 group-hover:text-primary-500 text-3xl leading-none transition-colors"
      aria-hidden="true"
    >
      +
    </span>
    <span
      class="font-outfit text-secondary-500/60 group-hover:text-primary-500 text-xs font-semibold transition-colors"
    >
      {{ label }}
    </span>
  </button>
</template>
