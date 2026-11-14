/**
 * "This Week": one row per bean with a bar and done out of due (Monday through today), the
 * family's perfect days, and the board's legend; the numbers agree with the Chores Done cells
 * for the same records, and a bean's row opens their day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import ChoreWeekSummary from '../ChoreWeekSummary.vue';
import ChoreWeekPanel from '../ChoreWeekPanel.vue';
import { MEMBERS, chore, clock, doneMark, resetKit } from './choreTestKit';
import { choreWeekRecord, indexMarks } from '@/utils/chores';
import type { Chore, ChoreMark } from '@/types/models';

// Week of Mon 2026-11-09; today is Friday the 13th. Pip has three chores a day, Juno one.
const OLD = '2026-11-01T12:00:00.000Z';
const LIST: Chore[] = [
  chore('a', { createdAt: OLD }),
  chore('b', { createdAt: OLD, block: 'evening' }),
  chore('c', { createdAt: OLD, block: 'anytime' }),
  chore('j', { createdAt: OLD, assigneeIds: ['sib'] }),
];
const MARKS: ChoreMark[] = [
  doneMark('kid', 'a', '2026-11-09'),
  doneMark('kid', 'a', '2026-11-10'), // Tuesday: perfect
  doneMark('kid', 'b', '2026-11-10'),
  doneMark('kid', 'c', '2026-11-10'),
  doneMark('kid', 'a', '2026-11-13'),
  doneMark('sib', 'j', '2026-11-12'), // Juno's Thursday: perfect
];

function rowsFor(ids: string[], marks = MARKS) {
  const index = indexMarks(marks);
  return MEMBERS.filter((m) => ids.includes(m.id)).map((member) => ({
    member,
    week: choreWeekRecord(LIST, index, member.id, clock.ymd, 1),
  }));
}

function mountSummary(rows = rowsFor(['kid', 'sib'])) {
  return mount(ChoreWeekSummary, {
    props: { rows, todayYmd: clock.ymd },
    global: { stubs: { BeanieAvatar: true } },
  });
}

beforeEach(() => resetKit());

describe('ChoreWeekSummary', () => {
  it('one row per bean in the board order: done of due Monday through today, and a bar', () => {
    const w = mountSummary();
    const rows = w.findAll('[data-testid="chore-week-summary-row"]');
    expect(rows.map((r) => r.attributes('data-member-id'))).toEqual(['kid', 'sib']);
    // Pip: five days of three chores so far = 15 due; 1 + 3 + 0 + 0 + 1 = 5 done.
    expect([rows[0]!.attributes('data-done'), rows[0]!.attributes('data-due')]).toEqual([
      '5',
      '15',
    ]);
    expect(rows[0]!.get('[data-testid="chore-week-summary-bar"]').attributes('style')).toContain(
      'width: 33%'
    );
    expect(rows[0]!.get('[data-testid="chore-week-summary-count"]').text()).toBe(
      'choreboard.block.count'
    );
    expect(rows[0]!.attributes('aria-label')).toBe('choreboard.weekSummary.rowAria');
  });

  it('agrees with the Chores Done cells for the same records', () => {
    const rows = rowsFor(['kid', 'sib']);
    const panel = mount(ChoreWeekPanel, {
      props: { rows, todayYmd: clock.ymd },
      global: { stubs: { BeanieAvatar: true } },
    });
    const summary = mountSummary(rows);
    for (const id of ['kid', 'sib']) {
      const cellSum = panel
        .findAll(`[data-testid="chore-day-cell"][data-member-id="${id}"]`)
        .filter((c) => c.attributes('data-ymd')! <= clock.ymd)
        .reduce((n, c) => n + Number(c.find('b').exists() ? c.get('b').text() : 0), 0);
      const row = summary.get(`[data-testid="chore-week-summary-row"][data-member-id="${id}"]`);
      expect(Number(row.attributes('data-done'))).toBe(cellSum);
    }
    panel.unmount();
  });

  it('perfect days add up across the family; none reads calmly', () => {
    expect(mountSummary().get('[data-testid="chore-week-summary-perfect"]').text()).toContain(
      'choreboard.weekSummary.perfect.other'
    );
    const one = mountSummary(rowsFor(['sib']));
    expect(one.get('[data-testid="chore-week-summary-perfect"]').text()).toContain(
      'choreboard.weekSummary.perfect.one'
    );
    const none = mountSummary(rowsFor(['kid', 'sib'], []));
    expect(none.get('[data-testid="chore-week-summary-perfect"]').text()).toBe(
      'choreboard.weekSummary.perfectNone'
    );
  });

  it('nothing due yet: words, not "0 of 0", and an empty bar', () => {
    const weekend = [chore('w', { createdAt: OLD, days: [0, 6] })];
    const rows = MEMBERS.filter((m) => m.id === 'kid').map((member) => ({
      member,
      week: choreWeekRecord(weekend, indexMarks([]), member.id, clock.ymd, 1),
    }));
    const w = mountSummary(rows);
    const row = w.get('[data-testid="chore-week-summary-row"]');
    expect(row.get('[data-testid="chore-week-summary-count"]').text()).toBe(
      'choreboard.weekSummary.nothingDue'
    );
    expect(row.attributes('aria-label')).toBe('choreboard.weekSummary.rowAriaNone');
    expect(row.get('[data-testid="chore-week-summary-bar"]').attributes('style')).toContain(
      'width: 0%'
    );
    // A day with nothing due shows on the board: the legend explains it.
    expect(w.get('[data-testid="chore-week-legend"]').text()).toContain(
      'choreboard.week.legend.free'
    );
  });

  it('holds the legend, and a bean’s row opens their day', async () => {
    const w = mountSummary();
    expect(w.get('[data-testid="chore-week-legend"]').text()).toContain(
      'choreboard.week.legend.some'
    );
    expect(w.get('[data-testid="chore-week-legend"]').text()).not.toContain(
      'choreboard.week.legend.free'
    );
    await w.get('[data-testid="chore-week-summary-row"][data-member-id="sib"]').trigger('click');
    expect(w.emitted('open-day')).toEqual([['sib']]);
  });
});
