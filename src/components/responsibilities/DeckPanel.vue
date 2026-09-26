<script setup lang="ts">
/**
 * Who Owns What (#109): the Overview's section card, the ONE definition of its surface,
 * header and spacing so the six Overview sections can't drift apart. `title` and `hint`
 * are already translated; the `#aside` slot replaces the hint (e.g. a link).
 */
defineProps<{ title?: string; hint?: string }>();
</script>

<template>
  <section
    class="dark:border-line dark:bg-surface-raised flex min-w-0 flex-col gap-3.5 rounded-3xl border border-[var(--color-border)] bg-white p-5 shadow-[var(--card-shadow)]"
  >
    <div v-if="title" class="flex items-baseline justify-between gap-3">
      <h3 class="font-outfit dark:text-ink text-base font-semibold text-[var(--color-text)]">
        {{ title }}
      </h3>
      <slot name="aside">
        <span
          v-if="hint"
          class="dark:text-ink-faint text-xs whitespace-nowrap text-[var(--color-text-muted)]"
          >{{ hint }}</span
        >
      </slot>
    </div>
    <slot />
  </section>
</template>
