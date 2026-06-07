<script setup lang="ts">
/**
 * The unified "✨ Perform magic" entry pill — the restyled standalone door into
 * the AI document readers. Presentational only: it emits `@click` and the parent
 * owns visibility (the existing `v-if` gates) and what the tap does. One
 * component, two consumers: the calendar command bar (icon-only, beside the Add
 * button) and the Travel page (full pill). The bold Heritage Orange → Terracotta
 * gradient + `.magic-shimmer` sheen is the shared "magic" signal.
 */
defineProps<{
  /** Visible label (full mode) — e.g. t('ai.magic.perform'). */
  label: string;
  /** Accessible name; falls back to `label`. Keep the existing key for the bar. */
  ariaLabel?: string;
  /** Compact 40px circle (the calendar command bar). Default false → text pill. */
  iconOnly?: boolean;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <button
    v-if="iconOnly"
    type="button"
    class="magic-shimmer from-primary-500 to-terracotta-400 inline-flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br text-lg text-white shadow-[0_4px_12px_rgba(241,93,34,0.25)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.35)] sm:rounded-2xl"
    :aria-label="ariaLabel ?? label"
    @click="$emit('click')"
  >
    <span aria-hidden="true">✨</span>
  </button>

  <button
    v-else
    type="button"
    class="magic-shimmer font-outfit from-primary-500 to-terracotta-400 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-br px-4 py-2.5 text-sm font-bold whitespace-nowrap text-white shadow-[0_4px_12px_rgba(241,93,34,0.25)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.35)]"
    :aria-label="ariaLabel ?? label"
    @click="$emit('click')"
  >
    <span aria-hidden="true">✨</span>
    <span>{{ label }}</span>
  </button>
</template>
