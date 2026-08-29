/**
 * Drives `useWheelMonthPaging` with synthetic wheel events against mocked
 * scroller geometry and asserts its state machine:
 *
 *   1. Consume condition — a wheel is only hijacked when the target's edge is
 *      visible AND the scroller is at its limit, in both directions.
 *   2. Accumulation → threshold → exactly one commit per gesture.
 *   3. Delta normalization — line and page `deltaMode`s reach the threshold
 *      (raw Firefox line deltas would never get there).
 *   4. Cooldown swallows the trackpad momentum tail in the committing
 *      direction only; reversing stays free.
 *   5. Reduced motion commits with no transform.
 *   6. Liveness — a torn-down or superseded commit never fires a navigation
 *      intent, and a hidden tab (no rAF) cannot strand the slide.
 *   7. `isPaging` tracks the whole slide + cooldown window.
 *   8. ctrl+wheel (pinch zoom) is never consumed.
 *   9. An open overlay makes the composable inert.
 *  10. `enabled: false` never attaches a listener.
 *  11. Teardown removes the listener and clears the timers.
 *
 * Honest limit: jsdom cannot verify the *feel* (rubber-band physics, momentum
 * delivery, real trackpad event cadence). That is what the plan's
 * hand-verification matrix is for. These tests pin the logic, not the motion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';

const getAppScroller = vi.fn<(from: Element | null | undefined) => HTMLElement | null>();
const hasOpenOverlays = vi.fn<() => boolean>(() => false);
const logEvent = vi.fn();
const reportError = vi.fn();
const prefersReducedMotion = ref(false);

vi.mock('@/utils/getAppScroller', () => ({
  getAppScroller: (from: Element | null | undefined) => getAppScroller(from),
}));
vi.mock('@/utils/overlayStack', () => ({
  hasOpenOverlays: () => hasOpenOverlays(),
}));
vi.mock('@/services/telemetry', () => ({
  logEvent: (input: unknown) => logEvent(input),
}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: (input: unknown) => reportError(input),
}));
vi.mock('@/composables/useReducedMotion', () => ({
  useReducedMotion: () => ({ prefersReducedMotion }),
}));

import { useWheelMonthPaging, type UseWheelMonthPagingOptions } from '../useWheelMonthPaging';

/** Scroller geometry knobs the consume condition reads. */
interface ScrollerState {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  top: number;
  bottom: number;
}

interface Harness {
  wrapper: VueWrapper;
  el: HTMLElement;
  onNext: ReturnType<typeof vi.fn>;
  onPrev: ReturnType<typeof vi.fn>;
  /** Target rect, mutable per assertion. */
  rect: { top: number; bottom: number };
  scroller: ScrollerState;
  isPaging: Ref<boolean>;
}

const AT_BOTTOM: ScrollerState = {
  scrollTop: 400,
  clientHeight: 600,
  scrollHeight: 1000,
  top: 0,
  bottom: 600,
};

function makeHarness(
  opts: Partial<UseWheelMonthPagingOptions> = {},
  scrollerState: Partial<ScrollerState> = {}
): Harness {
  const onNext = vi.fn();
  const onPrev = vi.fn();
  const scroller: ScrollerState = { ...AT_BOTTOM, ...scrollerState };
  const rect = { top: 100, bottom: 500 };

  const scrollerEl = document.createElement('main');
  Object.defineProperty(scrollerEl, 'scrollTop', { get: () => scroller.scrollTop });
  Object.defineProperty(scrollerEl, 'clientHeight', { get: () => scroller.clientHeight });
  Object.defineProperty(scrollerEl, 'scrollHeight', { get: () => scroller.scrollHeight });
  scrollerEl.getBoundingClientRect = () =>
    ({ top: scroller.top, bottom: scroller.bottom }) as DOMRect;
  getAppScroller.mockImplementation(() => scrollerEl);

  // Assigned during `setup()`, which runs synchronously inside `mount()` below.
  let isPaging!: Ref<boolean>;

  const Comp = defineComponent({
    setup() {
      const target = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
      // The composable's own ref, handed straight to the assertions — this is
      // exactly what CalendarGrid feeds into `useCalendarSlide`'s `enabled`.
      isPaging = useWheelMonthPaging(target, { onNext, onPrev, ...opts }).isPaging;
      return () => h('div', { ref: target });
    },
  });

  const wrapper = mount(Comp, { attachTo: document.body });
  const el = wrapper.element as HTMLElement;
  el.getBoundingClientRect = () => ({ top: rect.top, bottom: rect.bottom }) as DOMRect;
  return { wrapper, el, onNext, onPrev, rect, scroller, isPaging };
}

/** Dispatches a cancelable wheel event and reports whether it was consumed. */
function wheel(
  el: HTMLElement,
  deltaY: number,
  init: { deltaMode?: number; ctrlKey?: boolean } = {}
): boolean {
  const event = new Event('wheel', { bubbles: true, cancelable: true }) as Event & {
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
  };
  event.deltaY = deltaY;
  event.deltaMode = init.deltaMode ?? 0;
  event.ctrlKey = init.ctrlKey ?? false;
  el.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers();
  getAppScroller.mockReset();
  hasOpenOverlays.mockReset().mockReturnValue(false);
  logEvent.mockReset();
  reportError.mockReset();
  prefersReducedMotion.value = false;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useWheelMonthPaging — consume condition', () => {
  it('consumes a wheel-down at the bottom edge with the scroller at its limit', () => {
    const h1 = makeHarness();
    expect(wheel(h1.el, 30)).toBe(true);
    h1.wrapper.unmount();
  });

  it('ignores a wheel-down when the scroller is not at its downward limit', () => {
    const h1 = makeHarness({}, { scrollTop: 100 });
    expect(wheel(h1.el, 30)).toBe(false);
    // …and does not accumulate: a full threshold's worth still never commits.
    for (let i = 0; i < 10; i++) wheel(h1.el, 60);
    expect(h1.onNext).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it("ignores a wheel-down when the target's bottom edge is below the scroller", () => {
    const h1 = makeHarness();
    h1.rect.bottom = 900; // grid extends past the visible scroller bottom
    expect(wheel(h1.el, 30)).toBe(false);
    h1.wrapper.unmount();
  });

  it('consumes a wheel-up at the top of the scroller with the top edge visible', () => {
    const h1 = makeHarness({}, { scrollTop: 0 });
    expect(wheel(h1.el, -30)).toBe(true);
    h1.wrapper.unmount();
  });

  it('ignores a wheel-up when the scroller is scrolled away from the top', () => {
    const h1 = makeHarness({}, { scrollTop: 50 });
    expect(wheel(h1.el, -30)).toBe(false);
    h1.wrapper.unmount();
  });

  it("ignores a wheel-up when the target's top edge is above the scroller", () => {
    const h1 = makeHarness({}, { scrollTop: 0 });
    h1.rect.top = -200;
    expect(wheel(h1.el, -30)).toBe(false);
    h1.wrapper.unmount();
  });

  it('does nothing when the app scroller cannot be resolved', () => {
    const h1 = makeHarness();
    getAppScroller.mockImplementation(() => null);
    expect(wheel(h1.el, 400)).toBe(false);
    expect(h1.onNext).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it('ignores a zero-delta wheel event', () => {
    const h1 = makeHarness();
    expect(wheel(h1.el, 0)).toBe(false);
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — accumulation and commit', () => {
  it('rubber-bands below the threshold without paging, then springs back when idle', () => {
    const h1 = makeHarness();
    wheel(h1.el, 40);
    expect(h1.el.style.transform).toBe('translateY(-5px)');
    expect(h1.onNext).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(h1.el.style.transform).toBe('');
    h1.wrapper.unmount();
  });

  it('stretches proportionally to the accumulated delta (acc / 8, capped at 24px)', () => {
    const h1 = makeHarness();
    wheel(h1.el, 80);
    expect(h1.el.style.transform).toBe('translateY(-10px)');
    wheel(h1.el, 40); // acc = 120 — the largest stretch reachable before commit
    expect(h1.el.style.transform).toBe('translateY(-15px)');
    expect(h1.onNext).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it('commits exactly one next-month at 140px of accumulation', () => {
    const h1 = makeHarness();
    wheel(h1.el, 60);
    wheel(h1.el, 60);
    expect(h1.onNext).not.toHaveBeenCalled();
    wheel(h1.el, 60); // 180 ≥ 140
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    expect(h1.onPrev).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it('commits a previous-month on upward accumulation', () => {
    const h1 = makeHarness({}, { scrollTop: 0 });
    wheel(h1.el, -80);
    wheel(h1.el, -80);
    expect(h1.onPrev).toHaveBeenCalledTimes(1);
    expect(h1.onNext).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it('emits the wheel-page-commit telemetry event with the direction', () => {
    const h1 = makeHarness();
    wheel(h1.el, 200);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'calendar-nav',
        level: 'info',
        context: { action: 'wheel-page-commit', detail: 'next' },
      })
    );
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — cooldown', () => {
  it('swallows a momentum tail: a post-commit burst produces no second commit', () => {
    const h1 = makeHarness();
    wheel(h1.el, 200);
    expect(h1.onNext).toHaveBeenCalledTimes(1);

    // Trackpad momentum: a decaying burst of events immediately after.
    for (const d of [180, 140, 110, 90, 70, 50, 30, 20, 10, 5]) {
      expect(wheel(h1.el, d)).toBe(true); // consumed…
    }
    expect(h1.onNext).toHaveBeenCalledTimes(1); // …and discarded.

    // Cooldown expires; the accumulator is clean, so a fresh gesture needs
    // the full threshold again.
    vi.advanceTimersByTime(500);
    wheel(h1.el, 60);
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    wheel(h1.el, 100);
    expect(h1.onNext).toHaveBeenCalledTimes(2);
    h1.wrapper.unmount();
  });

  it('leaves the OPPOSITE direction alone during the cooldown', () => {
    // Scroller with nothing to scroll: both edges qualify, so the only thing
    // that can gate the wheel-up is the cooldown itself.
    const h1 = makeHarness({}, { scrollTop: 0, clientHeight: 600, scrollHeight: 600 });
    wheel(h1.el, 200);
    expect(h1.onNext).toHaveBeenCalledTimes(1);

    // Same direction → swallowed (momentum tail).
    expect(wheel(h1.el, 80)).toBe(true);
    // Reversing → untouched, so the page can scroll up to the content above
    // instead of feeling frozen for half a second.
    expect(wheel(h1.el, -80)).toBe(false);
    expect(h1.onPrev).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it('clears the transform once the cooldown expires', () => {
    const h1 = makeHarness();
    wheel(h1.el, 200);
    vi.advanceTimersByTime(500);
    expect(h1.el.style.transform).toBe('');
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — commit slide (WAAPI present)', () => {
  /**
   * jsdom ships no Web Animations API, so the default path above degrades to
   * the instant swap. This stubs `animate` to assert the two-phase sequence:
   * out in the direction of travel → content swap → snap opposite → in.
   */
  it('runs a two-phase vertical slide and swaps the month between phases', async () => {
    const h1 = makeHarness();
    const frames: Keyframe[][] = [];
    let swappedAfterPhases = -1;
    h1.onNext.mockImplementation(() => {
      swappedAfterPhases = frames.length;
    });
    (h1.el as HTMLElement).animate = ((keyframes: Keyframe[]) => {
      frames.push(keyframes);
      return { finished: Promise.resolve(), cancel: () => {} } as unknown as Animation;
    }) as HTMLElement['animate'];

    wheel(h1.el, 200);
    await vi.advanceTimersByTimeAsync(50);

    expect(h1.onNext).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(2);
    // Phase A travels upward (wheel-down) and fades out.
    expect(frames[0][1]).toMatchObject({ transform: 'translateY(-40px)', opacity: '0' });
    // The swap happens between the two phases, while the grid is invisible.
    expect(swappedAfterPhases).toBe(1);
    // Phase B enters from the opposite edge and fades in.
    expect(frames[1][0]).toMatchObject({ transform: 'translateY(40px)', opacity: '0' });
    expect(frames[1][1]).toMatchObject({ transform: 'translateY(0px)', opacity: '1' });

    await vi.advanceTimersByTimeAsync(500);
    expect(h1.el.style.transform).toBe('');
    expect(h1.el.style.opacity).toBe('');
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — deltaMode normalization', () => {
  it('commits in DOM_DELTA_PIXEL mode (deltas are already pixels)', () => {
    const h1 = makeHarness();
    wheel(h1.el, 150, { deltaMode: 0 });
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    h1.wrapper.unmount();
  });

  it('commits in DOM_DELTA_LINE mode — Firefox on Windows/Linux sends ~3 per notch', () => {
    const h1 = makeHarness();
    // Raw, this is 3 + 3 + 3 = 9 — nowhere near 140, and the idle reset would
    // zero it between notches: the silent dead zone this normalization fixes.
    wheel(h1.el, 3, { deltaMode: 1 }); // 48px
    wheel(h1.el, 3, { deltaMode: 1 }); // 96px
    expect(h1.onNext).not.toHaveBeenCalled();
    wheel(h1.el, 3, { deltaMode: 1 }); // 144px ≥ 140
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    h1.wrapper.unmount();
  });

  it('commits in DOM_DELTA_PAGE mode using the scroller height', () => {
    const h1 = makeHarness();
    wheel(h1.el, 1, { deltaMode: 2 }); // 1 page × clientHeight 600
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    h1.wrapper.unmount();
  });

  it('stretches by the normalized delta, not the raw line count', () => {
    const h1 = makeHarness();
    wheel(h1.el, 1, { deltaMode: 1 }); // 16px → 16/8 = 2px of stretch
    expect(h1.el.style.transform).toBe('translateY(-2px)');
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — ctrl+wheel / pinch zoom', () => {
  it('never consumes a ctrl+wheel event (browser zoom must survive)', () => {
    const h1 = makeHarness();
    expect(wheel(h1.el, 400, { ctrlKey: true })).toBe(false);
    expect(h1.onNext).not.toHaveBeenCalled();
    // …and it does not accumulate towards a later commit either.
    expect(wheel(h1.el, 100)).toBe(true);
    expect(h1.onNext).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — commit slide (WAAPI present)', () => {
  it('commits without applying any transform', () => {
    prefersReducedMotion.value = true;
    const h1 = makeHarness();

    wheel(h1.el, 60);
    expect(h1.el.style.transform).toBe('');
    expect(h1.onNext).not.toHaveBeenCalled();

    wheel(h1.el, 100); // same 140px requirement
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    expect(h1.el.style.transform).toBe('');
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — guards', () => {
  it('is inert while an overlay is open', () => {
    const h1 = makeHarness();
    hasOpenOverlays.mockReturnValue(true);
    expect(wheel(h1.el, 400)).toBe(false);
    expect(h1.onNext).not.toHaveBeenCalled();

    hasOpenOverlays.mockReturnValue(false);
    expect(wheel(h1.el, 400)).toBe(true);
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    h1.wrapper.unmount();
  });

  it('never attaches a listener while `enabled` is false', () => {
    const enabled = ref(false);
    const h1 = makeHarness({ enabled });
    const spy = vi.spyOn(h1.el, 'addEventListener');
    expect(wheel(h1.el, 400)).toBe(false);
    expect(h1.onNext).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it('attaches when `enabled` flips true and detaches when it flips back', async () => {
    const enabled = ref(false);
    const h1 = makeHarness({ enabled });

    enabled.value = true;
    await h1.wrapper.vm.$nextTick();
    expect(wheel(h1.el, 400)).toBe(true);
    expect(h1.onNext).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    enabled.value = false;
    await h1.wrapper.vm.$nextTick();
    expect(wheel(h1.el, 400)).toBe(false);
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — teardown', () => {
  it('removes the listener and clears pending timers on unmount', () => {
    const h1 = makeHarness();
    const removeSpy = vi.spyOn(h1.el, 'removeEventListener');

    wheel(h1.el, 40); // arms the idle timer
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    h1.wrapper.unmount();

    expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(h1.el.style.transform).toBe('');

    // A wheel on the detached element is a complete no-op.
    expect(wheel(h1.el, 400)).toBe(false);
    expect(h1.onNext).not.toHaveBeenCalled();
  });

  it('clears the cooldown timer on unmount mid-cooldown', () => {
    const h1 = makeHarness();
    wheel(h1.el, 200);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h1.wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** An `animate` stub whose `finished` promise the test resolves by hand. */
function stubDeferredAnimate(el: HTMLElement): { settle: () => void; count: () => number } {
  const resolvers: Array<() => void> = [];
  let settled = false;
  let created = 0;
  el.animate = ((): Animation => {
    created++;
    if (settled) return { finished: Promise.resolve(), cancel: () => {} } as unknown as Animation;
    let resolve!: () => void;
    const finished = new Promise<void>((r) => {
      resolve = r;
    });
    resolvers.push(resolve);
    return { finished, cancel: () => {} } as unknown as Animation;
  }) as HTMLElement['animate'];
  return {
    settle: () => {
      settled = true;
      resolvers.forEach((r) => r());
    },
    count: () => created,
  };
}

describe('useWheelMonthPaging — liveness', () => {
  it('never fires the navigation callback after teardown mid-slide', async () => {
    const h1 = makeHarness();
    const anim = stubDeferredAnimate(h1.el);

    wheel(h1.el, 200);
    await Promise.resolve();
    expect(anim.count()).toBe(1); // phase A in flight
    expect(h1.onNext).not.toHaveBeenCalled();

    // The user switches view while the slide is running.
    h1.wrapper.unmount();
    anim.settle();
    await vi.advanceTimersByTimeAsync(1000);

    // A disposed scope must not emit a navigation intent — this is the bug
    // that landed the user in Week view one month ahead.
    expect(h1.onNext).not.toHaveBeenCalled();
  });

  it('completes the slide when requestAnimationFrame never fires (hidden tab)', async () => {
    const h1 = makeHarness();
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0);
    h1.el.animate = (() =>
      ({
        finished: Promise.resolve(),
        cancel: () => {},
      }) as unknown as Animation) as HTMLElement['animate'];

    wheel(h1.el, 200);
    await vi.advanceTimersByTimeAsync(1000);

    // The frame timeout unblocks the between-phase await, so the grid is not
    // stranded at opacity 0 with every wheel swallowed.
    expect(h1.onNext).toHaveBeenCalledTimes(1);
    expect(h1.el.style.opacity).toBe('');
    expect(h1.isPaging.value).toBe(false);
    expect(wheel(h1.el, 200)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h1.onNext).toHaveBeenCalledTimes(2);

    rafSpy.mockRestore();
    h1.wrapper.unmount();
  });
});

describe('useWheelMonthPaging — isPaging', () => {
  it('is false at rest, true from commit until the cooldown expires', () => {
    const h1 = makeHarness();
    expect(h1.isPaging.value).toBe(false);

    wheel(h1.el, 60); // accumulating is not paging
    expect(h1.isPaging.value).toBe(false);

    wheel(h1.el, 100); // commit
    expect(h1.isPaging.value).toBe(true);

    vi.advanceTimersByTime(419);
    expect(h1.isPaging.value).toBe(true);
    vi.advanceTimersByTime(2);
    expect(h1.isPaging.value).toBe(false);
    h1.wrapper.unmount();
  });

  it('stays true for the whole slide even past the cooldown', async () => {
    const h1 = makeHarness();
    const anim = stubDeferredAnimate(h1.el);

    wheel(h1.el, 200);
    await Promise.resolve();
    expect(h1.isPaging.value).toBe(true);

    await vi.advanceTimersByTimeAsync(1000); // cooldown long gone
    expect(h1.isPaging.value).toBe(true); // slide still in flight

    anim.settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h1.isPaging.value).toBe(false);
    h1.wrapper.unmount();
  });

  it('is false again after teardown', () => {
    const h1 = makeHarness();
    wheel(h1.el, 200);
    expect(h1.isPaging.value).toBe(true);
    h1.wrapper.unmount();
    expect(h1.isPaging.value).toBe(false);
  });
});

describe('useWheelMonthPaging — failure handling', () => {
  it('reports and self-heals when the geometry probe throws', () => {
    const h1 = makeHarness();
    getAppScroller.mockImplementation(() => {
      throw new Error('detached');
    });

    expect(() => wheel(h1.el, 40)).not.toThrow();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'calendar-nav', severity: 'warning' })
    );
    expect(h1.el.style.transform).toBe('');
    expect(h1.onNext).not.toHaveBeenCalled();
    h1.wrapper.unmount();
  });

  it('reports and self-heals when the page callback throws', () => {
    const h1 = makeHarness({
      onNext: () => {
        throw new Error('render failed');
      },
    });

    expect(() => wheel(h1.el, 200)).not.toThrow();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'calendar-nav', severity: 'warning' })
    );
    expect(h1.el.style.transform).toBe('');
    h1.wrapper.unmount();
  });
});
