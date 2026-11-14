/**
 * A bean's home card, "four segments": the header (count, "N left today"), one summary row per
 * time of day in day order, the block happening now open with its ticks, other rows opening on
 * a tap (one at a time beside Now); the chip for a bean with no chores; grown-up controls
 * only for grown-ups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import ChoreBeanCard from '../ChoreBeanCard.vue';
import { MEMBERS, chore, chores, clock, doneMark, resetKit } from './choreTestKit';
import {
  DEFAULT_CHORE_BLOCK_STARTS,
  beanChoreDay,
  indexMarks,
  type BeanChoreDay,
} from '@/utils/chores';

const pip = MEMBERS.find((m) => m.id === 'kid')!;

function dayOf(): BeanChoreDay {
  return beanChoreDay(
    chores.list,
    indexMarks(chores.marks),
    'kid',
    { ...clock },
    DEFAULT_CHORE_BLOCK_STARTS
  );
}

function mountCard(props: Record<string, unknown> = {}) {
  return mount(ChoreBeanCard, {
    props: {
      member: pip,
      day: dayOf(),
      hasAnyChores: chores.list.length > 0,
      starts: DEFAULT_CHORE_BLOCK_STARTS,
      ...props,
    },
    global: { stubs: { CardArt: true, BeanieAvatar: true } },
  });
}

beforeEach(() => resetKit());

describe('ChoreBeanCard', () => {
  it('one summary row per block in day order; Now open with its ticks; the header counts', () => {
    chores.list = [
      chore('x1', { block: 'anytime' }),
      chore('e1', { block: 'evening' }),
      chore('m1'),
      chore('m2'),
      chore('a1', { block: 'afternoon' }),
      chore('a2', { block: 'afternoon' }),
    ];
    chores.marks = [doneMark('kid', 'm1')];
    const w = mountCard();
    expect(w.get('[data-testid="chore-bean-count"]').text()).toBe('choreboard.block.count');
    expect(w.get('[data-testid="chore-bean-left"]').text()).toBe('choreboard.card.left.other');
    const rows = w.findAll('[data-testid="chore-summary"]');
    expect(rows.map((r) => r.attributes('data-block'))).toEqual([
      'morning',
      'afternoon',
      'evening',
      'anytime',
    ]);
    expect(rows[0]!.attributes('data-now')).toBe('true');
    // Only the Now block's chores are showing.
    expect(
      w.findAll('[data-testid="chore-row"]').map((r) => r.attributes('data-chore-id'))
    ).toEqual(['m1', 'm2']);
    // The "More Today" chips are gone.
    expect(w.find('[data-testid="chore-bean-chips"]').exists()).toBe(false);
  });

  it('a tap opens another block, one at a time beside Now; a tap on Now folds it', async () => {
    chores.list = [
      chore('m1'),
      chore('a1', { block: 'afternoon' }),
      chore('e1', { block: 'evening' }),
    ];
    const w = mountCard();
    const toggle = (block: string) =>
      w.get(
        `[data-testid="chore-summary"][data-block="${block}"] [data-testid="chore-summary-toggle"]`
      );
    const shown = () =>
      w.findAll('[data-testid="chore-row"]').map((r) => r.attributes('data-chore-id'));
    await toggle('afternoon').trigger('click');
    expect(shown()).toEqual(['m1', 'a1']);
    await toggle('evening').trigger('click');
    expect(shown()).toEqual(['m1', 'e1']);
    await toggle('evening').trigger('click');
    expect(shown()).toEqual(['m1']);
    await toggle('morning').trigger('click');
    expect(shown()).toEqual([]);
    expect(toggle('morning').attributes('aria-expanded')).toBe('false');
  });

  it('folding is per block: when the clock moves on, the newly current block opens', async () => {
    chores.list = [chore('m1'), chore('a1', { block: 'afternoon' })];
    const w = mountCard();
    const shown = () =>
      w.findAll('[data-testid="chore-row"]').map((r) => r.attributes('data-chore-id'));
    await w.get('[data-block="morning"] [data-testid="chore-summary-toggle"]').trigger('click');
    expect(shown()).toEqual([]);
    clock.hhmm = '12:30';
    await w.setProps({ day: dayOf() });
    expect(shown()).toEqual(['a1']);
  });

  it('a finished Now block folds to its stars and All Done', () => {
    chores.list = [chore('m1'), chore('a1', { block: 'afternoon' })];
    chores.marks = [doneMark('kid', 'm1')];
    const w = mountCard();
    const morning = w.get('[data-testid="chore-summary"][data-block="morning"]');
    expect(morning.attributes('data-state')).toBe('done');
    expect(w.find('[data-testid="chore-row"]').exists()).toBe(false);
  });

  it('a block whose time passed with chores left says how many, in orange', () => {
    clock.hhmm = '18:15';
    chores.list = [chore('m1'), chore('m2'), chore('e1', { block: 'evening' })];
    chores.marks = [doneMark('kid', 'm1')];
    const w = mountCard();
    const morning = w.get('[data-testid="chore-summary"][data-block="morning"]');
    expect(morning.attributes('data-state')).toBe('left');
    expect(morning.get('[data-testid="chore-summary-left"]').text()).toBe(
      'choreboard.summary.left.one'
    );
  });

  it('every chore done: "All done today"', () => {
    chores.list = [chore('m1')];
    chores.marks = [doneMark('kid', 'm1')];
    const w = mountCard();
    expect(w.get('[data-testid="chore-bean-left"]').text()).toContain('choreboard.card.allDone');
  });

  it('a bean with no chores is a chip: avatar and name (the strip says "No Chores Yet")', () => {
    const w = mountCard({ hasAnyChores: false });
    const chip = w.get('[data-testid="chore-slim-row"]');
    expect(chip.attributes('data-member-id')).toBe('kid');
    expect(chip.text()).toContain('Pip');
    expect(w.find('[data-testid="chore-bean-card"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-summary"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-bean-count"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-bean-open"]').exists()).toBe(false);
  });

  it('chores on other days only: "No chores today"', () => {
    chores.list = [chore('sat', { days: [6] })]; // Friday today
    const w = mountCard();
    expect(w.get('[data-testid="chore-bean-empty"]').text()).toBe('choreboard.card.none');
  });

  it('grown-up controls only with canEdit: ONE edit affordance (Edit Chores) and Copy', async () => {
    chores.list = [chore('m1')];
    const child = mountCard();
    for (const id of ['chore-bean-edit', 'chore-bean-copy', 'chore-bean-add', 'chore-edit']) {
      expect(child.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    }
    const adult = mountCard({ canEdit: true });
    expect(adult.get('[data-testid="chore-bean-edit"]').attributes('aria-label')).toBe(
      'choreboard.card.editAria'
    );
    // A bean with chores has no separate "+".
    expect(adult.find('[data-testid="chore-bean-add"]').exists()).toBe(false);
    expect(adult.find('[data-testid="chore-row-edit"]').exists()).toBe(false);
    await adult.get('[data-testid="chore-bean-copy"]').trigger('click');
    await adult.get('[data-testid="chore-bean-open"]').trigger('click');
    await adult.get('[data-testid="chore-bean-edit"]').trigger('click');
    // A chore's name opens the same list.
    await adult.get('[data-testid="chore-edit"]').trigger('click');
    expect(adult.emitted('copy')).toHaveLength(1);
    expect(adult.emitted('open')).toHaveLength(1);
    expect(adult.emitted('edit-chores')).toHaveLength(2);
  });

  it('a bean with no chores at all has Add Chores (the same list, empty), no Edit Chores and no Copy', async () => {
    const w = mountCard({ canEdit: true, hasAnyChores: false });
    expect(w.find('[data-testid="chore-bean-edit"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-bean-copy"]').exists()).toBe(false);
    expect(w.get('[data-testid="chore-bean-add"]').text()).toContain('choreboard.addChores');
    expect(mountCard({ hasAnyChores: false }).find('[data-testid="chore-bean-add"]').exists()).toBe(
      false
    );
    await w.get('[data-testid="chore-bean-add"]').trigger('click');
    expect(w.emitted('edit-chores')).toHaveLength(1);
  });

  it('forwards a tick with the chore id', async () => {
    chores.list = [chore('m1')];
    const w = mountCard();
    await w.get('[data-testid="chore-tick"]').trigger('click');
    const [id, anchor] = w.emitted('toggle')![0]!;
    expect(id).toBe('m1');
    // The celebration's anchor is the block's summary row (the card has no banner of its own).
    expect(anchor).toMatchObject({
      block: w.get('[data-testid="chore-summary"]').element,
      tickEl: w.get('[data-testid="chore-tick"]').element,
    });
  });
});
