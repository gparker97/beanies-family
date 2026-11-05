/**
 * Calendar drag and drop (#142): the binding's DOM reads, on top of the `dragDom` protocol.
 * The ghost is `pointer-events: none`, so `elementFromPoint` sees straight through it.
 */
import { DRAG_ATTR, readDragSourceRef, readDropTarget } from '@/utils/calendar/dragDom';
import type { DropTarget } from '@/utils/calendar/dragMath';

/** The drag source an event started in, or `null`. */
export function sourceOf(target: EventTarget | null): HTMLElement | null {
  return (target as Element | null)?.closest?.<HTMLElement>(`[${DRAG_ATTR.source}]`) ?? null;
}

/**
 * The drop target under a viewport point. The TOPMOST element only (singular, unlike
 * `grabAt`): whatever covers a target hides it, and the sticky day and member headers
 * (`z-20`, opaque) sit over the scrolled timeline, so looking beneath them would drop onto
 * hours the person cannot see. A row whose chips sit over its own targets makes them
 * transparent while lifted instead (the week all-day row's `*:pointer-events-none`).
 */
export function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  return el ? readDropTarget(el, y) : null;
}

/**
 * At press: the target under the finger, BENEATH the pressed chip (hence `elementsFromPoint`,
 * plural). This is the grab point the drop's delta is measured from (see `DragSource`).
 * `null` for a chip in `portal` (the desktop month popover): the popover floats over cells
 * of other days, so the source's own `data-occurrence-date` is the grab date there.
 */
export function grabAt(
  x: number,
  y: number,
  pressed: Element,
  portal: Element | null | undefined
): DropTarget | null {
  if (portal?.contains(pressed)) return null;
  const drop = document
    .elementsFromPoint(x, y)
    .map((el) => el.closest(`[${DRAG_ATTR.drop}]`))
    .find(Boolean);
  return drop ? readDropTarget(drop, y) : null;
}

/**
 * A keyboard lift's virtual target: where the focused chip is now (its top, and on a timeline
 * its bottom as the resize origin). A chip outside any drop target (the phone open-day row)
 * falls back to its own occurrence day.
 */
export function keyboardOrigin(el: HTMLElement): { origin: DropTarget; endOrigin?: DropTarget } {
  const rect = el.getBoundingClientRect();
  const origin = readDropTarget(el, rect.top) ?? {
    kind: 'day',
    date: readDragSourceRef(el)?.occurrenceDate ?? '',
  };
  const endOrigin = origin.kind === 'time' ? readDropTarget(el, rect.bottom) : null;
  return endOrigin ? { origin, endOrigin } : { origin };
}
