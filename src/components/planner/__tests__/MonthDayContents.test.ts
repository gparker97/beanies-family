/**
 * `MonthDayContents` (#141): a day's full contents as a vertical list, one rendering
 * path over `capDayContents`.
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

import { ref } from 'vue';
import MonthDayContents from '../MonthDayContents.vue';
import { DEFAULT_CELL_CHIPS, MONTH_CELL_CHIPS } from '../monthCellChipsKey';
import { STREAM_DAY_CAPS } from '@/constants/calendarCaps';
import { allDay, birthday, cell, holiday, segment, timed, trip } from '@/test/monthCellFixtures';

const ids = (w: ReturnType<typeof mount>) =>
  w.findAll('[data-day-item]').map((n) => n.attributes('data-testid'));

describe('MonthDayContents order', () => {
  it('extras, all-day bars, then timeline, then the "+N more"', () => {
    const c = cell({
      extras: [birthday(), holiday()],
      vacations: [trip('tr1')],
      allDayItems: [allDay('ad1')],
      timedOccurrences: [timed('t1', '10:00')],
      segments: [segment('s1', { time: '08:00' })],
    });
    const w = mount(MonthDayContents, { props: { cell: c } });
    expect(ids(w)).toEqual([
      'birthday-chip',
      'holiday-chip',
      'trip-chip',
      'all-day-activity-chip',
      'month-segment-chip',
      'month-chip',
    ]);
  });

  it('with caps: the all-day "+N" sits right after the bars and before the timeline', () => {
    const c = cell({
      allDayItems: [allDay('a1'), allDay('a2'), allDay('a3')],
      timedOccurrences: [timed('t1')],
    });
    const html = mount(MonthDayContents, { props: { cell: c, caps: STREAM_DAY_CAPS } }).html();
    const lastBar = html.lastIndexOf('all-day-activity-chip');
    const plus = html.indexOf('+1');
    const timedChip = html.indexOf('month-chip');
    expect(lastBar).toBeLessThan(plus);
    expect(plus).toBeLessThan(timedChip);
  });
});

describe('MonthDayContents caps', () => {
  const busy = cell({
    allDayItems: [allDay('a1'), allDay('a2'), allDay('a3')],
    timedOccurrences: Array.from({ length: 7 }, (_, i) => timed(`t${i}`, `0${i}:00`)),
  });

  it('no caps shows everything and no "+N" at all', () => {
    const w = mount(MonthDayContents, { props: { cell: busy } });
    expect(w.findAll('[data-testid="all-day-activity-chip"]')).toHaveLength(3);
    expect(w.findAll('[data-testid="month-chip"]')).toHaveLength(7);
    expect(w.find('[data-testid="day-contents-more"]').exists()).toBe(false);
    expect(w.text()).not.toContain('+');
  });

  it('stream caps render capDayContents: 2 bars, 4 timed, hidden counts, and emit more', async () => {
    const w = mount(MonthDayContents, { props: { cell: busy, caps: STREAM_DAY_CAPS } });
    expect(w.findAll('[data-testid="all-day-activity-chip"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="month-chip"]')).toHaveLength(4);
    expect(w.text()).toContain('+1'); // the all-day count
    const more = w.get('[data-testid="day-contents-more"]');
    expect(more.text()).toContain('+3');
    expect(more.attributes('aria-label')).toBe('3 more activities');
    await more.trigger('click');
    expect(w.emitted('more')).toHaveLength(1);
  });

  it('every bar is labelled, even a trip day that is not the first or last', () => {
    const c = cell({
      vacations: [trip('Bali', { isStart: false, isEnd: false })],
      allDayItems: [allDay('Camp', { isFirstDay: false, isLastDay: false })],
    });
    const w = mount(MonthDayContents, { props: { cell: c } });
    expect(w.get('[data-testid="trip-chip"]').text()).toContain('Bali');
    expect(w.get('[data-testid="all-day-activity-chip"]').text()).toContain('Camp');
  });
});

describe('MonthDayContents empty day and context', () => {
  it('an empty day says Nothing planned', () => {
    const w = mount(MonthDayContents, { props: { cell: cell() } });
    expect(w.text()).toContain('planner.nothingPlanned');
  });

  it('a day with only a holiday is not empty', () => {
    const w = mount(MonthDayContents, { props: { cell: cell({ extras: [holiday()] }) } });
    expect(w.text()).not.toContain('planner.nothingPlanned');
  });

  it('provides showTime = !caps: times show uncapped and are hidden in the stream', () => {
    const c = cell({ timedOccurrences: [timed('t1', '16:00')] });
    expect(mount(MonthDayContents, { props: { cell: c } }).text()).toContain('4pm');
    expect(
      mount(MonthDayContents, { props: { cell: c, caps: STREAM_DAY_CAPS } }).text()
    ).not.toContain('4pm');
  });

  it('overrides a grid context above it: a Bars provider still gets labelled chips', () => {
    const c = cell({ timedOccurrences: [timed('Soccer', '16:00')] });
    const w = mount(MonthDayContents, {
      props: { cell: c },
      global: {
        provide: {
          [MONTH_CELL_CHIPS as symbol]: ref({
            ...DEFAULT_CELL_CHIPS,
            density: 'bars',
            interactive: false,
          }),
        },
      },
    });
    const chip = w.get('[data-testid="month-chip"]');
    expect(chip.element.tagName).toBe('BUTTON');
    expect(chip.text()).toContain('Soccer');
  });

  it('every item and extra carries data-day-item for roving focus', () => {
    const c = cell({
      extras: [birthday(), holiday()],
      timedOccurrences: [timed('t1')],
      allDayItems: [allDay('a1')],
    });
    const w = mount(MonthDayContents, { props: { cell: c } });
    expect(w.findAll('[data-day-item]')).toHaveLength(4);
  });
});

describe('MonthDayContents emits', () => {
  it('forwards birthday-click and holiday-click without bubbling', async () => {
    const b = birthday('m1', 'Joey');
    const h = holiday();
    const parent = vi.fn();
    const w = mount(
      {
        components: { MonthDayContents },
        setup: () => ({ c: cell({ extras: [b, h] }), parent }),
        template: '<div @click="parent"><MonthDayContents :cell="c" /></div>',
      },
      {}
    );
    await w.get('[data-testid="birthday-chip"]').trigger('click');
    await w.get('[data-testid="holiday-chip"]').trigger('click');
    const inner = w.findComponent(MonthDayContents);
    expect(inner.emitted('birthday-click')).toEqual([[b.birthday]]);
    expect(inner.emitted('holiday-click')).toEqual([[h.holiday]]);
    expect(parent).not.toHaveBeenCalled();
  });

  it('forwards view-activity, vacation-click and view-segment from its items', async () => {
    const c = cell({
      vacations: [trip('tr1')],
      timedOccurrences: [timed('t1')],
      segments: [segment('s1', { vacationId: 'v7', segmentIndex: 1 })],
    });
    const w = mount(MonthDayContents, { props: { cell: c } });
    await w.get('[data-testid="trip-chip"]').trigger('click');
    await w.get('[data-testid="month-chip"]').trigger('click');
    await w.get('[data-testid="month-segment-chip"]').trigger('click');
    expect(w.emitted('vacation-click')).toEqual([['tr1']]);
    expect(w.emitted('view-activity')).toEqual([['t1', '2026-05-19']]);
    expect(w.emitted('view-segment')).toEqual([['v7', 1]]);
  });
});
