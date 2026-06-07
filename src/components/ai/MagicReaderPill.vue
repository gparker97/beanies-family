<script setup lang="ts">
/**
 * The unified "✨ Perform magic" entry pill — the restyled standalone door into
 * the AI document readers. Presentational only: it emits `@click` and the parent
 * owns visibility (the existing `v-if` gates) and what the tap does. ONE
 * consistent, responsive rendering everywhere the AI capability appears (the
 * calendar command bar AND the Travel list / trip-detail headers): a compact ✨
 * circle on mobile, expanding to the full "✨ Perform magic" pill on `sm:+`.
 * This mirrors the responsive Add button beside it on the command bar so the AI
 * door is equally easy to find on every screen. The bold Heritage Orange →
 * Terracotta gradient + `.magic-shimmer` sheen is the shared "magic" signal.
 *
 * Accessibility: the label span is `hidden sm:inline` (visual only), so the
 * button carries an explicit `aria-label` that is ALWAYS present (the only
 * accessible name on mobile, and a superset of the visible text on desktop —
 * no WCAG label-in-name mismatch). It defaults to `label`.
 */
defineProps<{
  /** Visible label on `sm:+`, and the default accessible name. */
  label: string;
  /** Accessible name override; falls back to `label`. */
  ariaLabel?: string;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    class="magic-shimmer font-outfit from-primary-500 to-terracotta-400 inline-flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-br text-lg font-bold whitespace-nowrap text-white shadow-[0_4px_12px_rgba(241,93,34,0.25)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.35)] sm:h-auto sm:w-auto sm:rounded-2xl sm:px-4 sm:py-2.5 sm:text-sm"
    :aria-label="ariaLabel ?? label"
    @click="$emit('click')"
  >
    <span aria-hidden="true">✨</span>
    <span class="hidden sm:inline">{{ label }}</span>
  </button>
</template>
