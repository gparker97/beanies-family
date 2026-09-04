<script setup lang="ts">
/**
 * Consistent nook/activities section card wrapper.
 * Provides: rounded card with subtle gradient bg, prominent section title,
 * optional right-side slot (badge, link, etc).
 */

interface Props {
  /** Section title text */
  title: string;
  /** Border-left accent color (CSS color value). Omit for no border. */
  borderColor?: string;
}

withDefaults(defineProps<Props>(), {
  borderColor: undefined,
});
</script>

<template>
  <div
    class="dark:bg-surface-raised rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)]"
    :class="borderColor ? 'border-l-4' : ''"
    :style="borderColor ? { borderLeftColor: borderColor } : {}"
  >
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <span
        class="font-outfit dark:text-ink-soft text-xs font-bold tracking-[0.05em] text-gray-700 uppercase"
      >
        {{ title }}
      </span>
      <!-- Right slot: badge, link, etc -->
      <slot name="header-right" />
    </div>

    <!-- Content -->
    <slot />
  </div>
</template>
