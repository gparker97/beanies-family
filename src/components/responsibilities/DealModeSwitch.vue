<script setup lang="ts">
/**
 * Who Owns What (#109): the Deal view's layout switch, Card by Card | Board View (mockup
 * `docs/mockups/who-owns-what-view-switch-2026-09-28.html`, option B, chosen by greg with
 * no caption). Drawn as a layout control, one outlined two-part control with a small
 * drawing of each layout, so it never reads as a second row of tabs beside Overview /
 * Deal / Deck. The selected half takes an orange inner outline and an orange drawing.
 *
 * Presentational: the page owns the mode (`v-model`).
 */
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ modelValue: 'pile' | 'board' }>();
const emit = defineEmits<{ 'update:modelValue': [mode: 'pile' | 'board'] }>();

const { t } = useTranslation();
</script>

<template>
  <div
    role="group"
    :aria-label="t('whoOwnsWhat.dealMode.label')"
    class="switch dark:border-line dark:bg-surface-raised inline-flex overflow-hidden rounded-[14px] border-[1.5px] border-[var(--color-border)] bg-white"
    data-testid="who-owns-what-deal-mode"
  >
    <button
      type="button"
      class="half"
      :class="{ 'is-on': modelValue === 'pile' }"
      :aria-pressed="modelValue === 'pile'"
      data-testid="deal-mode-pile"
      @click="emit('update:modelValue', 'pile')"
    >
      <svg
        class="h-[1.375rem] w-[1.375rem] flex-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="2.6" y="6.4" width="8.4" height="12.2" rx="1.8" transform="rotate(-18 6.8 12.5)" />
        <rect x="13" y="6.4" width="8.4" height="12.2" rx="1.8" transform="rotate(18 17.2 12.5)" />
        <rect x="7.8" y="4.6" width="8.4" height="13.4" rx="1.8" class="front" />
        <path d="M10.2 14.8h3.6M10.2 12.2h2.2" stroke-linecap="round" />
      </svg>
      {{ t('whoOwnsWhat.board.cardByCard') }}
    </button>
    <button
      type="button"
      class="half dark:border-line border-l-[1.5px] border-[var(--color-border)]"
      :class="{ 'is-on': modelValue === 'board' }"
      :aria-pressed="modelValue === 'board'"
      data-testid="deal-mode-board"
      @click="emit('update:modelValue', 'board')"
    >
      <svg
        class="h-[1.375rem] w-[1.375rem] flex-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <rect x="2.8" y="4.3" width="18.4" height="15.4" rx="2.4" />
        <path d="M8.2 4.3v15.4" />
        <path d="M8.2 9.5h13M8.2 14.5h13" />
        <path d="M4.6 7.4h1.8M4.6 10.2h1.8M4.6 13h1.8" />
      </svg>
      {{ t('whoOwnsWhat.pile.boardView') }}
    </button>
  </div>
</template>

<style scoped>
.half {
  --half-bg: #fff;

  align-items: center;
  background: var(--half-bg);
  color: var(--color-text-muted);
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.8125rem;
  font-weight: 600;
  gap: 0.4375rem;
  height: 2.5rem;
  padding: 0 0.875rem;
  transition: background 150ms;
}

/* Each half is rounded to the control's INNER curve (14px outer radius - 1.5px border), so
   the selected half's inset outline follows the corner instead of being clipped by it. */
.half:first-child {
  border-radius: 0.7813rem 0 0 0.7813rem;
}

.half:last-child {
  border-radius: 0 0.7813rem 0.7813rem 0;
}

.half:focus-visible {
  outline: 2px solid #aed6f1;
  outline-offset: -2px;
}

html.dark .half {
  --half-bg: var(--color-surface-raised);

  color: var(--color-ink-soft);
}

.half.is-on {
  --half-bg: color-mix(in srgb, #f15d22 8%, #fff);

  box-shadow: inset 0 0 0 1.5px #f15d22;
  color: var(--color-text);
}

html.dark .half.is-on {
  --half-bg: color-mix(in srgb, #f15d22 16%, var(--color-surface-raised));

  box-shadow: inset 0 0 0 1.5px var(--color-accent-lift);
  color: var(--color-ink);
}

.half.is-on svg {
  color: #f15d22;
}

html.dark .half.is-on svg {
  color: var(--color-accent-lift);
}

/* The front card covers the two behind it. */
.front {
  fill: var(--half-bg);
}

@media (hover: hover) {
  .half:not(.is-on):hover {
    background: var(--tint-slate-5);
  }

  html.dark .half:not(.is-on):hover {
    background: var(--color-surface-hover);
  }
}
</style>
