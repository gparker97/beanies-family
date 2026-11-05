/**
 * Calendar drag and drop (#142): "the lifted item is held near an edge", one implementation
 * with an axis parameter.
 *
 * - **horizontal** (month and week paging): within `DRAG.edgeZonePx` of the root's left or
 *   right edge for `DRAG.edgeDwellMs`, `onEdge('prev' | 'next')` fires once per dwell. Staying
 *   in the zone starts the next dwell, so holding keeps paging one step at a time; leaving
 *   the zone (or switching sides) restarts the clock.
 * - **vertical** (timelines): within `SCROLL_ZONE_PX` of the top or bottom of the app's
 *   scroll container (`getAppScroller`, the `<main>`; clipped to the viewport), a rAF loop
 *   scrolls it, faster the deeper into the zone. `onScroll` runs after each step so the
 *   binding can re-hit-test under a pointer that has not moved.
 *
 * `track(point)` on every lifted move; `stop()` when the drag ends.
 */
import { getCurrentScope, onScopeDispose, type Ref } from 'vue';
import { DRAG } from '@/utils/calendar/dragMath';
import { getAppScroller } from '@/utils/getAppScroller';

export const SCROLL_ZONE_PX = 48;
/** The fastest auto-scroll step, at the very edge. */
export const SCROLL_MAX_PX_PER_FRAME = 12;

export type EdgeDir = 'prev' | 'next';

export interface EdgeDwellOptions {
  axis: 'horizontal' | 'vertical';
  onEdge?: (dir: EdgeDir) => void;
  onScroll?: () => void;
}

export function useEdgeDwell(root: Ref<HTMLElement | null>, opts: EdgeDwellOptions) {
  let dwellDir: EdgeDir | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;
  /** Signed px per frame; 0 = not scrolling. */
  let speed = 0;

  function clearDwell(): void {
    if (dwellTimer !== null) clearTimeout(dwellTimer);
    dwellTimer = null;
    dwellDir = null;
  }

  function startDwell(dir: EdgeDir): void {
    dwellDir = dir;
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      opts.onEdge?.(dir);
      startDwell(dir); // still held there: the next dwell begins
    }, DRAG.edgeDwellMs);
  }

  function trackHorizontal(x: number): void {
    const rect = root.value?.getBoundingClientRect();
    let dir: EdgeDir | null = null;
    if (rect && rect.width > 0) {
      if (x <= rect.left + DRAG.edgeZonePx) dir = 'prev';
      else if (x >= rect.right - DRAG.edgeZonePx) dir = 'next';
    }
    if (dir === dwellDir) return;
    clearDwell();
    if (dir) startDwell(dir);
  }

  function loop(): void {
    const scroller = getAppScroller(root.value);
    if (!scroller || speed === 0) {
      frame = null;
      return;
    }
    scroller.scrollTop += speed;
    opts.onScroll?.();
    frame = requestAnimationFrame(loop);
  }

  function trackVertical(y: number): void {
    const scroller = getAppScroller(root.value);
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const depth = (d: number) =>
      Math.ceil(((SCROLL_ZONE_PX - Math.max(d, 0)) / SCROLL_ZONE_PX) * SCROLL_MAX_PX_PER_FRAME);
    if (y < top + SCROLL_ZONE_PX) speed = -depth(y - top);
    else if (y > bottom - SCROLL_ZONE_PX) speed = depth(bottom - y);
    else speed = 0;
    if (speed !== 0 && frame === null) frame = requestAnimationFrame(loop);
  }

  function track(point: { x: number; y: number }): void {
    if (opts.axis === 'horizontal') trackHorizontal(point.x);
    else trackVertical(point.y);
  }

  function stop(): void {
    clearDwell();
    speed = 0;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  if (getCurrentScope()) onScopeDispose(stop);

  return { track, stop };
}
