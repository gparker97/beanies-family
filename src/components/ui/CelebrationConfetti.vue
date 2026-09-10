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
 * Per-piece fall.
 *
 * Deterministic from the index rather than `Math.random()`, for the same reason the scatter
 * is: two renders of the same card must not visibly differ. The variation is what stops the
 * shower reading as one rigid sheet of beans on rails, so distance, drift and duration all
 * vary out of step with each other (5, 5 and 4) rather than in lockstep.
 *
 * Distances are in PX and deliberately large. The beans start above the panel and are
 * clipped by the layer until they enter, so every one of them falls in from the top edge
 * whatever its resting position.
 */
const FALL_PX = [210, 280, 175, 320, 245] as const;
/** Cards fall a shorter way: the surface is smaller and the burst has less room. */
const CARD_FALL_PX = [96, 148, 82, 170, 120] as const;
const SWAY_PX = [-13, 9, -5, 16, -10] as const;
/**
 * Fast. A shower is a burst, not a descent — the previous 860-1180ms with a
 * decelerating ease meant the last third of every piece's journey was a crawl,
 * which is what read as "it falls, then floats".
 */
const FALL_MS = [560, 640, 500, 600] as const;

const beans = computed(() =>
  SCATTER.slice(0, COUNT[props.density]).map(([left, top, rotate], i) => ({
    i,
    left,
    top,
    rotate,
    light: POD_LIGHT[i % POD_LIGHT.length],
    dark: POD_DARK[i % POD_DARK.length],
    form: FORMS[i % FORMS.length],
    fall: (props.variant === 'drawer' ? FALL_PX : CARD_FALL_PX)[i % FALL_PX.length],
    sway: SWAY_PX[i % SWAY_PX.length],
    duration: FALL_MS[i % FALL_MS.length],
  }))
);

/**
 * Tight, so the shower lands as ONE burst rather than a trickle. Twenty pieces
 * at 14ms all start inside 266ms; at the old 45ms the last one began after the
 * first had already finished, which is a queue, not a celebration.
 */
const delayStep = computed(() => (props.variant === 'drawer' ? 14 : 10));

/**
 * Does the piece keep breathing after it lands?
 *
 * Everywhere EXCEPT a wall card. A kitchen tablet never sleeps, so an infinite
 * drift there is confetti moving in the corner of a room all evening, on every
 * celebrating card, indefinitely — plus continuous compositing on an always-on
 * device. A wall card bursts in and settles. A drawer is a surface someone
 * deliberately opened and will close, so it may keep drifting.
 */
const drifts = computed(() => props.variant === 'drawer' || props.density !== 'wall');
</script>

<template>
  <div class="celebration-confetti" :class="`is-${variant}`" aria-hidden="true">
    <span
      v-for="b in beans"
      :key="b.i"
      class="confetti-piece"
      :class="[
        `cf-${b.form}`,
        variant === 'drawer' ? 'confetti-rain' : 'confetti-drop',
        { 'confetti-still': prefersReducedMotion || !animate, 'confetti-drifts': drifts },
      ]"
      :style="{
        '--bean-light': b.light,
        '--bean-dark': b.dark,
        '--bean-rotate': `${b.rotate}deg`,
        '--bean-fall': `${b.fall}px`,
        '--bean-sway': `${b.sway}px`,
        '--fall-ms': `${b.duration}ms`,
        '--fall-delay': `${b.i * delayStep}ms`,
        '--drift-delay': `${b.i * delayStep + b.duration}ms`,
        left: `${b.left}%`,
        top: `${b.top}%`,
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
 * At the old flat 0.45 the scatter competed with the words on a card, and
 * readability beats decoration every time. Below about 0.22 it stops reading as
 * confetti and becomes dust, so 0.3 is the floor worth having.
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
 * without touching the Pod colours and without dimming the wash, which would
 * have made a birthday the least-owned card on the board.
 */
.confetti-piece {
  background: var(--bean-light);
  box-shadow: 0 0 0 1.25px rgb(255 255 255 / 85%);
  position: absolute;
  transform: rotate(var(--bean-rotate));
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

html.dark .confetti-piece {
  background: var(--bean-dark);
  box-shadow: 0 0 0 1.25px rgb(30 41 59 / 85%);
}

@media (prefers-reduced-motion: no-preference) {
  /*
   * Cards and drawers now share the burst; only the DISTANCE differs (see
   * `CARD_FALL_PX`). Keeping two class names would have implied two behaviours.
   */
  .confetti-drop:not(.confetti-still),
  .confetti-rain:not(.confetti-still) {
    animation: confetti-rain var(--fall-ms, 560ms) cubic-bezier(0.45, 0.02, 0.75, 0.35) backwards;
    animation-delay: var(--fall-delay, 0ms);
  }

  /*
   * The drift is a SECOND animation, delayed until this piece has landed. Two
   * animations on one property means the later one wins once it is running, and
   * during its delay it contributes nothing, so the fall plays untouched and the
   * drift takes over exactly on landing.
   */
  .confetti-drifts:not(.confetti-still) {
    animation:
      confetti-rain var(--fall-ms, 560ms) cubic-bezier(0.45, 0.02, 0.75, 0.35) backwards,
      confetti-drift 5600ms ease-in-out infinite;
    animation-delay: var(--fall-delay, 0ms), var(--drift-delay, 600ms);
  }
}

/*
 * GRAVITY, not a descent.
 *
 * This used to decelerate into the landing, so the last third of every piece's
 * journey was a crawl — which is exactly what a person reads as "it falls, then
 * floats". Real confetti accelerates, so the easing is ease-IN and the whole
 * fall is roughly half as long. The small overshoot at 86% is the settle: a
 * piece that stops dead at its resting position looks pinned.
 *
 * Ends explicitly on the resting transform rather than relying on the implicit
 * end state, so it cannot drift if `.confetti-piece`'s base rule changes.
 */
@keyframes confetti-rain {
  0% {
    opacity: 0;
    transform: translate3d(var(--bean-sway, 0), calc(var(--bean-fall, 240px) * -1), 0)
      rotate(calc(var(--bean-rotate) - 300deg));
  }

  6% {
    opacity: 1;
  }

  86% {
    transform: translate3d(calc(var(--bean-sway, 0px) * 0.08), 7px, 0)
      rotate(calc(var(--bean-rotate) + 14deg));
  }

  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) rotate(var(--bean-rotate));
  }
}

/*
 * After the burst, a breath. Deliberately tiny (2x3px over 5.6s): enough that a
 * celebrating card is not a still photograph, small enough that nobody reading
 * the card notices it moving.
 */
@keyframes confetti-drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0) rotate(var(--bean-rotate));
  }

  50% {
    transform: translate3d(2px, -3px, 0) rotate(calc(var(--bean-rotate) + 5deg));
  }
}
</style>
