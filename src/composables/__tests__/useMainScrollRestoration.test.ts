import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import type {
  NavigationGuardWithThis,
  NavigationHookAfter,
  RouteLocationNormalized,
  Router,
} from 'vue-router';
import {
  SCROLL_RESTORE_MAX_AGE_MS,
  applyDrop,
  decide,
  installMainScrollRestoration,
  sweep,
  type NavigationFacts,
  type ScrollMap,
} from '../useMainScrollRestoration';

vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
import { logEvent } from '@/services/telemetry';

const NOW = 10_000_000;
const MINUTE = 60 * 1000;

function nav(over: Partial<NavigationFacts>): NavigationFacts {
  return { leaving: 4, arrived: 5, samePath: false, popped: false, restorable: true, ...over };
}

describe('decide', () => {
  let map: ScrollMap;
  beforeEach(() => {
    map = new Map([
      [4, { top: 800, at: NOW - MINUTE }],
      [5, { top: 300, at: NOW - MINUTE }],
    ]);
  });

  it('a replace on the same path does nothing (planner prev/next, a deep-link param clear)', () => {
    expect(decide(map, nav({ leaving: 5, arrived: 5, samePath: true }), NOW)).toEqual({
      kind: 'noop',
    });
  });

  it('a replace to a new path opens at the top and forgets that entry', () => {
    expect(decide(map, nav({ leaving: 5, arrived: 5, samePath: false }), NOW)).toEqual({
      kind: 'top',
      drop: 'entry',
    });
  });

  it('a pop to a position saved within the hour restores it', () => {
    expect(decide(map, nav({ leaving: 5, arrived: 4, popped: true }), NOW)).toEqual({
      kind: 'restore',
      top: 800,
    });
  });

  it('a pop to a position saved over an hour ago opens at the top, stale', () => {
    map.set(4, { top: 800, at: NOW - SCROLL_RESTORE_MAX_AGE_MS - 1 });
    expect(decide(map, nav({ leaving: 5, arrived: 4, popped: true }), NOW)).toEqual({
      kind: 'top',
      stale: true,
      drop: 'entry',
    });
  });

  it('exactly an hour old still restores (the window is inclusive)', () => {
    map.set(4, { top: 800, at: NOW - SCROLL_RESTORE_MAX_AGE_MS });
    expect(decide(map, nav({ leaving: 5, arrived: 4, popped: true }), NOW).kind).toBe('restore');
  });

  it('a new push opens at the top', () => {
    map.delete(5);
    expect(decide(map, nav({ leaving: 4, arrived: 5 }), NOW)).toEqual({
      kind: 'top',
      drop: 'forward',
    });
  });

  it('a push to a position already in the map (after a back) opens at the top, not the old offset', () => {
    // Cookbook (4) -> recipe A (5) -> Back saves 5 -> recipe B is pushed at position 5 again.
    expect(decide(map, nav({ leaving: 4, arrived: 5, popped: false }), NOW)).toEqual({
      kind: 'top',
      drop: 'forward',
    });
  });

  it('the first navigation, with no remembered position, opens at the top', () => {
    expect(decide(new Map(), nav({ leaving: undefined, arrived: 1 }), NOW)).toEqual({
      kind: 'top',
      drop: 'forward',
    });
  });

  it('a pop to a position with nothing saved opens at the top', () => {
    expect(decide(map, nav({ leaving: 4, arrived: 2, popped: true }), NOW)).toEqual({
      kind: 'top',
    });
  });

  it('a pop to a `scrollRestore: false` route opens at the top, forgets the entry, no stale event', () => {
    expect(
      decide(map, nav({ leaving: 5, arrived: 4, popped: true, restorable: false }), NOW)
    ).toEqual({ kind: 'top', drop: 'entry' });
  });

  it('a same-path push onto a `scrollRestore: false` route leaves its scroller alone', () => {
    // A to-do chip or global search pushing /activities?activity=X while the planner is open.
    expect(
      decide(map, nav({ leaving: 4, arrived: 5, samePath: true, restorable: false }), NOW)
    ).toEqual({ kind: 'noop', drop: 'forward' });
  });

  it('a same-path pop on a `scrollRestore: false` route leaves its scroller alone', () => {
    // Back from the planner's day view to the month: the month stream anchors itself.
    expect(
      decide(
        map,
        nav({ leaving: 5, arrived: 4, samePath: true, popped: true, restorable: false }),
        NOW
      )
    ).toEqual({ kind: 'noop', drop: 'entry' });
  });

  it('a same-path replace on a `scrollRestore: false` route is still a no-op', () => {
    expect(
      decide(map, nav({ leaving: 5, arrived: 5, samePath: true, restorable: false }), NOW).kind
    ).toBe('noop');
  });
});

describe('sweep and applyDrop', () => {
  it('sweep forgets only entries older than the hour', () => {
    const map: ScrollMap = new Map([
      [1, { top: 10, at: NOW - SCROLL_RESTORE_MAX_AGE_MS - 1 }],
      [2, { top: 20, at: NOW - SCROLL_RESTORE_MAX_AGE_MS }],
      [3, { top: 30, at: NOW }],
    ]);
    sweep(map, NOW);
    expect([...map.keys()]).toEqual([2, 3]);
  });

  it('applyDrop forgets the entry, or it and every later one', () => {
    const fresh = (): ScrollMap =>
      new Map([1, 2, 3, 4].map((p) => [p, { top: p, at: NOW }] as const));
    const one = fresh();
    applyDrop(one, 2, 'entry');
    expect([...one.keys()]).toEqual([1, 3, 4]);
    const forward = fresh();
    applyDrop(forward, 2, 'forward');
    expect([...forward.keys()]).toEqual([1]);
    const none = fresh();
    applyDrop(none, 2, undefined);
    expect(none.size).toBe(4);
  });
});

/** A `<main>` whose layout numbers the test controls (the test DOM has no layout). */
function fakeMain() {
  const el = document.createElement('main');
  const box = { scrollHeight: 0, clientHeight: 500, scrollTop: 0 };
  Object.defineProperty(el, 'scrollHeight', { get: () => box.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { get: () => box.clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    get: () => box.scrollTop,
    set: (v: number) => {
      box.scrollTop = Math.max(0, Math.min(v, Math.max(0, box.scrollHeight - box.clientHeight)));
    },
  });
  return { el, box };
}

describe('installMainScrollRestoration (wiring)', () => {
  let before: NavigationGuardWithThis<undefined>;
  let after: NavigationHookAfter;
  let historyState: { position: number } | null;
  const route = (path: string) =>
    ({ path, name: path, meta: {} }) as unknown as RouteLocationNormalized;
  const fakeRouter = {
    beforeEach: (fn: NavigationGuardWithThis<undefined>) => {
      before = fn;
      return () => {};
    },
    afterEach: (fn: NavigationHookAfter) => {
      after = fn;
      return () => {};
    },
  } as unknown as Pick<Router, 'beforeEach' | 'afterEach'>;

  /** One navigation, the way Vue Router orders it: a pop moves `history.state` BEFORE guards. */
  function navigate(
    from: string,
    to: string,
    target: number,
    kind: 'push' | 'pop'
  ): Promise<unknown> {
    if (kind === 'pop') historyState = { position: target };
    void (before as (...a: unknown[]) => unknown)(route(to), route(from), () => {});
    if (kind === 'push') historyState = { position: target };
    return (after as (...a: unknown[]) => unknown)(
      route(to),
      route(from),
      undefined
    ) as Promise<unknown>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logEvent).mockClear();
    historyState = { position: 1 };
    vi.spyOn(window.history, 'state', 'get').mockImplementation(() => historyState);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('back restores the list offset only after the destination renders, ignoring the tall leaving page', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));

    // On the list (position 1), scrolled to 1200, then open a detail (push to 2).
    box.scrollHeight = 3000;
    box.scrollTop = 1200;
    await navigate('/list', '/detail', 2, 'push');
    expect(box.scrollTop).toBe(0);

    // The detail page is long too; Back pops to 1.
    box.scrollTop = 900;
    const done = navigate('/detail', '/list', 1, 'pop');
    // Synchronously: reset to the top, and the still-mounted tall detail page did not satisfy
    // the restore (without the nextTick the finder would have measured it and set 1200 now).
    expect(box.scrollTop).toBe(0);
    // Vue patches: the list renders short at first (lazy, hydrating).
    box.scrollHeight = 600;
    await vi.advanceTimersByTimeAsync(100);
    expect(box.scrollTop).toBe(0);
    expect(logEvent).not.toHaveBeenCalled();
    // Content grows tall enough; the next frame restores.
    box.scrollHeight = 3000;
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(box.scrollTop).toBe(1200);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'scroll-restore',
      message: 'restore',
      context: { action: 'restored', route_name: '/list' },
    });
  });

  it('a person scrolling during the wait cancels the restore, with no event', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    box.scrollTop = 1200;
    await navigate('/list', '/detail', 2, 'push');

    const done = navigate('/detail', '/list', 1, 'pop');
    box.scrollHeight = 600;
    await vi.advanceTimersByTimeAsync(50);
    el.dispatchEvent(new Event('wheel'));
    box.scrollHeight = 3000;
    box.scrollTop = 40; // the person's own scroll
    await vi.advanceTimersByTimeAsync(2500);
    await done;
    expect(box.scrollTop).toBe(40);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('a scroll that leaves the top (PageDown on the body, a scrollbar drag) cancels the restore', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    box.scrollTop = 1200;
    await navigate('/list', '/detail', 2, 'push');

    const done = navigate('/detail', '/list', 1, 'pop');
    box.scrollHeight = 600;
    await vi.advanceTimersByTimeAsync(20);
    // The reset's own scroll event arrives late and finds the top: not a takeover.
    el.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(20);
    box.scrollTop = 80; // the person pages down with focus on the body
    el.dispatchEvent(new Event('scroll'));
    box.scrollHeight = 3000;
    await vi.advanceTimersByTimeAsync(2500);
    await done;
    expect(box.scrollTop).toBe(80);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('the reset scroll event alone does not cancel the restore', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    box.scrollTop = 1200;
    await navigate('/list', '/detail', 2, 'push');

    const done = navigate('/detail', '/list', 1, 'pop');
    box.scrollHeight = 600;
    await vi.advanceTimersByTimeAsync(20);
    el.dispatchEvent(new Event('scroll'));
    box.scrollHeight = 3000;
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(box.scrollTop).toBe(1200);
  });

  it('a same-entry query replace during the wait lets the restore finish', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    box.scrollTop = 1200;
    await navigate('/list', '/detail', 2, 'push');

    const done = navigate('/detail', '/list', 1, 'pop');
    box.scrollHeight = 600;
    await vi.advanceTimersByTimeAsync(20);
    // The list normalises its query on mount: a replace keeps the entry (position 1).
    await navigate('/list', '/list', 1, 'push');
    box.scrollHeight = 3000;
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(box.scrollTop).toBe(1200);
  });

  it('leaving while a restore waits keeps the saved offset for that entry', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    box.scrollTop = 1200;
    await navigate('/list', '/detail', 2, 'push');

    // Back to the list, and away again before the list grows tall enough.
    const back = navigate('/detail', '/list', 1, 'pop');
    box.scrollHeight = 600;
    await vi.advanceTimersByTimeAsync(20);
    await navigate('/list', '/detail', 2, 'push');
    await vi.advanceTimersByTimeAsync(20);
    await back;
    expect(logEvent).not.toHaveBeenCalled(); // the aborted restore reports nothing
    // Back once more, to a list that now renders tall: the original offset, not the reset 0.
    const again = navigate('/detail', '/list', 1, 'pop');
    box.scrollHeight = 3000;
    await vi.advanceTimersByTimeAsync(50);
    await again;
    expect(box.scrollTop).toBe(1200);
  });

  it('content that never grows tall enough clamps to the bottom and reports unreachable', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    box.scrollTop = 1200;
    await navigate('/list', '/detail', 2, 'push');

    const done = navigate('/detail', '/list', 1, 'pop');
    box.scrollHeight = 1000;
    await vi.advanceTimersByTimeAsync(2500);
    await done;
    expect(box.scrollTop).toBe(500);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0].context).toEqual({
      action: 'unreachable',
      route_name: '/list',
    });
  });

  it('opening a second detail after Back starts at the top, not the first detail offset', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    await navigate('/list', '/detail-a', 2, 'push');
    box.scrollTop = 900; // read down detail A
    const back = navigate('/detail-a', '/list', 1, 'pop');
    await vi.advanceTimersByTimeAsync(50);
    await back;
    vi.mocked(logEvent).mockClear();

    await navigate('/list', '/detail-b', 2, 'push');
    await vi.advanceTimersByTimeAsync(100);
    expect(box.scrollTop).toBe(0);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('a failed navigation leaves the remembered position alone', async () => {
    const { el, box } = fakeMain();
    installMainScrollRestoration(fakeRouter, ref(el));
    box.scrollHeight = 3000;
    await navigate('/list', '/detail', 2, 'push');

    // An aborted pop: history.state still names the aborted destination when afterEach runs.
    historyState = { position: 7 };
    void (before as (...a: unknown[]) => unknown)(route('/x'), route('/detail'), () => {});
    await (after as (...a: unknown[]) => unknown)(route('/x'), route('/detail'), { type: 4 });
    historyState = { position: 2 };

    // Read down the detail, Back to the list, then Forward: the detail's offset was filed under
    // its own position (2), not the aborted destination's (7), so Forward restores it.
    box.scrollTop = 900;
    const back = navigate('/detail', '/list', 1, 'pop');
    await vi.advanceTimersByTimeAsync(50);
    await back;
    const forward = navigate('/list', '/detail', 2, 'pop');
    await vi.advanceTimersByTimeAsync(50);
    await forward;
    expect(box.scrollTop).toBe(900);
  });
});
