<script setup lang="ts">
/**
 * Tier 3, entire: a low-opacity scatter of confetti across a celebrating surface.
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

/**
 * Four confetti forms, mixed.
 *
 * These used to be one bean-shaped blob, on the strength of a docblock claiming
 * "the CIG's rule for every confetti surface". No such rule exists. What the CIG
 * actually mandates about beans is the Pod's Golden Rule — the four of them must
 * never be recoloured, reordered or SEPARATED, "the beanies must always hold
 * hands" — which if anything argues against scattering twenty separated beans
 * across a card. The Pod stays the Pod; this borrows its four colours, in order,
 * without each fleck pretending to be a bean.
 *
 * And at 10x7px a bean has about seventy pixels and no room for the notch that
 * makes it a bean, so it landed as a generic blob that read as neither. The
 * VARIETY is what makes confetti legible at this size: rectangles, strips,
 * curls and discs together are a thing nothing else looks like.
 */
const FORMS = ['rect', 'strip', 'curl', 'disc'] as const;

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
 * The scatter always renders; only the entrance ANIMATION is rationed.
 *
 * Gating the whole layer on the claim was a bug: once a card had mounted anywhere the
 * confetti was gone for the rest of the session and the card looked broken. The scatter is a
 * persistent decoration; what must not repeat is the beans arriving.
 *
 * A DRAWER NEVER CLAIMS. The claim exists because cards re-mount constantly — the planner
 * re-keys on navigation, long lists virtualise, the wall repaints at day rollover — so
 * without it a birthday would twitch every time it scrolled back into view. None of that is
 * true of a drawer: it mounts only because someone just opened it, which is the whole reason
 * the drawer variant rains rather than settles.
 *
 * Sharing one activity-keyed claim across both meant the drawer could essentially NEVER
 * animate. You reach a drawer by tapping the chip, the chip mounted first and spent the
 * claim, so the panel that was designed to rain opened on a static scatter every time.
 * `||` short-circuits, so a drawer does not spend a card's claim either.
 */
const animate = ref(false);
onMounted(() => {
  animate.value = props.variant === 'drawer' || claimConfetti(props.activityId);
});

/**
 * The popper's throw, per piece. Deterministic from the index rather than
 * `Math.random()`, for the same reason the scatter is: two renders of the same
 * surface must not visibly differ.
 */
const APEX_PCT = [-48, -74, -58, -86, -64, -80] as const;
const REST_PX = [0, 5, 2, 8, 3, 6] as const;
const BURST_MS = [1280, 1520, 1380, 1700, 1440, 1600] as const;
const SPIN_DEG = [340, 620, 480, 880, 400, 720] as const;
const THROW_DELAY_MS = [0, 40, 90, 25, 140, 65] as const;

/** How many pieces the popper fires. A card never fires: it has no floor. */
const BURST_COUNT = 24;

/**
 * The popper: pieces leave ONE bottom corner, arc across, and land on the floor.
 *
 * This replaces a fall onto fixed scatter positions spread from 8% to 92% down
 * the panel — which meant the pieces stopped IN MID-AIR, and no amount of easing
 * could make that look natural, because nothing stops halfway down. Landing on a
 * floor is what makes it read as confetti.
 *
 * The landing spread is index-based so the pile lays ALONG the floor rather than
 * heaping where a hash happened to cluster, and it reaches both edges even on a
 * panel as wide as the wall's drawer.
 */
const burst = computed(() =>
  Array.from({ length: BURST_COUNT }, (_, i) => {
    const slot = (i / BURST_COUNT) * 92 + 3;
    return {
      i,
      form: FORMS[i % FORMS.length],
      light: POD_LIGHT[i % POD_LIGHT.length],
      dark: POD_DARK[i % POD_DARK.length],
      land: Math.round(slot + (i % 3) - 1),
      apex: APEX_PCT[i % APEX_PCT.length],
      rest: REST_PX[i % REST_PX.length],
      duration: BURST_MS[i % BURST_MS.length],
      spin: SPIN_DEG[i % SPIN_DEG.length] * (i % 2 ? 1 : -1),
      delay: THROW_DELAY_MS[i % THROW_DELAY_MS.length],
    };
  })
);

/**
 * The quiet scatter. On a card this is the WHOLE treatment; in a drawer it
 * arrives after the popper has finished, so the burst is the event and this is
 * what it leaves behind.
 */
const ambient = computed(() =>
  SCATTER.slice(0, COUNT[props.density]).map(([left, top, rotate], i) => ({
    i,
    left,
    top,
    rotate,
    light: POD_LIGHT[i % POD_LIGHT.length],
    dark: POD_DARK[i % POD_DARK.length],
    form: FORMS[i % FORMS.length],
  }))
);

/** A drawer's scatter waits for the floor to settle; a card's arrives at once. */
const ambientStart = computed(() => (props.variant === 'drawer' ? 1450 : 0));

/**
 * Does the piece keep breathing once it has arrived?
 *
 * Everywhere EXCEPT a wall card. A kitchen tablet never sleeps, so an infinite
 * drift there is confetti moving in the corner of a room all evening, on every
 * celebrating card, indefinitely — plus continuous compositing on an always-on
 * device. A drawer is a surface someone deliberately opened and will close, so
 * it may keep drifting.
 */
const drifts = computed(() => props.variant === 'drawer' || props.density !== 'wall');

/** The popper is pure motion, so reduced motion gets the scatter and nothing else. */
const showBurst = computed(
  () => props.variant === 'drawer' && animate.value && !prefersReducedMotion.value
);
</script>

<template>
  <div class="celebration-confetti" :class="`is-${variant}`" aria-hidden="true">
    <!--
      THE POPPER. Three nested boxes per piece, and the nesting is the point:
      horizontal and vertical need DIFFERENT easing (drag going out, gravity
      coming down), and one transform cannot carry two curves. That is exactly
      why the previous version could only ever travel in a straight line.
    -->
    <template v-if="showBurst">
      <span
        v-for="p in burst"
        :key="`b${p.i}`"
        class="cf-x"
        :style="{
          '--land': `${p.land}%`,
          '--dur': `${p.duration}ms`,
          '--delay': `${p.delay}ms`,
        }"
      >
        <span class="cf-y" :style="{ '--apex': `${p.apex}%` }">
          <span class="cf-p" :style="{ '--rest': `${p.rest}px`, '--spin': `${p.spin}deg` }">
            <i
              :class="`cf-${p.form}`"
              :style="{ '--bean-light': p.light, '--bean-dark': p.dark }"
            />
          </span>
        </span>
      </span>
    </template>

    <!-- what the celebration leaves behind, and a card's whole treatment -->
    <span
      v-for="a in ambient"
      :key="`a${a.i}`"
      class="confetti-piece"
      :class="[
        `cf-${a.form}`,
        { 'confetti-still': prefersReducedMotion || !animate, 'confetti-drifts': drifts },
      ]"
      :style="{
        '--bean-light': a.light,
        '--bean-dark': a.dark,
        '--bean-rotate': `${a.rotate}deg`,
        '--in-delay': `${ambientStart + a.i * 45}ms`,
        '--drift-delay': `${ambientStart + a.i * 45 + 700}ms`,
        left: `${a.left}%`,
        top: `${a.top}%`,
      }"
    />
  </div>
</template>

<style scoped>
/*
 * Clips itself, and inherits the card's radius so pieces cannot square off the squircle.
 * `z-index: -1` inside the card's `isolation: isolate` context sits above the card's
 * background and beneath every child, so no consuming card re-indexes its content.
 */
.celebration-confetti {
  border-radius: inherit;
  inset: 0;
  opacity: var(--confetti-opacity);
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  z-index: -1;
}

/*
 * A card carries text; a drawer is mostly space.
 *
 * At a flat 0.45 the scatter competed with the words on a card, and readability
 * beats decoration every time. Below about 0.22 it stops reading as confetti and
 * becomes dust, so 0.3 is the floor worth having.
 */
.celebration-confetti.is-card {
  --confetti-opacity: 0.3;
}

.celebration-confetti.is-drawer {
  --confetti-opacity: 0.45;
}

/*
 * Four forms. The hairline ring is what makes a piece legible on ANY member
 * colour: every card carries its owner's wash, so an orange piece on an orange
 * wash was invisible. A ring in the card's own surface colour separates it
 * without touching the Pod colours and without dimming the wash.
 */
.cf-rect,
.cf-strip,
.cf-curl,
.cf-disc {
  background: var(--bean-light);
  box-shadow: 0 0 0 1.25px rgb(255 255 255 / 85%);
  display: block;
}

.cf-rect {
  border-radius: 1px;
  height: 4px;
  width: 9px;
}

.cf-strip {
  border-radius: 1px;
  height: 9px;
  width: 3px;
}

/* a curled streamer: two opposite corners rounded hard, two square */
.cf-curl {
  border-radius: 60% 0;
  height: 8px;
  width: 8px;
}

.cf-disc {
  border-radius: 50%;
  height: 6px;
  width: 6px;
}

html.dark .cf-rect,
html.dark .cf-strip,
html.dark .cf-curl,
html.dark .cf-disc {
  background: var(--bean-dark);
  box-shadow: 0 0 0 1.25px rgb(30 41 59 / 85%);
}

/* ── the popper ─────────────────────────────────────────────────────────── */

/*
 * Both wrappers fill the container, which is what makes their percentages mean
 * "of the panel" rather than "of a 9px piece" — the unit mistake that once
 * turned a fall from above into a 10px nudge.
 */
.cf-x,
.cf-y {
  inset: 0;
  position: absolute;
}

.cf-p {
  bottom: var(--rest, 0);
  left: 0;
  position: absolute;
}

.confetti-piece {
  position: absolute;
  transform: rotate(var(--bean-rotate));
}

@media (prefers-reduced-motion: no-preference) {
  /* out: fast at first, then dragging to a stop, like something thrown */
  .cf-x {
    animation: cf-fly-x var(--dur) cubic-bezier(0.12, 0.72, 0.35, 1) both;
    animation-delay: var(--delay);
  }

  /* up, then down: the two halves carry their own easing inside the keyframes */
  .cf-y {
    animation: cf-fly-y var(--dur) both;
    animation-delay: var(--delay);
  }

  .cf-p {
    animation: cf-spin var(--dur) linear both;
    animation-delay: var(--delay);
  }

  .confetti-piece:not(.confetti-still) {
    animation: cf-arrive 800ms ease-out backwards;
    animation-delay: var(--in-delay, 0ms);
  }

  .confetti-piece.confetti-drifts:not(.confetti-still) {
    animation:
      cf-arrive 800ms ease-out backwards,
      cf-drift 5600ms ease-in-out infinite;
    animation-delay: var(--in-delay, 0ms), var(--drift-delay, 800ms);
  }
}

@keyframes cf-fly-x {
  from {
    transform: translateX(-3%);
  }

  to {
    transform: translateX(var(--land));
  }
}

@keyframes cf-fly-y {
  0% {
    animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
    transform: translateY(0);
  }

  38% {
    animation-timing-function: cubic-bezier(0.5, 0, 0.85, 0.6);
    transform: translateY(var(--apex));
  }

  100% {
    transform: translateY(0);
  }
}

@keyframes cf-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(var(--spin));
  }
}

/*
 * The scatter does not fall. It fades up where it sits, after the floor has
 * settled, so the popper is the event and this is the residue.
 */
@keyframes cf-arrive {
  from {
    opacity: 0;
    transform: rotate(var(--bean-rotate)) scale(0.4);
  }

  to {
    opacity: 1;
    transform: rotate(var(--bean-rotate)) scale(1);
  }
}

/*
 * A breath. Deliberately tiny (2x3px over 5.6s): enough that a celebrating card
 * is not a still photograph, small enough that nobody reading it notices.
 */
@keyframes cf-drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0) rotate(var(--bean-rotate));
  }

  50% {
    transform: translate3d(2px, -3px, 0) rotate(calc(var(--bean-rotate) + 5deg));
  }
}
</style>
