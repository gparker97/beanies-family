import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { nextTick, ref } from 'vue';
import CalendarGrid from '../CalendarGrid.vue';
import MonthGridCell from '../MonthGridCell.vue';
import { MONTH_CELL_METRICS } from '@/constants/calendarCaps';
import { stepDensity } from '@/utils/monthGridLayout';
import { pinch } from '@/test/pointerSwipe';
import { logEvent } from '@/services/telemetry/logEvent';
import { useFamilyStore } from '@/stores/familyStore';

/** The desktop grid's presentation input (#141); the page builds it in the app. */
const GRID_PROPS = {
  display: { variant: 'desktop', density: 'compact', showTime: true, hideSoloFace: false },
  bleedBottom: false,
} as const;
import { useVacationStore } from '@/stores/vacationStore';
import type { FamilyActivity, FamilyVacation, VacationTravelSegment } from '@/types/models';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

// The fit measures a real layout, which happy-dom does not have (rowPx stays null). A test
// that needs a measured grid sets `fitOverride`; everything else runs the real composable.
const fitHolder = vi.hoisted(() => ({
  /** The options of the latest `useMonthGridFit` call (the grid's inset wiring). */
  lastOpts: null as null | { insetRef?: { value: HTMLElement | null } },
  override: null as null | {
    rowPx: { value: number | null };
    remPx: { value: number };
    bleedPx: { value: number };
    degraded: { value: boolean };
  },
}));
vi.mock('@/composables/useMonthGridFit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useMonthGridFit')>();
  return {
    ...actual,
    useMonthGridFit: (...args: Parameters<typeof actual.useMonthGridFit>) => {
      fitHolder.lastOpts = args[2];
      return fitHolder.override ?? actual.useMonthGridFit(...args);
    },
  };
});

// Records the wheel pager's options so a test can read whether paging is enabled.
const wheelSpy = vi.hoisted(() => ({ enabled: [] as Array<{ value: boolean } | undefined> }));
vi.mock('@/composables/useWheelMonthPaging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useWheelMonthPaging')>();
  return {
    ...actual,
    useWheelMonthPaging: (...args: Parameters<typeof actual.useWheelMonthPaging>) => {
      wheelSpy.enabled.push(args[1].enabled);
      return actual.useWheelMonthPaging(...args);
    },
  };
});

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
    eventsInRange: (startYmd: string, endYmd: string) =>
      mockActivityOccurrences.filter((o) => o.date >= startYmd && o.date <= endYmd),
  }),
  // Stable category color map matching what AllDayActivityChip expects.
  CATEGORY_COLORS: { sports: '#F15D22' } as Record<string, string>,
  // The chip uses getActivityColor(activity); return a deterministic color.
  getActivityColor: (a: FamilyActivity) => (a.color as string | undefined) ?? '#F15D22',
}));

// Mutable so a test can flip the week start; reset to Sunday in beforeEach.
const settingsHolder = vi.hoisted(() => ({ weekStartDay: 0 }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => settingsHolder,
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
  fitHolder.override = null;
  fitHolder.lastOpts = null;
  settingsHolder.weekStartDay = 0;
  wheelSpy.enabled.length = 0;
  vi.mocked(logEvent).mockClear();
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
    // #141: the month grid draws segments as month chips (`MonthSegmentChip`);
    // pending → the dashed edge.
    const chips = wrapper.findAll('[data-testid="month-segment-chip"]');
    expect(chips.length).toBeGreaterThanOrEqual(1);
    expect(chips[0]!.classes()).toContain('border-dashed');
  });

  it('caps visible chips at 2 with a +N overflow indicator', () => {
    const store = useVacationStore();
    // Build 4 outbound flights all on the same day → 8 occurrences (4 dep + 4 arr)
    // but each cell has 2 visible + +6 indicator (per cell)
    const segs = Array.from({ length: 4 }, (_, i) =>
      flightSegment({ id: `seg-${i}`, departureTime: `${10 + i}:00` })
    );
    store.vacations = [makeVacation(segs)];

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
    const chips = wrapper.findAll('[data-testid="all-day-activity-chip"]');
    expect(chips.length).toBe(3);
    // Title rendered exactly once across the run (start cell only)
    const titlesShown = chips.filter((c) => c.text().includes('Spring break'));
    expect(titlesShown.length).toBe(1);
  });

  it('puts all-day items past the lane and the fitted slots behind a +N overflow', () => {
    // #141: 5 single-day all-day activities → 1 wins the lane, 4 stack. Unmeasured (no
    // <main> in the test DOM) the Compact cell shows its 3 fallback slots → "+1".
    for (let i = 0; i < 5; i++) {
      const a = allDayActivity({ id: `a-${i}`, date: '2026-04-14', title: `Event ${i}` });
      mockActivityOccurrences.push({ activity: a, date: '2026-04-14' });
    }

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
    const html = wrapper.html();
    // Should show "+1" overflow somewhere in the all-day lane region
    expect(html).toMatch(/\+1/);
  });

  it('emits view-activity with [activityId, date] when an all-day chip is clicked', async () => {
    const a = allDayActivity({ id: 'a-click', date: '2026-04-14', title: 'Birthday' });
    mockActivityOccurrences.push({ activity: a, date: '2026-04-14' });

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
    const chip = wrapper.find('[data-testid="all-day-activity-chip"]');
    expect(chip.exists()).toBe(true);

    await chip.trigger('click');

    const events = wrapper.emitted('view-activity');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(['a-click', '2026-04-14']);
  });
});

describe('CalendarGrid today marker', () => {
  it('marks exactly the current day, with the numeral pill and no border', () => {
    // System time is pinned to 2026-04-15 in beforeEach; the mocked useToday
    // re-reads new Date() at mount, so "today" resolves to 2026-04-15.
    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });

    // The today marker is `aria-current="date"` on the day-cell <button>
    // (MonthGridCell.vue). Only the isToday branch emits it.
    const marked = wrapper.findAll('[data-date][aria-current="date"]');

    expect(marked.length).toBe(1);
    expect(marked[0]!.attributes('data-date')).toBe('2026-04-15');
    // The pill is the marker; the grid never draws an orange cell border.
    expect(wrapper.findAll('.bg-gradient-to-br')).toHaveLength(1);
    expect(marked[0]!.get('[data-testid="month-cell-numeral"]').classes().join(' ')).toContain(
      'bg-gradient-to-br'
    );
    expect(marked[0]!.classes()).not.toContain('border-primary-500');
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });

    expect(wrapper.text()).not.toContain('Off-grid March event');
    expect(wrapper.findAll('[data-testid="month-chip"]').length).toBe(0);
  });

  it('renders +N more button when a day exceeds the cell capacity', () => {
    // #141: 6 timed activities on the same day; unmeasured, the Compact cell shows its
    // 3 fallback slots → 3 chips + "+3 more"
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

    const wrapper = mount(CalendarGrid, { props: { ...GRID_PROPS, referenceDate: new Date() } });
    const chips = wrapper.findAll('[data-testid="month-chip"]');
    expect(chips.length).toBe(3);
    expect(wrapper.get('[data-testid="month-more"]').text()).toContain('+3');
  });
});

// ── The month grid contract (#141) ─────────────────────────────────────────

function timedActivity(id: string, date: string, startTime = '10:00'): FamilyActivity {
  return {
    id,
    title: `Event ${id}`,
    date,
    startTime,
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
  } as unknown as FamilyActivity;
}

function seedDay(date: string, count: number): void {
  for (let i = 0; i < count; i++) {
    mockActivityOccurrences.push({
      activity: timedActivity(`${date}-${i}`, date, `${String(8 + i).padStart(2, '0')}:00`),
      date,
    });
  }
}

function fakeFit(rowPx: number | null, bleedPx = 24, cellPx = 139, degraded = false) {
  fitHolder.override = {
    rowPx: ref(rowPx),
    remPx: ref(16),
    bleedPx: ref(bleedPx),
    degraded: ref(degraded),
    cellPx: ref(cellPx),
  } as unknown as NonNullable<typeof fitHolder.override>;
}

const mountGrid = (extra: Record<string, unknown> = {}, attach = false) =>
  mount(CalendarGrid, {
    props: { ...GRID_PROPS, referenceDate: new Date(), ...extra },
    ...(attach ? { attachTo: document.body } : {}),
  });

describe('CalendarGrid structure', () => {
  it('draws 42 cells in six week rows of seven', () => {
    const wrapper = mountGrid();
    const rows = wrapper.findAll('[data-testid="month-week-row"]');
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.findAll('[data-date]')).toHaveLength(7);
    expect(wrapper.findAll('[data-date]')).toHaveLength(42);
    // April 2026, Sunday start: Mar 29 .. May 9.
    expect(wrapper.findAll('[data-date]')[0]!.attributes('data-date')).toBe('2026-03-29');
    expect(wrapper.findAll('[data-date]')[41]!.attributes('data-date')).toBe('2026-05-09');
  });

  it('passes the display through: per-cell vars follow the density', () => {
    const wrapper = mountGrid({
      display: { variant: 'desktop', density: 'comfortable', showTime: false, hideSoloFace: false },
    });
    const style = wrapper.get('[data-date="2026-04-14"]').attributes('style') ?? '';
    expect(style).toContain(`--mg-chip-h: ${MONTH_CELL_METRICS.comfortable.chipRem}rem`);
    expect(style).toContain(`--mg-lane-h: ${MONTH_CELL_METRICS.comfortable.laneRem}rem`);
    const compact = mountGrid().get('[data-date="2026-04-14"]').attributes('style') ?? '';
    expect(compact).toContain(`--mg-chip-h: ${MONTH_CELL_METRICS.compact.chipRem}rem`);
  });

  it('passes showTime through to the chips', () => {
    seedDay('2026-04-14', 1);
    expect(mountGrid().get('[data-testid="month-chip"]').text()).toContain('8am');
    const noTime = mountGrid({
      display: { variant: 'desktop', density: 'compact', showTime: false, hideSoloFace: false },
    });
    expect(noTime.get('[data-testid="month-chip"]').text()).not.toContain('8am');
  });

  it('tints out-of-month cells, never in-month ones', () => {
    const wrapper = mountGrid();
    const OUT_OF_MONTH = 'bg-[var(--tint-slate-5)]';
    // 2026-03-29 and 2026-05-09 pad April's grid; 2026-04-18 is an in-month Saturday.
    expect(wrapper.get('[data-date="2026-03-29"]').classes()).toContain(OUT_OF_MONTH);
    expect(wrapper.get('[data-date="2026-05-09"]').classes()).toContain(OUT_OF_MONTH);
    expect(wrapper.get('[data-date="2026-04-18"]').classes()).not.toContain(OUT_OF_MONTH);
    expect(wrapper.get('[data-date="2026-04-14"]').classes()).not.toContain(OUT_OF_MONTH);
  });
});

describe('CalendarGrid weekday header', () => {
  // Every header cell carries `border-b-2` (transparent on weekdays) so the row stays one
  // height; only the colour marks the weekend.
  const WEEKEND = [
    'text-terracotta-600',
    'dark:text-terracotta-lift',
    'font-bold',
    'border-terracotta-600',
    'dark:border-terracotta-lift',
  ];
  const headers = (w: ReturnType<typeof mountGrid>) =>
    w.findAll('[data-testid="month-weekday-header"]');
  const weekendColumns = (w: ReturnType<typeof mountGrid>) =>
    headers(w).flatMap((hd, i) => (hd.classes().includes('text-terracotta-600') ? [i] : []));

  it('Sunday start: the first and last columns carry the terracotta weekend treatment', () => {
    const w = mountGrid();
    expect(headers(w).map((hd) => hd.text())).toEqual([
      'planner.day.sun',
      'planner.day.mon',
      'planner.day.tue',
      'planner.day.wed',
      'planner.day.thu',
      'planner.day.fri',
      'planner.day.sat',
    ]);
    expect(weekendColumns(w)).toEqual([0, 6]);
    for (const cls of WEEKEND) expect(headers(w)[0]!.classes()).toContain(cls);
    // A weekday keeps the muted ink and none of the weekend classes; both keep the type.
    const weekday = headers(w)[1]!.classes();
    expect(weekday).toContain('text-[var(--color-text-muted)]');
    expect(weekday).toContain('dark:text-ink-faint');
    for (const cls of WEEKEND) expect(weekday).not.toContain(cls);
    expect(weekday).toContain('border-b-2');
    expect(weekday).toContain('border-transparent');
    for (const cls of ['font-outfit', 'text-xs', 'uppercase', 'tracking-wide', 'py-1.5']) {
      expect(headers(w)[0]!.classes()).toContain(cls);
      expect(weekday).toContain(cls);
    }
    expect(headers(w)[0]!.classes()).not.toContain('text-[var(--color-text-muted)]');
  });

  it('Monday start: the last two columns carry it', () => {
    settingsHolder.weekStartDay = 1;
    const w = mountGrid();
    expect(headers(w)[0]!.text()).toBe('planner.day.mon');
    expect(weekendColumns(w)).toEqual([5, 6]);
    for (const cls of WEEKEND) expect(headers(w)[5]!.classes()).toContain(cls);
  });
});

describe('CalendarGrid span edges', () => {
  it('draws items on the first and last day of the 42-day span, and none just outside', () => {
    seedDay('2026-03-29', 1); // first cell
    seedDay('2026-05-09', 1); // last cell
    seedDay('2026-03-28', 1); // one day before
    seedDay('2026-05-10', 1); // one day after
    const wrapper = mountGrid();
    const drawn = wrapper.findAll('[data-testid="month-chip"]').map((c) => c.text());
    expect(drawn).toHaveLength(2);
    expect(
      wrapper.get('[data-date="2026-03-29"]').find('[data-testid="month-chip"]').exists()
    ).toBe(true);
    expect(
      wrapper.get('[data-date="2026-05-09"]').find('[data-testid="month-chip"]').exists()
    ).toBe(true);
  });
});

describe('CalendarGrid fit and bleed', () => {
  it('wide measured cells: emits update:timesRoom true and the cells keep showTime', () => {
    fakeFit(120, 24, 139);
    const wrapper = mountGrid();
    expect(wrapper.emitted('update:timesRoom')?.[0]).toEqual([true]);
    const cells = wrapper.findAllComponents(MonthGridCell);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells)
      expect((c.props('display') as { showTime?: boolean }).showTime).toBe(true);
  });

  it('narrow measured cells: emits update:timesRoom false and the cells drop showTime', () => {
    fakeFit(120, 24, 103);
    const wrapper = mountGrid();
    expect(wrapper.emitted('update:timesRoom')?.[0]).toEqual([false]);
    const cells = wrapper.findAllComponents(MonthGridCell);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells)
      expect((c.props('display') as { showTime?: boolean }).showTime).toBe(false);
  });

  it('unmeasured (no scroller): rows are content-sized and nothing bleeds', () => {
    const wrapper = mountGrid({ bleedBottom: true });
    for (const row of wrapper.findAll('[data-testid="month-week-row"]')) {
      expect(row.attributes('style') ?? '').not.toContain('height');
    }
    expect(wrapper.element.style.marginBottom).toBe('');
  });

  it('measured: every week row binds the fitted height', () => {
    fakeFit(120);
    const wrapper = mountGrid();
    for (const row of wrapper.findAll('[data-testid="month-week-row"]')) {
      expect(row.attributes('style')).toContain('height: 120px');
    }
  });

  it('bleedBottom toggles the negative bottom margin and the card radius', () => {
    fakeFit(120, 24);
    const bleeding = mountGrid({ bleedBottom: true });
    expect(bleeding.element.style.marginBottom).toBe('-24px');
    expect(bleeding.classes()).toContain('rounded-t-3xl');
    const contained = mountGrid({ bleedBottom: false });
    expect(contained.element.style.marginBottom).toBe('');
    expect(contained.classes()).toContain('rounded-3xl');
  });

  it('logs grid_fit once the first measure lands, naming format, density and fit', () => {
    fakeFit(120);
    mountGrid();
    const calls = vi.mocked(logEvent).mock.calls.filter(([e]) => e.message === 'grid_fit');
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toMatchObject({
      surface: 'calendar-month-grid',
      context: { action: 'grid_fit', format: 'desktop', kind: 'compact', detail: 'fits' },
    });
  });

  it('logs no grid_fit while unmeasured', () => {
    mountGrid();
    expect(vi.mocked(logEvent).mock.calls.some(([e]) => e.message === 'grid_fit')).toBe(false);
  });
});

describe('CalendarGrid popover', () => {
  const popovers = () => document.body.querySelectorAll('[data-testid="month-day-popover"]');

  it('opens one popover from "+N more", re-keys it on another cell, and closes on month change', async () => {
    seedDay('2026-04-14', 6);
    seedDay('2026-04-21', 6);
    const wrapper = mountGrid({}, true);

    await wrapper.get('[data-date="2026-04-14"] [data-testid="month-more"]').trigger('click');
    await nextTick();
    expect(popovers()).toHaveLength(1);
    expect(popovers()[0]!.querySelectorAll('[data-testid="month-chip"]')).toHaveLength(6);

    await wrapper.get('[data-date="2026-04-21"] [data-testid="month-more"]').trigger('click');
    await nextTick();
    await nextTick();
    expect(popovers()).toHaveLength(1);

    await wrapper.setProps({ referenceDate: new Date(2026, 4, 1) });
    await nextTick();
    await nextTick();
    expect(popovers()).toHaveLength(0);
    wrapper.unmount();
  });

  it('a popover chip click emits view-activity and closes without selecting the day', async () => {
    seedDay('2026-04-14', 5);
    const wrapper = mountGrid({}, true);
    await wrapper.get('[data-date="2026-04-14"] [data-testid="month-more"]').trigger('click');
    await nextTick();
    document.body
      .querySelector<HTMLElement>('[data-testid="month-day-popover"] [data-testid="month-chip"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('view-activity')![0]![0]).toBe('2026-04-14-0');
    expect(wrapper.emitted('selectDate')).toBeUndefined();
    expect(popovers()).toHaveLength(0);
    wrapper.unmount();
  });
});

describe('CalendarGrid events', () => {
  it('numeral click selects the day (selectDate)', async () => {
    const wrapper = mountGrid();
    await wrapper
      .get('[data-date="2026-04-14"] [data-testid="month-cell-numeral"]')
      .trigger('click');
    expect(wrapper.emitted('selectDate')).toEqual([['2026-04-14']]);
  });

  describe('birthday-click', () => {
    function withBirthday() {
      const store = useFamilyStore();
      store.members = [
        {
          id: 'm-joey',
          name: 'Joey',
          color: '#6AA84F',
          isPet: false,
          dateOfBirth: { month: 4, day: 14, year: 2019 },
        },
      ] as unknown as typeof store.members;
    }

    it('forwards it from a cell', async () => {
      withBirthday();
      const wrapper = mountGrid();
      await wrapper
        .get('[data-date="2026-04-14"] [data-testid="month-cell-birthday"]')
        .trigger('click');
      expect(wrapper.emitted('birthday-click')).toHaveLength(1);
      expect(wrapper.emitted('birthday-click')![0]![0]).toMatchObject({ memberId: 'm-joey' });
    });

    it('forwards it from the popover', async () => {
      withBirthday();
      seedDay('2026-04-14', 5);
      const wrapper = mountGrid({}, true);
      await wrapper.get('[data-date="2026-04-14"] [data-testid="month-more"]').trigger('click');
      await nextTick();
      document.body
        .querySelector<HTMLElement>(
          '[data-testid="month-day-popover"] [data-testid="birthday-chip"]'
        )!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();
      expect(wrapper.emitted('birthday-click')).toHaveLength(1);
      wrapper.unmount();
    });
  });
});

// ── Phone grid (#141 Phase 2) ──────────────────────────────────────────────

describe('CalendarGrid phone', () => {
  const PHONE = { variant: 'phone', density: 'titles' } as const;
  const dayRows = (w: ReturnType<typeof mountGrid>) => w.findAll('[data-testid="month-day-row"]');

  const mountPhone = (extra: Record<string, unknown> = {}) =>
    mountGrid({ display: PHONE, ...extra }, true);

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('draws the phone variant: no density label row, no popover, root-button cells', () => {
    const w = mountPhone();
    expect(w.find('[role="group"]').exists()).toBe(false);
    expect(w.find('[data-testid^="month-density-"]').exists()).toBe(false);
    expect(w.get('[data-date="2026-04-14"]').element.tagName).toBe('BUTTON');
    expect(document.body.querySelector('[data-testid="month-day-popover"]')).toBeNull();
    w.unmount();
  });

  it('a tap selects the day and the day row renders directly after that week', async () => {
    seedDay('2026-04-14', 1);
    const w = mountPhone();
    expect(dayRows(w)).toHaveLength(0);
    await w.get('[data-date="2026-04-14"]').trigger('click');
    expect(dayRows(w)).toHaveLength(1);
    expect(w.get('[data-date="2026-04-14"]').attributes('aria-expanded')).toBe('true');

    const row = w.get('[data-testid="month-day-row"]');
    // 14 April is in the third week row (Mar 29 start: Apr 12-18); the row follows it.
    const weekRows = w.findAll('[data-testid="month-week-row"]');
    const tappedWeek = weekRows.find((r) => r.find('[data-date="2026-04-14"]').exists())!;
    expect(tappedWeek.element.nextElementSibling).toBe(row.element);
    expect(w.get('[data-date="2026-04-14"]').attributes('aria-controls')).toBe(
      row.attributes('id')
    );
    expect(w.emitted('selectDate')).toBeUndefined();
    expect(vi.mocked(logEvent).mock.calls.some(([e]) => e.message === 'day_opened')).toBe(true);
    w.unmount();
  });

  it('tapping another day moves the row; a second tap on the same day emits selectDate', async () => {
    const w = mountPhone();
    await w.get('[data-date="2026-04-14"]').trigger('click');
    await w.get('[data-date="2026-04-21"]').trigger('click');
    expect(dayRows(w)).toHaveLength(1);
    expect(w.get('[data-date="2026-04-14"]').attributes('aria-expanded')).toBe('false');
    expect(w.get('[data-date="2026-04-21"]').attributes('aria-expanded')).toBe('true');
    expect(w.emitted('selectDate')).toBeUndefined();

    await w.get('[data-date="2026-04-21"]').trigger('click');
    expect(w.emitted('selectDate')).toEqual([['2026-04-21']]);
    expect(vi.mocked(logEvent).mock.calls.some(([e]) => e.message === 'day_drilled')).toBe(true);
    w.unmount();
  });

  it('a month change clears the selection', async () => {
    const w = mountPhone();
    await w.get('[data-date="2026-04-14"]').trigger('click');
    expect(dayRows(w)).toHaveLength(1);
    await w.setProps({ referenceDate: new Date(2026, 4, 1) });
    expect(dayRows(w)).toHaveLength(0);
    w.unmount();
  });

  it("the row's close button folds it back, logs day_closed and returns focus to the day", async () => {
    const w = mountPhone();
    await w.get('[data-date="2026-04-14"]').trigger('click');
    expect(dayRows(w)).toHaveLength(1);
    const close = w.get('[data-testid="month-day-row-close"]');
    expect(close.attributes('aria-label')).toBe('planner.dayRow.close');
    await close.trigger('click');
    expect(dayRows(w)).toHaveLength(0);
    expect(w.get('[data-date="2026-04-14"]').attributes('aria-expanded')).toBe('false');
    expect(w.emitted('selectDate')).toBeUndefined();
    const closed = vi.mocked(logEvent).mock.calls.find(([e]) => e.message === 'day_closed');
    expect(closed?.[0].context).toMatchObject({ stage: 'close_button' });
    await nextTick();
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-04-14');
    w.unmount();
  });

  it('Escape closes the open day row', async () => {
    const w = mountPhone();
    await w.get('[data-date="2026-04-14"]').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(dayRows(w)).toHaveLength(0);
    w.unmount();
  });

  it('"+N more" in the day row drills into the day, logging stage more', async () => {
    seedDay('2026-04-14', 6);
    const w = mountPhone();
    await w.get('[data-date="2026-04-14"]').trigger('click');
    vi.mocked(logEvent).mockClear();
    await w.get('[data-testid="month-day-row"] [data-testid="day-contents-more"]').trigger('click');
    expect(w.emitted('selectDate')).toEqual([['2026-04-14']]);
    const drilled = vi.mocked(logEvent).mock.calls.find(([e]) => e.message === 'day_drilled');
    expect(drilled?.[0].context).toMatchObject({ action: 'day_drilled', stage: 'more' });
    w.unmount();
  });

  it('the open day row is the fit inset, following the row to an earlier week and clearing on close', async () => {
    const w = mountPhone();
    const inset = () => fitHolder.lastOpts?.insetRef?.value ?? null;
    const row = () => w.get('[data-testid="month-day-row"]').element;
    expect(inset()).toBeNull();
    await w.get('[data-date="2026-04-21"]').trigger('click');
    expect(inset()).toBe(row());
    // An EARLIER week: Vue mounts the new row before the old one's unmount nulls the ref.
    await w.get('[data-date="2026-04-07"]').trigger('click');
    expect(inset()).toBe(row());
    expect(inset()?.isConnected).toBe(true);
    // A later week.
    await w.get('[data-date="2026-04-28"]').trigger('click');
    expect(inset()).toBe(row());
    await w.get('[data-testid="month-day-row-close"]').trigger('click');
    expect(inset()).toBeNull();
    w.unmount();
  });

  it('a pinch steps the density, emitting via pinch, and nothing at the clamp end', () => {
    const w = mountPhone({ display: { variant: 'phone', density: 'bars' } });
    const el = w.element as HTMLElement;
    pinch(
      el,
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 40, y: 100 },
        { x: 260, y: 100 },
      ]
    );
    expect(w.emitted('set-month-pref')).toEqual([
      [{ name: 'phoneDensity', value: stepDensity('bars', 1) }, 'pinch'],
    ]);
    w.unmount();

    const edge = mountPhone({ display: { variant: 'phone', density: stepDensity('bars', 1) } });
    const beyond = stepDensity(stepDensity('bars', 1), 1);
    expect(beyond).toBe(stepDensity('bars', 1)); // clamped: spreading again changes nothing
    pinch(
      edge.element as HTMLElement,
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 40, y: 100 },
        { x: 260, y: 100 },
      ]
    );
    expect(edge.emitted('set-month-pref')).toBeUndefined();
    edge.unmount();
  });

  it('wheel paging is off on the phone and on for desktop', () => {
    mountPhone().unmount();
    expect(wheelSpy.enabled.at(-1)?.value).toBe(false);
    mountGrid().unmount();
    expect(wheelSpy.enabled.at(-1)?.value).toBe(true);
  });

  describe('touch-action', () => {
    const touchAction = (w: ReturnType<typeof mountGrid>) =>
      (w.element as HTMLElement).style.touchAction;

    it('is none when the rows fit and the card bleeds (the page cannot scroll)', () => {
      fakeFit(120, 24, 55, false);
      const w = mountPhone({ bleedBottom: true });
      expect(touchAction(w)).toBe('none');
      w.unmount();
    });

    it('is pan-y when something renders below the grid', () => {
      fakeFit(120, 24, 55, false);
      const w = mountPhone({ bleedBottom: false });
      expect(touchAction(w)).toBe('pan-y');
      w.unmount();
    });

    it('is pan-y when the rows sit at their floor (degraded, the page scrolls)', () => {
      fakeFit(120, 24, 55, true);
      const w = mountPhone({ bleedBottom: true });
      expect(touchAction(w)).toBe('pan-y');
      w.unmount();
    });

    it('is pan-y when the measure failed (rowPx null, content-sized rows)', () => {
      fakeFit(null, 24, 55, false);
      const w = mountPhone({ bleedBottom: true });
      expect(touchAction(w)).toBe('pan-y');
      w.unmount();
    });

    it('is always pan-y on desktop', () => {
      fakeFit(120, 24, 139, false);
      const w = mountGrid({ bleedBottom: true });
      expect(touchAction(w)).toBe('pan-y');
      w.unmount();
    });
  });

  it('the phone card is full-bleed with no radius or shadow', () => {
    const w = mountPhone();
    expect(w.classes()).toContain('-mx-4');
    expect(w.classes()).not.toContain('rounded-3xl');
    w.unmount();
  });
});
