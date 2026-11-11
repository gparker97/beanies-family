/**
 * Synthetic pointer gestures for tests of anything built on `useHorizontalSwipe` (the
 * composable itself, `useCalendarSlide`, the deal pile's stage, the Card Details drawer).
 *
 * The test DOM has no usable `PointerEvent` / `TouchEvent` constructors, so these dispatch a
 * plain `Event` carrying the fields the handlers read (clientX, clientY, pointerId,
 * pointerType, button, isPrimary; or a touch's `touches` list).
 */
export interface PointerInit {
  x: number;
  y: number;
  /** Default `touch`. */
  pointerType?: string;
  pointerId?: number;
  button?: number;
  /** Default: true for pointer id 1, false otherwise (a browser marks the first finger). */
  isPrimary?: boolean;
}

type Point = { x: number; y: number };

/** Dispatches a bubbling plain `Event` of `type` carrying `fields`, and returns it. */
function dispatch<T extends object>(
  el: HTMLElement,
  type: string,
  fields: T,
  cancelable = true
): Event & T {
  const e = Object.assign(new Event(type, { bubbles: true, cancelable }), fields);
  el.dispatchEvent(e);
  return e;
}

export function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  el: HTMLElement,
  init: PointerInit
): void {
  const pointerId = init.pointerId ?? 1;
  dispatch(el, type, {
    clientX: init.x,
    clientY: init.y,
    pointerId,
    pointerType: init.pointerType ?? 'touch',
    button: init.button ?? 0,
    isPrimary: init.isPrimary ?? pointerId === 1,
  });
}

export interface TouchMoveInit {
  x: number;
  y: number;
  /** Default true. A real `touchmove` stops being cancelable once the browser's pan begins. */
  cancelable?: boolean;
  /** How many fingers are down (each at x, y). Default 1. */
  touches?: number;
}

/**
 * A `touchmove` with its `touches` list, for the swipe's touch guard. Returns the dispatched
 * event so a test can assert `defaultPrevented`.
 */
export function touchMove(el: HTMLElement, init: TouchMoveInit): Event {
  const touch = { clientX: init.x, clientY: init.y };
  const touches = Array.from({ length: init.touches ?? 1 }, () => touch);
  return dispatch(el, 'touchmove', { touches }, init.cancelable ?? true);
}

/**
 * A two-finger gesture: fingers 1 and 2 land at `a0` / `b0`, move to `a1` / `b1`, then
 * lift. Moving them apart is a spread, together a pinch.
 */
export function pinch(el: HTMLElement, [a0, b0]: [Point, Point], [a1, b1]: [Point, Point]): void {
  pointer('pointerdown', el, { ...a0, pointerId: 1 });
  pointer('pointerdown', el, { ...b0, pointerId: 2 });
  pointer('pointermove', el, { ...a1, pointerId: 1 });
  pointer('pointermove', el, { ...b1, pointerId: 2 });
  pointer('pointerup', el, { ...a1, pointerId: 1 });
  pointer('pointerup', el, { ...b1, pointerId: 2 });
}

/** A full gesture: down, two moves (so axis lock has a decision point), up. */
export function swipe(el: HTMLElement, from: Point, to: Point, pointerType = 'touch'): void {
  pointer('pointerdown', el, { ...from, pointerType });
  pointer('pointermove', el, {
    x: from.x + (to.x - from.x) / 2,
    y: from.y + (to.y - from.y) / 2,
    pointerType,
  });
  pointer('pointermove', el, { ...to, pointerType });
  pointer('pointerup', el, { ...to, pointerType });
}
