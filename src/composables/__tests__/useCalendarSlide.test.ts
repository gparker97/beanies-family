/**
 * Drives useCalendarSlide via synthesized pointer gestures and asserts the
 * composable's three contracts:
 *
 *   1. Direction mapping — finger left → onNext, finger right → onPrev,
 *      with the underlying useHorizontalSwipe's axis lock + threshold
 *      gates respected.
 *   2. Visual transform — a horizontal drag applies translate3d to the
 *      target, with rubber-band damping past threshold.
 *   3. Re-entrancy: a swipe made while an animation is in flight is not
 *      rejected; its page turn is queued (a signed count) and runs when the
 *      animation ends, and live progress is ignored until then.
 *
 * jsdom doesn't ship the Web Animations API, so we stub element.animate
 * with a Promise-backed shim and assert that runAnimation's `from`/`to`
 * frames + `applyTransform` end-state both land as expected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useCalendarSlide, type UseCalendarSlideOptions } from '../useCalendarSlide';
import { pointer, swipe, pinch } from '@/test/pointerSwipe';
import { logEvent } from '@/services/telemetry/logEvent';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

interface SlideHarness {
  wrapper: VueWrapper;
  el: HTMLElement;
  onNext: ReturnType<typeof vi.fn>;
  onPrev: ReturnType<typeof vi.fn>;
}

function makeHarness(
  opts: Partial<UseCalendarSlideOptions> = {},
  width = 300,
  /** Changing it renders a NEW target element (a target swap). */
  elementKey = ref(0)
): SlideHarness {
  const onNext = vi.fn();
  const onPrev = vi.fn();

  const Comp = defineComponent({
    setup() {
      const target = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
      useCalendarSlide(target, { name: 'month-grid', onNext, onPrev, ...opts });
      return () =>
        h('div', {
          key: elementKey.value,
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
function installAnimateShim(auto = true): RecordedAnimation[] {
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
    // settle once tests yield (await flushMicrotasks). With `auto` false the
    // test ends each animation itself (see `settle`).
    if (auto) Promise.resolve().then(() => rec.resolveFinished());
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

/** The context of every `queue_dropped` logged so far. */
function queueDrops() {
  return vi
    .mocked(logEvent)
    .mock.calls.filter(([e]) => e.message === 'queue_dropped')
    .map(([e]) => e.context);
}

/** Ends one manually driven animation and lets the composable run on from it. */
async function settle(rec: RecordedAnimation | undefined) {
  rec!.resolveFinished();
  await flushMicrotasks();
}

describe('useCalendarSlide', () => {
  let _originalAnimate: Element['animate'] | undefined;

  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    vi.mocked(logEvent).mockClear();
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

    it('axisLockRatio passes through: dx 10 / dy 8 previews at ratio 1, not at the default 1.5', () => {
      installAnimateShim();
      const relaxed = makeHarness({ axisLockRatio: 1 });
      pointer('pointerdown', relaxed.el, { x: 100, y: 100 });
      pointer('pointermove', relaxed.el, { x: 110, y: 108 });
      expect(relaxed.el.style.transform).toContain('translate3d(10px');
      relaxed.wrapper.unmount();

      const strict = makeHarness();
      pointer('pointerdown', strict.el, { x: 100, y: 100 });
      pointer('pointermove', strict.el, { x: 110, y: 108 });
      expect(strict.el.style.transform).toBe('');
      strict.wrapper.unmount();
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

  describe('browser cancel', () => {
    it('a cancel past threshold runs the commit animation path, not the spring-back', async () => {
      const animations = installAnimateShim();
      const h = makeHarness({}, 300);
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      pointer('pointermove', h.el, { x: 100, y: 100 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      await flushMicrotasks();
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
      // Phase A out to -width, then phase B in from +width: the commit, not a spring to 0.
      expect(animations).toHaveLength(2);
      expect((animations[0]!.keyframes[1] as Keyframe).transform).toBe('translate3d(-300px, 0, 0)');
      expect((animations[1]!.keyframes[0] as Keyframe).transform).toBe('translate3d(300px, 0, 0)');
      expect(h.el.style.transform).toBe('');
    });

    it('a cancel below threshold springs back', async () => {
      const animations = installAnimateShim();
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 160, y: 100 });
      pointer('pointercancel', h.el, { x: 0, y: 0 });
      await flushMicrotasks();
      expect(h.onNext).not.toHaveBeenCalled();
      expect(animations).toHaveLength(1);
      expect((animations[0]!.keyframes[1] as Keyframe).transform).toBe('translate3d(0px, 0, 0)');
      expect(h.el.style.transform).toBe('');
    });
  });

  describe('reversal through zero', () => {
    it('a finger that reverses through dx 0 mid-swipe still turns the page once', async () => {
      installAnimateShim();
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 230, y: 100 });
      // Back through the start: onProgress(0) starts a spring-back while the finger is
      // still down. The gesture under the finger must survive it.
      pointer('pointermove', h.el, { x: 200, y: 100 });
      await flushMicrotasks();
      pointer('pointermove', h.el, { x: 100, y: 100 });
      pointer('pointerup', h.el, { x: 100, y: 100 });
      await flushMicrotasks();
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
    });
  });

  describe('queued page turn', () => {
    it('a second swipe released during the commit animation turns the page twice, in order', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 }); // next
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 }); // prev, during phase A
      expect(animations).toHaveLength(1);
      await settle(animations[0]); // phase A ends: the first turn lands
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
      await settle(animations[1]); // phase B ends: the queued turn starts
      expect(h.onPrev).not.toHaveBeenCalled();
      expect(animations).toHaveLength(3);
      // The queued turn starts from centre (its own phase A out to +width).
      expect((animations[2]!.keyframes[0] as Keyframe).transform).toBe('translate3d(0px, 0, 0)');
      expect((animations[2]!.keyframes[1] as Keyframe).transform).toBe('translate3d(300px, 0, 0)');
      await settle(animations[2]);
      expect(h.onPrev).toHaveBeenCalledTimes(1);
      expect(h.onNext.mock.invocationCallOrder[0]!).toBeLessThan(
        h.onPrev.mock.invocationCallOrder[0]!
      );
      await settle(animations[3]);
      expect(h.el.style.transform).toBe('');
    });

    it('a swipe released during a spring-back turns the page once the spring-back ends', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 170, y: 100 }); // short: springs back
      expect(animations).toHaveLength(1);
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      expect(animations).toHaveLength(1);
      expect(h.onNext).not.toHaveBeenCalled();
      await settle(animations[0]); // spring-back ends: the queued turn starts
      expect(animations).toHaveLength(2);
      await settle(animations[1]);
      expect(h.onNext).toHaveBeenCalledTimes(1);
      await settle(animations[2]);
      expect(h.onNext).toHaveBeenCalledTimes(1);
    });

    it('the reversal trace released at once (no flush after the zero) turns the page exactly once', async () => {
      const animations = installAnimateShim();
      const h = makeHarness();
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 230, y: 100 });
      pointer('pointermove', h.el, { x: 200, y: 100 }); // dx 0: a spring-back starts
      pointer('pointermove', h.el, { x: 100, y: 100 });
      pointer('pointerup', h.el, { x: 100, y: 100 });
      await flushMicrotasks();
      await flushMicrotasks();
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
      // The spring-back, then the queued turn's two phases.
      expect(animations).toHaveLength(3);
      expect(h.el.style.transform).toBe('');
    });

    it('queued turns add up: next then prev cancel out, so no further turn runs', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 }); // next: animates
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 }); // next, queued (+1)
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 }); // prev, queued (0)
      await settle(animations[0]);
      await settle(animations[1]);
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
      expect(animations).toHaveLength(2);
    });

    it('next + next queued: two more turns, one after another', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      await settle(animations[0]);
      await settle(animations[1]); // first turn done: the second starts
      expect(animations).toHaveLength(3);
      expect(h.onNext).toHaveBeenCalledTimes(1);
      await settle(animations[2]);
      expect(h.onNext).toHaveBeenCalledTimes(2);
      await settle(animations[3]); // second done: the third starts
      expect(animations).toHaveLength(5);
      await settle(animations[4]);
      await settle(animations[5]);
      expect(h.onNext).toHaveBeenCalledTimes(3);
      expect(h.onPrev).not.toHaveBeenCalled();
      expect(animations).toHaveLength(6);
    });

    it('next + prev queued: no further turn', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 }); // prev: animates
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 }); // next, queued
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 }); // prev, queued: nets out
      await settle(animations[0]);
      await settle(animations[1]);
      expect(h.onPrev).toHaveBeenCalledTimes(1);
      expect(h.onNext).not.toHaveBeenCalled();
      expect(animations).toHaveLength(2);
    });

    it('the queue holds at most three turns either way', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      for (let i = 0; i < 6; i++) swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      for (let i = 0; i < 12 && animations.at(i); i++) await settle(animations.at(i));
      // The first turn plus three queued.
      expect(h.onNext).toHaveBeenCalledTimes(4);
      expect(animations).toHaveLength(8);
    });

    it("a queued turn is dropped if the consumer's enabled is false when the animation ends", async () => {
      const animations = installAnimateShim(false);
      const enabled = ref(true);
      const h = makeHarness({ enabled });
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 }); // queued
      enabled.value = false;
      await settle(animations[0]);
      await settle(animations[1]);
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
      expect(animations).toHaveLength(2);
      expect(queueDrops()).toEqual([
        {
          action: 'queue_dropped',
          format: 'month-grid',
          detail: 'disabled',
          count: 1,
        },
      ]);
      // Dropped, not deferred: re-enabling later does not run it.
      enabled.value = true;
      await flushMicrotasks();
      expect(h.onPrev).not.toHaveBeenCalled();
    });

    it('live progress during an animation applies no transform; after it ends, progress applies again', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      const during = h.el.style.transform;
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 });
      expect(h.el.style.transform).toBe(during);
      await settle(animations[0]);
      await settle(animations[1]);
      expect(h.el.style.transform).toBe('');
      // dx -30, shown relative to the -50 ignored during the animation (no jump).
      pointer('pointermove', h.el, { x: 170, y: 100 });
      expect(h.el.style.transform).toBe('translate3d(20px, 0, 0)');
    });

    it('an idle dispose logs nothing', () => {
      installAnimateShim(false);
      makeHarness().wrapper.unmount();
      expect(queueDrops()).toEqual([]);
    });

    it('a target-element swap drops the queued turn', async () => {
      const animations = installAnimateShim(false);
      const key = ref(0);
      const h = makeHarness({ name: 'week' }, 300, key);
      await nextTick(); // the first bind (null to the element) drops nothing
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 }); // queued
      key.value = 1; // a new element
      await nextTick();
      expect(queueDrops()).toEqual([
        expect.objectContaining({ format: 'week', detail: 'target_changed', count: 1 }),
      ]);
      for (let i = 0; i < 4 && animations.at(i); i++) await settle(animations.at(i));
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(h.onPrev).not.toHaveBeenCalled();
      h.wrapper.unmount();
    });

    it('a finger still down when the animation ends: the card follows from where it is, no jump', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 280, y: 100 }, { x: 160, y: 100 }); // a turn animates
      pointer('pointerdown', h.el, { x: 200, y: 100 });
      pointer('pointermove', h.el, { x: 150, y: 100 }); // -50, ignored
      await settle(animations[0]);
      await settle(animations[1]);
      expect(h.el.style.transform).toBe('');
      pointer('pointermove', h.el, { x: 148, y: 100 }); // -52: 2px from where it was
      expect(h.el.style.transform).toBe('translate3d(-2px, 0, 0)');
      pointer('pointermove', h.el, { x: 120, y: 100 }); // -80
      expect(h.el.style.transform).toBe('translate3d(-30px, 0, 0)');
      // The threshold is still on the real dx: the release turns the page.
      pointer('pointerup', h.el, { x: 120, y: 100 });
      await settle(animations[2]);
      expect(h.onNext).toHaveBeenCalledTimes(2);
    });

    it('a throwing onNext under reduced motion still lets the next swipe turn the page', () => {
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
      h.onNext.mockImplementationOnce(() => {
        throw new Error('consumer failed');
      });
      // The error surfaces at once (the test DOM rethrows a listener's error).
      expect(() => swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 })).toThrow('consumer failed');
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      expect(h.onNext).toHaveBeenCalledTimes(2);
    });

    it('dispose with a queued turn runs nothing', async () => {
      const animations = installAnimateShim(false);
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      swipe(h.el, { x: 80, y: 100 }, { x: 200, y: 100 }); // queued
      h.wrapper.unmount();
      expect(queueDrops()).toEqual([expect.objectContaining({ detail: 'dispose', count: 1 })]);
      // Run on whatever the in-flight turn still animates (the array grows as it goes).
      for (let i = 0; i < 4 && animations.at(i); i++) await settle(animations.at(i));
      expect(h.onPrev).not.toHaveBeenCalled();
      expect(animations.length).toBeLessThanOrEqual(2);
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

  describe('pinch passthrough', () => {
    it('forwards onPinch to the swipe', () => {
      const onPinch = vi.fn();
      const h = makeHarness({ onPinch });
      pinch(
        h.el,
        [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
        [
          { x: 40, y: 100 },
          { x: 260, y: 100 },
        ]
      );
      expect(onPinch).toHaveBeenCalledTimes(1);
      expect(onPinch).toHaveBeenCalledWith('spread');
    });
  });

  describe('animation failures', () => {
    /** An animate() whose `finished` rejects with the given error. */
    function installRejectingAnimate(err: unknown) {
      Element.prototype.animate = function () {
        const finished = Promise.reject(err);
        finished.catch(() => {});
        return { finished, cancel: () => {} } as unknown as Animation;
      } as Element['animate'];
    }

    it('an AbortError is quiet', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      installRejectingAnimate(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      await flushMicrotasks();
      expect(h.onNext).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('any other rejection warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      installRejectingAnimate(new Error('boom'));
      const h = makeHarness();
      swipe(h.el, { x: 200, y: 100 }, { x: 80, y: 100 });
      await flushMicrotasks();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[useCalendarSlide] animation finished failed'),
        expect.any(Error)
      );
      warn.mockRestore();
    });
  });
});
