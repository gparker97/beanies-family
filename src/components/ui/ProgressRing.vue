<script setup lang="ts">
/**
 * A progress ring: arcs drawn one after another from 12 o'clock on a slate track that has its
 * own dark partner. Extracted from Who Owns What's `DeckRing` (#109) for its second use, the
 * chore stars arc (#148).
 *
 * Each segment is a share of the whole ring (0..1), drawn after the one before it:
 *  - `fill`: the brand gradient (a filled mark, the same in both themes), round caps;
 *  - `soft`: Heritage Orange, faint; `faint`: fainter still. Both lift to `accent-lift` on dark.
 * Animates up from 0 on mount; static under reduced motion.
 *
 * The default slot is the centre; the `badge` slot sits at the bottom right. The root takes the
 * size from its class, and any `role` / `aria-label` passed falls through to it.
 */
import { computed, onMounted, ref, useId } from 'vue';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';

export interface ProgressRingSegment {
  /** A share of the whole ring, 0..1 (clamped). */
  value: number;
  tone: 'fill' | 'soft' | 'faint';
}

const props = withDefaults(
  defineProps<{
    segments: readonly ProgressRingSegment[];
    /** In viewBox units (the ring is drawn in a 100 x 100 box). */
    strokeWidth?: number;
  }>(),
  { strokeWidth: 11 }
);

const gradientId = `progress-ring-${useId()}`;

/** The ring sits 2.5 units in from the box's edge, whatever its width. */
const radius = computed(() => 47.5 - props.strokeWidth / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);

/** 0 → 1, flipped after mount so the strokes transition up from nothing. */
const drawn = ref(prefersReducedMotion() ? 1 : 0);
onMounted(() => {
  if (drawn.value === 1) return;
  requestAnimationFrame(() => {
    drawn.value = 1;
  });
});

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Each segment's arc length and where it starts (the sum of those before it). A segment of zero
 * share is not drawn at all: a round-capped stroke of length 0 still paints a dot at 12 o'clock
 * (a child at 0 stars showed one). Its key is its index, so the arcs that are drawn keep theirs.
 */
const arcs = computed(() => {
  let offset = 0;
  return props.segments.flatMap((seg, i) => {
    const share = clamp01(seg.value);
    if (share <= 0) return [];
    const length = share * circumference.value * drawn.value;
    const arc = { key: i, tone: seg.tone, length, offset };
    offset += length;
    return [arc];
  });
});
</script>

<template>
  <div class="relative">
    <svg viewBox="0 0 100 100" class="h-full w-full -rotate-90" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#F15D22" />
          <stop offset="1" stop-color="#E67E22" />
        </linearGradient>
      </defs>
      <circle class="track" cx="50" cy="50" :r="radius" fill="none" :stroke-width="strokeWidth" />
      <circle
        v-for="a in arcs"
        :key="a.key"
        :class="['arc', a.tone === 'fill' ? null : a.tone]"
        cx="50"
        cy="50"
        :r="radius"
        fill="none"
        :stroke="a.tone === 'fill' ? `url(#${gradientId})` : undefined"
        :stroke-width="strokeWidth"
        :stroke-linecap="a.tone === 'fill' ? 'round' : undefined"
        :stroke-dasharray="`${a.length} ${circumference}`"
        :stroke-dashoffset="a.offset ? -a.offset : undefined"
      />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center">
      <slot />
    </div>
    <div v-if="$slots.badge" class="absolute right-0 bottom-0">
      <slot name="badge" />
    </div>
  </div>
</template>

<style scoped>
.track {
  stroke: rgb(44 62 80 / 8%);
}

html.dark .track {
  stroke: var(--color-surface-overlay);
}

.arc {
  transition:
    stroke-dasharray 0.9s cubic-bezier(0.2, 0.9, 0.3, 1),
    stroke-dashoffset 0.9s cubic-bezier(0.2, 0.9, 0.3, 1);
}

.soft {
  opacity: 0.3;
  stroke: #f15d22;
}

html.dark .soft {
  stroke: var(--color-accent-lift);
}

.faint {
  opacity: 0.12;
  stroke: #f15d22;
}

html.dark .faint {
  opacity: 0.16;
  stroke: var(--color-accent-lift);
}

@media (prefers-reduced-motion: reduce) {
  .arc {
    transition: none;
  }
}
</style>
