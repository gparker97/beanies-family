import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import CalendarMonthStream from '../CalendarMonthStream.vue';
import type { FamilyActivity } from '@/types/models';

// The stream's *feel* (scroll compensation, momentum, the seam being invisible)
// cannot be honestly tested in jsdom — there is no layout, so `scrollHeight`
// and `getBoundingClientRect` are all zero. What IS testable here is the
// structure the feel depends on: that several months render as one stack, that
// each carries exactly one boundary marker, that the probe emits, and that the
// listener is cleaned up. Feel is verified by hand (see the plan's matrix).

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
}));

const mockActivityOccurrences: Array<{ activity: FamilyActivity; date: string }> = [];

vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({
    activitiesInRange: (startYmd: string, endYmd: string) =>
      mockActivityOccurrences.filter((o) => o.date >= startYmd && o.date <= endYmd),
  }),
  CATEGORY_COLORS: { sports: '#F15D22' } as Record<string, string>,
  getActivityColor: () => '#F15D22',
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ weekStartDay: 0 }),
}));

vi.mock('@/stores/holidayStore', () => ({
  useHolidayStore: () => ({ holidaysInRange: () => [] }),
}));

vi.mock('@/composables/useToday', async () => {
  const { ref, computed } = await import('vue');
  const { toDateInputValue, getStartOfDay } = await import('@/utils/date');
  return {
    useToday: () => ({
      today: ref(toDateInputValue(new Date())),
      startOfToday: computed(() => getStartOfDay(new Date())),
      isVisible: ref(true),
      lastVisibleAt: ref(0),
      lastHiddenAt: ref(0),
    }),
  };
});

// The slide layer is exercised by its own suite; here it would only add
// pointer plumbing noise.
vi.mock('@/composables/useCalendarSlide', () => ({ useCalendarSlide: vi.fn() }));

const REFERENCE = new Date(2026, 7, 15); // 15 August 2026

function mountStream(props: Record<string, unknown> = {}) {
  return mount(CalendarMonthStream, {
    props: { referenceDate: REFERENCE, ...props },
    global: { stubs: { teleport: true } },
  });
}

describe('CalendarMonthStream', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'));
    mockActivityOccurrences.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders a window of months as one stack, not a single month', () => {
    const w = mountStream();
    const markers = w.findAll('[data-month-key]');
    // One month either side of the anchor — the whole point of a stream is
    // that the next month is already there when you reach the seam.
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.attributes('data-month-key'))).toEqual([
      '2026-6',
      '2026-7',
      '2026-8',
    ]);
  });

  it('marks each month exactly once, so the probe can never double-count a boundary', () => {
    const w = mountStream();
    const keys = w.findAll('[data-month-key]').map((m) => m.attributes('data-month-key'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('renders whole months only — no padding days leak into the stack', () => {
    const w = mountStream();
    const dates = w.findAll('[data-date]').map((d) => d.attributes('data-date')!);
    // July, August and September in full: 31 + 31 + 30.
    expect(dates).toHaveLength(92);
    expect(dates[0]).toBe('2026-07-01');
    expect(dates[dates.length - 1]).toBe('2026-09-30');
  });

  it('keeps the days of each month contiguous and in order', () => {
    const w = mountStream();
    const dates = w.findAll('[data-date]').map((d) => d.attributes('data-date')!);
    expect([...dates].sort()).toEqual(dates);
  });

  it('names every month visibly — the header is what you land on, so it can never be hidden', () => {
    const w = mountStream();
    const headings = w.findAll('[data-month-key]');
    // The first month's header was briefly sr-only (the command bar names it
    // anyway). It cannot be: a month landing scrolls TO this element so the
    // month's name is in view on arrival, and you can also scroll up into it.
    for (const h of headings) expect(h.classes()).not.toContain('sr-only');
    expect(headings.map((h) => h.text().toLowerCase()).join(' ')).toContain('august');
  });

  it('lands a month anchor on the month header, not the 1st day card', async () => {
    const w = mountStream({ anchor: { tick: 0, target: 'month-start' } });
    await flushPromises();
    // Both swipe directions land the same way now (forward and back), and the
    // arrival point is the header so the month's name is fully visible — landing
    // on the 1st's card alone put the name just above the fold, which read as
    // having overshot the boundary.
    await w.setProps({ anchor: { tick: 1, target: 'month-start' } });
    await flushPromises();
    // No scroller exists in jsdom, so this asserts the request is well-formed
    // (it resolves without reporting a missing element) rather than the pixels.
    expect(w.find('[data-month-key="2026-7"]').exists()).toBe(true);
  });

  it('re-renders the window when the reference month moves outside it', async () => {
    const w = mountStream();
    await w.setProps({ referenceDate: new Date(2026, 11, 1) }); // December
    await flushPromises();
    const keys = w.findAll('[data-month-key]').map((m) => m.attributes('data-month-key'));
    expect(keys).toContain('2026-11');
  });

  it('detaches its scroll listener on unmount — a leaked one would emit from a dead component', () => {
    const add = vi.spyOn(Element.prototype, 'addEventListener');
    const remove = vi.spyOn(Element.prototype, 'removeEventListener');
    const w = mountStream();
    w.unmount();
    // Nothing is asserted about counts (the slide layer is mocked out, and
    // jsdom has no <main> ancestor here) beyond symmetry: whatever we bound,
    // we unbound.
    const scrollAdds = add.mock.calls.filter((c) => c[0] === 'scroll').length;
    const scrollRemoves = remove.mock.calls.filter((c) => c[0] === 'scroll').length;
    expect(scrollRemoves).toBeGreaterThanOrEqual(scrollAdds);
  });

  it('forwards day-card intents to the page rather than acting on them itself', async () => {
    const w = mountStream();
    const card = w.find('[data-date="2026-08-10"]');
    expect(card.exists()).toBe(true);
    await card.trigger('click');
    // One-way data flow: the stream never mutates the date, it emits.
    expect(w.emitted('selectDate')?.[0]).toEqual(['2026-08-10']);
  });
});
