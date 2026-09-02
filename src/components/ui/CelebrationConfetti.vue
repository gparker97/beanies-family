<script setup lang="ts">
/**
 * Tier 3's texture layer: a low-opacity scatter of beans across a celebrating card.
 *
 * ONE component, used by every wide celebration surface. The wash drifted across seven
 * hand-rolled call sites before the identity change consolidated it; the same thing would
 * happen to a decoration copied into three views, so this exists from the start.
 *
 * WIDE SURFACES ONLY. A month chip or a week-grid block is too small for a scatter to read
 * as anything but noise, and a month cell can hold four celebrations at once. Those
 * surfaces get the bunting edge (`.is-celebration::before`) and nothing else — which is
 * exactly why the bunting, not the confetti, is the universal marker.
 *
 * Clips ITSELF rather than relying on the card: the corner sticker sits outside the card's
 * box, so `.is-celebration` cannot be `overflow: hidden`.
 */
import { computed, onMounted, ref } from 'vue';
import { claimConfetti } from '@/composables/useCelebrationSeen';
import { useReducedMotion } from '@/composables/useReducedMotion';

const props = withDefaults(
  defineProps<{
    /** The activity this belongs to — the key for the once-per-session claim. */
    activityId: string;
    /** Bean count. Scales with the surface so density stays constant as width grows. */
    density?: 'card' | 'wall';
  }>(),
  { density: 'card' }
);

const { prefersReducedMotion } = useReducedMotion();

/**
 * Pod order is mandated by the CIG and must never be reordered or recoloured.
 *
 * Deep Slate is lifted on dark: at #2C3E50 on a #1e293b surface a quarter of the Pod is
 * invisible, and the wall at night is the surface this tier matters most on. #4A6274 is
 * the border token the dark theme already uses, so this introduces no new value.
 */
const POD_LIGHT = ['#2C3E50', '#E67E22', '#F15D22', '#AED6F1'];
const POD_DARK = ['#4A6274', '#E67E22', '#F15D22', '#AED6F1'];

/**
 * Fixed scatter, not `Math.random()`.
 *
 * A random layout would differ between two renders of the same card — and, worse, between
 * a server-free re-mount and its predecessor — so the same birthday would visibly reshuffle
 * on every scroll. These offsets are hand-placed to avoid the title's left edge and the
 * sticker's corner.
 */
const SCATTER = [
  [3, 12, -38],
  [11, 62, 20],
  [18, 28, -12],
  [25, 78, 46],
  [32, 40, -56],
  [39, 8, 30],
  [46, 70, -24],
  [53, 34, 64],
  [60, 84, -8],
  [67, 18, 38],
  [74, 56, -48],
  [81, 26, 16],
  [88, 72, -30],
  [94, 44, 58],
  [7, 88, -14],
  [43, 92, 42],
  [22, 4, -62],
  [57, 2, 26],
  [85, 6, -44],
  [70, 96, 50],
] as const;

/** Confetti plays ONCE per activity per session — see `useCelebrationSeen`. */
const show = ref(false);
onMounted(() => {
  show.value = claimConfetti(props.activityId);
});

const beans = computed(() => {
  const count = props.density === 'wall' ? SCATTER.length : 14;
  return SCATTER.slice(0, count).map(([left, top, rotate], i) => ({
    i,
    left,
    top,
    rotate,
    light: POD_LIGHT[i % POD_LIGHT.length],
    dark: POD_DARK[i % POD_DARK.length],
  }));
});
</script>

<template>
  <div v-if="show" class="celebration-confetti" aria-hidden="true">
    <span
      v-for="b in beans"
      :key="b.i"
      class="confetti-bean"
      :class="{ 'confetti-still': prefersReducedMotion }"
      :style="{
        '--bean-light': b.light,
        '--bean-dark': b.dark,
        left: `${b.left}%`,
        top: `${b.top}%`,
        transform: `rotate(${b.rotate}deg)`,
        animationDelay: `${b.i * 18}ms`,
      }"
    />
  </div>
</template>

<style scoped>
/*
 * Clips itself, and inherits the card's radius so beans cannot square off the squircle.
 * `z-index: 1` keeps it under the card's own content (`z-index: 2`) and under the sticker.
 */
.celebration-confetti {
  border-radius: inherit;
  inset: 0;
  opacity: 0.35;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  z-index: 1;
}

/* Bean-shaped, never rectangular — the CIG's rule for every confetti surface. */
.confetti-bean {
  background: var(--bean-light);
  border-radius: 50% 50% 48% 52% / 60% 58% 42% 40%;
  height: 7px;
  position: absolute;
  width: 10px;
}

:global(.dark) .confetti-bean {
  background: var(--bean-dark);
}

@media (prefers-reduced-motion: no-preference) {
  .confetti-bean:not(.confetti-still) {
    animation: confetti-settle 460ms cubic-bezier(0.2, 0.7, 0.3, 1) backwards;
  }
}

/*
 * Reduced motion keeps the beans and drops only the movement. Removing them entirely would
 * take the celebration away from the people most likely to have asked for less motion, not
 * less meaning.
 */
@keyframes confetti-settle {
  from {
    opacity: 0;
    transform: translateY(-10px) scale(0.6);
  }
}
</style>
