/**
 * The weekly counts: a bean's "This week" row (today ringed, future days a dot, the total) and
 * the grown-ups' "Week so far" panel. Plain counts of chores done, nothing stored as a value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);

import ChoreWeekRow from '../ChoreWeekRow.vue';
import ChoreWeekPanel from '../ChoreWeekPanel.vue';
import { MEMBERS, clock, doneMark, resetKit } from './choreTestKit';
import { indexMarks, weekCounts } from '@/utils/chores';

beforeEach(() => resetKit());

// Week of Mon 2026-11-09 .. Sun 2026-11-15; today is Friday the 13th.
const marks = [
  doneMark('kid', 'a', '2026-11-09'),
  doneMark('kid', 'b', '2026-11-09'),
  doneMark('kid', 'a', '2026-11-12'),
  doneMark('kid', 'a', '2026-11-13'),
];

describe('ChoreWeekRow', () => {
  it('counts each day, rings today, dots the days to come, and totals the week', () => {
    const week = weekCounts(indexMarks(marks), 'kid', clock.ymd, 1);
    const w = mount(ChoreWeekRow, { props: { week, todayYmd: clock.ymd } });
    const days = w.findAll('[data-testid="chore-week-day"]');
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.find('b').text())).toEqual(['2', '0', '0', '1', '1', '·', '·']);
    const today = days.find((d) => d.attributes('data-ymd') === '2026-11-13')!;
    expect(today.attributes('aria-current')).toBe('date');
    expect(today.classes()).toContain('ring-2');
    expect(w.get('[data-testid="chore-week-total"]').text()).toContain('4');
  });
});

describe('ChoreWeekPanel', () => {
  it('one row per bean with seven counts and the total', () => {
    const index = indexMarks([...marks, doneMark('sib', 'a', '2026-11-10')]);
    const rows = MEMBERS.filter((m) => m.id === 'kid' || m.id === 'sib').map((member) => ({
      member,
      week: weekCounts(index, member.id, clock.ymd, 1),
    }));
    const w = mount(ChoreWeekPanel, {
      props: { rows, todayYmd: clock.ymd },
      global: { stubs: { BeanieAvatar: true } },
    });
    const trs = w.findAll('[data-testid="chore-week-panel-row"]');
    expect(trs.map((r) => r.attributes('data-member-id'))).toEqual(['kid', 'sib']);
    const kidCells = trs[0]!.findAll('td').map((td) => td.text());
    // Mon..Sun then the total; days to come are blank.
    expect(kidCells).toEqual(['2', '0', '0', '1', '1', '', '', '4']);
    expect(trs[1]!.findAll('td').at(-1)!.text()).toBe('1');
  });
});
