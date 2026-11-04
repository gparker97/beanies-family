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
 * 4. **Multi-touch cancels**: the moment a second touch or pen pointer is
 *    down, any swipe in progress is cancelled (`onProgress(0)`), and no swipe
 *    starts again until every finger has lifted. A pinch can never swipe. This
 *    applies to EVERY consumer, including `DealPileStage`, where a second finger
 *    used to silently restart the gesture on the new pointer.
 *
 * Pointer capture is set after axis-lock so the gesture doesn't break if the
 * finger leaves the element mid-drag, and released only when it was set.
 *
 * **Optional pinch** (`onPinch`): with exactly two touch or pen pointers down,
 * the distance between them is recorded; once it grows or shrinks by
 * `pinchRatio` (see the pure {@link pinchDirection}) `onPinch('spread' |
 * 'pinch')` fires ONCE, latched until every finger lifts. Its opt-in is the
 * presence of `onPinch`, NOT `enabled`: a consumer (`useCalendarSlide`) holds
 * `enabled` false during the spring-back that the multi-touch cancel itself
 * triggers, so gating the pinch on it would drop a pinch whose first finger had
 * already started a swipe.
 *
 * One pointer map serves both the cancel and the pinch. A `pointerdown` with
 * `isPrimary` (the first finger of a new touch sequence) clears it first, so a
 * lost `pointerup` can never leave the gesture wedged in multi-touch.
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
  /**
   * Touch and pen only: a mouse drag is left alone (it selects text on a desktop, which a
   * swipe must not hijack). Default false: mouse drags swipe too.
   */
  ignoreMouse?: boolean;
  /** Optional two-finger pinch: fires once per gesture (see the docblock). */
  onPinch?: (dir: PinchDirection) => void;
  /** Distance ratio a pinch must reach (or its inverse). Default 1.25. */
  pinchRatio?: number;
}

export type PinchDirection = 'spread' | 'pinch';

/**
 * The pinch threshold, pure: `'spread'` once the finger distance `d` has grown to at least
 * `ratio` × the starting distance `d0`, `'pinch'` once it has shrunk to `1 / ratio` of it,
 * otherwise (and whenever `d0` is not positive) `null`.
 */
export function pinchDirection(d0: number, d: number, ratio: number): PinchDirection | null {
  if (!(d0 > 0)) return null;
  const r = d / d0;
  if (r >= ratio) return 'spread';
  if (r <= 1 / ratio) return 'pinch';
  return null;
}

/** Touch and pen pointers count toward multi-touch; a mouse is only ever one pointer. */
function isTouchLike(e: PointerEvent): boolean {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

export function useHorizontalSwipe(
  target: Ref<HTMLElement | null>,
  options: UseHorizontalSwipeOptions
): void {
  const threshold = options.threshold ?? 60;
  const axisLockRatio = options.axisLockRatio ?? 1.5;
  const edgeIgnore = options.edgeIgnore ?? 20;
  const pinchRatio = options.pinchRatio ?? 1.25;

  let attached: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let active = false;
  let locked: 'horizontal' | 'vertical' | null = null;
  let activePointerId = -1;

  /** Every touch / pen pointer currently down, by id (guardrail 4 and the pinch). */
  const pointers = new Map<number, { x: number; y: number }>();
  /** Set from the second pointer until the map empties: the swipe handlers stand down. */
  let multiTouch = false;
  /** The two fingers' starting distance; 0 = no pinch being tracked. */
  let pinchStart = 0;
  /** A pinch fired this gesture; latched until the map empties. */
  let pinchFired = false;

  function reset() {
    active = false;
    locked = null;
    activePointerId = -1;
  }

  function clearPointers() {
    pointers.clear();
    multiTouch = false;
    pinchStart = 0;
    pinchFired = false;
  }

  function pointerDistance(): number {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function warnCapture(err: unknown) {
    console.warn('[useHorizontalSwipe] pointer capture failed (pointer already gone)', err);
  }

  function releaseCapture(pointerId: number) {
    try {
      attached?.releasePointerCapture(pointerId);
    } catch (err) {
      warnCapture(err);
    }
  }

  /** A second pointer landed: cancel any swipe and stand down until every finger lifts. */
  function enterMultiTouch() {
    if (active) {
      options.onProgress?.(0);
      // Capture was only ever set after a horizontal lock, so only then is there one to
      // release (releasing an uncaptured pointer can throw).
      if (locked === 'horizontal') releaseCapture(activePointerId);
    }
    multiTouch = true;
    reset();
  }

  /** Keeps the pointer map current; runs before every early return in `onPointerDown`. */
  function trackPointerDown(e: PointerEvent) {
    if (!isTouchLike(e)) return;
    // The first finger of a new touch sequence: anything left in the map is stale (a lost
    // pointerup), and must not wedge the gesture in multi-touch for the rest of the session.
    if (e.isPrimary) clearPointers();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size < 2) return;
    if (!multiTouch) enterMultiTouch();
    if (pointers.size === 2 && options.onPinch && !pinchFired) pinchStart = pointerDistance();
  }

  /** A pointer lifted or was cancelled; the map emptying ends the multi-touch gesture. */
  function trackPointerEnd(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) clearPointers();
    // A third finger lifting leaves a different pair down: re-baseline, or the next move
    // would compare the new pair against the old pair's distance and fire a bogus pinch.
    else if (pointers.size === 2 && options.onPinch && !pinchFired) pinchStart = pointerDistance();
  }

  function onPointerDown(e: PointerEvent) {
    trackPointerDown(e);
    if (multiTouch) return;
    if (options.enabled && !options.enabled.value) return;
    if (options.ignoreMouse && e.pointerType === 'mouse') return;
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
    // The pinch runs BEFORE the swipe's guards and is not gated by `enabled` (docblock).
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (options.onPinch && pointers.size === 2 && !pinchFired) {
        const dir = pinchDirection(pinchStart, pointerDistance(), pinchRatio);
        if (dir) {
          pinchFired = true;
          options.onPinch(dir);
        }
      }
    }
    if (multiTouch) return;
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
        } catch (err) {
          // setPointerCapture can throw if the pointer is already gone
          // (rare race in mobile Safari). Gesture still works without it.
          warnCapture(err);
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
    const wasMultiTouch = multiTouch;
    trackPointerEnd(e);
    if (wasMultiTouch) return;
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
    if (locked === 'horizontal') releaseCapture(e.pointerId);
    reset();
  }

  function onPointerCancel(e: PointerEvent) {
    const wasMultiTouch = multiTouch;
    trackPointerEnd(e);
    // The multi-touch cancel already reported `onProgress(0)` and reset.
    if (wasMultiTouch) return;
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
    clearPointers();
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
