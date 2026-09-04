<script setup lang="ts">
/**
 * The shell every peripheral card shares: an uppercase orange heading, a
 * chevron that promises a drill-in, and the lift-on-press affordance.
 *
 * A shell rather than four hand-rolled cards, because the mockup's band and
 * rail render the SAME cards in two different containers — any styling that
 * lived in one of them would drift the moment the other changed.
 */
defineProps<{
  title: string;
  dark?: boolean;
  /**
   * `chores` gives the band's most important card its own identity, the way
   * `dark` does for the trip. Without it the anchor of the wall was one white
   * card among four.
   */
  tone?: 'chores' | 'todos';
}>();
defineEmits<{ open: [] }>();
</script>

<template>
  <button
    type="button"
    class="wall-card block w-full rounded-[26px] px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
    :class="
      dark
        ? 'bg-gradient-to-br from-[#33475b] to-[var(--deep-slate,#2C3E50)] text-[#ecf0f1] shadow-[var(--card-shadow)]'
        : tone === 'chores'
          ? 'dark:from-surface-raised dark:to-surface-raised dark:ring-surface-hover bg-gradient-to-br from-[#eaf4fc] to-white shadow-[var(--card-shadow)] ring-1 ring-[rgba(174,214,241,0.9)]'
          : 'dark:bg-surface-raised bg-white shadow-[var(--card-shadow)]'
    "
    @click="$emit('open')"
  >
    <span
      class="font-outfit wall-card-title mb-2 flex items-center gap-1.5 font-bold tracking-[0.09em] uppercase"
      :class="dark ? 'text-[var(--sky-silk,#AED6F1)]' : 'text-primary-500'"
    >
      {{ title }}
      <span class="ml-auto opacity-50" aria-hidden="true">›</span>
    </span>
    <slot />
  </button>
</template>
