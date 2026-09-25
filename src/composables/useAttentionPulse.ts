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
 *
 * `reveal(el)` is the scroll-then-pulse pair for an element that may be off-screen:
 * centre it, then pulse once it has arrived. Shared by the transaction quick-link
 * picker and `useFormValidation`'s "take me to what is missing".
 */
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';

/** How long a smooth scroll takes to settle before the pulse starts, so it is seen. */
const REVEAL_PULSE_DELAY_MS = 400;

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

  /**
   * Scroll `el` into the middle of its scroller, then pulse it. Under reduced motion the
   * scroll is instant and the pulse starts at once (the pulse class itself is suppressed by
   * the reduced-motion block in `style.css`). A null element is a no-op, like `pulse`.
   */
  function reveal(el: HTMLElement | null | undefined) {
    if (!el) return;
    const reduced = prefersReducedMotion();
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    if (reduced) pulse(el);
    else setTimeout(() => pulse(el), REVEAL_PULSE_DELAY_MS);
  }

  return { pulse, reveal };
}
