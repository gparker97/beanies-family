/**
 * Synthetic pointer gestures for tests of anything built on `useHorizontalSwipe` (the
 * composable itself, `useCalendarSlide`, the deal pile's stage, the Card Details drawer).
 *
 * The test DOM has no usable `PointerEvent` constructor, so these dispatch a plain `Event`
 * carrying the fields the handlers read (clientX, clientY, pointerId, pointerType, button,
 * isPrimary).
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

export function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  el: HTMLElement,
  init: PointerInit
): void {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    pointerId: number;
    pointerType: string;
    button: number;
    isPrimary: boolean;
  };
  e.clientX = init.x;
  e.clientY = init.y;
  e.pointerId = init.pointerId ?? 1;
  e.pointerType = init.pointerType ?? 'touch';
  e.button = init.button ?? 0;
  e.isPrimary = init.isPrimary ?? e.pointerId === 1;
  el.dispatchEvent(e);
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
