/**
 * "Chores Done": the day cells (done / perfect / past with nothing / future / today), the
 * grown-ups' board in both orientations, a bean's own week, and the day summary that opens from
 * a cell (its count agrees with the cell's, a future cell is inert, Escape closes it, and it
 * offers "Open {Name}'s Day" only on today and only where the board asks for it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

import ChoreDayCell from '../ChoreDayCell.vue';
import ChoreWeekPanel from '../ChoreWeekPanel.vue';
import { MEMBERS, chore, clock, doneMark, resetKit } from './choreTestKit';
import { choreDayRecord, choreWeekRecord, indexMarks, type ChoreDayRecord } from '@/utils/chores';
import type { Chore, ChoreMark } from '@/types/models';

const pip = MEMBERS.find((m) => m.id === 'kid')!;
const juno = MEMBERS.find((m) => m.id === 'sib')!;

// Week of Mon 2026-11-09 .. Sun 2026-11-15; today is Friday the 13th. Pip has three chores a
// day, created well before the week.
const OLD = '2026-11-01T12:00:00.000Z';
const LIST: Chore[] = [
  chore('a', { createdAt: OLD }),
  chore('b', { createdAt: OLD, block: 'evening' }),
  chore('c', { createdAt: OLD, block: 'anytime' }),
  chore('j', { createdAt: OLD, assigneeIds: ['sib'] }),
];
const MARKS: ChoreMark[] = [
  doneMark('kid', 'a', '2026-11-09'), // Mon 1 of 3
  doneMark('kid', 'a', '2026-11-10'), // Tue 3 of 3: perfect
  doneMark('kid', 'b', '2026-11-10'),
  doneMark('kid', 'c', '2026-11-10'),
  // Wed and Thu: nothing
  doneMark('kid', 'a', '2026-11-13'), // today 2 of 3
  doneMark('kid', 'c', '2026-11-13'),
  doneMark('sib', 'j', '2026-11-12'),
];

function rowsFor(ids: string[]) {
  const index = indexMarks(MARKS);
  return MEMBERS.filter((m) => ids.includes(m.id)).map((member) => ({
    member,
    week: choreWeekRecord(LIST, index, member.id, clock.ymd, 1),
  }));
}

const mounted: VueWrapper[] = [];
function mountPanel(props: Record<string, unknown>) {
  const w = mount(ChoreWeekPanel, {
    props: { rows: rowsFor(['kid', 'sib']), todayYmd: clock.ymd, ...props } as never,
    global: { stubs: { BeanieAvatar: true } },
    attachTo: document.body,
  });
  mounted.push(w);
  return w;
}

const cellsOf = (w: VueWrapper, memberId: string) =>
  w.findAll(`[data-testid="chore-day-cell"][data-member-id="${memberId}"]`);
const popover = () => document.body.querySelector('[data-testid="chore-day-popover"]');

beforeEach(() => {
  resetKit();
  logEvent.mockReset();
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
});

describe('ChoreDayCell', () => {
  const rec = (ymd: string, done: number, total: number): ChoreDayRecord => ({
    ymd,
    blocks: [],
    done,
    total,
  });
  const cell = (r: ChoreDayRecord) =>
    mount(ChoreDayCell, {
      props: { record: r, name: 'Pip', weekday: 'Thursday', todayYmd: clock.ymd },
    });

  it('a day with chores done: the count, "of N", a fill by the share done', () => {
    const w = cell(rec('2026-11-12', 1, 3));
    const b = w.get('button');
    expect(b.attributes('data-state')).toBe('done');
    expect(b.get('b').text()).toBe('1');
    expect(b.get('small').text()).toBe('choreboard.cell.of');
    expect(b.classes()).toContain('bg-[var(--chore-heat-2)]');
    expect(b.attributes('aria-label')).toBe('choreboard.cell.done');
    expect(
      cell(rec('2026-11-12', 1, 4))
        .get('button')
        .classes()
    ).toContain('bg-[var(--chore-heat-1)]');
    expect(
      cell(rec('2026-11-12', 3, 4))
        .get('button')
        .classes()
    ).toContain('bg-[var(--chore-heat-3)]');
  });

  it('a perfect day: the strongest fill and a star badge', () => {
    const b = cell(rec('2026-11-12', 3, 3)).get('button');
    expect(b.attributes('data-state')).toBe('perfect');
    expect(b.classes()).toContain('bg-[var(--chore-heat-4)]');
    expect(b.text()).toContain('⭐');
  });

  it('a past day with nothing done: a dashed cell with a dot, never "0"', () => {
    const b = cell(rec('2026-11-12', 0, 3)).get('button');
    expect(b.attributes('data-state')).toBe('empty');
    expect(b.classes()).toContain('border-dashed');
    expect(b.text()).toBe('');
    expect(b.attributes('aria-label')).toBe('choreboard.cell.none');
  });

  it('a day to come: a blank outline that is not a button', () => {
    const w = cell(rec('2026-11-14', 0, 3));
    expect(w.find('button').exists()).toBe(false);
    const span = w.get('[data-testid="chore-day-cell"]');
    expect(span.attributes('data-state')).toBe('future');
    expect(span.attributes('role')).toBe('img');
    expect(span.attributes('aria-label')).toBe('choreboard.cell.future');
  });

  it('today: the orange ring, aria-current, and "nothing done yet" when empty', () => {
    const b = cell(rec(clock.ymd, 0, 3)).get('button');
    expect(b.classes()).toContain('ring-primary-500');
    expect(b.attributes('aria-current')).toBe('date');
    expect(b.attributes('aria-label')).toBe('choreboard.cell.noneYet');
  });
});

describe('ChoreWeekPanel: the grown-ups board', () => {
  it('days across: per bean seven cells in the right states, and the week total', () => {
    const w = mountPanel({});
    expect(w.attributes('data-testid')).toBe('chore-week-panel');
    expect(w.attributes('data-orientation')).toBe('across');
    const states = cellsOf(w, 'kid').map((c) => c.attributes('data-state'));
    expect(states).toEqual(['done', 'perfect', 'empty', 'empty', 'done', 'future', 'future']);
    const counts = cellsOf(w, 'kid').map((c) => c.find('b').exists() && c.get('b').text());
    expect(counts).toEqual(['1', '3', false, false, '2', false, false]);
    const total = w.get('[data-testid="chore-week-panel-total"][data-member-id="kid"]');
    expect(total.text()).toBe('⭐ 6');
    expect(w.find('[data-testid="chore-week-legend"]').exists()).toBe(true);
  });

  it('days down (the rail): the same cells, day by day', () => {
    const w = mountPanel({ orientation: 'down' });
    expect(w.attributes('data-orientation')).toBe('down');
    const all = w.findAll('[data-testid="chore-day-cell"]');
    // Day-major: Monday's two beans first.
    expect(all.slice(0, 2).map((c) => c.attributes('data-member-id'))).toEqual(['kid', 'sib']);
    expect(cellsOf(w, 'kid').map((c) => c.attributes('data-shape'))).toEqual(Array(7).fill('tall'));
    expect(cellsOf(w, 'kid').map((c) => c.attributes('data-state'))).toEqual([
      'done',
      'perfect',
      'empty',
      'empty',
      'done',
      'future',
      'future',
    ]);
  });
});

describe('ChoreWeekPanel: a bean’s own week', () => {
  it('seven square cells, the total in the header, no legend', () => {
    const w = mountPanel({ rows: rowsFor(['kid']), single: true });
    expect(w.attributes('data-testid')).toBe('chore-week-row');
    expect(cellsOf(w, 'kid')).toHaveLength(7);
    expect(cellsOf(w, 'kid')[0]!.attributes('data-shape')).toBe('square');
    expect(w.get('[data-testid="chore-week-total"]').text()).toBe('⭐ 6');
    expect(w.find('[data-testid="chore-week-legend"]').exists()).toBe(false);
  });

  it('none yet this week: words, not a zero', () => {
    const empty = MEMBERS.filter((m) => m.id === 'kid').map((member) => ({
      member,
      week: choreWeekRecord(LIST, indexMarks([]), member.id, clock.ymd, 1),
    }));
    const w = mountPanel({ rows: empty, single: true });
    expect(w.get('[data-testid="chore-week-total"]').text()).toBe('choreboard.week.noneYet');
  });
});

describe('the day summary', () => {
  it('opens from a past cell with the same count as the cell, grouped by block, and logs', async () => {
    const w = mountPanel({});
    const thu = cellsOf(w, 'kid')[1]!; // Tuesday: perfect, 3 of 3
    await thu.trigger('click');
    await flushPromises();
    const pop = popover()!;
    expect(pop).not.toBeNull();
    expect(pop.getAttribute('data-ymd')).toBe('2026-11-10');
    const record = choreDayRecord(LIST, indexMarks(MARKS), 'kid', '2026-11-10');
    const items = [...pop.querySelectorAll('[data-testid="chore-day-popover-item"]')];
    expect(items).toHaveLength(record.total);
    expect(items.filter((i) => i.getAttribute('data-done') === 'true')).toHaveLength(record.done);
    expect(thu.get('b').text()).toBe(String(record.done));
    expect(
      [...pop.querySelectorAll('[data-testid="chore-day-popover-group"]')].map((g) =>
        g.getAttribute('data-block')
      )
    ).toEqual(['morning', 'evening', 'anytime']);
    expect(thu.attributes('aria-expanded')).toBe('true');
    // Past days are read only: no way to the tick view.
    expect(pop.querySelector('[data-testid="chore-day-popover-open-day"]')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'choreboard',
        message: 'day-popover-opened',
        context: { kind: 'past', count: 3, detail: 'home' },
      })
    );
  });

  it('lists what was not done too, and agrees with a partly done day', async () => {
    const w = mountPanel({});
    await cellsOf(w, 'kid')[0]!.trigger('click'); // Monday 1 of 3
    await flushPromises();
    const items = [...popover()!.querySelectorAll('[data-testid="chore-day-popover-item"]')];
    expect(items.map((i) => i.getAttribute('data-done'))).toEqual(['true', 'false', 'false']);
  });

  it('a future cell is inert', async () => {
    const w = mountPanel({});
    await cellsOf(w, 'kid')[5]!.trigger('click');
    await flushPromises();
    expect(popover()).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('Escape closes it and focus goes back to the cell', async () => {
    const w = mountPanel({});
    const mon = cellsOf(w, 'kid')[0]!;
    await mon.trigger('click');
    await flushPromises();
    expect(popover()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(mon.element);
  });

  it('an outside click closes it; the close button does too', async () => {
    const w = mountPanel({});
    await cellsOf(w, 'kid')[0]!.trigger('click');
    await flushPromises();
    document.body.click();
    await flushPromises();
    expect(popover()).toBeNull();
    await cellsOf(w, 'kid')[0]!.trigger('click');
    await flushPromises();
    (popover()!.querySelector('[data-testid="chore-day-popover-close"]') as HTMLElement).click();
    await flushPromises();
    expect(popover()).toBeNull();
  });

  it('today offers "Open {Name}\'s Day" where the board asks for it, and emits the bean', async () => {
    const w = mountPanel({ openDayAction: true });
    await cellsOf(w, 'sib')[4]!.trigger('click'); // Juno, today
    await flushPromises();
    const open = popover()!.querySelector(
      '[data-testid="chore-day-popover-open-day"]'
    ) as HTMLElement;
    expect(open).not.toBeNull();
    open.click();
    await flushPromises();
    expect(w.emitted('open-day')).toEqual([[juno.id]]);
    expect(popover()).toBeNull();
  });

  it('a bean’s own week never offers it (that page is the day already)', async () => {
    const w = mountPanel({ rows: rowsFor(['kid']), single: true });
    await cellsOf(w, pip.id)[4]!.trigger('click');
    await flushPromises();
    expect(popover()!.querySelector('[data-testid="chore-day-popover-open-day"]')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { kind: 'today', count: 2, detail: 'day' } })
    );
  });
});
