/**
 * View-only external calendars on the beanie wall (plan 2026-11-17, C4).
 *
 *  - The page is the wall's ONLY fetch-window setter: the days it draws plus one
 *    period each side, following the view and the anchor.
 *  - A tap on a view-only event opens the shared read-only details with no Google
 *    link, never the drill-in sheet, and never touches the lock: a LOCKED wall opens
 *    it and no PIN prompt follows (Requirement 9).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import BeanieWallPage from '@/pages/BeanieWallPage.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { widenByPeriod } from '@/utils/calendar/externalEvents';
import { addDaysYmd, localToday } from '@/utils/date';
import { externalEvent } from '@/test/monthCellFixtures';
import type { YmdRange } from '@/types/externalEvents';

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), resolve: () => ({ matched: [] }) }),
  useRoute: () => ({ query: {}, params: {}, path: '/wall' }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

// The wall has room, whatever jsdom's screen says.
vi.mock('@/composables/useWallRoomGate', () => ({ useWallRoomGate: () => ref(true) }));

// The lock, real, with its two entry points watched.
const lockSpies = vi.hoisted(() => ({ requestUnlock: vi.fn(), noteActivity: vi.fn() }));
vi.mock('@/composables/useWallLock', async (orig) => {
  const actual = await orig<typeof import('@/composables/useWallLock')>();
  return {
    ...actual,
    useWallLock: () => {
      const real = actual.useWallLock();
      return {
        ...real,
        requestUnlock: (...a: Parameters<typeof real.requestUnlock>) => {
          lockSpies.requestUnlock(...a);
          return real.requestUnlock(...a);
        },
        noteActivity: () => {
          lockSpies.noteActivity();
          real.noteActivity();
        },
      };
    },
  };
});

// The window the page hands the store, captured. Everything else stays real.
const windows = vi.hoisted(() => ({ calls: [] as (YmdRange | null)[] }));
vi.mock('@/composables/useExternalEvents', async (orig) => {
  const actual = await orig<typeof import('@/composables/useExternalEvents')>();
  return {
    ...actual,
    useExternalEvents: () => {
      const real = actual.useExternalEvents();
      return {
        ...real,
        setScreenWindow: (range: YmdRange | null) => {
          windows.calls.push(range);
          real.setScreenWindow(range);
        },
      };
    },
  };
});

async function settle() {
  await flushPromises();
  await nextTick();
}

function mountPage() {
  return shallowMount(BeanieWallPage);
}
type Wrapper = ReturnType<typeof mountPage>;
const lastWindow = () => windows.calls[windows.calls.length - 1];
const selectView = async (w: Wrapper, id: string) => {
  w.findComponent({ name: 'WallViewSwitcher' }).vm.$emit('select', id);
  await settle();
};

beforeEach(() => {
  setActivePinia(createPinia());
  windows.calls = [];
  lockSpies.requestUnlock.mockClear();
  lockSpies.noteActivity.mockClear();
  localStorage.clear();
});

describe('BeanieWallPage: the view-only fetch window', () => {
  it('sets the days view week widened by one week each side, on mount', async () => {
    const w = mountPage();
    await settle();
    const today = localToday();
    const weekStart = useSettingsStore().weekStartDay;
    expect(lastWindow()).toEqual(
      widenByPeriod({ startYmd: today, endYmd: addDaysYmd(today, 6) }, 'week', weekStart)
    );
    w.unmount();
  });

  it('a single-day view widens by a day; a board view keeps the last window', async () => {
    const w = mountPage();
    await settle();
    const today = localToday();

    await selectView(w, 'today');
    expect(lastWindow()).toEqual({ startYmd: addDaysYmd(today, -1), endYmd: addDaysYmd(today, 1) });

    await selectView(w, 'lanes');
    expect(lastWindow()).toEqual({ startYmd: addDaysYmd(today, -1), endYmd: addDaysYmd(today, 1) });

    const before = windows.calls.length;
    await selectView(w, 'jobs');
    expect(windows.calls.length).toBe(before);
    w.unmount();
  });

  it('follows the anchor: stepping the single-day view moves the window with it', async () => {
    const w = mountPage();
    await settle();
    const today = localToday();
    await selectView(w, 'today');
    w.findComponent({ name: 'WallTodayView' }).vm.$emit('focusDay', addDaysYmd(today, 1));
    await settle();
    expect(lastWindow()).toEqual({ startYmd: today, endYmd: addDaysYmd(today, 2) });
    w.unmount();
  });

  it('only the page sets a window (the views are stubbed, so every call is the page)', async () => {
    const w = mountPage();
    await settle();
    const keys = windows.calls.map((r) => (r ? `${r.startYmd}|${r.endYmd}` : 'null'));
    expect(new Set(keys).size).toBe(keys.length);
    w.unmount();
  });
});

describe('BeanieWallPage: a view-only event opens read-only details', () => {
  it('on a LOCKED wall: the details modal without a Google link, no sheet, no lock call', async () => {
    const w = mountPage();
    await settle();
    const lockMenu = w.findComponent({ name: 'WallLockMenu' });
    expect(lockMenu.props('isLocked')).toBe(true);
    lockSpies.noteActivity.mockClear();

    const event = externalEvent('Babysitting', { htmlLink: 'https://calendar.google.com/x' });
    w.findComponent({ name: 'WallDaysView' }).vm.$emit('open', { kind: 'external', event });
    await settle();

    const details = w.findComponent({ name: 'ExternalEventDetailsModal' });
    expect(details.props('open')).toBe(true);
    expect(details.props('event')).toEqual(event);
    expect(details.props('showGoogleLink')).toBe(false);
    // #150 P4: a location or join link on the wall is shown, never tappable.
    expect(details.props('interactive')).toBe(false);
    expect(w.findComponent({ name: 'WallSheet' }).exists()).toBe(false);
    expect(lockSpies.requestUnlock).not.toHaveBeenCalled();
    expect(lockSpies.noteActivity).not.toHaveBeenCalled();
    expect(lockMenu.props('challengeOpen')).toBe(false);
    expect(lockMenu.props('isLocked')).toBe(true);

    details.vm.$emit('close');
    await settle();
    expect(w.findComponent({ name: 'ExternalEventDetailsModal' }).props('open')).toBe(false);
    w.unmount();
  });

  it('an activity tap still opens the drill-in sheet, as before', async () => {
    const w = mountPage();
    await settle();
    w.findComponent({ name: 'WallDaysView' }).vm.$emit('open', {
      kind: 'activity',
      activityId: 'a1',
      ymd: localToday(),
    });
    await settle();
    expect(w.findComponent({ name: 'WallSheet' }).exists()).toBe(true);
    expect(w.findComponent({ name: 'ExternalEventDetailsModal' }).props('open')).toBe(false);
    w.unmount();
  });
});
