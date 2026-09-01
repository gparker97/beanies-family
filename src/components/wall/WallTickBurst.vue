<script setup lang="ts">
/**
 * The small celebration: beans popping out of a ticked job, and a cheer.
 *
 * Fixed-position and `pointer-events: none`, so it never blocks the next tick —
 * which matters, because the common case is a child clearing four jobs in a
 * row and the bursts overlapping.
 *
 * Suppressed entirely under reduced motion: the cheer alone still reads as
 * feedback, and this is exactly the kind of motion the preference is for.
 *
 * The cheer is offset ABOVE the tick rather than beside it. Sitting level with
 * the row put hand-written orange script directly on top of the job titles —
 * the same "celebration covers the words" problem the big shower had.
 */
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useTranslation } from '@/composables/useTranslation';
import type { WallBurst } from '@/composables/useWallBurst';

defineProps<{ bursts: WallBurst[] }>();

const { t } = useTranslation();
const { prefersReducedMotion } = useReducedMotion();
</script>

<template>
  <div class="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
    <template v-for="burst in bursts" :key="burst.id">
      <template v-if="!prefersReducedMotion">
        <span
          v-for="bean in burst.beans"
          :key="bean.id"
          class="burst-bean"
          :style="{
            left: `${burst.x}px`,
            top: `${burst.y}px`,
            '--dx': `${bean.dx}px`,
            '--r': `${bean.rotate}deg`,
            animationDelay: `${bean.delay}ms`,
          }"
        >
          {{ bean.glyph }}
        </span>
      </template>
      <span
        class="burst-cheer font-caveat text-[var(--heritage-orange)]"
        :style="{ left: `${burst.x + 26}px`, top: `${burst.y - 34}px` }"
      >
        {{ t(burst.cheerKey) }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.burst-bean {
  animation: burst-pop 1150ms cubic-bezier(0.16, 0.84, 0.44, 1) forwards;
  font-size: 1.6rem;
  line-height: 1;
  position: absolute;
}

/*
 * ONE easing curve across the whole arc.
 *
 * The previous keyframes set a position at 18% and another at 100%, so the bean
 * ran two different easing segments back to back and visibly kinked where they
 * met. Position is now interpolated once, fast out and slow in, and only the
 * opacity keys in the middle — which the eye cannot see a kink in.
 */
@keyframes burst-pop {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.5) rotate(0deg);
  }

  14% {
    opacity: 1;
  }

  70% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate(calc(var(--dx, 0px) * 2.4), -104px) scale(0.86)
      rotate(calc(var(--r, 0deg) * 2.2));
  }
}

.burst-cheer {
  animation: burst-cheer 1400ms cubic-bezier(0.2, 0.9, 0.32, 1) forwards;
  font-size: 1.9rem;
  font-weight: 700;
  position: absolute;
  white-space: nowrap;
}

/*
 * The cheer rises once, continuously. Three position keys at 20/70/100% meant it
 * sprang, then crawled, then sprang again — the "uneven" half of the complaint.
 * The overshoot now lives in the easing curve, not in a keyframe.
 */
@keyframes burst-cheer {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.86);
  }

  18% {
    opacity: 1;
  }

  72% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translateY(-30px) scale(1.02);
  }
}

@media (prefers-reduced-motion: reduce) {
  .burst-bean,
  .burst-cheer {
    animation: none;
  }
}
</style>
