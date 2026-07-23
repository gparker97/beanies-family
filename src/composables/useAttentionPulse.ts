/**
 * Reusable "attention pulse" effect — draws the user's eye to a specific element
 * with a warm Heritage Orange glow that pulses once and fades out.
 *
 * Usage:
 *   const { pulse } = useAttentionPulse();
 *   await nextTick();
 *   pulse(myElementRef.value);                 // default 'attention-pulse'
 *   pulse(bellRef.value, 'bell-ring');          // any one-shot keyframe class
 *
 * The mechanism (remove → reflow → add → auto-remove on animationend) is a
 * generic one-shot/retriggerable class driver, so `className` is parameterised —
 * the notification bell reuses it for its arrival ring (#55).
 */
export function useAttentionPulse() {
  function pulse(el: HTMLElement | null | undefined, className = 'attention-pulse') {
    if (!el) return;
    // Remove first in case it's already animating (allows re-trigger)
    el.classList.remove(className);
    // Force reflow so re-adding the class restarts the animation
    void el.offsetWidth;
    el.classList.add(className);
    el.addEventListener('animationend', () => el.classList.remove(className), {
      once: true,
    });
  }

  return { pulse };
}
