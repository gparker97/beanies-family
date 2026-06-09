import { mount, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import CalendarGrid from '../CalendarGrid.vue';
import type { FamilyActivity } from '@/types/models';

// Why a SEPARATE file from CalendarGrid.test.ts: `vi.mock` is one-per-module, and
// this suite needs a *reactive* useToday mock (a test-controlled ref mutated in
// place) rather than the static factory the main suite uses. Mutating today
// without a remount is the only way to actually exercise the issue-#25 fix — a
// remount-based test would pass even against the old frozen `new Date()` code,
// since a fresh mount always re-reads the clock.

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({
    monthActivities: () => [] as Array<{ activity: FamilyActivity; date: string }>,
  }),
  CATEGORY_COLORS: {} as Record<string, string>,
  getActivityColor: () => '#F15D22',
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ weekStartDay: 0 }),
}));

// The mock factory creates the reactive `today` ref and exposes the SAME instance
// via this hoisted holder so tests can mutate it. (The factory runs at import time,
// before any test, so `holder.todayRef` is populated by the time tests run.)
const holder = vi.hoisted(() => ({ todayRef: null as null | { value: string } }));

vi.mock('@/composables/useToday', async () => {
  const { ref, computed } = await import('vue');
  const { getStartOfDay, parseLocalDate } = await import('@/utils/date');
  const todayRef = ref('2026-04-15');
  holder.todayRef = todayRef;
  return {
    useToday: () => ({
      today: todayRef,
      startOfToday: computed(() => getStartOfDay(parseLocalDate(todayRef.value))),
      isVisible: ref(true),
      lastVisibleAt: ref(0),
      lastHiddenAt: ref(0),
    }),
  };
});

// April 2026 — independent of system clock; the displayed month is driven by the
// prop, while the today marker is driven by the mocked reactive ref.
const APRIL_2026 = new Date(2026, 3, 1);

function setToday(date: string): void {
  holder.todayRef!.value = date;
}

function markedTodayDates(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-date]')
    .filter((el) => el.classes().includes('border-l-[3px]'))
    .map((el) => el.attributes('data-date') ?? '');
}

beforeEach(() => {
  setActivePinia(createPinia());
  setToday('2026-04-15');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CalendarGrid today marker — live midnight rollover', () => {
  it('moves the border to the new day when today changes in place (no remount)', async () => {
    const wrapper = mount(CalendarGrid, { props: { referenceDate: APRIL_2026 } });

    expect(markedTodayDates(wrapper)).toEqual(['2026-04-15']);

    // Cross midnight WITHOUT remounting — the fix recomputes calendarDays off the
    // reactive ref, so the border must relocate on its own.
    setToday('2026-04-16');
    await nextTick();

    expect(markedTodayDates(wrapper)).toEqual(['2026-04-16']);
  });

  it('shows no today border when today falls outside the displayed month', async () => {
    const wrapper = mount(CalendarGrid, { props: { referenceDate: APRIL_2026 } });
    expect(markedTodayDates(wrapper)).toEqual(['2026-04-15']);

    // A May date is not a current-month April cell → no today marker, degrades
    // cleanly to "no border" (todayInView → false).
    setToday('2026-05-20');
    await nextTick();

    expect(markedTodayDates(wrapper)).toEqual([]);
  });
});
