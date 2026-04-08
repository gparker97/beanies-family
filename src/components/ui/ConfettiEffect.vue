<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Whether the confetti animation is active */
    active?: boolean;
    /** Override default brand colors */
    colors?: string[];
  }>(),
  {
    active: false,
    colors: () => ['#00b4d8', '#ffd93d', '#f15d22', '#27ae60'],
  }
);

const pieces = [
  { delay: '0s', colorIdx: 0, left: '5%' },
  { delay: '0.2s', colorIdx: 1, left: '15%' },
  { delay: '0.4s', colorIdx: 2, left: '28%' },
  { delay: '0.1s', colorIdx: 3, left: '40%' },
  { delay: '0.5s', colorIdx: 0, left: '52%' },
  { delay: '0.3s', colorIdx: 1, left: '65%' },
  { delay: '0.6s', colorIdx: 2, left: '75%' },
  { delay: '0.15s', colorIdx: 3, left: '85%' },
  { delay: '0.45s', colorIdx: 0, left: '92%', round: true },
  { delay: '0.7s', colorIdx: 1, left: '48%', round: true },
];
</script>

<template>
  <div v-if="active" class="confetti-container">
    <div
      v-for="(p, i) in pieces"
      :key="i"
      class="confetti-piece"
      :style="{
        animationDelay: p.delay,
        background: colors[p.colorIdx % colors.length],
        left: p.left,
        borderRadius: p.round ? '50%' : undefined,
      }"
    />
  </div>
</template>

<style scoped>
.confetti-container {
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
}

.confetti-piece {
  animation: confetti-fall 2s ease-out forwards;
  border-radius: 2px;
  height: 8px;
  opacity: 0;
  position: absolute;
  top: -10px;
  width: 8px;
}

@keyframes confetti-fall {
  0% {
    opacity: 1;
    transform: translateY(-20px) rotate(0deg);
  }

  100% {
    opacity: 0;
    transform: translateY(300px) rotate(720deg);
  }
}
</style>
