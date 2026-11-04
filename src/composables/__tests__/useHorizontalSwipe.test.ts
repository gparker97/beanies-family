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
import { defineComponent, h, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import {
  useHorizontalSwipe,
  pinchDirection,
  type UseHorizontalSwipeOptions,
} from '../useHorizontalSwipe';
import { pointer, swipe, pinch } from '@/test/pointerSwipe';

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

describe('useHorizontalSwipe', () => {
  beforeEach(() => {
    // Stub setPointerCapture / releasePointerCapture which jsdom lacks.
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
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
});
