/**
 * Drives useCalendarSlide via synthesized pointer gestures and asserts the
 * composable's three contracts:
 *
 *   1. Direction mapping — finger left → onNext, finger right → onPrev,
 *      with the underlying useHorizontalSwipe's axis lock + threshold
 *      gates respected.
 *   2. Visual transform — a horizontal drag applies translate3d to the
 *      target, with rubber-band damping past threshold.
 *   3. Re-entrancy — a second commit attempted while an animation is in
 *      flight is dropped (the swipe is rejected via the enabled-flag wired
 *      through useHorizontalSwipe).
 *
 * jsdom doesn't ship the Web Animations API, so we stub element.animate
 * with a Promise-backed shim and assert that runAnimation's `from`/`to`
 * frames + `applyTransform` end-state both land as expected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useCalendarSlide, type UseCalendarSlideOptions } from '../useCalendarSlide';

interface SlideHarness {
  wrapper: VueWrapper;
  el: HTMLElement;
  onNext: ReturnType<typeof vi.fn>;
  onPrev: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: Partial<UseCalendarSlideOptions> = {}, width = 300): SlideHarness {
  const onNext = vi.fn();
  const onPrev = vi.fn();

  const Comp = defineComponent({
    setup() {
      const target = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
      useCalendarSlide(target, { onNext, onPrev, ...opts });
      return () =>
        h('div', {
          ref: target,
          style: `width:${width}px;height:300px`,
        });
    },
  });

  const wrapper = mount(Comp, { attachTo: document.body });
  const el = wrapper.element as HTMLElement;
  // Pin offsetWidth (jsdom returns 0 for unrendered layout).
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
  return { wrapper, el, onNext, onPrev };
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  el: HTMLElement,
  init: { x: number; y: number; pointerType?: string; pointerId?: number; button?: number }
) {
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
  pointer('pointermove', el, {
    x: from.x + (to.x - from.x) / 2,
    y: from.y + (to.y - from.y) / 2,
  });
  pointer('pointermove', el, to);
  pointer('pointerup', el, to);
}

/**
 * Web Animations API shim. Returns an Animation-shaped object whose
 * `finished` promise resolves on the next microtask, mirroring real
 * browser behaviour closely enough for direction + lockout testing.
 * Tracks every animate() call for assertions.
 */
interface RecordedAnimation {
  keyframes: Keyframe[];
  options: number | KeyframeAnimationOptions | undefined;
  resolveFinished: () => void;
  cancelled: boolean;
}
function installAnimateShim(): RecordedAnimation[] {
  const recorded: RecordedAnimation[] = [];
  Element.prototype.animate = function (
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ) {
    const rec: RecordedAnimation = {
      keyframes: (keyframes ?? []) as Keyframe[],
      options,
      resolveFinished: () => {},
      cancelled: false,
    };
    recorded.push(rec);
    let resolveFn!: (value: Animation) => void;
    const finished = new Promise<Animation>((resolve) => {
      resolveFn = resolve;
    });
    const animation = {
      finished,
      cancel: () => {
        rec.cancelled = true;
      },
      play: () => {},
      pause: () => {},
      onfinish: null,
    } as unknown as Animation;
    rec.resolveFinished = () => resolveFn(animation);
    // Microtask resolution lets `await animation.finished` in the composable
    // settle once tests yield (await flushMicrotasks).
    Promise.resolve().then(() => rec.resolveFinished());
    return animation;
  } as Element['animate'];
  return recorded;
}

async function flushMicrotasks() {
  // Several queued microtasks (await promise chain in commit()): yield a few.
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
  // requestAnimationFrame between phase A and phase B — jsdom polyfills it
  // to setTimeout(_, 0), so flush a macrotask too.
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('useCalendarSlide', () => {
  let _originalAnimate: Element['animate'] | undefined;

  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    _originalAnimate = Element.prototype.animate;
    // matchMedia stub — default to "motion OK" so animations run.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    if (_originalAnimate) Element.prototype.animate = _originalAnimate;
  });

  describe('direction', () => {
    it('finger left past threshold → calls onNext (mid-animation)', async () => {
      installAnimateShim();
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      await flushMicrotasks();
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
    });

    it('finger right past threshold → calls onPrev (mid-animation)', async () => {
      installAnimateShim();
      const h = makeHarness();
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 });
      await flushMicrotasks();
      expect(h.onPrev).toHaveBeenCalledTimes(1);
      expect(h.onNext).not.toHaveBeenCalled();
    });

    it('does not fire below default 60px threshold', async () => {
      installAnimateShim();
      const h = makeHarness();
      swipe(h.el, { x: 100, y: 100 }, { x: 130, y: 100 });
      await flushMicrotasks();
      expect(h.onNext).not.toHaveBeenCalled();
      expect(h.onPrev).not.toHaveBeenCalled();
    });
  });

  describe('drag preview', () => {
    it('applies translate3d transform as the finger moves horizontally', () => {
      installAnimateShim();
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 130, y: 100 });
      // 30px movement, under threshold → no damping, raw value applied
      expect(h.el.style.transform).toContain('translate3d(30px');
    });

    it('rubber-bands past threshold (damping coefficient 0.45)', () => {
      installAnimateShim();
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 260, y: 100 });
      // dx=160 past threshold=60 → expected = 60 + (160-60)*0.45 = 105
      expect(h.el.style.transform).toBe('translate3d(105px, 0, 0)');
    });

    it('clears transform on cancel below threshold', async () => {
      installAnimateShim();
      const h = makeHarness();
      // Drag short of threshold, then release.
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 130, y: 100 });
      expect(h.el.style.transform).toContain('translate3d(30px');
      pointer('pointerup', h.el, { x: 130, y: 100 });
      await flushMicrotasks();
      // Spring-back animation lands at translate3d(0, 0, 0) → transform cleared.
      expect(h.el.style.transform).toBe('');
      expect(h.onNext).not.toHaveBeenCalled();
      expect(h.onPrev).not.toHaveBeenCalled();
    });
  });

  describe('animation sequence', () => {
    it('commit fires two animations: out-then-in, with content swap between', async () => {
      const animations = installAnimateShim();
      const h = makeHarness({}, 300);
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      await flushMicrotasks();
      // Two animations total: phase A (out to -width) + phase B (in from +width to 0).
      expect(animations).toHaveLength(2);
      // Phase A ends at -300px (negative direction).
      const phaseAEnd = (animations[0]!.keyframes[1] as Keyframe).transform as string;
      expect(phaseAEnd).toBe('translate3d(-300px, 0, 0)');
      // Phase B starts at +300px (snapped opposite edge) and ends at 0.
      const phaseBStart = (animations[1]!.keyframes[0] as Keyframe).transform as string;
      const phaseBEnd = (animations[1]!.keyframes[1] as Keyframe).transform as string;
      expect(phaseBStart).toBe('translate3d(300px, 0, 0)');
      expect(phaseBEnd).toBe('translate3d(0px, 0, 0)');
      // Final inline transform settles at empty (translate3d(0,0,0) cleared).
      expect(h.el.style.transform).toBe('');
    });
  });

  describe('re-entrancy', () => {
    it('drops a second commit fired mid-animation', async () => {
      // First gesture's animation never resolves so we stay in the
      // committing state while the second gesture is dispatched.
      const animations: RecordedAnimation[] = [];
      Element.prototype.animate = function (
        keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
        options?: number | KeyframeAnimationOptions
      ) {
        const rec: RecordedAnimation = {
          keyframes: (keyframes ?? []) as Keyframe[],
          options,
          resolveFinished: () => {},
          cancelled: false,
        };
        animations.push(rec);
        const finished = new Promise<Animation>(() => {
          /* never resolves */
        });
        return {
          finished,
          cancel: () => {
            rec.cancelled = true;
          },
          play: () => {},
          pause: () => {},
          onfinish: null,
        } as unknown as Animation;
      } as Element['animate'];

      const h = makeHarness();
      // First commit — phase A animation kicks off and hangs (never resolves
      // in this test). onNext won't fire until phase A completes (mid-flight
      // content swap is by design); what we're proving here is that the
      // second gesture doesn't even start a second animation.
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      expect(animations).toHaveLength(1);
      expect(h.onNext).not.toHaveBeenCalled();
      // Second commit attempted — useHorizontalSwipe's enabled flag is now
      // false (computed off isAnimating), so the gesture is rejected at
      // pointerdown and no second animation is queued.
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      expect(animations).toHaveLength(1);
      expect(h.onNext).not.toHaveBeenCalled();
    });
  });

  describe('reduced motion', () => {
    it('skips animation entirely and calls handler synchronously', async () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      const animations = installAnimateShim();
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      await flushMicrotasks();
      expect(animations).toHaveLength(0);
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.el.style.transform).toBe('');
    });

    it('does not apply a drag preview under reduced motion', () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      installAnimateShim();
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 100, y: 100 });
      pointer('pointermove', h.el, { x: 200, y: 100 });
      expect(h.el.style.transform).toBe('');
    });
  });
});
