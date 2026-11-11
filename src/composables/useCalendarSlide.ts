import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { useHorizontalSwipe, type PinchDirection, type SwipeSurface } from './useHorizontalSwipe';
import { useReducedMotion } from './useReducedMotion';
import { logQueueDropped, type QueueDropReason } from './swipeTelemetry';

/**
 * iOS-Calendar-style horizontal slide transition for paginated surfaces
 * (day / week / month views in the planner). Layered on top of
 * {@link useHorizontalSwipe} — that composable owns gesture detection
 * (axis lock, edge ignore, threshold, pointer capture); this one owns
 * the motion.
 *
 * Behaviour:
 *
 *  - **Live drag**: the target element follows the finger via
 *    `transform: translate3d(dx, 0, 0)`. Motion past the commit
 *    threshold is rubber-banded so the element resists infinite pulling.
 *
 *  - **Commit (released past threshold)**: a two-phase Web Animations API
 *    sequence. Phase A glides the element the rest of the way off in the
 *    finger's direction; we then call `onNext` / `onPrev` (Vue re-renders
 *    the surface with the new reference date), snap the transform to the
 *    opposite off-screen edge, and Phase B glides it back to centre. The
 *    content swap happens while the element is off-screen so the user
 *    perceives one continuous slide.
 *
 *  - **Cancel (released, or cancelled by the browser, below threshold)**: a
 *    single ease-back-to-zero spring. A browser cancel PAST the threshold
 *    commits instead; it arrives through `onSwipeLeft` / `onSwipeRight` like
 *    a release.
 *
 *  - **Reduced motion** (`prefers-reduced-motion: reduce`): no drag preview
 *    and no animation — just calls `onNext` / `onPrev` on commit, matching
 *    the pre-animation behaviour exactly.
 *
 *  - **Re-entrancy (queued page turns)**: a gesture may start while an
 *    animation is in flight (the swipe's `enabled` is only the consumer's), so
 *    the touch guard still claims it and the page does not scroll. While an
 *    animation runs, live progress is ignored: the card finishes its
 *    animation instead of following the finger, and a zero starts no
 *    spring-back. When it ends under a finger still down, the card follows
 *    from where it is, offset by the distance the finger moved meanwhile, so
 *    it never jumps. Commits asked for meanwhile add up as a signed count
 *    (next +1, prev -1, clamped to ±3): each time an animation ends one unit
 *    runs, so three quick "next" swipes turn three pages and a "next" then
 *    "prev" cancel out. If the consumer has disabled the swipe by then, a
 *    target change, or dispose, drops the whole count (and logs it).
 */

export interface UseCalendarSlideOptions {
  /** Which surface this is, passed straight through to `useHorizontalSwipe` (its telemetry). */
  name: SwipeSurface;
  /** Finger went left → user wants the next page. Fired mid-animation. */
  onNext: () => void;
  /** Finger went right → user wants the previous page. Fired mid-animation. */
  onPrev: () => void;
  /** Minimum |dx| to commit a swipe. Default 60px. */
  threshold?: number;
  /** Optional reactive flag to disable the gesture without unmounting. */
  enabled?: Ref<boolean>;
  /**
   * Optional two-finger pinch, passed straight through to `useHorizontalSwipe` (which
   * documents it). Not gated by `enabled` or by an animation in flight.
   */
  onPinch?: (dir: PinchDirection) => void;
  /**
   * Required |dx|/|dy| ratio to lock the gesture as horizontal, passed straight through to
   * `useHorizontalSwipe` (default 1.5 there). Read once at setup: keep it constant for the
   * instance. The phone month grid passes 1, so a swipe that is at least as sideways as it
   * is down turns the month.
   */
  axisLockRatio?: number;
}

/** iOS system page-transition easing: fast start, gentle settle. */
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const PHASE_OUT_MS = 220;
const PHASE_IN_MS = 320;
const SPRING_BACK_MS = 220;

/** Rubber-band damping ratio applied to drag motion past `threshold`. */
const PAST_THRESHOLD_RESISTANCE = 0.45;

/** The most page turns that can wait behind one animation, either way. */
const MAX_QUEUED = 3;

/**
 * A cancelled Web Animation rejects `finished` with an `AbortError`: expected here (dispose,
 * or a programmatic cancel), so it returns quietly. Anything else is a real failure and warns.
 */
function warnUnlessAborted(what: string, err: unknown): void {
  if ((err as { name?: unknown } | null)?.name === 'AbortError') return;
  console.warn(`[useCalendarSlide] animation ${what} failed`, err);
}

export function useCalendarSlide(
  target: Ref<HTMLElement | null>,
  options: UseCalendarSlideOptions
): void {
  const threshold = options.threshold ?? 60;
  // One reduced-motion implementation for the whole app (this composable used
  // to carry its own matchMedia copy; the guard it needed moved into the shared
  // composable when they were consolidated).
  const { prefersReducedMotion } = useReducedMotion();
  // Set synchronously by `commit` (inside onSwipeLeft/onSwipeRight, which fire BEFORE
  // useHorizontalSwipe's terminal onProgress(0) on a committed gesture) and by
  // `springBack`, so the onProgress handler ignores everything while the card animates,
  // including that terminal zero ("commit took over, leave the transform alone").
  const isAnimating = ref(false);
  /** Page turns asked for during an animation: signed (+ next, - prev); see `drainQueued`. */
  let queued = 0;
  /** Progress arrived while the card was animating, during the gesture under way. */
  let missedProgress = false;
  /** The last dx ignored during that animation: later progress is shown relative to it. */
  let ignoredDx = 0;
  /** The offset the gesture's progress is shown relative to (0 = none). */
  let rebaseDx = 0;

  function clearRebase(): void {
    missedProgress = false;
    ignoredDx = 0;
    rebaseDx = 0;
  }

  function getElement(): HTMLElement | null {
    return target.value;
  }

  function applyTransform(px: number): void {
    const el = getElement();
    if (!el) return;
    el.style.transform = px === 0 ? '' : `translate3d(${px}px, 0, 0)`;
  }

  function damp(dx: number): number {
    const sign = Math.sign(dx);
    const abs = Math.abs(dx);
    if (abs <= threshold) return dx;
    return sign * (threshold + (abs - threshold) * PAST_THRESHOLD_RESISTANCE);
  }

  function canAnimate(): boolean {
    const el = getElement();
    return !!el && typeof el.animate === 'function' && !prefersReducedMotion.value;
  }

  // Tracks the live Animation so cleanup-on-dispose can cancel it.
  let activeAnimation: Animation | null = null;

  async function runAnimation(fromPx: number, toPx: number, duration: number): Promise<void> {
    const el = getElement();
    if (!el) return;
    if (!canAnimate()) {
      applyTransform(toPx);
      return;
    }
    const animation = el.animate(
      [
        { transform: `translate3d(${fromPx}px, 0, 0)` },
        { transform: `translate3d(${toPx}px, 0, 0)` },
      ],
      { duration, easing: EASING, fill: 'forwards' }
    );
    activeAnimation = animation;
    try {
      await animation.finished;
    } catch (err) {
      // Cancelled on dispose or by a programmatic abort: an expected AbortError.
      warnUnlessAborted('finished', err);
    }
    if (activeAnimation === animation) activeAnimation = null;
    // Commit the keyframe end state to inline style + cancel the animation
    // so subsequent transforms aren't shadowed by a forwards-filled WAAPI.
    applyTransform(toPx);
    try {
      animation.cancel();
    } catch (err) {
      warnUnlessAborted('cancel', err);
    }
  }

  function turn(direction: 1 | -1): void {
    if (direction === 1) options.onNext();
    else options.onPrev();
  }

  /**
   * Turns the page, or queues the turn while an animation is in flight. Synchronous, so a
   * consumer that throws on the paths without animation fails at once rather than as an
   * unhandled rejection.
   */
  function commit(direction: 1 | -1, currentDx: number): void {
    // direction = +1 means "advance forward" (finger went left, dx negative).
    // direction = -1 means "go back" (finger went right, dx positive).
    if (isAnimating.value) {
      queued = Math.max(-MAX_QUEUED, Math.min(MAX_QUEUED, queued + direction));
      return;
    }
    clearRebase();
    // Set before anything else, so the gesture's terminal onProgress(0), which follows
    // onSwipeLeft / onSwipeRight, is ignored.
    isAnimating.value = true;

    const el = getElement();
    if (!el || !canAnimate()) {
      // No element, or reduced motion: the pre-animation behaviour (no element means nothing
      // can flash; reduced motion means no slide).
      try {
        applyTransform(0);
        turn(direction);
      } finally {
        isAnimating.value = false;
        drainQueued();
      }
      return;
    }
    void animateCommit(el, direction, currentDx);
  }

  async function animateCommit(
    el: HTMLElement,
    direction: 1 | -1,
    currentDx: number
  ): Promise<void> {
    const width = el.offsetWidth;

    try {
      // Phase A — finish the slide off-screen in the finger's direction.
      // direction=+1 (finger went left): slide to -width.
      // direction=-1 (finger went right): slide to +width.
      const outTarget = -direction * width;
      await runAnimation(currentDx, outTarget, PHASE_OUT_MS);

      // Swap content. Vue updates the same component instance with new data.
      turn(direction);

      // Snap to the opposite off-screen edge so the new content slides in
      // from the same side the old content went out (perceptually one slide).
      const inStart = direction * width;
      applyTransform(inStart);

      // Wait one animation frame so Vue's just-triggered re-render lands
      // before we kick off the inbound animation. Without this the new
      // content can flash with the old layout for one frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      // Phase B — glide in to centre.
      await runAnimation(inStart, 0, PHASE_IN_MS);
    } finally {
      isAnimating.value = false;
      drainQueued();
    }
  }

  // Only `onProgress` calls this, and only when no animation is in flight.
  async function springBack(fromDx: number): Promise<void> {
    isAnimating.value = true;
    try {
      await runAnimation(fromDx, 0, SPRING_BACK_MS);
    } finally {
      isAnimating.value = false;
      drainQueued();
    }
  }

  /** Drops every queued turn, logging how many were dropped and why. */
  function dropQueued(reason: QueueDropReason): void {
    if (queued === 0) return;
    const count = Math.abs(queued);
    queued = 0;
    logQueueDropped(options.name, reason, count);
  }

  /**
   * An animation just ended: run ONE queued page turn, from centre (the next drain takes the
   * next), unless the consumer has disabled the swipe meanwhile (then all are dropped).
   * `lastDragDx` is already 0 here: every animation starts with it at 0, and `onProgress`
   * cannot set it while one runs.
   */
  function drainQueued(): void {
    if (queued === 0) return;
    if (options.enabled?.value === false) {
      dropQueued('disabled');
      return;
    }
    const direction = queued > 0 ? 1 : -1;
    queued -= direction;
    commit(direction, 0);
  }

  // Tracks the most recent live dx so the commit handler can pick up where
  // the drag left off (useHorizontalSwipe doesn't pass dx into the commit
  // callbacks — only the direction-disambiguated onSwipeLeft / onSwipeRight).
  let lastDragDx = 0;

  useHorizontalSwipe(target, {
    name: options.name,
    threshold,
    axisLockRatio: options.axisLockRatio,
    enabled: options.enabled,
    onPinch: options.onPinch,
    onProgress: (dx) => {
      // A zero ends the gesture (or puts the finger back at its start): forget any rebase.
      if (dx === 0) clearRebase();
      // The card is animating (a commit, including the terminal zero of the gesture that
      // started it, or a spring-back): it does not follow the finger until that ends.
      if (isAnimating.value) {
        if (dx !== 0) {
          missedProgress = true;
          ignoredDx = dx;
        }
        return;
      }
      if (dx === 0) {
        // End of gesture without a commit (cancel or below threshold). Animate
        // any active drag offset back to 0. If the gesture never produced any
        // displacement (e.g. vertical-locked), this no-ops in canAnimate's
        // applyTransform shortcut.
        if (lastDragDx !== 0) {
          void springBack(lastDragDx);
          lastDragDx = 0;
        }
        return;
      }
      if (!canAnimate()) {
        // Reduced motion: don't preview the drag. The commit handlers still
        // fire, just without the slide animation.
        return;
      }
      // First progress after an animation this gesture sat through: show the finger's
      // movement from where it was when the animation ended, so the card does not jump.
      if (missedProgress) {
        rebaseDx = ignoredDx;
        missedProgress = false;
      }
      const damped = damp(dx - rebaseDx);
      lastDragDx = damped;
      applyTransform(damped);
    },
    onSwipeLeft: () => {
      const dx = lastDragDx;
      lastDragDx = 0;
      commit(1, dx);
    },
    onSwipeRight: () => {
      const dx = lastDragDx;
      lastDragDx = 0;
      commit(-1, dx);
    },
  });

  // If the target element changes (e.g. v-if remount), reset transform state
  // so the new element doesn't inherit a stale committed transform from a
  // previous element's animation. A queued turn belongs to the old element, so
  // it is dropped too; not on the first bind (null to the element, which this
  // watch also sees, a tick after mount).
  watch(target, (_el, prev) => {
    lastDragDx = 0;
    if (prev) dropQueued('target_changed');
  });

  onScopeDispose(() => {
    dropQueued('dispose');
    if (activeAnimation) {
      try {
        activeAnimation.cancel();
      } catch (err) {
        warnUnlessAborted('cancel on dispose', err);
      }
      activeAnimation = null;
    }
  });
}
