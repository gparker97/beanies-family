<script setup lang="ts">
/**
 * The weekly reward's one-time burst (#154): the reward's own picture pops up and rises from the
 * child's lane (or their day head) with a shower of stars, while the "Ice Cream earned!" banner is
 * up. CSS only, decorative (`aria-hidden`), never takes a tap.
 *
 * Drawn by each reward banner host beside its `CelebrationBanner`, from the same
 * `rewardBannerFor(member)` it already reads, keyed on the banner's `id` by the host. It is NOT a
 * variant of `ChoreCelebration` (that one is keyed per block and anchored to a chore block, and
 * its map is what the reward waits on). No timer of the reward's own lives here: the banner's
 * timer in `useCelebration` ends it.
 *
 *  - `calm` (reduced motion): nothing is drawn; the banner alone is the moment.
 *  - It times itself from `banner.startedAt`: once `REWARD_BURST_MS` has passed it renders
 *    nothing (the picture's animation runs for the same constant, handed to the CSS as
 *    `--burst-ms`, so the two cannot drift), and a host remounted part-way through (the banner
 *    map outlives a route change) picks the burst up where it was (a negative animation delay)
 *    instead of restarting it.
 *
 * It fills its host's positioned box (`absolute inset-0`) and relies on the host to clip it: the
 * wall lane is `overflow-hidden` and carries `data-celebration-clip`.
 *
 * Dark mode: emoji glyphs only, nothing painted, so nothing changes between themes.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { REWARD_BURST_MS, type ActiveRewardBanner } from '@/composables/useCelebration';

const props = defineProps<{
  banner: Pick<ActiveRewardBanner, 'id' | 'emoji' | 'calm' | 'startedAt'>;
}>();

/** Where each star flies to from the picture, in rem, and its delay (a ring of ten). */
const STARS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
  const reach = i % 2 ? 4.5 : 6;
  return {
    i,
    glyph: i % 3 === 0 ? '✨' : '⭐',
    dx: `${(Math.cos(angle) * reach).toFixed(2)}rem`,
    dy: `${(Math.sin(angle) * reach * 0.8).toFixed(2)}rem`,
    delay: 120 + (i % 4) * 60,
  };
});

/** Ms since the banner started, read once at mount (a remount resumes from here). */
const elapsed = Math.max(0, performance.now() - props.banner.startedAt);
const playing = ref(!props.banner.calm && elapsed < REWARD_BURST_MS);
let timer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  if (playing.value) timer = setTimeout(() => (playing.value = false), REWARD_BURST_MS - elapsed);
});
onBeforeUnmount(() => {
  if (timer !== null) clearTimeout(timer);
});

const offset = computed(() => `-${Math.round(elapsed)}ms`);
/** The picture's animation length: `REWARD_BURST_MS`, the one source the unmount timer reads too. */
const duration = `${REWARD_BURST_MS}ms`;
</script>

<template>
  <div
    v-if="playing"
    class="reward-burst pointer-events-none absolute inset-0"
    :style="{ '--burst-offset': offset, '--burst-ms': duration }"
    aria-hidden="true"
    data-testid="reward-burst"
    :data-banner-id="banner.id"
  >
    <span class="reward-burst-origin">
      <span
        v-for="s in STARS"
        :key="s.i"
        class="reward-burst-star text-lg"
        :style="{ '--dx': s.dx, '--dy': s.dy, '--delay': `${s.delay}ms` }"
        >{{ s.glyph }}</span
      >
      <span class="reward-burst-prize text-4xl" data-testid="reward-burst-prize">{{
        banner.emoji
      }}</span>
    </span>
  </div>
</template>

<style scoped>
/* Geometry only: the picture and the stars start a little below the top of the host's box. */
.reward-burst {
  z-index: 5;
}

.reward-burst-origin {
  left: 50%;
  position: absolute;
  top: min(40%, 8rem);
}

.reward-burst-prize,
.reward-burst-star {
  left: 0;
  line-height: 1;
  opacity: 0;
  position: absolute;
  top: 0;
  transform: translate(-50%, -50%);
}

/* Motion only when it is welcome (a calm banner draws none of this anyway). */
@media (prefers-reduced-motion: no-preference) {
  .reward-burst-prize {
    animation: reward-rise var(--burst-ms) cubic-bezier(0.2, 0.9, 0.3, 1) both;
    animation-delay: var(--burst-offset, 0ms);
    filter: drop-shadow(0 0.25rem 0.5rem rgb(44 62 80 / 30%));
  }

  .reward-burst-star {
    animation: reward-star 1.6s ease-out both;
    animation-delay: calc(var(--delay, 0ms) + var(--burst-offset, 0ms));
  }
}

@keyframes reward-rise {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.2) rotate(-25deg);
  }

  18% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.5) rotate(8deg);
  }

  32% {
    transform: translate(-50%, -60%) scale(1.2) rotate(-4deg);
  }

  80% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate(-50%, -260%) scale(1) rotate(0deg);
  }
}

@keyframes reward-star {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.3);
  }

  20% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1.1) rotate(160deg);
  }
}
</style>
