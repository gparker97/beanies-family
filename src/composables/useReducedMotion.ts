import { ref, onMounted, onUnmounted } from 'vue';

export function useReducedMotion() {
  const prefersReducedMotion = ref(false);
  let mql: MediaQueryList | null = null;

  function update() {
    prefersReducedMotion.value = mql?.matches ?? false;
  }

  onMounted(() => {
    mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.value = mql.matches;
    mql.addEventListener('change', update);
  });

  onUnmounted(() => {
    mql?.removeEventListener('change', update);
  });

  return { prefersReducedMotion };
}
