import { ref, onMounted, onUnmounted, type Ref } from 'vue';

/**
 * Reactive "is this device touch-primary?" — true on phones and tablets
 * where touch is the primary input, false on laptops and desktops (even
 * those with touchscreens, because the trackpad/mouse is the primary
 * pointer). Used to gate mobile-only affordances like the in-form camera
 * button without resorting to user-agent sniffing.
 *
 * Updates reactively if the pointer capability changes (e.g. iPad docked
 * into a keyboard, external monitor plugged into a laptop).
 */
export function useIsTouchPrimary(): Ref<boolean> {
  const isTouchPrimary = ref(false);

  let mq: MediaQueryList | null = null;
  function onChange(e: MediaQueryListEvent | MediaQueryList): void {
    isTouchPrimary.value = e.matches;
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    mq = window.matchMedia('(pointer: coarse)');
    isTouchPrimary.value = mq.matches;
    mq.addEventListener('change', onChange);
  });

  onUnmounted(() => {
    mq?.removeEventListener('change', onChange);
    mq = null;
  });

  return isTouchPrimary;
}
