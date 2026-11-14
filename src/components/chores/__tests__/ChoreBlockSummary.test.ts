/**
 * One time of day as a summary row (or the phone's tile): "3 of 5" and a bar while it runs,
 * stars and "All Done" when finished, an orange "N left" pill when its time passed with chores
 * left, the Now ring and tag, a disclosure on the card and a jump on the day page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);

import ChoreBlockSummary from '../ChoreBlockSummary.vue';
import { chore, resetKit } from './choreTestKit';
import { DEFAULT_CHORE_BLOCK_STARTS, type ChoreDayBlock } from '@/utils/chores';

function block(done: boolean[], over: Partial<ChoreDayBlock> = {}): ChoreDayBlock {
  const chores = done.map((d, i) => ({ chore: chore(`c${i}`), done: d }));
  const n = done.filter(Boolean).length;
  return {
    block: 'morning',
    chores,
    done: n,
    total: chores.length,
    allDone: chores.length > 0 && n === chores.length,
    celebrated: false,
    isNow: false,
    ended: false,
    ...over,
  };
}

function mountSummary(props: Record<string, unknown>, slot = '') {
  return mount(ChoreBlockSummary, {
    props: { starts: DEFAULT_CHORE_BLOCK_STARTS, beanName: 'Pip', ...props } as never,
    slots: slot ? { default: slot } : {},
  });
}

beforeEach(() => resetKit());

describe('ChoreBlockSummary (row)', () => {
  it('a block still to come: its hours, "d of t" and a bar in the block colour', () => {
    const w = mountSummary({ block: block([true, false, false], { block: 'afternoon' }) });
    const root = w.get('[data-testid="chore-summary"]');
    expect(root.attributes('data-state')).toBe('open');
    expect(root.classes()).toContain('chore-block-afternoon');
    expect(w.text()).toContain('choreboard.block.from');
    expect(w.text()).toContain('choreboard.block.count');
    expect(w.find('[data-testid="chore-summary-now"]').exists()).toBe(false);
    expect(w.get('[style*="width"]').attributes('style')).toContain('width: 33%');
  });

  it('the block happening now: the orange ring, the Now tag, "until"', () => {
    const w = mountSummary({ block: block([true, false], { isNow: true }) });
    const root = w.get('[data-testid="chore-summary"]');
    expect(root.attributes('data-now')).toBe('true');
    expect(root.classes()).toContain('ring-primary-500');
    expect(w.get('[data-testid="chore-summary-now"]').text()).toBe('choreboard.now.tag');
    expect(w.text()).toContain('choreboard.now.until');
  });

  it('a finished block: its stars and All Done, a word for the bean while it is now', () => {
    const now = mountSummary({ block: block([true, true], { isNow: true }) });
    expect(now.get('[data-testid="chore-summary"]').attributes('data-state')).toBe('done');
    expect(now.text()).toContain('choreboard.block.allDone');
    expect(now.get('[data-testid="chore-summary-note"]').text()).toContain('⭐⭐');
    expect(now.get('[data-testid="chore-summary-note"]').text()).toContain(
      'choreboard.summary.niceWork'
    );
    const later = mountSummary({ block: block([true, true], { block: 'evening' }) });
    expect(later.get('[data-testid="chore-summary-note"]').text()).toContain(
      'choreboard.summary.done'
    );
  });

  it('an ended block with chores left: the orange "N left" pill, singular for one', () => {
    const one = mountSummary({ block: block([true, false], { ended: true }) });
    expect(one.get('[data-testid="chore-summary"]').attributes('data-state')).toBe('left');
    const pill = one.get('[data-testid="chore-summary-left"]');
    expect(pill.text()).toBe('choreboard.summary.left.one');
    expect(pill.classes()).toContain('text-primary-700');
    const two = mountSummary({ block: block([false, false], { ended: true }) });
    expect(two.get('[data-testid="chore-summary-left"]').text()).toBe(
      'choreboard.summary.left.other'
    );
  });

  it('Anytime has no hours hint', () => {
    const w = mountSummary({ block: block([false], { block: 'anytime' }) });
    expect(w.text()).not.toContain('choreboard.block.anytimeHint');
  });

  it('toggle: a disclosure whose rows show when expanded; a tap emits activate', async () => {
    const closed = mountSummary({ block: block([false]) }, '<p data-testid="rows">rows</p>');
    const btn = closed.get('[data-testid="chore-summary-toggle"]');
    expect(btn.attributes('aria-expanded')).toBe('false');
    expect(closed.find('[data-testid="rows"]').exists()).toBe(false);
    await btn.trigger('click');
    expect(closed.emitted('activate')).toHaveLength(1);
    const open = mountSummary(
      { block: block([false]), expanded: true },
      '<p data-testid="rows">rows</p>'
    );
    const openBtn = open.get('[data-testid="chore-summary-toggle"]');
    expect(openBtn.attributes('aria-expanded')).toBe('true');
    const rows = open.get('[data-testid="rows"]');
    expect(openBtn.attributes('aria-controls')).toBe(rows.element.parentElement!.id);
  });

  it('jump: no disclosure state, and it says where it goes', () => {
    const w = mountSummary({ block: block([false]), mode: 'jump' }, '<p data-testid="rows" />');
    const btn = w.get('[data-testid="chore-summary-toggle"]');
    expect(btn.attributes('aria-expanded')).toBeUndefined();
    expect(btn.text()).toContain('choreboard.summary.goTo');
    expect(w.find('[data-testid="rows"]').exists()).toBe(false);
  });
});

describe('ChoreBlockSummary (tile)', () => {
  it('a small tile with the same states, Now on top, a tap emits activate', async () => {
    const w = mountSummary({ block: block([true, false], { isNow: true }), variant: 'tile' });
    const tile = w.get('button[data-testid="chore-summary"]');
    expect(tile.attributes('data-now')).toBe('true');
    expect(w.find('[data-testid="chore-summary-now"]').exists()).toBe(true);
    expect(tile.text()).toContain('choreboard.block.count');
    await tile.trigger('click');
    expect(w.emitted('activate')).toHaveLength(1);
    const left = mountSummary({ block: block([false], { ended: true }), variant: 'tile' });
    expect(left.find('[data-testid="chore-summary-left"]').exists()).toBe(true);
  });
});
