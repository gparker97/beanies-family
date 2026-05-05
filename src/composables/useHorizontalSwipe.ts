import { onMounted, onScopeDispose, watch, type Ref } from 'vue';

/**
 * Detects horizontal swipe gestures on a target element using Pointer Events
 * (so it works for touch, pen, AND mouse drag uniformly across PWA + browser).
 *
 * Three guardrails make the gesture safe to ship next to native scroll:
 *
 * 1. **Axis lock** — the gesture only commits if the user's first ~8px of
 *    movement is clearly horizontal (|dx| > axisLockRatio * |dy|). A diagonal
 *    or vertical motion is silently released so native vertical scroll keeps
 *    working. The consumer should set `touch-action: pan-y` on the target so
 *    the browser doesn't pre-empt horizontal scrolls before we get a chance
 *    to see them.
 *
 * 2. **Edge ignore** — touches starting within `edgeIgnore` px of the left
 *    edge are dropped, so the gesture doesn't fight iOS Safari's edge-swipe-
 *    back. In an installed PWA there is no edge-swipe-back, so this is purely
 *    for the in-browser experience.
 *
 * 3. **Threshold** — only commits if the final |dx| is at least `threshold`
 *    pixels. Smaller motions are treated as accidental.
 *
 * Pointer capture is set after axis-lock so the gesture doesn't break if the
 * finger leaves the element mid-drag.
 */
export interface UseHorizontalSwipeOptions {
  /** Finger moves left → user wants to move forward in a sequence (next page, next day, etc.). */
  onSwipeLeft?: () => void;
  /** Finger moves right → user wants to move backward (prev page, prev day, etc.). */
  onSwipeRight?: () => void;
  /** Optional live progress callback (signed dx in px). Useful for drag-preview transforms. */
  onProgress?: (dx: number) => void;
  /** Minimum |dx| to commit a swipe. Default 60px. */
  threshold?: number;
  /** Required |dx|/|dy| ratio to lock as horizontal. Default 1.5. */
  axisLockRatio?: number;
  /** Touches starting within this many px of the left edge are ignored (iOS edge-back). Default 20. */
  edgeIgnore?: number;
  /** Optional reactive flag to disable the gesture without unmounting. */
  enabled?: Ref<boolean>;
}

export function useHorizontalSwipe(
  target: Ref<HTMLElement | null>,
  options: UseHorizontalSwipeOptions
): void {
  const threshold = options.threshold ?? 60;
  const axisLockRatio = options.axisLockRatio ?? 1.5;
  const edgeIgnore = options.edgeIgnore ?? 20;

  let attached: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let active = false;
  let locked: 'horizontal' | 'vertical' | null = null;
  let activePointerId = -1;

  function reset() {
    active = false;
    locked = null;
    activePointerId = -1;
  }

  function onPointerDown(e: PointerEvent) {
    if (options.enabled && !options.enabled.value) return;
    // Only primary mouse button; touch/pen always primary.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // iOS Safari edge-swipe-back guard. Only applies to touch — mouse / pen
    // drags from the edge are intentional.
    if (e.pointerType === 'touch' && e.clientX < edgeIgnore) return;
    startX = e.clientX;
    startY = e.clientY;
    active = true;
    locked = null;
    activePointerId = e.pointerId;
  }

  function onPointerMove(e: PointerEvent) {
    if (!active || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (locked === null) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      // Need a minimum motion before committing to an axis — avoids jitter
      // misclassifying a tap-with-tiny-tremor as a directional gesture.
      if (adx < 8 && ady < 8) return;
      if (adx > ady * axisLockRatio) {
        locked = 'horizontal';
        try {
          attached?.setPointerCapture(e.pointerId);
        } catch {
          // setPointerCapture can throw if the pointer is already gone
          // (rare race in mobile Safari). Gesture still works without it.
        }
      } else {
        // Vertical-ish gesture — release so native scroll takes over.
        reset();
        return;
      }
    }

    if (locked === 'horizontal') {
      options.onProgress?.(dx);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!active || e.pointerId !== activePointerId) {
      reset();
      return;
    }
    const dx = e.clientX - startX;
    const committed = locked === 'horizontal' && Math.abs(dx) >= threshold;
    if (committed) {
      if (dx < 0) options.onSwipeLeft?.();
      else options.onSwipeRight?.();
    }
    options.onProgress?.(0);
    try {
      attached?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released — fine
    }
    reset();
  }

  function onPointerCancel() {
    options.onProgress?.(0);
    reset();
  }

  function attach(el: HTMLElement) {
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    attached = el;
  }

  function detach() {
    if (!attached) return;
    attached.removeEventListener('pointerdown', onPointerDown);
    attached.removeEventListener('pointermove', onPointerMove);
    attached.removeEventListener('pointerup', onPointerUp);
    attached.removeEventListener('pointercancel', onPointerCancel);
    attached = null;
    reset();
  }

  // Initial bind on mount (template refs are populated by then) + watch for
  // later element changes (e.g. a v-if'd target that remounts inside the
  // same component lifetime).
  onMounted(() => {
    if (target.value) attach(target.value);
  });

  watch(target, (el) => {
    if (attached === el) return;
    detach();
    if (el) attach(el);
  });

  onScopeDispose(detach);
}
