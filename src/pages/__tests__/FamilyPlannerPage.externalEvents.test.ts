/**
 * View-only external calendars on the planner page (plan 2026-11-17, C2).
 *
 *  - The page is the ONLY planner place that sets the fetch window: the visible range
 *    widened by one period of the active view, following navigation.
 *  - A view-only event opens the read-only details modal, never the activity drawer or
 *    the add-activity form.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import FamilyPlannerPage from '@/pages/FamilyPlannerPage.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { widenByPeriod } from '@/utils/calendar/externalEvents';
import {
  addDaysYmd,
  localToday,
  monthGridRange,
  parseLocalDate,
  startOfWeekYmd,
} from '@/utils/date';
import { externalEvent } from '@/test/monthCellFixtures';
import type { YmdRange } from '@/types/externalEvents';

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {}, path: '/activities' }),
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
  return shallowMount(FamilyPlannerPage, { attachTo: document.body });
}
type Wrapper = ReturnType<typeof mountPage>;
const commandBar = (w: Wrapper) => w.findComponent({ name: 'CalendarCommandBar' });
const lastWindow = () => windows.calls[windows.calls.length - 1];

beforeEach(() => {
  setActivePinia(createPinia());
  windows.calls = [];
  localStorage.clear();
});

describe('FamilyPlannerPage: the view-only fetch window', () => {
  it('sets the month grid widened by one month each side, on mount', async () => {
    const w = mountPage();
    await settle();
    const weekStart = useSettingsStore().weekStartDay;
    const visible = monthGridRange(parseLocalDate(localToday()), weekStart);
    expect(lastWindow()).toEqual(widenByPeriod(visible, 'month', weekStart));
    w.unmount();
  });

  it('follows the active view: a week widens by a week, a day by a day', async () => {
    const w = mountPage();
    await settle();
    const weekStart = useSettingsStore().weekStartDay;
    const today = localToday();

    commandBar(w).vm.$emit('update:activeView', 'week');
    await settle();
    const sow = startOfWeekYmd(today, weekStart);
    expect(lastWindow()).toEqual(
      widenByPeriod({ startYmd: sow, endYmd: addDaysYmd(sow, 6) }, 'week', weekStart)
    );

    commandBar(w).vm.$emit('update:activeView', 'day');
    await settle();
    expect(lastWindow()).toEqual({ startYmd: addDaysYmd(today, -1), endYmd: addDaysYmd(today, 1) });

    commandBar(w).vm.$emit('next');
    await settle();
    expect(lastWindow()).toEqual({ startYmd: today, endYmd: addDaysYmd(today, 2) });
    w.unmount();
  });

  it('no child surface sets a window: only the page does', async () => {
    const w = mountPage();
    await settle();
    // shallowMount stubs the surfaces, so every call came from the page; one per window.
    const keys = windows.calls.map((r) => (r ? `${r.startYmd}|${r.endYmd}` : 'null'));
    expect(new Set(keys).size).toBe(keys.length);
    w.unmount();
  });
});

describe('FamilyPlannerPage: a view-only event opens read-only details', () => {
  it('from the month grid: the details modal, never the activity drawer or the add form', async () => {
    const w = mountPage();
    await settle();
    const event = externalEvent('Bridge club');

    w.findComponent({ name: 'CalendarGrid' }).vm.$emit('external-click', event);
    await settle();

    const details = w.findComponent({ name: 'ExternalEventDetailsModal' });
    expect(details.props('open')).toBe(true);
    expect(details.props('event')).toEqual(event);
    expect(w.findComponent({ name: 'ActivityViewEditModal' }).props('activity')).toBeFalsy();
    expect(w.findComponent({ name: 'ActivityModal' }).props('open')).toBe(false);

    details.vm.$emit('close');
    await settle();
    expect(details.props('open')).toBe(false);
    w.unmount();
  });

  it('from the week and day views and the agenda too', async () => {
    const w = mountPage();
    await settle();
    const event = externalEvent('Busy block', { busyOnly: true, title: undefined });

    commandBar(w).vm.$emit('update:activeView', 'week');
    await settle();
    w.findComponent({ name: 'WeeklyCalendarView' }).vm.$emit('external-click', event);
    await settle();
    expect(w.findComponent({ name: 'ExternalEventDetailsModal' }).props('event')).toEqual(event);
    w.findComponent({ name: 'ExternalEventDetailsModal' }).vm.$emit('close');

    commandBar(w).vm.$emit('update:activeView', 'day');
    await settle();
    w.findComponent({ name: 'DailyCalendarView' }).vm.$emit('external-click', event);
    await settle();
    expect(w.findComponent({ name: 'ExternalEventDetailsModal' }).props('open')).toBe(true);
    w.findComponent({ name: 'ExternalEventDetailsModal' }).vm.$emit('close');

    w.findComponent({ name: 'DayAgendaSidebar' }).vm.$emit('external-click', event);
    await settle();
    expect(w.findComponent({ name: 'ExternalEventDetailsModal' }).props('open')).toBe(true);
    expect(w.findComponent({ name: 'ActivityModal' }).props('open')).toBe(false);
    w.unmount();
  });
});
