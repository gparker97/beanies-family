import { ref, watch, type Ref } from 'vue';
import { useReducedMotion } from './useReducedMotion';

export function useCountUp(target: Ref<number>, delay = 0, duration = 600) {
  const displayValue = ref(0);
  const { prefersReducedMotion } = useReducedMotion();

  let rafId: number | null = null;

  function animate(from: number, to: number) {
    if (rafId !== null) cancelAnimationFrame(rafId);

    if (prefersReducedMotion.value) {
      displayValue.value = to;
      return;
    }

    const start = performance.now() + delay;

    function step(now: number) {
      const elapsed = now - start;
      if (elapsed < 0) {
        rafId = requestAnimationFrame(step);
        return;
      }

      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      displayValue.value = from + (to - from) * eased;

      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        displayValue.value = to;
        rafId = null;
      }
    }

    rafId = requestAnimationFrame(step);
  }

  watch(
    target,
    (newVal, oldVal) => {
      animate(oldVal ?? 0, newVal);
    },
    { immediate: true }
  );

  return { displayValue };
}
