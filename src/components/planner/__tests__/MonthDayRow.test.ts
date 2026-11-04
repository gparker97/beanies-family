/**
 * `MonthDayRow` (#141): the phone grid's open day, a presentational row over
 * `MonthDayContents`.
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { member } from '@/test/monthCellFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'planner.dayRow.count.one': '1 thing on',
        'planner.dayRow.count.other': '{count} things on',
        'planner.dayRow.tapAgain': 'Tap again for the day',
        'planner.nothingPlanned': 'Nothing planned',
        'planner.moreEventsShort': 'more',
      };
      return map[key] ?? key;
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

import MonthDayRow from '../MonthDayRow.vue';
import MonthDayContents from '../MonthDayContents.vue';
import { allDay, birthday, cell, holiday, timed } from '@/test/monthCellFixtures';

describe('MonthDayRow', () => {
  it('shows the day caption, the count label and the tap-again hint', () => {
    const c = cell({
      date: '2026-05-19',
      allDayItems: [allDay('ad1')],
      timedOccurrences: [timed('t1')],
    });
    const w = mount(MonthDayRow, { props: { cell: c } });
    const header = w.get('p').text();
    expect(header).toContain('Tue, 19 May');
    expect(header).toContain('2 things on');
    expect(header).toContain('Tap again for the day');
  });

  it('says "Nothing planned" for an empty day', () => {
    const w = mount(MonthDayRow, { props: { cell: cell() } });
    expect(w.get('p').text()).toContain('Nothing planned');
  });

  it('renders MonthDayContents for the cell without caps', () => {
    const c = cell({ timedOccurrences: ['t1', 't2', 't3', 't4', 't5'].map((id) => timed(id)) });
    const w = mount(MonthDayRow, { props: { cell: c } });
    const inner = w.getComponent(MonthDayContents);
    expect(inner.props('cell')).toStrictEqual(c);
    expect(inner.props('caps')).toBeUndefined();
    expect(w.findAll('[data-day-item]')).toHaveLength(5);
  });

  it('forwards birthday-click, holiday-click and view-activity', async () => {
    const b = birthday('m1', 'Joey');
    const h = holiday();
    const c = cell({ extras: [b, h], timedOccurrences: [timed('t1')] });
    const w = mount(MonthDayRow, { props: { cell: c } });
    await w.get('[data-testid="birthday-chip"]').trigger('click');
    await w.get('[data-testid="holiday-chip"]').trigger('click');
    await w.get('[data-testid="month-chip"]').trigger('click');
    expect(w.emitted('birthday-click')).toEqual([[b.birthday]]);
    expect(w.emitted('holiday-click')).toEqual([[h.holiday]]);
    expect(w.emitted('view-activity')?.[0]?.[0]).toBe('t1');
  });
});
