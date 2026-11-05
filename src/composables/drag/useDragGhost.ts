/**
 * Calendar drag and drop (#142): the lifted item's ghost, and the placeholder left behind.
 *
 * The ghost is a `cloneNode(true)` of the pressed chip/block, so it looks exactly like the
 * chip in both themes (the chips are already dark-correct), framed on the card surface it was
 * drawn on (`bg-white` / `dark:bg-surface-raised`: the chip washes are translucent, and a
 * see-through ghost over other chips is unreadable) and appended straight to
 * `document.body`. It must escape the view: the month grid and its cells are
 * `overflow-hidden`, and the view roots carry `will-change: transform`, which makes them the
 * containing block of any `position: fixed` descendant. `pointer-events: none`, so hit-testing
 * with `elementFromPoint` sees straight through it; `inert` + `aria-hidden`, so it is never
 * focused or read (the live region speaks for the drag). Ids and every `data-*` attribute are
 * stripped from the clone so no test id, reveal hook or drag/drop attribute exists twice.
 *
 * The source keeps its place with the `drag-placeholder` class (`src/style.css`: a dashed
 * line-strong outline, no fill, contents at 40%; it is applied to elements of several
 * components, so it cannot be a scoped rule). A keyboard lift has no ghost, so its source
 * also gets `drag-placeholder-solid`: the same outline with the contents at full strength,
 * since the focused chip is the only rendering of what is being moved.
 *
 * The ghost is at most 14rem wide (the phone open day's full-width chips would otherwise float as
 * a bar across a whole week row); a grab beyond that centres it under the finger.
 *
 * Timelines (Phase 3) pass a `snapRect` (the slot the drop would fill) and a `readout`
 * ("4pm – 5pm"): the ghost then sits on the slot at the slot's size instead of under the
 * finger, and a pill shows the time above it; off a slot it floats at the chip's size again.
 *
 * Plan: `~/projects/beanies-ops/docs/plans/2026-11-05-calendar-drag-and-drop-142.md`.
 */
import { getCurrentScope, onScopeDispose } from 'vue';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';

export const PLACEHOLDER_CLASS = 'drag-placeholder';
/** A keyboard lift has no ghost: the placeholder IS the item, so its contents stay readable. */
export const SOLID_PLACEHOLDER_CLASS = 'drag-placeholder-solid';

/** Literal class lists, so Tailwind's source scan sees every class. */
const GHOST_CLASS = 'dark:bg-surface-raised overflow-hidden rounded-md bg-white shadow-lg';
const READOUT_CLASS =
  'dark:bg-surface-overlay text-secondary-500 dark:text-ink rounded-full bg-white px-2 py-0.5 text-xs font-semibold whitespace-nowrap shadow-md';
/** Above the planner's own sheets and bars (z-[45] to z-[200]), below the toasts (z-[270]). */
const Z = '240';
/** Gap between the finger and a ghost floated above it (0.75rem at 16px). */
const ABOVE_GAP_PX = 12;

/** The widest a ghost floats (Large reading mode scales it with the root). */
const MAX_WIDTH_REM = 14;

function rootRemPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export interface Point {
  x: number;
  y: number;
}

export interface SnapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Strip ids and data-* from the clone and every descendant. */
function scrub(el: Element): void {
  for (const node of [el, ...el.querySelectorAll('*')]) {
    node.removeAttribute('id');
    for (const name of node.getAttributeNames()) {
      if (name.startsWith('data-')) node.removeAttribute(name);
    }
  }
}

export function useDragGhost() {
  let ghost: HTMLElement | null = null;
  let readout: HTMLElement | null = null;
  let source: HTMLElement | null = null;
  /** Where inside the source the pointer grabbed it, so the ghost does not jump. */
  let offset: Point = { x: 0, y: 0 };
  let tilt = '';
  /** The floating size, restored when the ghost leaves a timeline slot. */
  let size = { width: 0, height: 0 };

  /**
   * Lift `el`: mark it as the placeholder and, for a pointer drag (`point` given), float a
   * clone at its current place. A keyboard lift passes no point: placeholder only (the ring
   * and the live region carry it). Throws only if the DOM refuses the clone; the binding
   * reports that and cancels the drag (`'ghost'`), so a drag never runs without a ghost.
   */
  function show(el: HTMLElement, point: Point | null): void {
    hide();
    source = el;
    el.classList.add(PLACEHOLDER_CLASS);
    if (!point) {
      el.classList.add(SOLID_PLACEHOLDER_CLASS);
      return;
    }
    const rect = el.getBoundingClientRect();
    // A full-width row chip (the phone open day) would float as a bar over a whole week row.
    const width = Math.min(rect.width, MAX_WIDTH_REM * rootRemPx());
    const grabX = point.x - rect.left;
    offset = { x: grabX > width ? width / 2 : grabX, y: point.y - rect.top };
    tilt = prefersReducedMotion() ? '' : ' rotate(-2deg) scale(1.03)';
    const clone = el.cloneNode(true) as HTMLElement;
    scrub(clone);
    clone.classList.remove(PLACEHOLDER_CLASS);
    // A timeline block is `absolute` with an inline top/left/width (its place in the grid):
    // in the frame it must fill the frame instead, or it renders off inside it, invisible.
    Object.assign(clone.style, {
      position: 'relative',
      top: '0px',
      left: '0px',
      width: '100%',
      height: '100%',
      margin: '0',
    });
    // The chips' washes are translucent: on its card's own surface the clone reads exactly
    // as the chip does, instead of showing whatever it floats over through it.
    const frame = document.createElement('div');
    frame.className = GHOST_CLASS;
    frame.setAttribute('aria-hidden', 'true');
    frame.inert = true;
    Object.assign(frame.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: `${width}px`,
      height: `${rect.height}px`,
      pointerEvents: 'none',
      zIndex: Z,
      transformOrigin: `${offset.x}px ${offset.y}px`,
    });
    frame.appendChild(clone);
    document.body.appendChild(frame);
    ghost = frame;
    size = { width, height: rect.height };
    place(point);
  }

  /**
   * Follow the pointer, or sit on `snapRect` with an optional time `readout` above it.
   * `above` floats the free ghost ABOVE the finger (its bottom 0.75rem over the point) so a
   * small day target under the finger (a week-strip pill, an all-day cell) stays visible.
   */
  function place(point: Point, snapRect?: SnapRect, text?: string, above = false): void {
    if (!ghost) return;
    const x = snapRect ? snapRect.left : point.x - offset.x;
    const y = snapRect
      ? snapRect.top
      : above
        ? point.y - size.height - ABOVE_GAP_PX
        : point.y - offset.y;
    ghost.style.transform = `translate(${x}px, ${y}px)${snapRect ? '' : tilt}`;
    // On a slot the ghost IS the slot; off it, it floats at the chip's own size again.
    ghost.style.width = `${snapRect ? snapRect.width : size.width}px`;
    ghost.style.height = `${snapRect ? snapRect.height : size.height}px`;
    if (!text) {
      readout?.remove();
      readout = null;
      return;
    }
    if (!readout) {
      readout = document.createElement('div');
      readout.className = READOUT_CLASS;
      readout.setAttribute('aria-hidden', 'true');
      Object.assign(readout.style, { position: 'fixed', pointerEvents: 'none', zIndex: Z });
      document.body.appendChild(readout);
    }
    readout.textContent = text;
    readout.style.left = `${x}px`;
    readout.style.top = `${y}px`;
    readout.style.transform = 'translateY(calc(-100% - 0.25rem))';
  }

  /** Remove the ghost and readout and restore the source. Safe to call at any time. */
  function hide(): void {
    ghost?.remove();
    readout?.remove();
    source?.classList.remove(PLACEHOLDER_CLASS, SOLID_PLACEHOLDER_CLASS);
    ghost = readout = source = null;
  }

  if (getCurrentScope()) onScopeDispose(hide);

  return { show, place, hide };
}
