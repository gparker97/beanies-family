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
import { PHONE_DAY_ROW_CAPS } from '@/constants/calendarCaps';

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

  it('renders with the row caps and times shown', () => {
    const c = cell({ timedOccurrences: ['t1', 't2', 't3', 't4', 't5'].map((id) => timed(id)) });
    const w = mount(MonthDayRow, { props: { cell: c } });
    const inner = w.getComponent(MonthDayContents);
    expect(inner.props('cell')).toStrictEqual(c);
    expect(inner.props('caps')).toStrictEqual(PHONE_DAY_ROW_CAPS);
    expect(inner.props('showTime')).toBe(true);
    // Capped timeline items plus the "+N more" (which also carries data-day-item).
    expect(w.findAll('[data-testid="month-chip"]')).toHaveLength(PHONE_DAY_ROW_CAPS.timed);
    expect(w.get('[data-testid="month-chip"]').text()).toContain('4pm');
    expect(w.get('[data-testid="day-contents-more"]').text()).toContain(
      `+${5 - PHONE_DAY_ROW_CAPS.timed}`
    );
  });

  it('forwards "+N more" as more', async () => {
    const c = cell({ timedOccurrences: ['t1', 't2', 't3', 't4', 't5'].map((id) => timed(id)) });
    const w = mount(MonthDayRow, { props: { cell: c } });
    await w.get('[data-testid="day-contents-more"]').trigger('click');
    expect(w.emitted('more')).toHaveLength(1);
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
