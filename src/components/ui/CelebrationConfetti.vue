<script setup lang="ts">
/**
 * Tier 3, entire: a low-opacity scatter of beans across a celebrating surface.
 *
 * After three cuts this is the whole treatment — a gradient border and then a bunting edge
 * were both tried and both removed (see `.is-celebration` in `style.css` for why). The
 * confetti and the corner sticker carry it, so this component IS the tier and there is
 * exactly one implementation of it.
 *
 * EVERY celebration surface renders it, dense ones included. Showing it on some cards and
 * not others read as half-finished; the count scales with area instead, so a month cell
 * holding four celebrations gets four beans each rather than twenty.
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
    /**
     * Bean count, by surface area. Density stays constant as cards grow instead of the
     * scatter thinning out on a wall card or crowding a month chip.
     */
    density?: 'month' | 'week' | 'card' | 'wall';
    /**
     * Drawers rain the beans in from above; cards settle them in place.
     *
     * A drawer is a moment you opened, so movement there means "you just arrived". Cards are
     * always on screen — a fall on every one would be the board twitching. Either way it runs
     * ONCE and stops on a static scatter; nothing loops, because the wall tablet never sleeps
     * and ambient motion in the corner of a kitchen all evening is not a celebration.
     */
    variant?: 'card' | 'drawer';
  }>(),
  { density: 'card', variant: 'card' }
);

const { prefersReducedMotion } = useReducedMotion();

/**
 * Pod order is mandated by the CIG and must never be reordered or recoloured.
 *
 * Deep Slate is lifted on dark: at #2C3E50 on a #1e293b surface a quarter of the Pod is
 * invisible, and the wall at night is the surface this tier matters most on. #4A6274 is the
 * border token the dark theme already uses, so this introduces no new value.
 */
const POD_LIGHT = ['#2C3E50', '#E67E22', '#F15D22', '#AED6F1'];
const POD_DARK = ['#4A6274', '#E67E22', '#F15D22', '#AED6F1'];

const COUNT = { month: 4, week: 8, card: 14, wall: 20 } as const;

/**
 * Fixed scatter, not `Math.random()`.
 *
 * A random layout would differ between two renders of the same card, so the same birthday
 * would visibly reshuffle on every scroll. Ordered so that truncating the list for a smaller
 * surface still leaves an even spread rather than clustering in one corner.
 */
const SCATTER = [
  [8, 18, -38],
  [46, 74, 20],
  [78, 26, -12],
  [26, 58, 46],
  [92, 62, -56],
  [16, 84, 30],
  [60, 12, -24],
  [36, 34, 64],
  [70, 88, -8],
  [4, 46, 38],
  [52, 44, -48],
  [86, 8, 16],
  [22, 8, -30],
  [64, 62, 58],
  [40, 92, -14],
  [96, 38, 42],
  [12, 66, -62],
  [74, 48, 26],
  [30, 22, -44],
  [56, 78, 50],
] as const;

/**
 * The scatter always renders; only the entrance ANIMATION is once-per-session.
 *
 * Gating the whole layer on the claim was a bug: once a card had mounted anywhere the
 * confetti was gone for the rest of the session and the card looked broken. The scatter is a
 * persistent decoration; what must not repeat is the beans arriving.
 */
const animate = ref(false);
onMounted(() => {
  animate.value = claimConfetti(props.activityId);
});

const beans = computed(() =>
  SCATTER.slice(0, COUNT[props.density]).map(([left, top, rotate], i) => ({
    i,
    left,
    top,
    rotate,
    light: POD_LIGHT[i % POD_LIGHT.length],
    dark: POD_DARK[i % POD_DARK.length],
  }))
);

/** Drawers stagger further apart, so the rain reads as falling rather than as one blink. */
const delayStep = computed(() => (props.variant === 'drawer' ? 60 : 18));
</script>

<template>
  <div class="celebration-confetti" aria-hidden="true">
    <span
      v-for="b in beans"
      :key="b.i"
      class="confetti-bean"
      :class="[
        variant === 'drawer' ? 'confetti-rain' : 'confetti-drop',
        { 'confetti-still': prefersReducedMotion || !animate },
      ]"
      :style="{
        '--bean-light': b.light,
        '--bean-dark': b.dark,
        '--bean-rotate': `${b.rotate}deg`,
        left: `${b.left}%`,
        top: `${b.top}%`,
        animationDelay: `${b.i * delayStep}ms`,
      }"
    />
  </div>
</template>

<style scoped>
/*
 * Clips itself, and inherits the card's radius so beans cannot square off the squircle.
 * `z-index: -1` inside the card's `isolation: isolate` context sits above the card's
 * background and beneath every child, so no consuming card re-indexes its content.
 */
.celebration-confetti {
  border-radius: inherit;
  inset: 0;
  opacity: 0.45;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  z-index: -1;
}

/*
 * Bean-shaped, never rectangular — the CIG's rule for every confetti surface.
 *
 * The hairline ring is what makes a bean legible on ANY member colour. Every card carries
 * its owner's wash, so an orange bean on an orange wash was invisible; a ring in the card's
 * own surface colour separates it without touching the Pod colours and without dimming the
 * wash, which would have made a birthday the least-owned card on the board.
 */
.confetti-bean {
  background: var(--bean-light);
  border-radius: 50% 50% 48% 52% / 60% 58% 42% 40%;
  box-shadow: 0 0 0 1.25px rgb(255 255 255 / 85%);
  height: 7px;
  position: absolute;
  transform: rotate(var(--bean-rotate));
  width: 10px;
}

:global(.dark) .confetti-bean {
  background: var(--bean-dark);
  box-shadow: 0 0 0 1.25px rgb(30 41 59 / 85%);
}

@media (prefers-reduced-motion: no-preference) {
  .confetti-drop:not(.confetti-still) {
    animation: confetti-drop 460ms cubic-bezier(0.2, 0.7, 0.3, 1) backwards;
  }

  .confetti-rain:not(.confetti-still) {
    animation: confetti-rain 900ms cubic-bezier(0.25, 0.65, 0.35, 1) backwards;
  }
}

/*
 * Both END on the bean's resting position and stop there — `backwards` fills the stagger
 * delay, and neither is `infinite`. Reduced motion keeps the beans and drops only the
 * movement: removing them would take the celebration away from the people who asked for
 * less motion, not less meaning.
 */
@keyframes confetti-drop {
  from {
    opacity: 0;
    transform: translateY(-10px) rotate(var(--bean-rotate)) scale(0.6);
  }
}

@keyframes confetti-rain {
  0% {
    opacity: 0;
    transform: translateY(-140%) rotate(calc(var(--bean-rotate) - 180deg));
  }

  25% {
    opacity: 1;
  }
}
</style>
