/**
 * The app-level unhealthy view-calendar toast (view-only calendars plan 2026-11-17).
 * Moved out of `calendarViewStore` so the store has no path to the router (the doc
 * worker bundles the store's import graph).
 *
 * Load-bearing promises:
 *  - one toast per session per unhealthy kind, with an action to the calendar settings;
 *  - never on the wall; a kind first seen there toasts once the route leaves it;
 *  - a store teardown (new session) toasts afresh;
 *  - flag off = the store is never instantiated and nothing toasts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick, reactive, type EffectScope } from 'vue';

type Kind = 'unavailable' | 'needs_reconnect';

const h = vi.hoisted(() => ({
  route: null as unknown as { name: string },
  push: vi.fn(async (_to: unknown) => {}),
  isReady: vi.fn(async () => {}),
  state: null as unknown as { unhealthyStates: ReadonlySet<Kind>; standingSettled: boolean },
  useStore: vi.fn(),
  showToast: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => h.route,
  useRouter: () => ({ push: h.push, isReady: h.isReady }),
}));
vi.mock('@/stores/calendarViewStore', () => ({
  useCalendarViewStore: () => {
    h.useStore();
    return h.state;
  },
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));

import { useCalendarViewHealthToast } from '../useCalendarViewHealthToast';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';

const FLAG_KEY = 'beanies:flag:viewOnlyCalendars';
let scope: EffectScope;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await nextTick();
}

async function mount(): Promise<void> {
  scope = effectScope();
  scope.run(() => useCalendarViewHealthToast());
  await settle();
}

function setStates(...kinds: Kind[]): void {
  h.state.unhealthyStates = new Set(kinds);
}

function toastedTitles(): string[] {
  return h.showToast.mock.calls.map(([, title]) => String(title));
}

beforeEach(() => {
  localStorage.setItem(FLAG_KEY, 'true');
  h.route = reactive({ name: 'FamilyPlanner' });
  h.state = reactive({ unhealthyStates: new Set<Kind>(), standingSettled: false });
  h.push.mockClear();
  h.isReady.mockClear();
  h.useStore.mockClear();
  h.showToast.mockClear();
  h.reportError.mockClear();
});

afterEach(() => {
  scope?.stop();
  localStorage.removeItem(FLAG_KEY);
});

describe('useCalendarViewHealthToast', () => {
  it('toasts once per session per unhealthy kind', async () => {
    await mount();
    expect(h.showToast).not.toHaveBeenCalled();

    setStates('unavailable');
    await settle();
    expect(toastedTitles()).toEqual(['calendarView.toast.unavailable.title']);
    const [type, , message, options] = h.showToast.mock.calls[0]!;
    expect(type).toBe('warning');
    expect(message).toBe('calendarView.toast.unavailable.message');
    expect(options).toMatchObject({
      actionLabel: 'calendarView.toast.openSettings',
      durationMs: 8000,
    });

    // The same kind again (a later read) is not toasted twice; a new kind is.
    setStates('unavailable');
    await settle();
    setStates('unavailable', 'needs_reconnect');
    await settle();
    setStates();
    await settle();
    setStates('needs_reconnect');
    await settle();
    expect(toastedTitles()).toEqual([
      'calendarView.toast.unavailable.title',
      'calendarView.toast.needsReconnect.title',
    ]);
  });

  it('never toasts on the wall route, and toasts once the route leaves the wall', async () => {
    h.route.name = 'BeanieWall';
    await mount();
    setStates('needs_reconnect');
    await settle();
    expect(h.showToast).not.toHaveBeenCalled();

    h.route.name = 'FamilyNook';
    await settle();
    expect(toastedTitles()).toEqual(['calendarView.toast.needsReconnect.title']);

    h.route.name = 'BeanieWall';
    await settle();
    h.route.name = 'FamilyNook';
    await settle();
    expect(h.showToast).toHaveBeenCalledTimes(1);
  });

  it('the action opens the calendar settings drawer, and a failed navigation is reported', async () => {
    await mount();
    setStates('unavailable');
    await settle();
    const options = h.showToast.mock.calls[0]![3] as { actionFn: () => void };
    options.actionFn();
    expect(h.push).toHaveBeenCalledWith({
      path: '/settings',
      query: { open: CALENDAR_SYNC_OPEN },
    });

    h.push.mockRejectedValueOnce(new Error('navigation aborted'));
    options.actionFn();
    await settle();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'calendar-view', severity: 'warning' })
    );
  });

  it('a store teardown (new session) toasts afresh', async () => {
    await mount();
    h.state.standingSettled = true;
    setStates('unavailable');
    await settle();
    expect(h.showToast).toHaveBeenCalledTimes(1);

    // stop() on sign-out / family switch: states cleared, standingSettled reset.
    h.state.standingSettled = false;
    setStates();
    await settle();
    setStates('unavailable');
    await settle();
    expect(h.showToast).toHaveBeenCalledTimes(2);
  });

  it('flag off: never instantiates the store and never toasts', async () => {
    localStorage.setItem(FLAG_KEY, 'false');
    await mount();
    setStates('unavailable', 'needs_reconnect');
    await settle();
    expect(h.useStore).not.toHaveBeenCalled();
    expect(h.isReady).not.toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
  });
});
