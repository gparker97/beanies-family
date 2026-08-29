import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useHorizontalSwipe } from './useHorizontalSwipe';
import { useReducedMotion } from './useReducedMotion';

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
 *  - **Cancel (released below threshold or pointercancel)**: a single
 *    ease-back-to-zero spring.
 *
 *  - **Reduced motion** (`prefers-reduced-motion: reduce`): no drag preview
 *    and no animation — just calls `onNext` / `onPrev` on commit, matching
 *    the pre-animation behaviour exactly.
 *
 *  - **Re-entrancy**: `enabled` on the underlying swipe is held false
 *    while an animation is in flight, so a second gesture can't start
 *    mid-transition.
 */

export interface UseCalendarSlideOptions {
  /** Finger went left → user wants the next page. Fired mid-animation. */
  onNext: () => void;
  /** Finger went right → user wants the previous page. Fired mid-animation. */
  onPrev: () => void;
  /** Minimum |dx| to commit a swipe. Default 60px. */
  threshold?: number;
  /** Optional reactive flag to disable the gesture without unmounting. */
  enabled?: Ref<boolean>;
}

/** iOS system page-transition easing: fast start, gentle settle. */
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const PHASE_OUT_MS = 220;
const PHASE_IN_MS = 320;
const SPRING_BACK_MS = 220;

/** Rubber-band damping ratio applied to drag motion past `threshold`. */
const PAST_THRESHOLD_RESISTANCE = 0.45;

export function useCalendarSlide(
  target: Ref<HTMLElement | null>,
  options: UseCalendarSlideOptions
): void {
  const threshold = options.threshold ?? 60;
  // One reduced-motion implementation for the whole app (this composable used
  // to carry its own matchMedia copy; the guard it needed moved into the shared
  // composable when they were consolidated).
  const { prefersReducedMotion } = useReducedMotion();
  const isAnimating = ref(false);
  // Synchronous flag — set inside onSwipeLeft/onSwipeRight (which fire BEFORE
  // useHorizontalSwipe's terminal onProgress(0) on a committed gesture), so
  // our onProgress handler can distinguish "drag ended, snap back" from
  // "commit took over, leave the transform alone."
  let committing = false;

  // Compose with consumer's optional enabled flag so animation lockout and
  // consumer-side disable both gate the gesture cleanly.
  const swipeEnabled = computed(() => {
    if (isAnimating.value) return false;
    if (options.enabled && !options.enabled.value) return false;
    return true;
  });

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
    } catch {
      // Animation may be cancelled on dispose or programmatic abort — both fine.
    }
    if (activeAnimation === animation) activeAnimation = null;
    // Commit the keyframe end state to inline style + cancel the animation
    // so subsequent transforms aren't shadowed by a forwards-filled WAAPI.
    applyTransform(toPx);
    try {
      animation.cancel();
    } catch {
      // already disposed
    }
  }

  async function commit(direction: 1 | -1, currentDx: number): Promise<void> {
    // direction = +1 means "advance forward" (finger went left, dx negative).
    // direction = -1 means "go back" (finger went right, dx positive).
    if (isAnimating.value) return;
    committing = true;
    isAnimating.value = true;

    const el = getElement();
    if (!el) {
      // No element — degrade to the pre-animation behaviour (no flash possible
      // since there's nothing to render).
      if (direction === 1) options.onNext();
      else options.onPrev();
      committing = false;
      isAnimating.value = false;
      return;
    }

    if (!canAnimate()) {
      applyTransform(0);
      if (direction === 1) options.onNext();
      else options.onPrev();
      committing = false;
      isAnimating.value = false;
      return;
    }

    const width = el.offsetWidth;

    try {
      // Phase A — finish the slide off-screen in the finger's direction.
      // direction=+1 (finger went left): slide to -width.
      // direction=-1 (finger went right): slide to +width.
      const outTarget = -direction * width;
      await runAnimation(currentDx, outTarget, PHASE_OUT_MS);

      // Swap content. Vue updates the same component instance with new data.
      if (direction === 1) options.onNext();
      else options.onPrev();

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
      committing = false;
      isAnimating.value = false;
    }
  }

  async function springBack(fromDx: number): Promise<void> {
    if (isAnimating.value) return;
    isAnimating.value = true;
    try {
      await runAnimation(fromDx, 0, SPRING_BACK_MS);
    } finally {
      isAnimating.value = false;
    }
  }

  // Tracks the most recent live dx so the commit handler can pick up where
  // the drag left off (useHorizontalSwipe doesn't pass dx into the commit
  // callbacks — only the direction-disambiguated onSwipeLeft / onSwipeRight).
  let lastDragDx = 0;

  useHorizontalSwipe(target, {
    threshold,
    enabled: swipeEnabled,
    onProgress: (dx) => {
      if (committing) return;
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
      const damped = damp(dx);
      lastDragDx = damped;
      applyTransform(damped);
    },
    onSwipeLeft: () => {
      const dx = lastDragDx;
      lastDragDx = 0;
      void commit(1, dx);
    },
    onSwipeRight: () => {
      const dx = lastDragDx;
      lastDragDx = 0;
      void commit(-1, dx);
    },
  });

  // If the target element changes (e.g. v-if remount), reset transform state
  // so the new element doesn't inherit a stale committed transform from a
  // previous element's animation.
  watch(target, () => {
    lastDragDx = 0;
  });

  onScopeDispose(() => {
    if (activeAnimation) {
      try {
        activeAnimation.cancel();
      } catch {
        // already disposed
      }
      activeAnimation = null;
    }
  });
}
