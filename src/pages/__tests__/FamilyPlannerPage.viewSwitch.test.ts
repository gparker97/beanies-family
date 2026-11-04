/**
 * Drilling into a day from the month opens the Day view on that date, and switching back to the
 * month shows the same period. The month carries no leftover "clicked day" state: the page keeps
 * only `referenceDate`, which is what both surfaces read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import FamilyPlannerPage from '@/pages/FamilyPlannerPage.vue';
import { useActivityStore } from '@/stores/activityStore';
import type { FamilyActivity } from '@/types/models';

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {}, path: '/activities' }),
}));

// The nudge and the reveal log are observed, not replaced: the nudge flag is test-driven,
// and the reveal's options are captured so `viewKind` can be read back.
const nudge = vi.hoisted(() => ({ show: null as null | { value: boolean } }));
vi.mock('@/composables/useCalendarNudge', async () => {
  const { ref } = await import('vue');
  nudge.show = ref(false);
  return { useCalendarNudge: () => ({ showNudge: nudge.show }) };
});
const revealOptions = vi.hoisted(() => ({ current: null as null | { viewKind: () => string } }));
vi.mock('@/composables/useActivityReveal', async (orig) => {
  const actual = await orig<typeof import('@/composables/useActivityReveal')>();
  return {
    ...actual,
    useActivityReveal: (options: Parameters<typeof actual.useActivityReveal>[0]) => {
      revealOptions.current = options;
      return actual.useActivityReveal(options);
    },
  };
});

// The phone cases flip `breakpoint.mobile`; everything else runs as a desktop.
const breakpoint = vi.hoisted(() => ({ mobile: null as null | { value: boolean } }));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref } = await import('vue');
  breakpoint.mobile = ref(false);
  return {
    useBreakpoint: () => ({
      isMobile: breakpoint.mobile,
      isTablet: ref(false),
      isDesktop: ref(true),
    }),
  };
});

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

async function settle() {
  await flushPromises();
  await nextTick();
  await nextTick();
}

type Wrapper = ReturnType<typeof mountPage>;
function mountPage() {
  return shallowMount(FamilyPlannerPage, { attachTo: document.body });
}
/** Whichever month surface mounted (the stream on a phone, the grid otherwise). */
function monthSurface(w: Wrapper) {
  const stream = w.findComponent({ name: 'CalendarMonthStream' });
  return stream.exists() ? stream : w.findComponent({ name: 'CalendarGrid' });
}
const dayView = (w: Wrapper) => w.findComponent({ name: 'DailyCalendarView' });
const commandBar = (w: Wrapper) => w.findComponent({ name: 'CalendarCommandBar' });

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  nudge.show!.value = false;
  breakpoint.mobile!.value = false;
  localStorage.clear();
});

describe('FamilyPlannerPage: month to day and back', () => {
  it('opens the Day view on the clicked date, then returns to the month on the same period', async () => {
    const w = mountPage();
    expect(monthSurface(w).exists()).toBe(true);

    monthSurface(w).vm.$emit('selectDate', '2030-10-13');
    await settle();
    expect(monthSurface(w).exists()).toBe(false);
    const shown = dayView(w).props('referenceDate') as Date;
    expect([shown.getFullYear(), shown.getMonth(), shown.getDate()]).toEqual([2030, 9, 13]);

    commandBar(w).vm.$emit('update:activeView', 'month');
    await settle();
    expect(dayView(w).exists()).toBe(false);
    const back = monthSurface(w).props('referenceDate') as Date;
    expect([back.getFullYear(), back.getMonth()]).toEqual([2030, 9]);
    // The month surfaces take no selection prop at all.
    expect(monthSurface(w).props()).not.toHaveProperty('selectedDate');
    w.unmount();
  });
});

describe('FamilyPlannerPage: the desktop month grid (#141)', () => {
  const grid = (w: Wrapper) => w.findComponent({ name: 'CalendarGrid' });

  it('mounts the grid with the desktop display from the default prefs', async () => {
    const w = mountPage();
    await settle();
    expect(grid(w).exists()).toBe(true);
    expect(w.findComponent({ name: 'CalendarMonthStream' }).exists()).toBe(false);
    expect(grid(w).props('display')).toEqual({
      variant: 'desktop',
      density: 'compact',
      showTime: true,
      hideSoloFace: false,
    });
    w.unmount();
  });

  it('bleeds into the page padding only when nothing renders below the grid', async () => {
    const w = mountPage();
    await settle();
    expect(grid(w).props('bleedBottom')).toBe(true);

    // The connect nudge is showing below the grid.
    nudge.show!.value = true;
    await settle();
    expect(grid(w).props('bleedBottom')).toBe(false);

    nudge.show!.value = false;
    await settle();
    expect(grid(w).props('bleedBottom')).toBe(true);
    w.unmount();
  });

  it('does not bleed while inactive activities are listed below the grid', async () => {
    const store = useActivityStore();
    store.activities = [
      {
        id: 'a-off',
        title: 'Old class',
        isActive: false,
        date: '2026-01-05',
        category: 'other_activity',
        isAllDay: false,
        recurrence: { type: 'none' },
      } as unknown as FamilyActivity,
    ];
    const w = mountPage();
    await settle();
    expect(grid(w).props('bleedBottom')).toBe(false);
    w.unmount();
  });

  it('reads month-desktop as the reveal log view kind, and week keeps its desktop kind', async () => {
    const w = mountPage();
    await settle();
    expect(revealOptions.current!.viewKind()).toBe('month-desktop');
    commandBar(w).vm.$emit('update:activeView', 'week');
    await settle();
    expect(revealOptions.current!.viewKind()).toBe('week-desktop');
    w.unmount();
  });

  it('passes the saved density, times and solo-face prefs into the display', async () => {
    localStorage.setItem('beanies:monthGridDensity', 'comfortable');
    localStorage.setItem('beanies:monthGridSoloFaces', 'hidden');
    const w = mountPage();
    await settle();
    expect(grid(w).props('display')).toEqual({
      variant: 'desktop',
      density: 'comfortable',
      showTime: false, // times only show in Compact
      hideSoloFace: true,
    });
    w.unmount();
  });

  it('a set-month-pref from the command bar changes the display and persists', async () => {
    const w = mountPage();
    await settle();
    commandBar(w).vm.$emit('set-month-pref', { name: 'density', value: 'comfortable' }, 'menu');
    await settle();
    expect((grid(w).props('display') as { density: string }).density).toBe('comfortable');
    expect(localStorage.getItem('beanies:monthGridDensity')).toBe('comfortable');
    w.unmount();
  });

  it('the command bar gets the prefs snapshot', async () => {
    const w = mountPage();
    await settle();
    expect(commandBar(w).props('monthPrefs')).toMatchObject({
      density: 'compact',
      times: 'shown',
      soloFaces: 'shown',
    });
    w.unmount();
  });
});

describe('FamilyPlannerPage: the phone month surface (#141)', () => {
  const grid = (w: Wrapper) => w.findComponent({ name: 'CalendarGrid' });
  const stream = (w: Wrapper) => w.findComponent({ name: 'CalendarMonthStream' });

  beforeEach(() => {
    breakpoint.mobile!.value = true;
  });

  it('with no saved mode, mounts the grid in the phone variant', async () => {
    const w = mountPage();
    await settle();
    expect(grid(w).exists()).toBe(true);
    expect(stream(w).exists()).toBe(false);
    expect(grid(w).props('display')).toEqual({ variant: 'phone', density: 'titles' });
    w.unmount();
  });

  it('a saved list mode mounts the stream instead', async () => {
    localStorage.setItem('beanies:phoneMonthMode', 'list');
    const w = mountPage();
    await settle();
    expect(stream(w).exists()).toBe(true);
    expect(grid(w).exists()).toBe(false);
    w.unmount();
  });

  it('a saved phone density reaches the grid display', async () => {
    localStorage.setItem('beanies:phoneMonthDensity', 'faces');
    const w = mountPage();
    await settle();
    expect(grid(w).props('display')).toEqual({ variant: 'phone', density: 'faces' });
    w.unmount();
  });

  it('flipping the mode from the command bar swaps the surface and persists', async () => {
    const w = mountPage();
    await settle();
    commandBar(w).vm.$emit('set-month-pref', { name: 'phoneMode', value: 'list' }, 'm_pill');
    await settle();
    expect(stream(w).exists()).toBe(true);
    expect(grid(w).exists()).toBe(false);
    expect(localStorage.getItem('beanies:phoneMonthMode')).toBe('list');

    commandBar(w).vm.$emit('set-month-pref', { name: 'phoneMode', value: 'grid' }, 'm_pill');
    await settle();
    expect(grid(w).exists()).toBe(true);
    expect(stream(w).exists()).toBe(false);
    w.unmount();
  });

  it('a grid pinch change (set-month-pref from the grid) updates the density', async () => {
    const w = mountPage();
    await settle();
    grid(w).vm.$emit('set-month-pref', { name: 'phoneDensity', value: 'bars' }, 'pinch');
    await settle();
    expect(grid(w).props('display')).toEqual({ variant: 'phone', density: 'bars' });
    expect(localStorage.getItem('beanies:phoneMonthDensity')).toBe('bars');
    w.unmount();
  });

  it('crossing the breakpoint remounts the grid as the other variant', async () => {
    const w = mountPage();
    await settle();
    const phoneGrid = grid(w).vm;
    expect((grid(w).props('display') as { variant: string }).variant).toBe('phone');

    breakpoint.mobile!.value = false;
    await settle();
    expect(grid(w).exists()).toBe(true);
    expect((grid(w).props('display') as { variant: string }).variant).toBe('desktop');
    expect(grid(w).vm).not.toBe(phoneGrid);
    w.unmount();
  });

  it('reads month-mobile-grid for the phone grid and month-mobile for the stream', async () => {
    const w = mountPage();
    await settle();
    expect(revealOptions.current!.viewKind()).toBe('month-mobile-grid');
    commandBar(w).vm.$emit('set-month-pref', { name: 'phoneMode', value: 'list' }, 'm_pill');
    await settle();
    expect(revealOptions.current!.viewKind()).toBe('month-mobile');
    w.unmount();
  });
});
