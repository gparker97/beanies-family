/**
 * Reusable "attention pulse" effect — draws the user's eye to a specific element
 * with a warm Heritage Orange glow that pulses once and fades out.
 *
 * Usage:
 *   const { pulse } = useAttentionPulse();
 *   await nextTick();
 *   pulse(myElementRef.value);
 */
export function useAttentionPulse() {
  function pulse(el: HTMLElement | null | undefined) {
    if (!el) return;
    // Remove first in case it's already pulsing (allows re-trigger)
    el.classList.remove('attention-pulse');
    // Force reflow so re-adding the class restarts the animation
    void el.offsetWidth;
    el.classList.add('attention-pulse');
    el.addEventListener('animationend', () => el.classList.remove('attention-pulse'), {
      once: true,
    });
  }

  return { pulse };
}
