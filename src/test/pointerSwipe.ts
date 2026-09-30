/**
 * Synthetic pointer gestures for tests of anything built on `useHorizontalSwipe` (the
 * composable itself, `useCalendarSlide`, the deal pile's stage, the Card Details drawer).
 *
 * The test DOM has no usable `PointerEvent` constructor, so these dispatch a plain `Event`
 * carrying the fields the handlers read (clientX, clientY, pointerId, pointerType, button).
 */
export interface PointerInit {
  x: number;
  y: number;
  /** Default `touch`. */
  pointerType?: string;
  pointerId?: number;
  button?: number;
}

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
  };
  e.clientX = init.x;
  e.clientY = init.y;
  e.pointerId = init.pointerId ?? 1;
  e.pointerType = init.pointerType ?? 'touch';
  e.button = init.button ?? 0;
  el.dispatchEvent(e);
}

/** A full gesture: down, two moves (so axis lock has a decision point), up. */
export function swipe(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType = 'touch'
): void {
  pointer('pointerdown', el, { ...from, pointerType });
  pointer('pointermove', el, {
    x: from.x + (to.x - from.x) / 2,
    y: from.y + (to.y - from.y) / 2,
    pointerType,
  });
  pointer('pointermove', el, { ...to, pointerType });
  pointer('pointerup', el, { ...to, pointerType });
}
