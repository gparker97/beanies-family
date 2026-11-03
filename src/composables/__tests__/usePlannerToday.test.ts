import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { navigateTo, requestGoToday, usePlannerTodayConsumer } from '../usePlannerToday';
import { PLANNER_ROUTE_NAME } from '@/constants/navigation';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent }));

// A settable stand-in for the app-wide day signal, so a rollover is one assignment.
const day = vi.hoisted(() => ({ today: null as unknown as Ref<string> }));
vi.mock('@/composables/useToday', async () => {
  const { ref: vueRef } = await import('vue');
  day.today = vueRef('2026-11-03');
  return { useToday: () => ({ today: day.today }) };
});

// The planner's current route as the consumer sees it, so a test can give it an explicit `d`.
const planner = vi.hoisted(() => ({ route: null as unknown as { query: Record<string, string> } }));
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  const { reactive } = await import('vue');
  planner.route = reactive({ query: {} as Record<string, string> });
  return { ...actual, useRoute: () => planner.route };
});

// Track every mounted host so we can unmount between tests — the consumer's
// `watch` lives for the component's lifetime, and a leaked watcher from a prior
// test would consume the shared module flag before the current test's does.
const wrappers: VueWrapper[] = [];

/** Mount a throwaway host that wires the consumer to `handler`. */
function mountConsumer(
  handler: () => void,
  referenceDate: Ref<Date> = ref(new Date(2026, 10, 3))
): VueWrapper {
  const wrapper = mount(
    defineComponent({
      setup() {
        usePlannerTodayConsumer(handler, referenceDate);
        return () => h('div');
      },
    })
  );
  wrappers.push(wrapper);
  return wrapper;
}

type FakeRouter = Pick<Router, 'push' | 'replace' | 'currentRoute'> & {
  push: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
};

/** A router whose navigation settles with `outcome` and then reports it landed on `landed`. */
function fakeRouter(
  landed: { name: string; query?: Record<string, string> },
  outcome: Promise<unknown> = Promise.resolve(undefined)
): FakeRouter {
  return {
    push: vi.fn(() => outcome),
    replace: vi.fn(() => outcome),
    currentRoute: ref({ name: landed.name, query: landed.query ?? {} }),
  } as unknown as FakeRouter;
}

const resetTodayLog = (detail: 'nav' | 'rollover') =>
  expect.objectContaining({
    level: 'debug',
    surface: 'calendar-nav',
    context: { action: 'reset-today', detail },
  });

/** A REAL vue-router NavigationFailure of the given kind (isNavigationFailure checks a private marker). */
async function realFailure(kind: 'duplicated' | 'aborted' | 'cancelled'): Promise<unknown> {
  const stub = { render: () => null };
  const r = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/x', '/y'].map((path) => ({ path, component: stub })),
  });
  await r.push('/');
  if (kind === 'duplicated') return r.push('/');
  if (kind === 'aborted') {
    r.beforeEach(() => false);
    return r.push('/x');
  }
  r.beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const first = r.push('/x');
  void r.push('/y'); // a newer navigation supersedes the first
  return first;
}

beforeEach(() => {
  logEvent.mockClear();
  day.today.value = '2026-11-03';
  planner.route.query = {};
});

afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
});

describe('usePlannerTodayConsumer', () => {
  it('fires on mount when a request was queued before the page mounted (cross-page case)', () => {
    const handler = vi.fn();
    requestGoToday(); // the navigation settled before the page's first render
    mountConsumer(handler); // page mounts → onMounted consumes
    expect(handler).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledWith(resetTodayLog('nav'));
  });

  it('fires via watch when already mounted (same-page re-tap case)', async () => {
    const handler = vi.fn();
    mountConsumer(handler); // nothing queued yet → onMounted no-ops
    expect(handler).not.toHaveBeenCalled();
    requestGoToday(); // re-tap while on the page
    await nextTick();
    expect(handler).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledWith(resetTodayLog('nav'));
  });

  it('clears the flag after consuming so it never re-fires on the next mount', () => {
    const first = vi.fn();
    requestGoToday();
    mountConsumer(first); // consumes the flag
    expect(first).toHaveBeenCalledOnce();

    const second = vi.fn();
    mountConsumer(second); // flag already cleared → no spurious fire
    expect(second).not.toHaveBeenCalled();
  });

  it('snaps to the new today on a rollover when the planner was on the previous today', async () => {
    const handler = vi.fn();
    // Any time of day on the old today counts as "on today".
    mountConsumer(handler, ref(new Date(2026, 10, 3, 15, 30)));
    day.today.value = '2026-11-04';
    await nextTick();
    expect(handler).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledWith(resetTodayLog('rollover'));
  });

  it('never lets a stale flag override a URL that names a day (and still clears it)', async () => {
    const handler = vi.fn();
    planner.route.query = { view: 'day', d: '2026-10-20' }; // a widget row tap landed here
    requestGoToday(); // left over from an earlier navigation
    mountConsumer(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'reset-today-skipped', detail: 'nav' } })
    );

    planner.route.query = {};
    mountConsumer(handler); // the flag was cleared, not deferred
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not roll over a day the URL names explicitly', async () => {
    const handler = vi.fn();
    planner.route.query = { view: 'day', d: '2026-11-03' }; // tapped today's row at 23:50
    mountConsumer(handler, ref(new Date(2026, 10, 3)));
    day.today.value = '2026-11-04';
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves a planner the user moved to another day where it is on a rollover', async () => {
    const handler = vi.fn();
    mountConsumer(handler, ref(new Date(2026, 9, 15)));
    day.today.value = '2026-11-04';
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('navigateTo', () => {
  it('pushes, and sets the today flag only once the navigation has settled on the planner', async () => {
    const handler = vi.fn();
    mountConsumer(handler);
    let settle!: () => void;
    const router = fakeRouter(
      { name: PLANNER_ROUTE_NAME },
      new Promise<void>((resolve) => (settle = resolve))
    );

    navigateTo(router, '/activities');
    expect(router.push).toHaveBeenCalledWith('/activities');
    expect(router.replace).not.toHaveBeenCalled();
    await flushPromises();
    expect(handler).not.toHaveBeenCalled(); // still in flight: no flag yet

    settle();
    await flushPromises();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('replaces when asked, and sets the flag for a widget-style link with no d', async () => {
    const handler = vi.fn();
    mountConsumer(handler);
    const router = fakeRouter({ name: PLANNER_ROUTE_NAME, query: { view: 'day', src: 'widget' } });

    navigateTo(router, '/activities?view=day&src=widget', { replace: true });
    await flushPromises();
    expect(router.replace).toHaveBeenCalledWith('/activities?view=day&src=widget');
    expect(router.push).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('sets the flag for a duplicate navigation, which resolves with a NavigationFailure', async () => {
    const handler = vi.fn();
    mountConsumer(handler);
    const duplicate = await realFailure('duplicated');
    const router = fakeRouter({ name: PLANNER_ROUTE_NAME }, Promise.resolve(duplicate));

    navigateTo(router, '/activities');
    await flushPromises();
    expect(handler).toHaveBeenCalledOnce();
    expect(logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ surface: 'app-nav' }));
  });

  it('does not set the flag when a guard aborted the navigation and the user stayed on the planner', async () => {
    const handler = vi.fn();
    mountConsumer(handler);
    // e.g. the critical-write guard returned false while the user sat on /activities
    const aborted = await realFailure('aborted');
    const cancelled = await realFailure('cancelled');

    navigateTo(fakeRouter({ name: PLANNER_ROUTE_NAME }, Promise.resolve(aborted)), '/nook');
    navigateTo(fakeRouter({ name: PLANNER_ROUTE_NAME }, Promise.resolve(cancelled)), '/todo');
    await flushPromises();
    expect(handler).not.toHaveBeenCalled();
    expect(logEvent.mock.calls.map(([event]) => event.context)).toEqual([
      { action: 'nav_not_completed', detail: 'aborted' },
      { action: 'nav_not_completed', detail: 'cancelled' },
    ]);
  });

  it('a planner reached with an explicit d keeps that day (the consumer owns the d rule)', async () => {
    const handler = vi.fn();
    mountConsumer(handler);
    planner.route.query = { view: 'day', d: '2026-10-20' };
    const router = fakeRouter({ name: PLANNER_ROUTE_NAME, query: planner.route.query });

    navigateTo(router, '/activities?view=day&d=2026-10-20');
    await flushPromises();
    expect(handler).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'reset-today-skipped', detail: 'nav' } })
    );
  });

  it('does not set the flag when the navigation landed elsewhere (another page, or a guard redirect)', async () => {
    const handler = vi.fn();
    mountConsumer(handler);

    navigateTo(fakeRouter({ name: 'Todo' }), '/todo');
    navigateTo(fakeRouter({ name: 'Login' }), '/activities'); // a guard redirected it
    await flushPromises();
    expect(handler).not.toHaveBeenCalled();
  });

  it('resolved navigations log nothing', async () => {
    mountConsumer(vi.fn());
    navigateTo(fakeRouter({ name: 'Todo' }), '/todo');
    await flushPromises();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('a rejected navigation logs nav_failed with the error and the method, and sets nothing', async () => {
    const handler = vi.fn();
    mountConsumer(handler);
    const error = new Error('guard threw');
    const router = fakeRouter({ name: PLANNER_ROUTE_NAME }, Promise.reject(error));

    navigateTo(router, '/activities?view=day&src=widget', { replace: true });
    await flushPromises();
    expect(handler).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'app-nav',
        context: { action: 'nav_failed', detail: 'replace' },
        error,
      })
    );
  });
});
