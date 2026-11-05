/** Edge dwell (#142): horizontal paging once per dwell; vertical auto-scroll of `<main>`. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { SCROLL_ZONE_PX, useEdgeDwell } from '@/composables/drag/useEdgeDwell';
import { DRAG } from '@/utils/calendar/dragMath';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

describe('useEdgeDwell', () => {
  let main: HTMLElement;
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    main = document.createElement('main');
    root = document.createElement('div');
    main.appendChild(root);
    document.body.appendChild(main);
    root.getBoundingClientRect = () => rect(100, 0, 700, 600);
    main.getBoundingClientRect = () => rect(0, 100, 1000, 600);
    vi.stubGlobal('innerHeight', 800);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    main.remove();
  });

  it('horizontal: fires once per full dwell inside the zone, repeating while held', () => {
    const onEdge = vi.fn();
    const dwell = useEdgeDwell(ref(root), { axis: 'horizontal', onEdge });
    dwell.track({ x: 790, y: 300 }); // within 24px of the right edge (800)
    vi.advanceTimersByTime(DRAG.edgeDwellMs - 1);
    expect(onEdge).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEdge).toHaveBeenCalledWith('next');
    dwell.track({ x: 791, y: 300 }); // still in the zone: the clock is not restarted
    vi.advanceTimersByTime(DRAG.edgeDwellMs);
    expect(onEdge).toHaveBeenCalledTimes(2);
    dwell.stop();
    vi.advanceTimersByTime(DRAG.edgeDwellMs * 3);
    expect(onEdge).toHaveBeenCalledTimes(2);
  });

  it('horizontal: leaving the zone or switching sides restarts the clock', () => {
    const onEdge = vi.fn();
    const dwell = useEdgeDwell(ref(root), { axis: 'horizontal', onEdge });
    dwell.track({ x: 110, y: 300 });
    vi.advanceTimersByTime(DRAG.edgeDwellMs - 100);
    dwell.track({ x: 400, y: 300 });
    vi.advanceTimersByTime(DRAG.edgeDwellMs);
    expect(onEdge).not.toHaveBeenCalled();
    dwell.track({ x: 110, y: 300 });
    vi.advanceTimersByTime(DRAG.edgeDwellMs);
    expect(onEdge).toHaveBeenCalledWith('prev');
  });

  it('vertical: scrolls <main> near its bottom, calls onScroll, and stops outside the zone', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => (frames.length = 0));
    const onScroll = vi.fn();
    const dwell = useEdgeDwell(ref(root), { axis: 'vertical', onScroll });
    dwell.track({ x: 300, y: 700 - SCROLL_ZONE_PX / 2 }); // main's bottom is 700
    frames.shift()!(0);
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(onScroll).toHaveBeenCalledTimes(1);
    dwell.track({ x: 300, y: 400 });
    frames.shift()?.(0);
    const settled = main.scrollTop;
    expect(frames).toHaveLength(0);
    expect(main.scrollTop).toBe(settled);
  });

  it('vertical: scrolls up near the top', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => (frames.length = 0));
    main.scrollTop = 200;
    const dwell = useEdgeDwell(ref(root), { axis: 'vertical' });
    dwell.track({ x: 300, y: 105 });
    frames.shift()!(0);
    expect(main.scrollTop).toBeLessThan(200);
    dwell.stop();
  });
});
