<script setup lang="ts">
/**
 * LoginChoiceCard — shared interaction shell for the multi-choice card pattern
 * used across the login surface (WelcomeGate's three entrance cards, LoadPodView's
 * storage-picker cards, NoPodEmptyState's three CTAs).
 *
 * Design contract:
 *   - The COMPONENT owns interaction shell + ARIA (hover-translate, focus-ring,
 *     disabled/dimmed state classes, `<button>` semantics).
 *   - The CALL SITE owns visual identity AND geometry (border-radius, padding,
 *     background, gradient, icon backdrop, title/subtitle, optional corner badge)
 *     via the default slot and inline classes.
 *
 * Why slot-driven rather than prop-driven variants: every existing call site
 * has a distinct icon backdrop colour AND radius (cards in LoadPodView use
 * rounded-2xl; cards in WelcomeGate use rounded-3xl; secondary cards in the
 * proposed WelcomeGate layout use rounded-[18px]). Pushing those into prop
 * variants creates either a kitchen-sink prop bag or a leaky abstraction.
 * Slot-driven keeps the visual identity adjacent to its semantic meaning.
 *
 * IMPORTANT: call sites MUST specify a `rounded-*` class. The shell intentionally
 * doesn't ship one so radii can vary by context. Forgetting one will render a
 * sharp-cornered button — easy to spot in review.
 */
defineProps<{
  disabled?: boolean;
  dimmed?: boolean;
  ariaLabel?: string;
  testid?: string;
}>();

const emit = defineEmits<{
  click: [];
}>();

function handleClick() {
  emit('click');
}
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :data-testid="testid"
    class="group focus-visible:ring-primary-500 dark:focus-visible:ring-offset-surface-ground relative flex w-full flex-col items-stretch text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    :class="[
      disabled ? 'cursor-not-allowed opacity-50' : 'hover:-translate-y-0.5',
      dimmed && !disabled ? 'opacity-60' : '',
    ]"
    @click="handleClick"
  >
    <slot />
  </button>
</template>
