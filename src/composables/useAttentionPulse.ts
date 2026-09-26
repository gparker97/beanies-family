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

/**
 * Longer than any one-shot pulse (the longest, `attention-pulse-twice`, runs 1.6s). The class
 * comes off at this point even when `animationend` never fires: under reduced motion
 * (`animation: none`), when a more specific rule on the element owns its `animation`, or when
 * the element left the page mid-animation. A stuck class would otherwise swallow the next
 * pulse or leave a static style behind.
 */
const PULSE_FALLBACK_MS = 3000;

/**
 * One running pulse: its fallback timer and the controller that owns its `animationend`
 * listener. Exactly one of {animationend, fallback} finishes it, and finishing tears down both.
 */
interface ActivePulse {
  timer: ReturnType<typeof setTimeout>;
  listener: AbortController;
}

/**
 * The running pulse per element and class. A re-trigger finishes the old one's listener and
 * timer before starting its own, so nothing left over from an earlier pulse (a listener whose
 * fallback already fired, a timer) can end a newer one early.
 */
const activePulses = new WeakMap<HTMLElement, Map<string, ActivePulse>>();

export function useAttentionPulse() {
  function pulse(el: HTMLElement | null | undefined, className = 'attention-pulse') {
    if (!el) return;
    let running = activePulses.get(el);
    if (!running) activePulses.set(el, (running = new Map()));
    const previous = running.get(className);
    if (previous) {
      clearTimeout(previous.timer);
      previous.listener.abort();
    }

    // Remove first in case it's already animating (allows re-trigger)
    el.classList.remove(className);
    // Force reflow so re-adding the class restarts the animation
    void el.offsetWidth;
    el.classList.add(className);

    const listener = new AbortController();
    const self: ActivePulse = { listener, timer: setTimeout(() => done(), PULSE_FALLBACK_MS) };
    running.set(className, self);
    const map = running;
    function done(): void {
      // Only this pulse's own finish counts; a newer pulse has already replaced it.
      if (map.get(className) !== self) return;
      clearTimeout(self.timer);
      listener.abort();
      map.delete(className);
      el!.classList.remove(className);
    }
    el.addEventListener(
      'animationend',
      (event) => {
        // A descendant's animation bubbles here too; only the element's own ends the pulse.
        if (event.target === el) done();
      },
      { signal: listener.signal }
    );
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
