/**
 * Drives useHorizontalSwipe with synthesized PointerEvents to verify the
 * three guardrails (axis lock, edge ignore, threshold) and direction
 * mapping (finger left → onSwipeLeft → "next" semantics in callers).
 *
 * The composable runs inside Vue's reactive scope, so each test mounts a
 * tiny disposable component that owns the target ref + the composable
 * binding, then dispatches synthetic events on that component's root.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import {
  useHorizontalSwipe,
  pinchDirection,
  decideAxis,
  type UseHorizontalSwipeOptions,
} from '../useHorizontalSwipe';
import { pointer, swipe, pinch, touchMove } from '@/test/pointerSwipe';
import { logEvent } from '@/services/telemetry/logEvent';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

interface SwipeHarness {
  wrapper: VueWrapper;
  el: HTMLElement;
  onSwipeLeft: ReturnType<typeof vi.fn>;
  onSwipeRight: ReturnType<typeof vi.fn>;
  onProgress: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: Partial<UseHorizontalSwipeOptions> = {}): SwipeHarness {
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  const onProgress = vi.fn();

  const Comp = defineComponent({
    setup() {
      const target = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
      useHorizontalSwipe(target, {
        name: 'month-grid',
        onSwipeLeft,
        onSwipeRight,
        onProgress,
        ...opts,
      });
      return () => h('div', { ref: target, style: 'width:300px;height:300px' });
    },
  });

  const wrapper = mount(Comp, { attachTo: document.body });
  const el = wrapper.element as HTMLElement;
  return { wrapper, el, onSwipeLeft, onSwipeRight, onProgress };
}

/** The context of every `swipe_end` logged so far. */
function swipeEnds() {
  return vi
    .mocked(logEvent)
    .mock.calls.filter(([e]) => e.message === 'swipe_end')
    .map(([e]) => e.context);
}

describe('useHorizontalSwipe', () => {
  beforeEach(() => {
    // Stub setPointerCapture / releasePointerCapture which jsdom lacks.
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    vi.mocked(logEvent).mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('direction', () => {
    it('finger moves left past threshold → fires onSwipeLeft', () => {
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });

    it('finger moves right past threshold → fires onSwipeRight', () => {
      const h = makeHarness();
      swipe(h.el, { x: 100, y: 100 }, { x: 220, y: 100 });
      expect(h.onSwipeRight).toHaveBeenCalledTimes(1);
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
    });
  });

  describe('threshold', () => {
    it('does not fire below default 60px threshold', () => {
      const h = makeHarness();
      swipe(h.el, { x: 100, y: 100 }, { x: 140, y: 100 }); // 40px
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });

    it('respects custom threshold', () => {
      const h = makeHarness({ threshold: 30 });
      swipe(h.el, { x: 100, y: 100 }, { x: 140, y: 100 }); // 40px > 30
      expect(h.onSwipeRight).toHaveBeenCalledTimes(1);
    });
  });

  describe('axis lock', () => {
    it('ignores predominantly-vertical motion', () => {
      const h = makeHarness();
      // 80px right but 200px down — clearly vertical
      swipe(h.el, { x: 100, y: 100 }, { x: 180, y: 300 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });

    it('accepts horizontal even with some vertical drift', () => {
      const h = makeHarness();
      // 100px right, 30px down — still 3.3:1 horizontal
      swipe(h.el, { x: 100, y: 100 }, { x: 200, y: 130 });
      expect(h.onSwipeRight).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge ignore', () => {
    it('ignores touch swipes starting within 20px of the left edge', () => {
      const h = makeHarness();
      swipe(h.el, { x: 5, y: 100 }, { x: 200, y: 100 }); // started at x=5
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });

    it('does NOT ignore mouse drags from the edge (only touch)', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 5, y: 100, pointerType: 'mouse' });
      pointer('pointermove', h.el, { x: 100, y: 100, pointerType: 'mouse' });
      pointer('pointermove', h.el, { x: 200, y: 100, pointerType: 'mouse' });
      pointer('pointerup', h.el, { x: 200, y: 100, pointerType: 'mouse' });
      expect(h.onSwipeRight).toHaveBeenCalledTimes(1);
    });

    it('respects custom edgeIgnore', () => {
      const h = makeHarness({ edgeIgnore: 0 });
      swipe(h.el, { x: 5, y: 100 }, { x: 200, y: 100 });
      expect(h.onSwipeRight).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel', () => {
    it('does not fire on pointercancel mid-gesture', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointercancel', h.el, { x: 150, y: 100 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });
  });

  describe('progress callback', () => {
    it('fires onProgress with signed dx during a horizontal gesture', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointermove', h.el, { x: 200, y: 100 });
      pointer('pointerup', h.el, { x: 200, y: 100 });
      // First move (50px) locks axis to horizontal; subsequent move(s) +
      // the up event reset progress to 0.
      const calls = h.onProgress.mock.calls.map((c) => c[0]);
      expect(calls).toContain(50);
      expect(calls).toContain(100);
      expect(calls[calls.length - 1]).toBe(0);
    });

    it('does NOT fire onProgress for a vertical-locked gesture', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 110, y: 200 });
      pointer('pointerup', h.el, { x: 110, y: 200 });
      // Locked vertical on first move → no horizontal progress reported.
      expect(h.onProgress).not.toHaveBeenCalled();
    });
  });

  describe('enabled flag', () => {
    it('does nothing when enabled.value is false', () => {
      const enabled = ref(false);
      const h = makeHarness({ enabled });
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
    });

    it('fires when enabled.value flips to true', () => {
      const enabled = ref(false);
      const h = makeHarness({ enabled });
      enabled.value = true;
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
    });
  });

  describe('multi-touch cancel', () => {
    it('a second pointer cancels the swipe and reports onProgress(0)', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 150, y: 100, pointerId: 1 });
      h.onProgress.mockClear();
      pointer('pointerdown', h.el, { x: 250, y: 100, pointerId: 2 });
      expect(h.onProgress).toHaveBeenCalledWith(0);
      pointer('pointermove', h.el, { x: 50, y: 100, pointerId: 1 });
      pointer('pointerup', h.el, { x: 50, y: 100, pointerId: 1 });
      pointer('pointerup', h.el, { x: 250, y: 100, pointerId: 2 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });

    it('does not swipe again until every pointer has lifted', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 250, y: 100, pointerId: 2 });
      pointer('pointerup', h.el, { x: 200, y: 100, pointerId: 1 });
      // Finger 2 still down: moving it must not start a swipe.
      pointer('pointermove', h.el, { x: 150, y: 100, pointerId: 2 });
      pointer('pointermove', h.el, { x: 50, y: 100, pointerId: 2 });
      pointer('pointerup', h.el, { x: 50, y: 100, pointerId: 2 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      // Everything lifted: a fresh single-pointer swipe works.
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
    });

    it('a single-pointer swipe still commits', () => {
      const h = makeHarness();
      swipe(h.el, { x: 100, y: 100 }, { x: 220, y: 100 });
      expect(h.onSwipeRight).toHaveBeenCalledTimes(1);
    });

    it('a second finger inside the edge-ignore zone still cancels', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 150, y: 100, pointerId: 1 });
      h.onProgress.mockClear();
      pointer('pointerdown', h.el, { x: 5, y: 100, pointerId: 2 });
      expect(h.onProgress).toHaveBeenCalledWith(0);
      pointer('pointermove', h.el, { x: 50, y: 100, pointerId: 1 });
      pointer('pointerup', h.el, { x: 50, y: 100, pointerId: 1 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
    });

    it('a new primary pointerdown after a lost pointerup swipes normally', () => {
      const h = makeHarness();
      // Finger 1 goes down and its pointerup is lost.
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      // A new touch sequence: a primary pointer clears the stale entry.
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
    });

    it('releases pointer capture only after a horizontal lock', () => {
      const release = vi.fn();
      Element.prototype.releasePointerCapture = release;
      const h = makeHarness();
      // Vertical gesture, then a second finger: nothing was captured.
      pointer('pointerdown', h.el, { x: 100, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 100, y: 200, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 150, y: 100, pointerId: 2 });
      expect(release).not.toHaveBeenCalled();
      pointer('pointerup', h.el, { x: 100, y: 200, pointerId: 1 });
      pointer('pointerup', h.el, { x: 150, y: 100, pointerId: 2 });
      // Horizontal lock, then a second finger: capture is released.
      pointer('pointerdown', h.el, { x: 100, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 160, y: 100, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 150, y: 100, pointerId: 2 });
      expect(release).toHaveBeenCalledWith(1);
    });

    it('capture failures warn instead of throwing', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      Element.prototype.setPointerCapture = vi.fn(() => {
        throw new Error('gone');
      });
      Element.prototype.releasePointerCapture = vi.fn(() => {
        throw new Error('gone');
      });
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[useHorizontalSwipe] pointer capture failed'),
        expect.any(Error)
      );
      warn.mockRestore();
    });
  });

  describe('pinchDirection', () => {
    it('spreads at or above the ratio', () => {
      expect(pinchDirection(100, 125, 1.25)).toBe('spread');
      expect(pinchDirection(100, 200, 1.25)).toBe('spread');
    });

    it('pinches at or below the inverse ratio', () => {
      expect(pinchDirection(100, 80, 1.25)).toBe('pinch');
      expect(pinchDirection(100, 20, 1.25)).toBe('pinch');
    });

    it('is null between the thresholds', () => {
      expect(pinchDirection(100, 110, 1.25)).toBeNull();
      expect(pinchDirection(100, 90, 1.25)).toBeNull();
      expect(pinchDirection(100, 100, 1.25)).toBeNull();
    });

    it('is null when the starting distance is not positive', () => {
      expect(pinchDirection(0, 100, 1.25)).toBeNull();
      expect(pinchDirection(-5, 100, 1.25)).toBeNull();
    });
  });

  describe('onPinch', () => {
    const A0 = { x: 100, y: 100 };
    const B0 = { x: 200, y: 100 };

    it('fires spread once per gesture', () => {
      const onPinch = vi.fn();
      const h = makeHarness({ onPinch });
      pointer('pointerdown', h.el, { ...A0, pointerId: 1 });
      pointer('pointerdown', h.el, { ...B0, pointerId: 2 });
      pointer('pointermove', h.el, { x: 80, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 230, y: 100, pointerId: 2 });
      pointer('pointermove', h.el, { x: 40, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 300, y: 100, pointerId: 2 });
      expect(onPinch).toHaveBeenCalledTimes(1);
      expect(onPinch).toHaveBeenCalledWith('spread');
    });

    it('a third finger lifting re-baselines the pair, so no bogus pinch fires', () => {
      const onPinch = vi.fn();
      const h = makeHarness({ onPinch });
      pointer('pointerdown', h.el, { ...A0, pointerId: 1 });
      pointer('pointerdown', h.el, { ...B0, pointerId: 2 });
      pointer('pointerdown', h.el, { x: 150, y: 300, pointerId: 3 });
      pointer('pointerup', h.el, { x: 150, y: 300, pointerId: 3 });
      // Same distance as they started: nothing to report.
      pointer('pointermove', h.el, { ...A0, pointerId: 1 });
      pointer('pointermove', h.el, { ...B0, pointerId: 2 });
      expect(onPinch).not.toHaveBeenCalled();
      // Now spread past the ratio.
      pointer('pointermove', h.el, { x: 40, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 300, y: 100, pointerId: 2 });
      expect(onPinch).toHaveBeenCalledTimes(1);
      expect(onPinch).toHaveBeenCalledWith('spread');
    });

    it('fires pinch when the fingers close in', () => {
      const onPinch = vi.fn();
      const h = makeHarness({ onPinch });
      pinch(
        h.el,
        [A0, B0],
        [
          { x: 140, y: 100 },
          { x: 160, y: 100 },
        ]
      );
      expect(onPinch).toHaveBeenCalledTimes(1);
      expect(onPinch).toHaveBeenCalledWith('pinch');
    });

    it('fires again for the next gesture', () => {
      const onPinch = vi.fn();
      const h = makeHarness({ onPinch });
      pinch(
        h.el,
        [A0, B0],
        [
          { x: 140, y: 100 },
          { x: 160, y: 100 },
        ]
      );
      pinch(
        h.el,
        [A0, B0],
        [
          { x: 40, y: 100 },
          { x: 260, y: 100 },
        ]
      );
      expect(onPinch.mock.calls.map((c) => c[0])).toEqual(['pinch', 'spread']);
    });

    it('fires while enabled is false', () => {
      const onPinch = vi.fn();
      const h = makeHarness({ onPinch, enabled: ref(false) });
      pinch(
        h.el,
        [A0, B0],
        [
          { x: 40, y: 100 },
          { x: 260, y: 100 },
        ]
      );
      expect(onPinch).toHaveBeenCalledWith('spread');
    });

    it('does nothing for one pointer', () => {
      const onPinch = vi.fn();
      const h = makeHarness({ onPinch });
      pointer('pointerdown', h.el, { ...A0, pointerId: 1 });
      pointer('pointermove', h.el, { x: 300, y: 100, pointerId: 1 });
      pointer('pointerup', h.el, { x: 300, y: 100, pointerId: 1 });
      expect(onPinch).not.toHaveBeenCalled();
    });

    it('does nothing without onPinch', () => {
      const h = makeHarness();
      expect(() =>
        pinch(
          h.el,
          [A0, B0],
          [
            { x: 40, y: 100 },
            { x: 260, y: 100 },
          ]
        )
      ).not.toThrow();
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });
  });

  describe('decideAxis', () => {
    it.each([
      // dx, dy, ratio, minMove, expected
      [0, 0, 1.5, 8, null],
      [7, 7, 1.5, 8, null],
      [-7, 3, 1.5, 8, null],
      [8, 0, 1.5, 8, 'horizontal'],
      [-8, 0, 1.5, 8, 'horizontal'],
      [0, 8, 1.5, 8, 'vertical'],
      [10, 8, 1.5, 8, 'vertical'],
      [10, 8, 1, 8, 'horizontal'],
      [12, 8, 1.5, 8, 'vertical'], // 12 is not strictly > 1.5 * 8
      [13, 8, 1.5, 8, 'horizontal'],
      [5, 0, 1.5, 4, 'horizontal'],
      [5, 4, 1, 4, 'horizontal'],
      [5, 4, 1.5, 4, 'vertical'],
      [3, 3, 1, 4, null],
    ] as const)('dx %d, dy %d, ratio %d, minMove %d → %s', (dx, dy, ratio, minMove, expected) => {
      expect(decideAxis(dx, dy, ratio, minMove)).toBe(expected);
    });
  });

  describe('touch guard', () => {
    it('prevents a sideways first move, and keeps preventing for the rest of that gesture', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 105, y: 101 }).defaultPrevented).toBe(true);
      // Later moves of the same gesture stay claimed, whatever their direction.
      expect(touchMove(h.el, { x: 105, y: 106 }).defaultPrevented).toBe(true);
      expect(touchMove(h.el, { x: 130, y: 104 }).defaultPrevented).toBe(true);
    });

    it('a 5px sideways drift is claimed but reports no progress and locks nothing', () => {
      const capture = vi.fn();
      Element.prototype.setPointerCapture = capture;
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 105, y: 100 }).defaultPrevented).toBe(true);
      expect(h.onProgress).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
      // The pointer path is still pending: a later vertical move stands it down.
      pointer('pointermove', h.el, { x: 104, y: 115 });
      expect(h.onProgress).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    });

    it('does not prevent a vertical move', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 101, y: 106 }).defaultPrevented).toBe(false);
      expect(touchMove(h.el, { x: 102, y: 2 }).defaultPrevented).toBe(false);
    });

    it('does not prevent a move below the claim floor', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 103, y: 100 }).defaultPrevented).toBe(false);
    });

    it('after the pointer path stands a gesture down as vertical, never claims it', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      // The guard alone never stands a gesture down: the 8px vertical pointermove does.
      pointer('pointermove', h.el, { x: 100, y: 110 });
      expect(touchMove(h.el, { x: 140, y: 110 }).defaultPrevented).toBe(false);
    });

    it('keeps preventing once the pointer path has already locked horizontal', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 120, y: 100 });
      // A first touchmove that arrives late (Chrome on Android's slop) and reads vertical.
      expect(touchMove(h.el, { x: 120, y: 140 }).defaultPrevented).toBe(true);
    });

    it('does nothing when disabled', () => {
      const enabled = ref(true);
      const h = makeHarness({ enabled });
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      enabled.value = false; // the guard reads `enabled` directly while the gesture is pending
      expect(touchMove(h.el, { x: 120, y: 100 }).defaultPrevented).toBe(false);
    });

    it('does nothing on an edge touch', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 5, y: 100 });
      expect(touchMove(h.el, { x: 30, y: 100 }).defaultPrevented).toBe(false);
    });

    it('does nothing on an edge touch that follows a stale gesture', () => {
      const h = makeHarness();
      // A gesture whose pointerup was lost, then a fresh touch at the edge.
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointerdown', h.el, { x: 5, y: 100 });
      expect(touchMove(h.el, { x: 30, y: 100 }).defaultPrevented).toBe(false);
    });

    it('does nothing in multi-touch', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 2 });
      expect(touchMove(h.el, { x: 130, y: 100 }).defaultPrevented).toBe(false);
    });

    it('does nothing with two touches on the event', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 130, y: 100, touches: 2 }).defaultPrevented).toBe(false);
    });

    it('does nothing when the move is not cancelable (the claim is not recorded)', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 106, y: 100, cancelable: false }).defaultPrevented).toBe(false);
      // Unclaimed: the vertical stand-down that follows is not a false claim, so no event.
      pointer('pointermove', h.el, { x: 104, y: 115 });
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('does nothing without a gesture', () => {
      const h = makeHarness();
      expect(touchMove(h.el, { x: 130, y: 100 }).defaultPrevented).toBe(false);
    });

    it('respects axisLockRatio: dx 5 / dy 4 is claimed at 1, not at 1.5', () => {
      const relaxed = makeHarness({ axisLockRatio: 1 });
      pointer('pointerdown', relaxed.el, { x: 100, y: 100 });
      expect(touchMove(relaxed.el, { x: 105, y: 104 }).defaultPrevented).toBe(true);
      relaxed.wrapper.unmount();

      const strict = makeHarness();
      pointer('pointerdown', strict.el, { x: 100, y: 100 });
      expect(touchMove(strict.el, { x: 105, y: 104 }).defaultPrevented).toBe(false);
      strict.wrapper.unmount();
    });

    it('stops listening once unmounted', () => {
      const h = makeHarness();
      const remove = vi.spyOn(h.el, 'removeEventListener');
      h.wrapper.unmount();
      expect(remove).toHaveBeenCalledWith('touchmove', expect.any(Function));
    });
  });

  describe('pointercancel', () => {
    it('past the threshold on a horizontal gesture commits once', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointermove', h.el, { x: 120, y: 100 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
      expect(h.onSwipeRight).not.toHaveBeenCalled();
      expect(h.onProgress.mock.calls.at(-1)).toEqual([0]);
      // The gesture is over: a stray pointerup cannot commit it again.
      pointer('pointerup', h.el, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
    });

    it('below the threshold does not commit, and springs back', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onProgress.mock.calls.at(-1)).toEqual([0]);
    });

    it("acts only on the gesture's own pointer", () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointercancel', h.el, { x: 0, y: 0, pointerId: 7, pointerType: 'mouse' });
      pointer('pointermove', h.el, { x: 100, y: 100 });
      pointer('pointerup', h.el, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
    });

    it('the multi-touch cancel never commits, even past the threshold', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 100, y: 100, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 250, y: 100, pointerId: 2 });
      pointer('pointercancel', h.el, { x: 0, y: 0, pointerId: 1 });
      pointer('pointercancel', h.el, { x: 0, y: 0, pointerId: 2 });
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(h.onSwipeRight).not.toHaveBeenCalled();
    });

    it('a pointercancel after a vertical stand-down logs nothing', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 100, y: 120 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      expect(logEvent).not.toHaveBeenCalled();
      expect(h.onProgress).not.toHaveBeenCalled();
    });

    it('a pending gesture cancelled (a native scroll began) logs nothing', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 102, y: 104 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      expect(logEvent).not.toHaveBeenCalled();
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
    });
  });

  describe('stand-downs', () => {
    it('enabled turning false mid-horizontal-gesture does not abandon it, and the guard still prevents', async () => {
      const enabled = ref(true);
      const h = makeHarness({ enabled });
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      enabled.value = false;
      await nextTick();
      expect(touchMove(h.el, { x: 140, y: 120 }).defaultPrevented).toBe(true);
      pointer('pointermove', h.el, { x: 100, y: 100 });
      expect(h.onProgress.mock.calls.at(-1)).toEqual([-100]);
      pointer('pointerup', h.el, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'committed' })]);
    });

    it('never releases a pointer capture it did not set', () => {
      const release = vi.fn();
      Element.prototype.releasePointerCapture = release;
      const h = makeHarness();
      // Another party (the calendar drag, at lift) captures the pending gesture's pointer,
      // then a second finger abandons the gesture.
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      h.el.setPointerCapture(1);
      pointer('pointerdown', h.el, { x: 250, y: 100, pointerId: 2 });
      expect(release).not.toHaveBeenCalled();
      pointer('pointerup', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointerup', h.el, { x: 250, y: 100, pointerId: 2 });

      // A horizontal lock whose own capture failed: the abandon leaves the capture alone.
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      Element.prototype.setPointerCapture = vi.fn(() => {
        throw new Error('gone');
      });
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 150, y: 100, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 250, y: 100, pointerId: 2 });
      expect(h.onProgress).toHaveBeenCalledWith(0);
      expect(release).not.toHaveBeenCalled();
      vi.mocked(console.warn).mockRestore();
    });

    it('a stale horizontal gesture is abandoned at the next primary pointerdown', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      // Its pointerup is lost. The next touch sequence begins.
      h.onProgress.mockClear();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      expect(h.onProgress).toHaveBeenCalledWith(0);
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'stale' })]);
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointermove', h.el, { x: 100, y: 100 });
      pointer('pointerup', h.el, { x: 100, y: 100 });
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
    });

    it('a throwing onSwipeLeft still resets the gesture', () => {
      const release = vi.fn();
      Element.prototype.releasePointerCapture = release;
      const onSwipeLeft = vi.fn(() => {
        throw new Error('consumer failed');
      });
      const h = makeHarness({ onSwipeLeft });
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 100, y: 100 });
      // The consumer's error still surfaces (the test DOM rethrows a listener's error out of
      // dispatchEvent; a browser reports it).
      expect(() => pointer('pointerup', h.el, { x: 100, y: 100 })).toThrow('consumer failed');
      expect(onSwipeLeft).toHaveBeenCalledTimes(1);
      expect(h.onProgress.mock.calls.at(-1)).toEqual([0]);
      expect(release).toHaveBeenCalledWith(1);
      // Reset: a further move of that pointer reports nothing.
      h.onProgress.mockClear();
      pointer('pointermove', h.el, { x: 50, y: 100 });
      expect(h.onProgress).not.toHaveBeenCalled();
    });
  });

  describe('finish teardown', () => {
    it('a throwing onProgress on release still resets and releases', () => {
      const release = vi.fn();
      Element.prototype.releasePointerCapture = release;
      const onProgress = vi.fn((dx: number) => {
        if (dx === 0) throw new Error('progress failed');
      });
      const h = makeHarness({ onProgress });
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      expect(() => pointer('pointerup', h.el, { x: 150, y: 100 })).toThrow('progress failed');
      expect(release).toHaveBeenCalledWith(1);
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'short' })]);
      // Reset: a further move of that pointer reports nothing.
      onProgress.mockClear();
      pointer('pointermove', h.el, { x: 50, y: 100 });
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  describe('telemetry', () => {
    it('a committed touch swipe logs swipe_end with the surface name', () => {
      const h = makeHarness({ name: 'week' });
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logEvent).mock.calls[0]![0]).toEqual({
        level: 'info',
        surface: 'horizontal-swipe',
        message: 'swipe_end',
        context: {
          action: 'swipe_end',
          kind: 'committed',
          format: 'week',
          detail: 'unclaimed',
          count: 100,
        },
      });
    });

    it('a claimed swipe logs detail claimed', () => {
      const h = makeHarness({ name: 'day' });
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      touchMove(h.el, { x: 194, y: 101 });
      pointer('pointermove', h.el, { x: 150, y: 101 });
      pointer('pointerup', h.el, { x: 120, y: 101 });
      expect(swipeEnds()).toEqual([
        expect.objectContaining({ kind: 'committed', format: 'day', detail: 'claimed', count: 80 }),
      ]);
    });

    it('a cancel past the threshold logs committed_on_cancel', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 130, y: 100 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      expect(swipeEnds()).toEqual([
        expect.objectContaining({ kind: 'committed_on_cancel', count: 70 }),
      ]);
    });

    it('a cancel below the threshold logs browser_cancel', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'browser_cancel', count: 50 })]);
    });

    it('a release below the threshold logs short', () => {
      const h = makeHarness();
      swipe(h.el, { x: 100, y: 100 }, { x: 140, y: 100 });
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'short', count: 40 })]);
    });

    it('a second finger logs multi_touch', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointermove', h.el, { x: 150, y: 100, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 250, y: 100, pointerId: 2 });
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'multi_touch', count: 50 })]);
    });

    it('a claimed gesture that turns vertical logs vertical', () => {
      const h = makeHarness({ name: 'meals' });
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 105, y: 100 }).defaultPrevented).toBe(true);
      pointer('pointermove', h.el, { x: 104, y: 115 });
      expect(swipeEnds()).toEqual([
        expect.objectContaining({ kind: 'vertical', format: 'meals', detail: 'claimed', count: 4 }),
      ]);
      expect(h.onProgress).not.toHaveBeenCalled();
    });

    it('a pen swipe logs too', () => {
      const h = makeHarness({ name: 'deal-pile' });
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 }, 'pen');
      expect(swipeEnds()).toEqual([
        expect.objectContaining({ kind: 'committed', format: 'deal-pile' }),
      ]);
    });

    it('mouse gestures log nothing', () => {
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 }, 'mouse');
      swipe(h.el, { x: 100, y: 100 }, { x: 140, y: 100 }, 'mouse');
      expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('a claimed gesture released before it decides logs unresolved', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      expect(touchMove(h.el, { x: 105, y: 103 }).defaultPrevented).toBe(true);
      pointer('pointermove', h.el, { x: 106, y: 107 });
      pointer('pointerup', h.el, { x: 106, y: 107 });
      expect(swipeEnds()).toEqual([
        expect.objectContaining({ kind: 'unresolved', detail: 'claimed', count: 6 }),
      ]);
    });

    it('a claimed gesture cancelled before it decides logs unresolved', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      touchMove(h.el, { x: 105, y: 103 });
      pointer('pointermove', h.el, { x: 106, y: 107 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'unresolved', count: 6 })]);
    });

    it('an unclaimed tap logs nothing (unresolved is for claimed gestures only)', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 103, y: 104 });
      pointer('pointerup', h.el, { x: 103, y: 104 });
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('a tap and an ordinary vertical scroll log nothing', () => {
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointerup', h.el, { x: 101, y: 101 });
      swipe(h.el, { x: 100, y: 100 }, { x: 110, y: 250 });
      expect(logEvent).not.toHaveBeenCalled();
    });
  });

  describe('locked_out', () => {
    it('logs once for a sideways touch that landed while disabled, and changes nothing else', () => {
      const capture = vi.fn();
      Element.prototype.setPointerCapture = capture;
      const h = makeHarness({ name: 'week', enabled: ref(false) });
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      expect(touchMove(h.el, { x: 190, y: 100 }).defaultPrevented).toBe(false);
      pointer('pointermove', h.el, { x: 197, y: 100 }); // below 8px: undecided
      expect(logEvent).not.toHaveBeenCalled();
      pointer('pointermove', h.el, { x: 170, y: 102 });
      pointer('pointermove', h.el, { x: 100, y: 102 });
      pointer('pointerup', h.el, { x: 100, y: 102 });
      expect(swipeEnds()).toEqual([
        expect.objectContaining({
          kind: 'locked_out',
          format: 'week',
          detail: 'unclaimed',
          count: 30,
        }),
      ]);
      expect(h.onProgress).not.toHaveBeenCalled();
      expect(h.onSwipeLeft).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    });

    it('logs nothing for a vertical move while disabled', () => {
      const h = makeHarness({ enabled: ref(false) });
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 202, y: 120 });
      // Already decided vertical: a later sideways move does not count.
      pointer('pointermove', h.el, { x: 100, y: 120 });
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('logs nothing for a tap while disabled', () => {
      const h = makeHarness({ enabled: ref(false) });
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointerup', h.el, { x: 200, y: 100 });
      // The record is gone: a stray move of the same id after the lift logs nothing.
      pointer('pointermove', h.el, { x: 100, y: 100 });
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('logs nothing for a mouse while disabled', () => {
      const h = makeHarness({ enabled: ref(false) });
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 }, 'mouse');
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('logs nothing for an edge touch while disabled', () => {
      const h = makeHarness({ enabled: ref(false) });
      swipe(h.el, { x: 5, y: 100 }, { x: 100, y: 100 });
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('a second finger clears it silently', () => {
      const h = makeHarness({ enabled: ref(false) });
      pointer('pointerdown', h.el, { x: 200, y: 100, pointerId: 1 });
      pointer('pointerdown', h.el, { x: 250, y: 100, pointerId: 2 });
      pointer('pointerup', h.el, { x: 250, y: 100, pointerId: 2 });
      pointer('pointermove', h.el, { x: 100, y: 100, pointerId: 1 });
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('logs nothing locked_out when enabled (a normal swipe)', () => {
      const h = makeHarness({ enabled: ref(true) });
      swipe(h.el, { x: 200, y: 100 }, { x: 100, y: 100 });
      expect(swipeEnds()).toEqual([expect.objectContaining({ kind: 'committed' })]);
    });
  });
});
