/**
 * Desktop wheel/trackpad month paging with a rubber-band "resistance then
 * turn" feel (approved mockup variant B1 —
 * `docs/mockups/calendar-continuous-months-2026-08-29.html`).
 *
 * The contract is deliberately view-agnostic: an element, its edge, and two
 * callbacks. Nothing here knows about the planner, the month grid, or the
 * reference date — the caller supplies `onNext` / `onPrev` and gates
 * `enabled` (the planner gates on `!isMobile`).
 *
 * Behaviour:
 *
 *  - **Listener placement**: `wheel` is bound to the TARGET element, not
 *    window/document, so wheel events over any other page region are
 *    structurally incapable of paging the month.
 *
 *  - **Consume condition** (both terms required): a wheel-DOWN is consumed
 *    only when the target's bottom edge is visible inside the app scroller
 *    AND the scroller is at its downward scroll limit. Mirrored for
 *    wheel-UP. Without the at-limit term, every wheel-down over the grid
 *    would page the month the moment its bottom edge scrolled into view,
 *    making the content below it unreachable. When either term fails the
 *    event is left completely untouched — no `preventDefault`, no
 *    accumulation — so ordinary scrolling proceeds.
 *
 *  - **Resistance**: while consuming, `deltaY` accumulates and the target is
 *    translated `translateY(-clamp(acc / 8, ±24px))`. An idle timeout
 *    (260ms) springs the transform back and resets the accumulator, so a
 *    half-hearted nudge never leaves the grid displaced.
 *
 *  - **Commit** at |acc| ≥ 140: a vertical two-phase slide mirroring
 *    {@link useCalendarSlide}'s pattern — phase out (220ms) in the scroll
 *    direction while fading, then `onNext`/`onPrev` (Vue re-renders), snap
 *    to the opposite offset, phase in (320ms) back to centre. A 420ms
 *    cooldown follows during which every wheel event over the target is
 *    consumed and discarded — this swallows the trackpad momentum tail so
 *    one flick is exactly one month.
 *
 *  - **Reduced motion**: no stretch, no slide. The commit still requires the
 *    same 140px of accumulation, it just swaps instantly.
 *
 *  - **Overlay guard**: inert while any modal/drawer is open
 *    (`hasOpenOverlays()`). Belt-and-braces — a listener on the grid element
 *    is already inert under a covering overlay — but it names the real
 *    ref-counted signal rather than inventing a parallel one.
 *
 *  - **Teardown**: `onScopeDispose` removes the listener, clears every
 *    timer, cancels any in-flight animation and resets the transform.
 */
import { getCurrentInstance, onMounted, onScopeDispose, watch, type Ref } from 'vue';
import { getAppScroller } from '@/utils/getAppScroller';
import { hasOpenOverlays } from '@/utils/overlayStack';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';

export interface UseWheelMonthPagingOptions {
  /** Wheeling down past the bottom edge → advance a month. */
  onNext: () => void;
  /** Wheeling up past the top edge → go back a month. */
  onPrev: () => void;
  /** Reactive gate — the caller passes `!isMobile`. Default: always on. */
  enabled?: Ref<boolean>;
}

/** iOS system page-transition easing, shared with `useCalendarSlide`. */
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const PHASE_OUT_MS = 220;
const PHASE_IN_MS = 320;
/** Momentum-tail swallow window after a commit. */
const COOLDOWN_MS = 420;
/** No wheel for this long → spring back and forget the accumulation. */
const IDLE_RESET_MS = 260;
/** Accumulated |deltaY| that turns the month. */
const COMMIT_THRESHOLD_PX = 140;
/** Rubber-band damping: pixels of stretch per pixel of wheel delta. */
const STRETCH_DIVISOR = 8;
/** Hard cap on the rubber-band displacement. */
const MAX_STRETCH_PX = 24;
/** Vertical travel of the commit slide. */
const SLIDE_PX = 40;
/** Slop for "at the scroll limit" / "edge is visible" comparisons. */
const EPSILON_PX = 2;

const SURFACE = 'calendar-nav';

export function useWheelMonthPaging(
  target: Ref<HTMLElement | null>,
  options: UseWheelMonthPagingOptions
): void {
  const { prefersReducedMotion } = useReducedMotion();

  /** Element the listener is currently bound to (null = detached). */
  let bound: HTMLElement | null = null;
  let acc = 0;
  /** True from commit start until the cooldown expires. */
  let cooling = false;
  /** True while the two-phase slide is in flight. */
  let animating = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAnimation: Animation | null = null;

  function clearIdleTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearCooldownTimer(): void {
    if (cooldownTimer !== null) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  }

  function cancelAnimation(): void {
    if (!activeAnimation) return;
    try {
      activeAnimation.cancel();
    } catch {
      // Already finished or disposed — nothing to unwind.
    }
    activeAnimation = null;
  }

  function resetTransform(el: HTMLElement | null): void {
    if (!el) return;
    el.style.transform = '';
    el.style.opacity = '';
  }

  function canAnimate(el: HTMLElement): boolean {
    return typeof el.animate === 'function' && !prefersReducedMotion.value;
  }

  /**
   * Both halves of the Pass-4 consume rule. Returns false (leave the event
   * alone) whenever the scroller cannot be resolved — never crash, never
   * hijack on a guess.
   */
  function canConsume(el: HTMLElement, dir: 1 | -1): boolean {
    const scroller = getAppScroller(el);
    if (!scroller) return false;

    const scrollerRect = scroller.getBoundingClientRect();
    const rect = el.getBoundingClientRect();

    if (dir === 1) {
      const atScrollLimit =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EPSILON_PX;
      const edgeVisible = rect.bottom <= scrollerRect.bottom + EPSILON_PX;
      return atScrollLimit && edgeVisible;
    }

    const atScrollTop = scroller.scrollTop <= EPSILON_PX;
    const edgeVisible = rect.top >= scrollerRect.top - EPSILON_PX;
    return atScrollTop && edgeVisible;
  }

  function applyStretch(el: HTMLElement): void {
    const raw = acc / STRETCH_DIVISOR;
    const stretch = Math.max(-MAX_STRETCH_PX, Math.min(MAX_STRETCH_PX, raw));
    el.style.transform = `translateY(${-stretch}px)`;
  }

  function scheduleIdleReset(el: HTMLElement): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      acc = 0;
      if (!cooling && !animating) resetTransform(el);
    }, IDLE_RESET_MS);
  }

  function startCooldown(el: HTMLElement | null): void {
    cooling = true;
    clearCooldownTimer();
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      cooling = false;
      acc = 0;
      if (!animating) resetTransform(el);
    }, COOLDOWN_MS);
  }

  /** Self-heal: whatever went wrong, drop back to a known-good resting state. */
  function recover(el: HTMLElement | null, error: unknown, detail: string): void {
    reportError({
      surface: SURFACE,
      message: 'Wheel month paging failed — resetting to a resting state',
      severity: 'warning',
      error,
      context: { action: 'wheel-page-error', detail },
    });
    cancelAnimation();
    animating = false;
    acc = 0;
    resetTransform(el);
    startCooldown(el);
  }

  async function runAnimation(
    el: HTMLElement,
    from: { transform: string; opacity: string },
    to: { transform: string; opacity: string },
    duration: number
  ): Promise<void> {
    const animation = el.animate([from, to], { duration, easing: EASING, fill: 'forwards' });
    activeAnimation = animation;
    try {
      await animation.finished;
    } catch {
      // Cancelled on dispose or superseded — both are expected outcomes.
    }
    if (activeAnimation === animation) activeAnimation = null;
    // Commit the end state to inline style so a forwards-filled WAAPI can't
    // shadow the next transform we set.
    el.style.transform = to.transform;
    el.style.opacity = to.opacity;
    try {
      animation.cancel();
    } catch {
      // Already disposed.
    }
  }

  function fire(dir: 1 | -1): void {
    if (dir === 1) options.onNext();
    else options.onPrev();
  }

  async function commit(el: HTMLElement, dir: 1 | -1): Promise<void> {
    clearIdleTimer();
    acc = 0;
    startCooldown(el);

    logEvent({
      surface: SURFACE,
      level: 'info',
      message: 'wheel month paging commit',
      context: { action: 'wheel-page-commit', detail: dir === 1 ? 'next' : 'prev' },
    });

    if (!canAnimate(el)) {
      // Reduced motion (or an environment without WAAPI): instant swap, same
      // accumulation requirement, no visual displacement left behind.
      try {
        resetTransform(el);
        fire(dir);
      } catch (error) {
        recover(el, error, 'reduced-commit');
      }
      return;
    }

    animating = true;
    try {
      // Phase A — continue off in the direction of travel while fading out.
      await runAnimation(
        el,
        { transform: el.style.transform || 'translateY(0px)', opacity: '1' },
        { transform: `translateY(${-dir * SLIDE_PX}px)`, opacity: '0' },
        PHASE_OUT_MS
      );

      // Swap content while the grid is invisible — the user perceives one
      // continuous slide.
      fire(dir);

      // Snap to the opposite offset so the new month enters from the side the
      // old one left towards.
      el.style.transform = `translateY(${dir * SLIDE_PX}px)`;
      el.style.opacity = '0';

      // One frame for Vue's re-render to land before the inbound animation.
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else resolve();
      });

      // Phase B — glide back to centre.
      await runAnimation(
        el,
        { transform: `translateY(${dir * SLIDE_PX}px)`, opacity: '0' },
        { transform: 'translateY(0px)', opacity: '1' },
        PHASE_IN_MS
      );

      animating = false;
      resetTransform(el);
    } catch (error) {
      recover(el, error, 'slide');
    }
  }

  function onWheel(event: WheelEvent): void {
    const el = target.value;
    if (!el) return;
    if (options.enabled && !options.enabled.value) return;
    if (hasOpenOverlays()) return;

    // Momentum tail / in-flight slide: swallow everything over the target so a
    // single flick can never turn two months.
    if (cooling || animating) {
      event.preventDefault();
      return;
    }

    const dir = Math.sign(event.deltaY);
    if (dir !== 1 && dir !== -1) return;

    let consumable: boolean;
    try {
      consumable = canConsume(el, dir);
    } catch (error) {
      recover(el, error, 'consume-check');
      return;
    }
    if (!consumable) {
      // Not at the edge — leave the event completely alone so the page (and
      // anything below the grid) keeps scrolling normally.
      return;
    }

    event.preventDefault();
    acc += event.deltaY;

    try {
      if (!prefersReducedMotion.value) applyStretch(el);

      if (Math.abs(acc) >= COMMIT_THRESHOLD_PX) {
        void commit(el, dir);
        return;
      }

      scheduleIdleReset(el);
    } catch (error) {
      recover(el, error, 'wheel');
    }
  }

  function attach(el: HTMLElement): void {
    if (bound === el) return;
    detach();
    el.addEventListener('wheel', onWheel, { passive: false });
    bound = el;
  }

  function detach(): void {
    if (!bound) return;
    bound.removeEventListener('wheel', onWheel);
    resetTransform(bound);
    bound = null;
  }

  function reset(): void {
    clearIdleTimer();
    clearCooldownTimer();
    cancelAnimation();
    acc = 0;
    cooling = false;
    animating = false;
  }

  function sync(): void {
    const el = target.value;
    const on = options.enabled ? options.enabled.value : true;
    if (el && on) {
      attach(el);
      return;
    }
    reset();
    detach();
  }

  // `onMounted` binds as soon as the template ref resolves (a post-flush watch
  // would not run until the next tick, leaving the first frame unbound); the
  // watch then tracks every later change to the element or the gate.
  if (getCurrentInstance()) onMounted(() => sync());
  watch(
    () => [target.value, options.enabled ? options.enabled.value : true] as const,
    () => sync(),
    { flush: 'post' }
  );

  onScopeDispose(() => {
    reset();
    detach();
  });
}
