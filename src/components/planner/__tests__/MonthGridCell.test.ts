/**
 * `MonthGridCell` (#141): desktop cases, then the phone cases (root button,
 * `aria-expanded`, no nested interactive elements, the Faces cluster).
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { member } from '@/test/monthCellFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'planner.moreEventsShort') return 'more';
      if (key === 'planner.moreEvents') return '{count} more activities';
      if (key === 'planner.monthGrid.openDay') return 'Open {date}';
      return key;
    },
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
}));

const MEMBERS = [member('m-aria', 'Aria'), member('m-bo', 'Bo')];
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
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: { name: string }) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  document.body.innerHTML = '';
});

import MonthGridCell from '../MonthGridCell.vue';
import { CALENDAR_TODAY } from '@/constants/tileStyles';
import { MONTH_CELL_METRICS, monthCellCssVars } from '@/constants/calendarCaps';
import type { CellLayout, MonthGridDisplay } from '@/utils/monthGridLayout';
import type { MonthDayCellData } from '@/utils/monthCells';
import type { DayItem } from '@/utils/monthDayItems';
import {
  allDay,
  birthday,
  cell,
  holiday,
  timed,
  trip,
  FIXTURE_DATE,
} from '@/test/monthCellFixtures';

const DESKTOP: MonthGridDisplay = {
  variant: 'desktop',
  density: 'compact',
  showTime: true,
  hideSoloFace: false,
};

function stackOf(c: MonthDayCellData): DayItem[] {
  return [...c.timedOccurrences.map((o): DayItem => ({ kind: 'timed', occurrence: o }))];
}

function mountCell(
  c: MonthDayCellData,
  over: {
    display?: MonthGridDisplay;
    layout?: CellLayout;
    capacity?: { shown: number; hidden: number };
    tint?: 'holiday' | 'weekend';
  } = {}
) {
  const stack = stackOf(c);
  return mount(MonthGridCell, {
    props: {
      cell: c,
      layout: over.layout ?? { lane: null, stack },
      display: over.display ?? DESKTOP,
      capacity: over.capacity ?? { shown: stack.length, hidden: 0 },
      cssVars: monthCellCssVars(MONTH_CELL_METRICS.compact),
      tint: over.tint,
      dayRowId: 'day-row',
    },
  });
}

describe('MonthGridCell root', () => {
  it('is a labelled group with the spoken caption and the data-date', () => {
    const w = mountCell(cell());
    expect(w.element.tagName).toBe('DIV');
    expect(w.attributes('role')).toBe('group');
    expect(w.attributes('aria-label')).toBe('Tue, 19 May');
    expect(w.attributes('data-date')).toBe(FIXTURE_DATE);
    expect(w.attributes('aria-current')).toBeUndefined();
    expect(w.attributes('aria-expanded')).toBeUndefined();
  });

  it('applies the per-cell --mg-* vars as its inline style', () => {
    const style = mountCell(cell()).attributes('style') ?? '';
    for (const [name, value] of Object.entries(monthCellCssVars(MONTH_CELL_METRICS.compact))) {
      expect(style).toContain(`${name}: ${value}`);
    }
  });

  it('clicking the empty cell emits select-date', async () => {
    const w = mountCell(cell());
    await w.trigger('click');
    expect(w.emitted('select-date')).toEqual([[FIXTURE_DATE]]);
    expect(w.emitted('tap-day')).toBeUndefined();
  });
});

describe('MonthGridCell today', () => {
  it('marks today with the pill and aria-current, and no orange border or today wash', () => {
    const w = mountCell(cell({ isToday: true }));
    expect(w.attributes('aria-current')).toBe('date');
    expect(w.attributes('aria-label')).toBe('Tue, 19 May, planner.today');
    const numeral = w.get('[data-testid="month-cell-numeral"]');
    for (const cls of CALENDAR_TODAY.pill.split(' ')) expect(numeral.classes()).toContain(cls);
    for (const cls of CALENDAR_TODAY.outline.split(' ')) expect(w.classes()).not.toContain(cls);
    expect(w.classes()).not.toContain(CALENDAR_TODAY.wash);
    expect(w.classes()).not.toContain('border-2');
  });

  it('another day has no pill, and the in-month and out-of-month numerals differ in ink', () => {
    const inMonth = mountCell(cell()).get('[data-testid="month-cell-numeral"]');
    expect(inMonth.classes().join(' ')).not.toContain('bg-gradient-to-br');
    expect(inMonth.classes().join(' ')).toContain('text-[var(--muted-text)]');
    const out = mountCell(cell({ isCurrentMonth: false })).get(
      '[data-testid="month-cell-numeral"]'
    );
    expect(out.classes().join(' ')).toContain('dark:text-ink-faint');
  });
});

describe('MonthGridCell numeral row', () => {
  it('the numeral is a button labelled with the formatted caption, never the ISO date', async () => {
    const w = mountCell(cell());
    const numeral = w.get('[data-testid="month-cell-numeral"]');
    expect(numeral.element.tagName).toBe('BUTTON');
    expect(numeral.attributes('aria-label')).toBe('Open Tue, 19 May');
    expect(numeral.attributes('aria-label')).not.toContain('2026');
    await numeral.trigger('click');
    expect(w.emitted('select-date')).toEqual([[FIXTURE_DATE]]); // once: the click is stopped
  });

  it('the holiday name is a button showing extra.label and emitting holiday-click', async () => {
    const h = holiday('Vesak Day');
    const w = mountCell(cell({ extras: [h] }));
    const btn = w.get('[data-testid="month-cell-holiday"]');
    expect(btn.text()).toBe('Vesak Day (SG)');
    await btn.trigger('click');
    expect(w.emitted('holiday-click')).toEqual([[h.holiday]]);
    expect(w.emitted('select-date')).toBeUndefined();
  });

  it('a birthday cake is a labelled button emitting birthday-click', async () => {
    const b = birthday('m1', 'Joey');
    const w = mountCell(cell({ extras: [b] }));
    const btn = w.get('[data-testid="month-cell-birthday"]');
    expect(btn.text()).toBe('🎂');
    expect(btn.attributes('aria-label')).toBe("Joey's birthday");
    await btn.trigger('click');
    expect(w.emitted('birthday-click')).toEqual([[b.birthday]]);
    expect(w.emitted('select-date')).toBeUndefined();
  });
});

describe('MonthGridCell tint', () => {
  it('a tinted cell keeps its tint AND the hover wash (every square lights up)', () => {
    const w = mountCell(cell(), { tint: 'holiday' });
    expect(w.classes()).toContain('bg-[var(--holiday-clay-tint)]');
    expect(w.classes()).toContain('hover:bg-[var(--tint-slate-10)]');
    expect(w.classes()).toContain('dark:hover:bg-surface-hover');
    const weekend = mountCell(cell(), { tint: 'weekend' });
    expect(weekend.classes()).toContain('bg-[var(--tint-slate-5)]');
    expect(weekend.classes()).toContain('hover:bg-[var(--tint-slate-10)]');
  });

  it('no tint leaves the hover wash, and today does not paint the today wash', () => {
    const w = mountCell(cell({ isToday: true }));
    expect(w.classes()).toContain('hover:bg-[var(--tint-slate-10)]');
    expect(w.classes()).not.toContain(CALENDAR_TODAY.wash);
  });

  it('the phone variant hovers like desktop', () => {
    const w = mountCell(cell(), { display: { variant: 'phone', density: 'titles' } });
    expect(w.classes()).toContain('hover:bg-[var(--tint-slate-10)]');
  });
});

describe('MonthGridCell chips and the chip context', () => {
  const day = () => cell({ timedOccurrences: [timed('Soccer', '16:00')] });

  it('draws only capacity.shown stack items', () => {
    const c = cell({ timedOccurrences: [timed('a'), timed('b'), timed('c')] });
    const w = mountCell(c, { capacity: { shown: 2, hidden: 1 } });
    expect(w.findAll('[data-testid="month-chip"]')).toHaveLength(2);
  });

  it('provides showTime from the display: shown in Compact with times on, hidden when off', () => {
    expect(mountCell(day()).text()).toContain('4pm');
    expect(mountCell(day(), { display: { ...DESKTOP, showTime: false } }).text()).not.toContain(
      '4pm'
    );
  });

  it('provides the density: Comfortable draws the established chip', () => {
    const w = mountCell(day(), {
      display: { variant: 'desktop', density: 'comfortable', showTime: false, hideSoloFace: false },
    });
    expect(w.get('[data-testid="month-chip"]').classes()).toContain('py-0.5');
  });

  it('provides muted for an out-of-month cell: no wash on the chip', () => {
    const style = mountCell({ ...day(), isCurrentMonth: false })
      .get('[data-testid="month-chip"]')
      .attributes('style');
    expect(style).not.toContain('background');
    const inMonth = mountCell(day()).get('[data-testid="month-chip"]').attributes('style');
    expect(inMonth).toContain('background');
  });

  it('provides interactive chips on desktop (buttons) and hideSoloFace from the display', () => {
    const w = mountCell(day(), { display: { ...DESKTOP, hideSoloFace: true } });
    expect(w.get('[data-testid="month-chip"]').element.tagName).toBe('BUTTON');
    expect(w.findAllComponents({ name: 'BeanieAvatar' })).toHaveLength(0);
    expect(mountCell(day()).findAllComponents({ name: 'BeanieAvatar' }).length).toBeGreaterThan(0);
  });

  it('a chip click emits view-activity and never also select-date', async () => {
    const w = mountCell(day());
    await w.get('[data-testid="month-chip"]').trigger('click');
    expect(w.emitted('view-activity')).toEqual([['Soccer', FIXTURE_DATE]]);
    expect(w.emitted('select-date')).toBeUndefined();
  });
});

describe('MonthGridCell lane', () => {
  it('draws the lane with its run, ahead of the stack, with end insets on the true ends', () => {
    const c = cell({ vacations: [trip('Bali')], timedOccurrences: [timed('t1')] });
    const w = mountCell(c, {
      layout: {
        lane: {
          item: { kind: 'trip', vacation: c.vacations[0]! },
          run: { isStart: true, isEnd: false, showLabel: true },
        },
        stack: stackOf(c),
      },
    });
    const lane = w.get('[data-testid="trip-chip"]');
    expect(lane.text()).toContain('Bali');
    expect(lane.classes()).toEqual(
      expect.arrayContaining(['h-[var(--mg-lane-h)]', '-mx-1', 'ml-1'])
    );
    expect(lane.classes()).not.toContain('mr-1');
    // The lane precedes the stack in the DOM.
    const html = w.html();
    expect(html.indexOf('trip-chip')).toBeLessThan(html.indexOf('month-chip'));
  });

  it('a middle slice has no insets and keeps the run label rule', () => {
    const c = cell({ allDayItems: [allDay('Camp', { isFirstDay: false, isLastDay: false })] });
    const w = mountCell(c, {
      layout: {
        lane: {
          item: { kind: 'allday', item: c.allDayItems[0]!, date: c.date },
          run: { isStart: false, isEnd: false, showLabel: false },
        },
        stack: [],
      },
    });
    const lane = w.get('[data-testid="all-day-activity-chip"]');
    expect(lane.classes()).not.toContain('ml-1');
    expect(lane.classes()).not.toContain('mr-1');
    expect(lane.text()).not.toContain('Camp');
  });
});

describe('MonthGridCell +N more', () => {
  it('renders no button when nothing is hidden', () => {
    expect(mountCell(cell()).find('[data-testid="month-more"]').exists()).toBe(false);
  });

  it('renders a labelled dialog-opening button when items are hidden, and emits more with its trigger', async () => {
    const w = mountCell(cell({ timedOccurrences: [timed('a')] }), {
      capacity: { shown: 1, hidden: 3 },
    });
    const more = w.get('[data-testid="month-more"]');
    expect(more.element.tagName).toBe('BUTTON');
    expect(more.text()).toBe('+3 more');
    expect(more.attributes('aria-label')).toBe('3 more activities');
    expect(more.attributes('aria-haspopup')).toBe('dialog');
    await more.trigger('click');
    expect(w.emitted('more')).toHaveLength(1);
    const [date, trigger] = w.emitted('more')![0]!;
    expect(date).toBe(FIXTURE_DATE);
    expect(trigger).toBe(more.element);
    expect(w.emitted('select-date')).toBeUndefined();
  });
});

describe('MonthGridCell phone', () => {
  const PHONE_TITLES: MonthGridDisplay = { variant: 'phone', density: 'titles' };
  const PHONE_FACES: MonthGridDisplay = { variant: 'phone', density: 'faces' };

  function mountPhone(
    c: MonthDayCellData,
    over: Parameters<typeof mountCell>[1] & { selected?: boolean } = {}
  ) {
    const stack = stackOf(c);
    return mount(MonthGridCell, {
      props: {
        cell: c,
        layout: over.layout ?? { lane: null, stack },
        display: over.display ?? PHONE_TITLES,
        capacity: over.capacity ?? { shown: stack.length, hidden: 0 },
        cssVars: monthCellCssVars(MONTH_CELL_METRICS.compact),
        tint: over.tint,
        selected: over.selected,
        dayRowId: 'day-row',
      },
    });
  }

  it('the root is a button with aria-expanded and a caption plus count label', () => {
    const w = mountPhone(cell({ timedOccurrences: [timed('a')] }));
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.attributes('type')).toBe('button');
    expect(w.attributes('role')).toBeUndefined();
    expect(w.attributes('aria-expanded')).toBe('false');
    expect(w.attributes('aria-label')).toContain('Tue, 19 May');
    expect(mountPhone(cell(), { selected: true }).attributes('aria-expanded')).toBe('true');
  });

  it('aria-controls names the day row only while selected', () => {
    expect(mountPhone(cell()).attributes('aria-controls')).toBeUndefined();
    expect(mountPhone(cell(), { selected: true }).attributes('aria-controls')).toBe('day-row');
  });

  it('a tap emits tap-day and never select-date', async () => {
    const w = mountPhone(cell());
    await w.trigger('click');
    expect(w.emitted('tap-day')).toEqual([[FIXTURE_DATE]]);
    expect(w.emitted('select-date')).toBeUndefined();
  });

  it('has no nested interactive elements, even with a cake, a holiday, chips and "+N"', () => {
    const c = cell({
      extras: [birthday(), holiday()],
      timedOccurrences: [timed('a'), timed('b')],
    });
    const w = mountPhone(c, { capacity: { shown: 1, hidden: 1 } });
    // Descendants only: the root itself is the button.
    expect(
      w.element.querySelectorAll('button, a, input, select, textarea, [role="button"]')
    ).toHaveLength(0);
    // Chips are aria-hidden spans on the phone.
    const chip = w.get('[data-testid="month-chip"]');
    expect(chip.element.tagName).toBe('SPAN');
    expect(chip.attributes('aria-hidden')).toBe('true');
  });

  it('the birthday cake is a span and the hidden count is a plain "+N" span', () => {
    const w = mountPhone(cell({ extras: [birthday()], timedOccurrences: [timed('a')] }), {
      capacity: { shown: 1, hidden: 2 },
    });
    const cake = w.findAll('span').find((n) => n.text() === '🎂');
    expect(cake).toBeDefined();
    expect(cake!.attributes('aria-hidden')).toBe('true');
    const more = w.get('[data-testid="month-more"]');
    expect(more.element.tagName).toBe('SPAN');
    expect(more.text()).toBe('+2');
  });

  it('Faces draws a wrapped cluster instead of the stack', () => {
    const c = cell({ timedOccurrences: [timed('a'), timed('b')] });
    const w = mountPhone(c, { display: PHONE_FACES });
    expect(w.find('[data-testid="month-chip"]').exists()).toBe(false);
    expect(w.get('[data-testid="month-cell-faces"]').attributes('aria-hidden')).toBe('true');
  });

  it("Faces includes a lane trip's travellers", () => {
    const tr = trip('Bali', { travellerIds: ['m-bo'] });
    const c = cell({ vacations: [tr], timedOccurrences: [timed('a')] });
    const w = mountPhone(c, {
      display: PHONE_FACES,
      layout: {
        lane: {
          item: { kind: 'trip', vacation: tr },
          run: { isStart: true, isEnd: true, showLabel: false },
        },
        stack: stackOf(c),
      },
    });
    const faces = w.get('[data-testid="month-cell-faces"]');
    // The activity's owner (Aria) plus the lane trip's traveller (Bo): two distinct faces.
    expect(faces.findAllComponents({ name: 'BeanieAvatar' })).toHaveLength(2);
    expect(faces.text()).not.toContain('+');
    // The lane still draws above the cluster.
    expect(w.find('[data-testid="trip-chip"]').exists()).toBe(true);
  });

  it('the lane never draws a name on the phone', () => {
    const tr = trip('Bali');
    const c = cell({ vacations: [tr] });
    const w = mountPhone(c, {
      layout: {
        lane: {
          item: { kind: 'trip', vacation: tr },
          run: { isStart: true, isEnd: true, showLabel: true },
        },
        stack: [],
      },
    });
    expect(w.get('[data-testid="trip-chip"]').text()).not.toContain('Bali');
  });
});
