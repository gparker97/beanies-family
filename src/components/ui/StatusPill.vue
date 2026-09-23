<script setup lang="ts">
/**
 * "Something is happening, and here is what" — a tinted Heritage Orange pill with the brand
 * spinner beside a short line of text.
 *
 * For a wait the person has to sit through and should not mistake for a stuck screen: the
 * cold device waiting for another device's approval, a biometric check in progress. It
 * replaced a pulsing 8px dot that read as a colour change rather than as work being done.
 *
 * `role="status"` so the line is announced when it appears; the spinner is decorative.
 *
 * A plain ring, not `BeanieSpinner`: the brand spinner is an image built for a page-level
 * wait, and at pill size it shrinks to an unreadable dot — the "too subtle" problem this
 * component exists to fix.
 */
defineProps<{ text: string }>();
</script>

<template>
  <p
    role="status"
    class="text-primary-700 dark:text-accent-lift mx-auto inline-flex max-w-full items-center gap-2.5 rounded-full bg-[var(--tint-orange-8)] px-4 py-2 text-left text-sm font-semibold"
  >
    <span
      aria-hidden="true"
      class="border-t-primary-500 dark:border-t-accent-lift h-5 w-5 shrink-0 animate-spin rounded-full border-[2.5px] border-[var(--tint-orange-15)] motion-reduce:[animation-duration:2.5s]"
    />
    <span>{{ text }}</span>
  </p>
</template>
