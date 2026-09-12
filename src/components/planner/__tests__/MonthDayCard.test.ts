import { mount } from '@vue/test-utils';
import type { DayExtra } from '@/utils/calendarDay';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import MonthDayCard from '../MonthDayCard.vue';
import type { MonthDayCellData } from '../MonthDayCard.vue';
import type { FamilyActivity, FamilyMember, HolidayOccurrence } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Surface key in DOM so we can assert on it
      if (key === 'planner.day.tue') return 'tue';
      if (key === 'planner.day.mon') return 'mon';
      if (key === 'planner.moreEventsShort') return 'more';
      if (key === 'planner.moreEvents') return '{count} more activities';
      return key;
    },
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
}));

const MEMBERS: FamilyMember[] = [
  // @ts-expect-error — partial fixture
  { id: 'm-aria', name: 'Aria', color: '#6AA84F', isPet: false },
];

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: MEMBERS, humans: MEMBERS }),
}));

vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberById: (id: string) => MEMBERS.find((m) => m.id === id),
    getMemberName: (id: string) => MEMBERS.find((m) => m.id === id)?.name ?? 'Unknown',
    getMemberColor: (id: string, fallback = '#6b7280') =>
      MEMBERS.find((m) => m.id === id)?.color ?? fallback,
  }),
}));

vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ monthActivities: () => [] }),
  getActivityColor: (a: FamilyActivity) => (a as { color?: string }).color ?? '#F15D22',
}));

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a-1',
    title: 'Soccer',
    date: '2026-05-19',
    startTime: '16:00',
    category: 'soccer',
    isAllDay: false,
    recurrence: { type: 'none' },
    feeSchedule: 'none',
    reminderMinutes: { default: 15 },
    isActive: true,
    createdBy: 'm-aria',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    assigneeIds: ['m-aria'],
    ...overrides,
  } as FamilyActivity;
}

function makeCell(overrides: Partial<MonthDayCellData> = {}): MonthDayCellData {
  return {
    date: '2026-05-19',
    day: 19,
    isCurrentMonth: true,
    isToday: false,
    weekRow: 0,
    timedOccurrences: [],
    vacations: [],
    segments: [],
    allDayItems: [],
    extras: [],
    ...overrides,
  };
}

/** A holiday as the shared `DayExtra` the cell now takes. */
function holidayExtra(name = 'Vesak Day'): DayExtra {
  return {
    kind: 'holiday',
    id: `h:${name}`,
    ymd: '2026-05-19',
    label: `${name} (SG)`,
    holiday: makeHoliday(name),
  };
}

/** A birthday as a `DayExtra`. */
function birthdayExtra(memberId: string, name: string, age = 7): DayExtra {
  return {
    kind: 'birthday',
    id: `b:${memberId}`,
    ymd: '2026-05-19',
    label: `${name}'s birthday`,
    emoji: '🎂',
    birthday: { date: '2026-05-19', memberId, name, age, isPet: false },
  };
}

function makeHoliday(name = 'Vesak Day'): HolidayOccurrence {
  return {
    name,
    date: '2026-05-19',
    countryCode: 'SG',
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  document.body.innerHTML = '';
});

const baseProps = {
  allDayCap: 2,
  timedCap: 4,
  selected: false,
  bgClass: '',
};

describe('MonthDayCard structure', () => {
  it('renders the day number', () => {
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell({ day: 19 }), ...baseProps },
    });
    expect(wrapper.text()).toContain('19');
  });

  it('renders the DOW label (mobile-only span still in DOM)', () => {
    // 2026-05-19 is a Tuesday → "tue" label
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell({ date: '2026-05-19' }), ...baseProps },
    });
    expect(wrapper.text()).toContain('tue');
  });

  it('emits select-date when the cell button is clicked', async () => {
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell(), ...baseProps },
    });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('select-date')).toEqual([['2026-05-19']]);
  });

  it('marks today via gradient class', () => {
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell({ isToday: true }), ...baseProps },
    });
    expect(wrapper.html()).toContain('from-primary-500');
  });

  it('shows ring on selected state', () => {
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell(), ...baseProps, selected: true },
    });
    expect(wrapper.html()).toContain('ring-2');
  });
});

describe('MonthDayCard chip row', () => {
  it('renders one MonthChip per timed occurrence up to the cap', () => {
    const occs = Array.from({ length: 3 }, (_, i) => ({
      activity: makeActivity({ id: `a-${i}`, title: `Activity ${i}` }),
      date: '2026-05-19',
    }));
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell({ timedOccurrences: occs }), ...baseProps },
    });
    expect(wrapper.findAll('[data-testid="month-chip"]').length).toBe(3);
  });

  it('renders +N more button when timed occurrences exceed the cap', () => {
    const occs = Array.from({ length: 6 }, (_, i) => ({
      activity: makeActivity({ id: `a-${i}`, title: `Activity ${i}` }),
      date: '2026-05-19',
    }));
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell({ timedOccurrences: occs }), ...baseProps },
    });
    expect(wrapper.findAll('[data-testid="month-chip"]').length).toBe(4);
    const moreBtn = wrapper.findAll('button').find((b) => b.text().includes('+2'));
    expect(moreBtn).toBeDefined();
    expect(moreBtn?.element.tagName).toBe('BUTTON');
  });

  it('re-emits view-activity when a chip is clicked (not the cell)', async () => {
    const occ = {
      activity: makeActivity({ id: 'a-99', title: 'Soccer' }),
      date: '2026-05-19',
    };
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell({ timedOccurrences: [occ] }), ...baseProps },
    });
    await wrapper.get('[data-testid="month-chip"]').trigger('click');
    expect(wrapper.emitted('view-activity')).toEqual([['a-99', '2026-05-19']]);
    // Cell select-date should NOT also fire (chip's @click.stop)
    expect(wrapper.emitted('select-date')).toBeFalsy();
  });
});

describe('MonthDayCard all-day lane', () => {
  it('renders holiday chips above timed chips', () => {
    const wrapper = mount(MonthDayCard, {
      props: {
        cell: makeCell({
          extras: [holidayExtra()],
          timedOccurrences: [{ activity: makeActivity({ title: 'Piano' }), date: '2026-05-19' }],
        }),
        ...baseProps,
      },
    });
    const html = wrapper.html();
    // Holiday name appears before timed-chip title in DOM order
    const holidayIdx = html.indexOf('Vesak');
    const timedIdx = html.indexOf('Piano');
    expect(holidayIdx).toBeGreaterThan(-1);
    expect(timedIdx).toBeGreaterThan(-1);
    expect(holidayIdx).toBeLessThan(timedIdx);
  });

  it('shows overflow indicator when holidays + all-day items exceed cap', () => {
    const items = [
      { activity: makeActivity({ id: 'ad-1', isAllDay: true }), isStart: true, isEnd: true },
      { activity: makeActivity({ id: 'ad-2', isAllDay: true }), isStart: true, isEnd: true },
      { activity: makeActivity({ id: 'ad-3', isAllDay: true }), isStart: true, isEnd: true },
    ];
    const wrapper = mount(MonthDayCard, {
      props: { cell: makeCell({ allDayItems: items }), ...baseProps },
    });
    // 2 visible + +1 overflow
    expect(wrapper.text()).toContain('+1');
  });
});

/**
 * The all-day lane's budget, shared three ways.
 *
 * `allDayCap` is 2 in production, so this arithmetic decides whether a family
 * sees their own plans on a busy day. A straight priority order let a birthday
 * plus a holiday eat the whole budget and push every real event behind "+N".
 */
describe("the all-day cap, split between reference days and the family's own events", () => {
  const allDay = (id: string, title: string) => ({
    activity: makeActivity({ id, title, isAllDay: true }),
    isStart: true,
    isEnd: true,
  });

  it('leaves the family an event when the day carries a birthday AND a holiday', () => {
    const wrapper = mount(MonthDayCard, {
      props: {
        cell: makeCell({
          extras: [birthdayExtra('m1', 'Joey'), holidayExtra()],
          allDayItems: [allDay('ad-1', 'Bin night')],
        }),
        ...baseProps,
      },
    });
    // One reference day (the birthday leads), and the family's own event keeps
    // the other slot — it answers "what are we doing today".
    expect(wrapper.findAll('[data-testid="birthday-chip"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="holiday-chip"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('Bin night');
  });

  it('does not strand a slot when the day has no events of its own', () => {
    const wrapper = mount(MonthDayCard, {
      props: {
        cell: makeCell({
          extras: [birthdayExtra('m1', 'Joey'), holidayExtra()],
          allDayItems: [],
        }),
        ...baseProps,
      },
    });
    // Nothing competing, so BOTH reference days show rather than one and a gap.
    expect(wrapper.findAll('[data-testid="birthday-chip"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('Vesak Day');
  });

  it('behaves exactly as before on a day with no reference days', () => {
    const wrapper = mount(MonthDayCard, {
      props: {
        cell: makeCell({
          allDayItems: [allDay('a1', 'One'), allDay('a2', 'Two'), allDay('a3', 'Three')],
        }),
        ...baseProps,
      },
    });
    expect(wrapper.text()).toContain('+1');
  });
});
