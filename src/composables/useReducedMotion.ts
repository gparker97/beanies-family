import { ref, onMounted, onUnmounted } from 'vue';

export function useReducedMotion() {
  const prefersReducedMotion = ref(false);
  let mql: MediaQueryList | null = null;

  function update() {
    prefersReducedMotion.value = mql?.matches ?? false;
  }

  onMounted(() => {
    // matchMedia is unavailable in some test environments (jsdom without a
    // stub) — treat absence as "no preference set" (animations on) rather than
    // throwing on mount. This guard moved here from `useCalendarSlide`'s
    // hand-rolled copy when the two were consolidated.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.value = mql.matches;
    mql.addEventListener('change', update);
  });

  onUnmounted(() => {
    mql?.removeEventListener('change', update);
  });

  return { prefersReducedMotion };
}
