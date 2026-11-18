<script setup lang="ts">
/**
 * The weekly reward, reached (#154): a full-width celebration at the top of a child's stars on the
 * wall. The reward's own picture, big, on a white tile tilted on the brand gradient, with confetti
 * and sparkles, "{reward} earned!" and the line with the day. It shows every time the sheet is
 * opened that week (it is a state, not an event); the one-time moment is the burst on the lane.
 *
 * Presentational: the words come in translated. The picture, the confetti and the sparkles are
 * decorative (`aria-hidden`); the title and the line are read. The tile pops in and the sparkles
 * twinkle only for someone who has not asked for reduced motion.
 *
 * Dark mode: a filled mark, the same in both themes, like a filled button: the Heritage Orange to
 * Terracotta gradient (utilities, so no dark partner is needed) with white ink; the prize tile is
 * white in both themes (it is part of the mark, on the gradient, never on a dark surface); the
 * confetti dots are fixed brand tints on the gradient.
 */
defineProps<{
  /** The reward's own emoji. */
  emoji: string;
  /** "Ice Cream earned!" */
  title: string;
  /** "Mia reached the weekly reward on Thursday with 18 stars." ('' to leave it out.) */
  line: string;
}>();

/** Confetti dots on the gradient: where each sits, its size class, and its tint. */
const CONFETTI = [
  { left: '8%', top: '22%', size: 'h-2 w-2', tint: 'bg-white' },
  { left: '21%', top: '78%', size: 'h-2.5 w-2.5', tint: 'bg-[#AED6F1]' },
  { left: '37%', top: '12%', size: 'h-1.5 w-1.5', tint: 'bg-[#FFE9A8]' },
  { left: '55%', top: '86%', size: 'h-1.5 w-1.5', tint: 'bg-white' },
  { left: '68%', top: '18%', size: 'h-2 w-2', tint: 'bg-[#AED6F1]' },
  { left: '82%', top: '70%', size: 'h-2.5 w-2.5', tint: 'bg-[#FFE9A8]' },
  { left: '93%', top: '30%', size: 'h-2 w-2', tint: 'bg-white' },
  { left: '47%', top: '44%', size: 'h-1 w-1', tint: 'bg-white' },
] as const;
</script>

<template>
  <div
    class="from-primary-500 to-terracotta-400 relative flex flex-wrap items-center gap-5 overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-[0_0.75rem_2rem_rgb(241_93_34/35%)]"
    data-testid="reward-earned-banner"
  >
    <span
      v-for="(dot, i) in CONFETTI"
      :key="i"
      class="pointer-events-none absolute rounded-full"
      :class="[dot.size, dot.tint]"
      :style="{ left: dot.left, top: dot.top }"
      aria-hidden="true"
    />
    <span class="reward-spark reward-spark-a text-2xl" aria-hidden="true">✨</span>
    <span class="reward-spark reward-spark-b text-3xl" aria-hidden="true">🎉</span>
    <span class="reward-spark reward-spark-c text-xl" aria-hidden="true">⭐</span>

    <span
      class="reward-prize relative grid h-24 w-24 flex-none place-items-center rounded-[1.75rem] bg-white text-4xl leading-none shadow-[0_0.5rem_1.25rem_rgb(44_62_80/25%)]"
      aria-hidden="true"
      data-testid="reward-earned-emoji"
      >{{ emoji
      }}<span class="absolute -top-3 -right-3 rotate-[18deg] text-2xl leading-none">⭐</span></span
    >
    <div class="relative flex min-w-0 flex-[1_1_14rem] flex-col gap-1">
      <p class="font-outfit text-3xl leading-tight font-extrabold text-balance">{{ title }}</p>
      <p v-if="line" class="font-outfit text-base font-semibold">{{ line }}</p>
    </div>
  </div>
</template>

<style scoped>
/* Geometry and motion only: the paint is the utilities above. */
.reward-prize {
  transform: rotate(-6deg);
}

.reward-spark {
  line-height: 1;
  position: absolute;
}

.reward-spark-a {
  left: 42%;
  top: 0.5rem;
}

.reward-spark-b {
  bottom: 0.75rem;
  right: 1.25rem;
}

.reward-spark-c {
  bottom: 0.5rem;
  left: 1rem;
}

@media (prefers-reduced-motion: no-preference) {
  .reward-prize {
    animation: reward-pop 0.7s cubic-bezier(0.2, 1.6, 0.4, 1) both;
  }

  .reward-spark {
    animation: reward-twinkle 1.8s ease-in-out infinite alternate;
  }

  .reward-spark-b {
    animation-delay: 0.5s;
  }

  .reward-spark-c {
    animation-delay: 0.9s;
  }
}

@keyframes reward-pop {
  0% {
    transform: scale(0.3) rotate(-30deg);
  }

  100% {
    transform: scale(1) rotate(-6deg);
  }
}

@keyframes reward-twinkle {
  0% {
    opacity: 0.6;
    transform: scale(0.8) rotate(-8deg);
  }

  100% {
    opacity: 1;
    transform: scale(1.15) rotate(8deg);
  }
}
</style>
