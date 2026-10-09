<script setup lang="ts">
/**
 * The small animated glyph beside a to-do bucket's heading in the wall drawer: a ringing
 * alarm clock for late, a sun for today, a ticking clock for coming up. Undated to-dos get
 * none, so the three that appear each mean something.
 *
 * Line art in `currentColor`, so the parent sets the colour for both themes. Each one moves
 * gently and rarely (the alarm shakes for under half a second every three), and all motion
 * stops under `prefers-reduced-motion`, where the alarm keeps its ring marks showing.
 * Decorative: the heading beside it already says which bucket this is.
 */
import type { WallTodoBucket } from '@/types/wall';

defineProps<{ bucket: WallTodoBucket }>();
</script>

<template>
  <svg
    v-if="bucket === 'overdue'"
    class="wall-alarm"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g class="wall-alarm-body">
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9.5V13l2.2 1.6" />
      <path d="M4.2 6.3a3 3 0 0 1 4.1-2.6" />
      <path d="M19.8 6.3a3 3 0 0 0-4.1-2.6" />
      <path d="M7.5 19.2 6 21M16.5 19.2 18 21" />
    </g>
    <path class="wall-alarm-ring" d="M1.6 11.5l-.9-.4M1.4 14.2l-1 .1" />
    <path class="wall-alarm-ring" d="M22.4 11.5l.9-.4M22.6 14.2l1 .1" />
  </svg>
  <svg
    v-else-if="bucket === 'today'"
    class="wall-sun"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path
      class="wall-sun-rays"
      d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3"
    />
    <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.25" />
  </svg>
  <svg
    v-else-if="bucket === 'upcoming'"
    class="wall-tick"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 12 9.5 13.5" />
    <path class="wall-tick-hand" d="M12 12V6.5" />
  </svg>
</template>

<style scoped>
svg {
  height: 1.5em;
  overflow: visible;
  width: 1.5em;
}

.wall-alarm-body {
  animation: wall-alarm-shake 3s ease-in-out infinite;
  transform-origin: 12px 13px;
}

.wall-alarm-ring {
  animation: wall-alarm-flash 3s ease-in-out infinite;
  opacity: 0;
}

.wall-sun-rays {
  animation:
    wall-turn 16s linear infinite,
    wall-sun-breathe 3s ease-in-out infinite;
  transform-origin: 12px 12px;
}

.wall-tick-hand {
  animation: wall-turn 10s linear infinite;
  transform-origin: 12px 12px;
}

@keyframes wall-alarm-shake {
  0%,
  70%,
  84%,
  100% {
    transform: rotate(0);
  }

  72%,
  76% {
    transform: rotate(-12deg);
  }

  74%,
  78% {
    transform: rotate(12deg);
  }

  80% {
    transform: rotate(-8deg);
  }

  82% {
    transform: rotate(8deg);
  }
}

@keyframes wall-alarm-flash {
  0%,
  70%,
  86%,
  100% {
    opacity: 0;
  }

  72%,
  82% {
    opacity: 1;
  }
}

@keyframes wall-turn {
  to {
    transform: rotate(360deg);
  }
}

@keyframes wall-sun-breathe {
  0%,
  100% {
    opacity: 0.75;
  }

  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wall-alarm-body,
  .wall-sun-rays,
  .wall-tick-hand {
    animation: none;
  }

  .wall-alarm-ring {
    animation: none;
    opacity: 1;
  }
}
</style>
