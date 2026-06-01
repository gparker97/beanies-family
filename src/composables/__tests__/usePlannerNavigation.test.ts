import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { usePlannerNavigation, type PlannerView } from '@/composables/usePlannerNavigation';

// Mock useToday so its `startOfToday` reflects whatever time is set via
// `vi.setSystemTime` at the moment useToday() is invoked. The real composable
// initialises a module-scoped singleton at import time, which captures the real
// system date before vi.useFakeTimers() runs in beforeEach — so without this
// mock the seeded referenceDate ignores the pinned clock and the month/week
// assertions below silently break whenever the real wall-clock date crosses a
// month boundary (e.g. the 1st). Mirrors the useNavBadges.test mock.
vi.mock('@/composables/useToday', async () => {
  const { ref: vueRef, computed } = await import('vue');
  const { toDateInputValue, getStartOfDay } = await import('@/utils/date');
  return {
    useToday: () => ({
      today: vueRef(toDateInputValue(new Date())),
      startOfToday: computed(() => getStartOfDay(new Date())),
      isVisible: vueRef(true),
      lastVisibleAt: vueRef(0),
      lastHiddenAt: vueRef(0),
    }),
  };
});

describe('usePlannerNavigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    // Tuesday 26 May 2026, local — referenceDate seeds from startOfToday.
    vi.setSystemTime(new Date(2026, 4, 26, 9, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('month: steps by whole months and never overflows on a high day-of-month', () => {
    const view = ref<PlannerView>('month');
    const nav = usePlannerNavigation(view);
    expect(nav.referenceDate.value.getMonth()).toBe(4); // May
    nav.goNext();
    expect(nav.referenceDate.value.getMonth()).toBe(5); // June — not skipped
    expect(nav.referenceDate.value.getDate()).toBe(1); // anchored to the 1st
    nav.goPrev();
    nav.goPrev();
    expect(nav.referenceDate.value.getMonth()).toBe(3); // April
  });

  it('week: steps by 7 days', () => {
    const view = ref<PlannerView>('week');
    const nav = usePlannerNavigation(view);
    const start = nav.referenceDate.value.getDate(); // 26
    nav.goNext();
    expect(nav.referenceDate.value.getDate()).toBe(start + 7 - 31); // June 2 (26+7=33 → Jun 2)
    expect(nav.referenceDate.value.getMonth()).toBe(5);
  });

  it('day: steps by 1 day; label is non-empty', () => {
    const view = ref<PlannerView>('day');
    const nav = usePlannerNavigation(view);
    // Derive the expectation from the composable's own seed so the test is
    // robust regardless of the pinned date — goNext just adds one day.
    const expected = new Date(nav.referenceDate.value);
    expected.setDate(expected.getDate() + 1);
    nav.goNext();
    expect(nav.referenceDate.value.getDate()).toBe(expected.getDate());
    expect(nav.referenceDate.value.getMonth()).toBe(expected.getMonth());
    expect(nav.label.value.length).toBeGreaterThan(0);
  });

  it('goToday resets the reference date to today', () => {
    const view = ref<PlannerView>('day');
    const nav = usePlannerNavigation(view);
    const today = new Date(nav.referenceDate.value); // the seeded "today"
    nav.goNext();
    nav.goNext();
    nav.goToday();
    expect(nav.referenceDate.value.getDate()).toBe(today.getDate());
    expect(nav.referenceDate.value.getMonth()).toBe(today.getMonth());
  });

  it('view-switch continuity: the focused period persists across views', () => {
    const view = ref<PlannerView>('month');
    const nav = usePlannerNavigation(view);
    nav.goNext(); // → June
    view.value = 'week';
    expect(nav.referenceDate.value.getMonth()).toBe(5); // still June, not reset to today
  });
});
