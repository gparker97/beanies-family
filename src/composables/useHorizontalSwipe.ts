import { onMounted, onScopeDispose, watch, type Ref } from 'vue';
import { logSwipeEnd, type SwipeOutcome, type SwipeSurface } from './swipeTelemetry';

export type { SwipeSurface } from './swipeTelemetry';

/**
 * Detects horizontal swipe gestures on a target element using Pointer Events (so it works
 * for touch, pen AND mouse drag uniformly across PWA + browser), with a touch guard that
 * stops the browser scrolling a sideways swipe away.
 *
 * **The gesture.** One nullable record, `gesture`, holds everything about the swipe under
 * way: its pointer, start point, phase (`pending` until an axis is decided, then
 * `horizontal`), the last tracked dx, and whether the guard claimed it and whether THIS
 * composable captured its pointer. No gesture means idle; `reset()` is `gesture = null`, so
 * nothing from one gesture can leak into the next.
 *
 * - **Axis lock** (`onPointerMove`): once the pointer has moved 8px on either axis, the
 *   pure {@link decideAxis} picks horizontal (|dx| > axisLockRatio * |dy|) or vertical. A
 *   vertical gesture is dropped so native scroll keeps working. Only a horizontal lock
 *   captures the pointer and reports `onProgress(dx)`. The consumer sets
 *   `touch-action: pan-y` (or `none`) on the target.
 * - **Touch guard** (`onTouchMove`, one non-passive `touchmove` registered at attach): under
 *   `pan-y`, iOS decides for itself that a drifting thumb is a vertical pan, scrolls, and
 *   fires `pointercancel`, which used to spring a good swipe back. So while a single-finger
 *   gesture is pending or horizontal, the first cancelable `touchmove` that is sideways by
 *   the same `decideAxis` at `CLAIM_MIN_MOVE_PX` (4px, earlier than the lock so the claim
 *   lands before iOS begins its pan) is `preventDefault`ed, and so is every later move of
 *   that gesture. The guard ONLY prevents and marks the gesture `claimed`: it never locks,
 *   never captures, never reports progress and never stands a gesture down. A drag's
 *   press-and-hold drifting 4 to 7px therefore moves nothing; the page just does not scroll.
 *   Known cost: a touch that starts sideways and then turns vertical loses its scroll for
 *   that one touch; the pointer path logs it as `vertical` (or `unresolved`, if it ends
 *   before deciding). Constraint: the guard claims sideways moves anywhere inside the swipe
 *   root, so a horizontally scrolling element must never be placed inside one (none of the
 *   six roots has one today).
 * - **Edge ignore**: touches starting within `edgeIgnore` px of the left edge are dropped,
 *   so the gesture does not fight iOS Safari's edge-swipe-back.
 * - **Threshold**: a horizontal gesture commits only if |dx| reaches `threshold`.
 * - **Multi-touch cancels**: the moment a second touch or pen pointer is down, any swipe in
 *   progress is abandoned, and no swipe starts again until every finger has lifted. A pinch
 *   can never swipe. This applies to EVERY consumer, including `DealPileStage`.
 *
 * **Two exits.** `finish(dx, outcome)` (a `pointerup`, or a `pointercancel` past the
 * threshold) fires `onSwipeLeft` / `onSwipeRight` when |dx| reaches the threshold, then in a
 * `finally` reports `onProgress(0)`, releases its capture and resets, so a throwing consumer
 * callback still surfaces but cannot leave the gesture locked. `abandon(outcome)` (a second
 * finger, a `pointercancel` below the threshold, or a stale gesture found at the next primary
 * `pointerdown`) reports `onProgress(0)` for a horizontal gesture,
 * releases its capture and resets; on a pending gesture it only resets.
 * `finish`'s teardown sits in its own inner `finally`, so even a throwing `onProgress(0)`
 * cannot skip it.
 *
 * **`pointercancel`** acts only on the gesture's own pointer and not in multi-touch. It
 * carries no reliable coordinates, so the decision uses the last dx seen in `pointermove`: a
 * horizontal gesture already past the threshold commits (the person did swipe that far,
 * even if the browser or the system took the touch); below it, it springs back; a pending
 * gesture (the cancel that ends every native scroll) just resets.
 *
 * **Capture ownership.** The pointer is captured after a horizontal lock, so the gesture
 * survives the finger leaving the element. `gesture.captured` records that THIS composable's
 * `setPointerCapture` succeeded, and only then is it released: the calendar drag captures
 * the same pointer on the same root at lift, and `hasPointerCapture` cannot say whose
 * capture it is, so releasing on that would drop the drag's.
 *
 * **`enabled`** is read at `pointerdown` (false starts no gesture) and by the guard while a
 * gesture is still pending. It deliberately does NOT stand down a gesture already running:
 * a consumer that flips it mid-gesture (as `useCalendarSlide` once did for the spring-back
 * its own `onProgress(0)` starts when a finger reverses through dx 0) would otherwise kill
 * the swipe under the finger. A locked gesture keeps its claim for the same reason, or iOS
 * could start scrolling mid-swipe. A drag's lift (which disables the swipe) only ever meets a pending gesture,
 * because the guard never locks.
 *
 * **Telemetry** (touch and pen only, `swipeTelemetry.ts`): one `swipe_end` per gesture that
 * locked horizontal, named by the required `name`; plus `vertical` / `unresolved` for each
 * false claim, and `locked_out` once for a primary touch that landed while `enabled` was
 * false and then moved sideways (tracked in a separate record the guard never sees, so the
 * behaviour stays exactly as before: it is ignored and the page may scroll).
 *
 * **Platform assumptions** (not unit-testable; the test DOM is hand-built events):
 * 1. WebKit dispatches a touch's pointer event before the matching touch event, so the
 *    gesture exists when its first `touchmove` arrives (if not, the guard does nothing).
 * 2. A non-passive `touchmove` on the target is consulted for touches that start on it.
 * 3. A prevented `touchmove` suppresses the scroll and so the `pointercancel` it would fire.
 * 4. Chrome on Android withholds `touchmove` until its own slop is crossed, so the guard may
 *    first run on a gesture the pointer path already locked; it then simply prevents.
 * 5. A desktop browser may have no `TouchEvent` global: it is a type only here, never
 *    `instanceof`, and the listener is inert where no touch events fire.
 *
 * **Optional pinch** (`onPinch`): with exactly two touch or pen pointers down, the distance
 * between them is recorded; once it grows or shrinks by `pinchRatio` (see the pure
 * {@link pinchDirection}) `onPinch('spread' | 'pinch')` fires ONCE, latched until every
 * finger lifts. Its opt-in is the presence of `onPinch`, NOT `enabled`: a consumer that
 * switches the swipe off (the month grid, while its wheel pager runs or a drag is lifted)
 * keeps its pinch.
 *
 * One pointer map serves both the cancel and the pinch. A `pointerdown` with `isPrimary`
 * (the first finger of a new touch sequence) clears it first, so a lost `pointerup` can never
 * leave the gesture wedged in multi-touch.
 */
export interface UseHorizontalSwipeOptions {
  /** Which surface this is, for the `swipe_end` telemetry. Required. */
  name: SwipeSurface;
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

/** Movement on either axis the pointer path waits for before it locks an axis. */
const AXIS_LOCK_MIN_MOVE_PX = 8;
/** Movement the touch guard waits for before it claims: earlier than the lock, to beat iOS's pan. */
const CLAIM_MIN_MOVE_PX = 4;

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

/**
 * The axis decision, pure and shared by the pointer path and the touch guard: `null` until
 * the movement reaches `minMove` on either axis (a tap's tremor decides nothing), then
 * `'horizontal'` when |dx| > ratio * |dy|, otherwise `'vertical'`.
 */
export function decideAxis(
  dx: number,
  dy: number,
  ratio: number,
  minMove: number
): 'horizontal' | 'vertical' | null {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < minMove && ady < minMove) return null;
  return adx > ady * ratio ? 'horizontal' : 'vertical';
}

/** Touch and pen pointers count toward multi-touch; a mouse is only ever one pointer. */
function isTouchLike(e: PointerEvent): boolean {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

/** The swipe under way (see the docblock). */
interface Gesture {
  pointerId: number;
  /** Touch or pen: only these are logged. */
  touchLike: boolean;
  startX: number;
  startY: number;
  phase: 'pending' | 'horizontal';
  /** The dx of the last tracked `pointermove`, for a `pointercancel` (which has no coordinates). */
  lastDx: number;
  /** The touch guard prevented a move of this gesture. */
  claimed: boolean;
  /** THIS composable's `setPointerCapture` succeeded for this gesture. */
  captured: boolean;
}

type AbandonOutcome = Extract<SwipeOutcome, 'browser_cancel' | 'multi_touch' | 'stale'>;

export function useHorizontalSwipe(
  target: Ref<HTMLElement | null>,
  options: UseHorizontalSwipeOptions
): void {
  const threshold = options.threshold ?? 60;
  const axisLockRatio = options.axisLockRatio ?? 1.5;
  const edgeIgnore = options.edgeIgnore ?? 20;
  const pinchRatio = options.pinchRatio ?? 1.25;

  let attached: HTMLElement | null = null;
  let gesture: Gesture | null = null;
  /**
   * A primary touch ignored only because `enabled` was false: measured for `locked_out`,
   * never acted on. Deliberately not a `gesture`, so the guard stays inert for it.
   */
  let lockedOut: { pointerId: number; startX: number; startY: number } | null = null;

  /** Every touch / pen pointer currently down, by id (the multi-touch cancel and the pinch). */
  const pointers = new Map<number, { x: number; y: number }>();
  /** Set from the second pointer until the map empties: the swipe handlers stand down. */
  let multiTouch = false;
  /** The two fingers' starting distance; 0 = no pinch being tracked. */
  let pinchStart = 0;
  /** A pinch fired this gesture; latched until the map empties. */
  let pinchFired = false;

  function reset() {
    gesture = null;
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

  /** Releases the gesture's pointer capture, only if this composable set it. */
  function releaseCapture(g: Gesture) {
    if (!g.captured) return;
    try {
      attached?.releasePointerCapture(g.pointerId);
    } catch (err) {
      warnCapture(err);
    }
  }

  function log(g: Gesture, outcome: SwipeOutcome, dx: number) {
    if (g.touchLike) logSwipeEnd(options.name, outcome, g.claimed, dx);
  }

  /**
   * Exit 1: the gesture ended with a known dx (a release, or a cancel past the threshold).
   * Commits a horizontal gesture that reached the threshold; the teardown runs even if the
   * consumer's callback throws.
   */
  function finish(dx: number, committedAs: 'committed' | 'committed_on_cancel') {
    const g = gesture;
    if (!g) return;
    const horizontal = g.phase === 'horizontal';
    const committed = horizontal && Math.abs(dx) >= threshold;
    try {
      if (committed) {
        if (dx < 0) options.onSwipeLeft?.();
        else options.onSwipeRight?.();
      }
    } finally {
      try {
        options.onProgress?.(0);
      } finally {
        releaseCapture(g);
        reset();
        if (horizontal) log(g, committed ? committedAs : 'short', dx);
        else if (g.claimed) log(g, 'unresolved', dx);
      }
    }
  }

  /**
   * Exit 2: the gesture is stood down without a commit. A horizontal gesture springs back
   * (`onProgress(0)`) and is logged; a pending one only resets.
   */
  function abandon(outcome: AbandonOutcome) {
    const g = gesture;
    if (!g) return;
    const horizontal = g.phase === 'horizontal';
    try {
      if (horizontal) options.onProgress?.(0);
    } finally {
      releaseCapture(g);
      reset();
      if (horizontal) log(g, outcome, g.lastDx);
    }
  }

  /** A second pointer landed: cancel any swipe and stand down until every finger lifts. */
  function enterMultiTouch() {
    multiTouch = true;
    lockedOut = null;
    abandon('multi_touch');
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
    // A new primary pointer means the old gesture's pointerup was lost. Clear it before the
    // early returns below, or the touch guard (which has no pointer id) would measure an
    // edge touch against the stale start.
    if (e.isPrimary) {
      lockedOut = null;
      abandon('stale');
    }
    if (options.ignoreMouse && e.pointerType === 'mouse') return;
    // Only primary mouse button; touch/pen always primary.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // iOS Safari edge-swipe-back guard. Only applies to touch: mouse / pen drags from the
    // edge are intentional.
    if (e.pointerType === 'touch' && e.clientX < edgeIgnore) return;
    if (options.enabled?.value === false) {
      // Disabled is the only reason this touch is ignored: remember it for `locked_out`.
      if (isTouchLike(e) && e.isPrimary) {
        lockedOut = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
      }
      return;
    }
    gesture = {
      pointerId: e.pointerId,
      touchLike: isTouchLike(e),
      startX: e.clientX,
      startY: e.clientY,
      phase: 'pending',
      lastDx: 0,
      claimed: false,
      captured: false,
    };
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
    if (lockedOut && e.pointerId === lockedOut.pointerId) {
      measureLockedOut(e);
      return;
    }
    const g = gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    g.lastDx = dx;

    if (g.phase === 'pending') {
      const axis = decideAxis(dx, dy, axisLockRatio, AXIS_LOCK_MIN_MOVE_PX);
      if (axis === null) return;
      if (axis === 'vertical') {
        // Native scroll takes over. A gesture the guard had claimed was a false claim: that
        // touch lost its scroll, so it is logged.
        reset();
        if (g.claimed) log(g, 'vertical', dx);
        return;
      }
      g.phase = 'horizontal';
      if (attached) {
        try {
          attached.setPointerCapture(e.pointerId);
          g.captured = true;
        } catch (err) {
          // setPointerCapture can throw if the pointer is already gone
          // (rare race in mobile Safari). Gesture still works without it.
          warnCapture(err);
        }
      }
    }

    options.onProgress?.(dx);
  }

  /** `locked_out`: logs once the ignored touch decides horizontal; any other decision is silent. */
  function measureLockedOut(e: PointerEvent) {
    const lo = lockedOut;
    if (!lo) return;
    const dx = e.clientX - lo.startX;
    const axis = decideAxis(dx, e.clientY - lo.startY, axisLockRatio, AXIS_LOCK_MIN_MOVE_PX);
    if (axis === null) return;
    lockedOut = null;
    if (axis === 'horizontal') logSwipeEnd(options.name, 'locked_out', false, dx);
  }

  function onPointerUp(e: PointerEvent) {
    if (lockedOut?.pointerId === e.pointerId) lockedOut = null;
    const wasMultiTouch = multiTouch;
    trackPointerEnd(e);
    if (wasMultiTouch) return;
    const g = gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    finish(e.clientX - g.startX, 'committed');
  }

  function onPointerCancel(e: PointerEvent) {
    if (lockedOut?.pointerId === e.pointerId) lockedOut = null;
    const wasMultiTouch = multiTouch;
    trackPointerEnd(e);
    // The multi-touch cancel already abandoned the gesture.
    if (wasMultiTouch) return;
    const g = gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.phase === 'pending') {
      reset();
      if (g.claimed) log(g, 'unresolved', g.lastDx);
    } else if (Math.abs(g.lastDx) >= threshold) {
      finish(g.lastDx, 'committed_on_cancel');
    } else {
      abandon('browser_cancel');
    }
  }

  /**
   * The touch guard (see the docblock): claims a sideways single-finger move before the
   * browser can turn it into a scroll. Branch-only, since a non-passive `touchmove` makes
   * scrolling wait on it.
   */
  function onTouchMove(e: TouchEvent) {
    const g = gesture;
    if (!g || multiTouch || !e.cancelable) return;
    // `?.`: a synthetic or non-standard event may carry no `touches` list.
    if (e.touches?.length !== 1) return;
    // A locked gesture keeps its claim even while `enabled` is false (see the docblock).
    if (g.phase === 'pending' && options.enabled?.value === false) return;
    if (!g.claimed && g.phase !== 'horizontal') {
      const t = e.touches[0];
      if (!t) return;
      const axis = decideAxis(
        t.clientX - g.startX,
        t.clientY - g.startY,
        axisLockRatio,
        CLAIM_MIN_MOVE_PX
      );
      if (axis !== 'horizontal') return;
    }
    e.preventDefault();
    g.claimed = true;
  }

  function attach(el: HTMLElement) {
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    attached = el;
  }

  function detach() {
    if (!attached) return;
    attached.removeEventListener('pointerdown', onPointerDown);
    attached.removeEventListener('pointermove', onPointerMove);
    attached.removeEventListener('pointerup', onPointerUp);
    attached.removeEventListener('pointercancel', onPointerCancel);
    attached.removeEventListener('touchmove', onTouchMove);
    attached = null;
    reset();
    lockedOut = null;
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
