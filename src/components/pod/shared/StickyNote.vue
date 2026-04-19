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
    class="relative rounded-lg shadow-[0_1px_2px_rgba(44,62,80,0.06),0_6px_20px_rgba(44,62,80,0.08)]"
    :style="{ background, transform: `rotate(${rotation}deg)` }"
  >
    <div class="px-4 pt-3.5 pb-4">
      <blockquote
        class="text-secondary-500 font-caveat leading-tight font-medium"
        :class="quoteSize"
      >
        <slot>{{ text }}</slot>
      </blockquote>
      <footer
        v-if="footerText || $slots.footer"
        class="font-outfit text-secondary-500/60 mt-2.5 text-[11px] font-semibold tracking-wide uppercase"
      >
        <slot name="footer">{{ footerText }}</slot>
      </footer>
    </div>
  </article>
</template>
