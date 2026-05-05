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
import { useHorizontalSwipe, type UseHorizontalSwipeOptions } from '../useHorizontalSwipe';

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

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  el: HTMLElement,
  init: { x: number; y: number; pointerType?: string; pointerId?: number; button?: number }
) {
  // jsdom doesn't have PointerEvent — fall back to a CustomEvent-shaped Event
  // that carries the fields our handler reads (clientX, clientY, pointerId,
  // pointerType, button). dispatchEvent + a custom prototype is reliable.
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

function swipe(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  pointer('pointerdown', el, from);
  // Two intermediate moves so axis-lock has at least one decision point.
  pointer('pointermove', el, {
    x: from.x + (to.x - from.x) / 2,
    y: from.y + (to.y - from.y) / 2,
  });
  pointer('pointermove', el, to);
  pointer('pointerup', el, to);
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
});
