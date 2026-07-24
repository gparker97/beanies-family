import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import CalendarGrid from '../CalendarGrid.vue';
import { useVacationStore } from '@/stores/vacationStore';
import type { FamilyActivity, FamilyVacation, VacationTravelSegment } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
}));

// Module-scope holder so individual tests can seed the activities the
// CalendarGrid will consume without re-mocking. Reset in beforeEach.
const mockActivityOccurrences: Array<{ activity: FamilyActivity; date: string }> = [];

vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({
    // Mirrors the real store: range-bounded, inclusive. The grid queries the
    // whole visible span (incl. prev/next-month padding cells), not the month.
    activitiesInRange: (startYmd: string, endYmd: string) =>
      mockActivityOccurrences.filter((o) => o.date >= startYmd && o.date <= endYmd),
  }),
  // Stable category color map matching what AllDayActivityChip expects.
  CATEGORY_COLORS: { sports: '#F15D22' } as Record<string, string>,
  // The chip uses getActivityColor(activity); return a deterministic color.
  getActivityColor: (a: FamilyActivity) => (a.color as string | undefined) ?? '#F15D22',
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    weekStartDay: 0,
  }),
}));

// Reactive "today" is mocked so the real composable's import-time singleton
// capture (`const today = ref(localToday())`) can't make these date-pinned tests
// flaky — `vi.setSystemTime` alone won't move that singleton. This canonical
// factory re-reads `new Date()` on each `useToday()` call (i.e. at mount), so it
// picks up the `vi.setSystemTime` set in `beforeEach`. (Pattern shared with
// vacationStore.test.ts / TransactionsPage.test.ts.)
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

const NOW = '2026-04-01T00:00:00.000Z';

function flightSegment(overrides: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'seg-flight-1',
    type: 'flight_outbound',
    title: 'SFO → JFK',
    status: 'booked',
    departureDate: '2026-04-15',
    departureTime: '09:00',
    arrivalDate: '2026-04-15',
    arrivalTime: '17:30',
    ...overrides,
  };
}

function makeVacation(segments: VacationTravelSegment[]): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Trip',
    tripType: 'fly_and_stay',
    assigneeIds: [],
    travelSegments: segments,
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: NOW,
    updatedAt: NOW,
    startDate: '2026-04-15',
    endDate: '2026-04-20',
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  mockActivityOccurrences.length = 0;
  // Pin the calendar to April 2026 so test data lands on visible cells
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('CalendarGrid travel-segment chips', () => {
  it('renders direction-aware flight emojis (🛫 departure / 🛬 arrival) with kind labels', () => {
    const store = useVacationStore();
    store.vacations = [makeVacation([flightSegment()])];

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const html = wrapper.html();

    // Direction-aware emoji disambiguates the two markers without reading the time
    expect(html).toContain('🛫');
    expect(html).toContain('🛬');
    // Kind labels (Dep/Arr) prefix the time
    expect(html).toContain('planner.segmentDepartureShort');
    expect(html).toContain('planner.segmentArrivalShort');
    // Departure time and arrival time both rendered
    // (formatTime12: '09:00' → '9am', '17:30' → '5:30pm')
    expect(html).toContain('9am');
    expect(html).toContain('5:30pm');
  });

  it('clicking a chip emits view-segment with vacationId + segmentIndex', async () => {
    const store = useVacationStore();
    store.vacations = [makeVacation([flightSegment()])];

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    // Find any chip — direction-aware emoji means we look for the takeoff one
    const chips = wrapper.findAll('span').filter((el) => el.text().includes('🛫'));
    expect(chips.length).toBeGreaterThanOrEqual(1);

    await chips[0].trigger('click');

    const events = wrapper.emitted('view-segment');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(['vac-1', 0]);
  });

  it('renders pending segments with the dashed-outline class', () => {
    const store = useVacationStore();
    store.vacations = [makeVacation([flightSegment({ status: 'pending' })])];

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const html = wrapper.html();
    // Pending → travel-chip-pending class. Scoped CSS in TravelSegmentChip.vue
    // supplies the dashed border + italic styles; the test checks the class
    // hook (which survives the chip extraction during the chip refactor).
    expect(html).toContain('travel-chip-pending');
  });

  it('caps visible chips at 2 with a +N overflow indicator', () => {
    const store = useVacationStore();
    // Build 4 outbound flights all on the same day → 8 occurrences (4 dep + 4 arr)
    // but each cell has 2 visible + +6 indicator (per cell)
    const segs = Array.from({ length: 4 }, (_, i) =>
      flightSegment({ id: `seg-${i}`, departureTime: `${10 + i}:00` })
    );
    store.vacations = [makeVacation(segs)];

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const html = wrapper.html();
    // Should show overflow indicator
    expect(html).toMatch(/\+\d+/);
  });
});

function allDayActivity(
  overrides: Partial<FamilyActivity> & { id: string; date: string }
): FamilyActivity {
  return {
    title: `Event ${overrides.id}`,
    category: 'sports',
    isActive: true,
    isAllDay: true,
    createdAt: NOW,
    updatedAt: NOW,
    recurrence: 'none',
    ...overrides,
  } as FamilyActivity;
}

describe('CalendarGrid all-day lane', () => {
  it('renders an AllDayActivityChip for a single-day all-day activity', () => {
    const a = allDayActivity({ id: 'a-single', date: '2026-04-14', title: "Beau's birthday" });
    mockActivityOccurrences.push({ activity: a, date: '2026-04-14' });

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const chips = wrapper.findAll('[data-testid="all-day-activity-chip"]');
    expect(chips.length).toBe(1);
    expect(chips[0]!.text()).toContain("Beau's birthday");
  });

  it('renders 3 slices for a 3-day all-day activity, with title only on the start cell', () => {
    const a = allDayActivity({
      id: 'a-multi',
      date: '2026-04-14',
      endDate: '2026-04-16',
      title: 'Spring break',
    });
    // monthActivities() yields one occurrence per day for multi-day all-day
    mockActivityOccurrences.push(
      { activity: a, date: '2026-04-14' },
      { activity: a, date: '2026-04-15' },
      { activity: a, date: '2026-04-16' }
    );

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const chips = wrapper.findAll('[data-testid="all-day-activity-chip"]');
    expect(chips.length).toBe(3);
    // Title rendered exactly once across the run (start cell only)
    const titlesShown = chips.filter((c) => c.text().includes('Spring break'));
    expect(titlesShown.length).toBe(1);
  });

  it('caps the all-day lane at 2 chips with a +N overflow indicator', () => {
    // 3 distinct single-day all-day activities on the same date → 2 visible + "+1"
    for (let i = 0; i < 3; i++) {
      const a = allDayActivity({ id: `a-${i}`, date: '2026-04-14', title: `Event ${i}` });
      mockActivityOccurrences.push({ activity: a, date: '2026-04-14' });
    }

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const html = wrapper.html();
    // Should show "+1" overflow somewhere in the all-day lane region
    expect(html).toMatch(/\+1/);
  });

  it('emits view-activity with [activityId, date] when an all-day chip is clicked', async () => {
    const a = allDayActivity({ id: 'a-click', date: '2026-04-14', title: 'Birthday' });
    mockActivityOccurrences.push({ activity: a, date: '2026-04-14' });

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const chip = wrapper.find('[data-testid="all-day-activity-chip"]');
    expect(chip.exists()).toBe(true);

    await chip.trigger('click');

    const events = wrapper.emitted('view-activity');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(['a-click', '2026-04-14']);
  });
});

describe('CalendarGrid today marker', () => {
  it('draws the today border on exactly the current day and no other cell', () => {
    // System time is pinned to 2026-04-15 in beforeEach; the mocked useToday
    // re-reads new Date() at mount, so "today" resolves to 2026-04-15.
    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });

    // The today marker is the `border-l-[3px]` class on the day-cell <button>
    // (MonthDayCard.vue). Only the isToday branch emits it.
    const marked = wrapper
      .findAll('[data-date]')
      .filter((el) => el.classes().includes('border-l-[3px]'));

    expect(marked.length).toBe(1);
    expect(marked[0]!.attributes('data-date')).toBe('2026-04-15');
  });
});

describe('CalendarGrid timed-chip row', () => {
  it('renders a MonthChip for each timed activity on a day', () => {
    // Two timed activities on the same day (April 14, 2026 — system time pinned above)
    mockActivityOccurrences.push(
      {
        activity: {
          id: 'a-timed-1',
          title: 'Piano',
          date: '2026-04-14',
          startTime: '15:30',
          category: 'piano',
          isAllDay: false,
          recurrence: { type: 'none' },
          feeSchedule: 'none',
          reminderMinutes: { default: 15 },
          isActive: true,
          createdBy: 'm-1',
          createdAt: NOW,
          updatedAt: NOW,
          assigneeIds: ['m-1'],
        } as unknown as FamilyActivity,
        date: '2026-04-14',
      },
      {
        activity: {
          id: 'a-timed-2',
          title: 'Soccer',
          date: '2026-04-14',
          startTime: '16:00',
          category: 'soccer',
          isAllDay: false,
          recurrence: { type: 'none' },
          feeSchedule: 'none',
          reminderMinutes: { default: 15 },
          isActive: true,
          createdBy: 'm-1',
          createdAt: NOW,
          updatedAt: NOW,
          assigneeIds: ['m-1'],
        } as unknown as FamilyActivity,
        date: '2026-04-14',
      }
    );

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const chips = wrapper.findAll('[data-testid="month-chip"]');
    expect(chips.length).toBe(2);
    const text = wrapper.text();
    expect(text).toContain('Piano');
    expect(text).toContain('Soccer');
  });

  it('renders chips on the greyed prev/next-month padding cells too', () => {
    // April 2026 with a Sunday week start: the grid's first row reaches back to
    // Mar 29-31 and its last row runs on to May 1-2. Those days are drawn, so
    // their items must be drawn as well — a visible day that renders empty when
    // it isn't reads as "nothing on", which is worse than not showing the day.
    const timed = (id: string, date: string, title: string) => ({
      activity: {
        id,
        title,
        date,
        startTime: '10:00',
        category: 'other_activity',
        isAllDay: false,
        recurrence: { type: 'none' },
        feeSchedule: 'none',
        reminderMinutes: { default: 15 },
        isActive: true,
        createdBy: 'm-1',
        createdAt: NOW,
        updatedAt: NOW,
        assigneeIds: ['m-1'],
      } as unknown as FamilyActivity,
      date,
    });

    mockActivityOccurrences.push(
      timed('a-prev', '2026-03-30', 'Late March swim'),
      timed('a-next', '2026-05-01', 'Early May recital')
    );

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const text = wrapper.text();

    expect(text).toContain('Late March swim');
    expect(text).toContain('Early May recital');
    expect(wrapper.findAll('[data-testid="month-chip"]').length).toBe(2);
  });

  it('does not pull in items from outside the visible grid span', () => {
    // Mar 20 is in the previous month but NOT on the April grid — querying a
    // whole 3 months instead of the grid range would wrongly surface it.
    mockActivityOccurrences.push({
      activity: {
        id: 'a-offgrid',
        title: 'Off-grid March event',
        date: '2026-03-20',
        startTime: '10:00',
        category: 'other_activity',
        isAllDay: false,
        recurrence: { type: 'none' },
        feeSchedule: 'none',
        reminderMinutes: { default: 15 },
        isActive: true,
        createdBy: 'm-1',
        createdAt: NOW,
        updatedAt: NOW,
        assigneeIds: ['m-1'],
      } as unknown as FamilyActivity,
      date: '2026-03-20',
    });

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });

    expect(wrapper.text()).not.toContain('Off-grid March event');
    expect(wrapper.findAll('[data-testid="month-chip"]').length).toBe(0);
  });

  it('renders +N more button when a day exceeds the timed-chip cap', () => {
    // 6 timed activities on the same day → cap is 4 → 4 chips + "+2 more"
    for (let i = 0; i < 6; i++) {
      mockActivityOccurrences.push({
        activity: {
          id: `a-overflow-${i}`,
          title: `Event ${i}`,
          date: '2026-04-14',
          startTime: `${10 + i}:00`,
          category: 'other_activity',
          isAllDay: false,
          recurrence: { type: 'none' },
          feeSchedule: 'none',
          reminderMinutes: { default: 15 },
          isActive: true,
          createdBy: 'm-1',
          createdAt: NOW,
          updatedAt: NOW,
          assigneeIds: ['m-1'],
        } as unknown as FamilyActivity,
        date: '2026-04-14',
      });
    }

    const wrapper = mount(CalendarGrid, { props: { referenceDate: new Date() } });
    const chips = wrapper.findAll('[data-testid="month-chip"]');
    expect(chips.length).toBe(4);
    expect(wrapper.text()).toContain('+2');
  });
});
