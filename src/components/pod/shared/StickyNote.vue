<script setup lang="ts">
/**
 * Pastel-paper sticky-note card for quotes + memorable sayings.
 *
 * Uses Caveat for the body (per the CIG accent-font rule — handwritten
 * content only). Consumers pass the quote via the `text` prop and
 * optional metadata via the `footer` slot (or `footerText` prop for the
 * common "date · place" case).
 *
 * `index` lets the parent vary tilt + color deterministically across a
 * row so every note in a grid doesn't look identical. Callers that
 * don't care can omit it (falls back to 0 → no rotation, yellow).
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    text: string;
    /** Index in a collection; drives tilt + color variation. */
    index?: number;
    /** Optional trailing meta line (e.g. place, date). */
    footerText?: string;
    size?: 'sm' | 'md' | 'lg';
  }>(),
  {
    index: 0,
    footerText: '',
    size: 'md',
  }
);

// Three pastel backgrounds cycled by index — intentionally picked to
// match the mockup (`#fff7c8`, `#d4f1f4`, `#ffe4d6`).
const COLORS = ['#fff7c8', '#d4f1f4', '#ffe4d6'] as const;
// Deterministic tilt cycle — same three rotations across every row
// keep the "paper scattered on a corkboard" vibe without randomness
// (which would re-shuffle on every render).
const ROTATIONS = [-1.2, 1, -0.5] as const;

const background = computed(() => COLORS[props.index % COLORS.length]);
const rotation = computed(() => ROTATIONS[props.index % ROTATIONS.length]);

const quoteSize = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'text-sm';
    case 'lg':
      return 'text-xl';
    default:
      return 'text-base';
  }
});
</script>

<template>
  <article
    class="sticky-note relative rounded-lg shadow-[0_1px_2px_rgba(44,62,80,0.06),0_6px_20px_rgba(44,62,80,0.08)]"
    :style="{ '--sticky-paper': background, transform: `rotate(${rotation}deg)` }"
  >
    <div class="px-4 pt-3.5 pb-4">
      <blockquote
        class="text-secondary-500 dark:text-ink font-caveat leading-tight font-medium"
        :class="quoteSize"
      >
        <slot>{{ text }}</slot>
      </blockquote>
      <footer
        v-if="footerText || $slots.footer"
        class="font-outfit text-secondary-500/60 dark:text-ink-soft mt-2.5 text-[0.6875rem] font-semibold tracking-wide uppercase"
      >
        <slot name="footer">{{ footerText }}</slot>
      </footer>
    </div>
  </article>
</template>

<style scoped>
/* The pastel paper is passed in as a custom property rather than set as an
   inline `background`, because an inline background outranks every
   stylesheet rule — the note would stay pastel in dark mode while the
   quote and footer switched to light ink, which is the "white text on a
   yellow slab" defect. Routing it through a property lets the dark
   partner below win.

   Dark treatment matches `.scrap-taped` / `.bean-polaroid` in style.css:
   the paper dims to a translucent warm wash and the ink goes light, so a
   sticky note reads as paper in both themes rather than as a bright
   sticker on a dark board. */
.sticky-note {
  background: var(--sticky-paper);
}

html.dark .sticky-note {
  background: rgb(255 250 240 / 6%);
}
</style>
