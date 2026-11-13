/**
 * A bean's home card: today's count, the block happening now open (and Anytime), finished
 * blocks as All Done strips, every other block as a coloured count; the compact card for a
 * bean with no chores; grown-up controls only for grown-ups.
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
  it('shows the count, the Now block open, Anytime, and later blocks as coloured counts', () => {
    chores.list = [
      chore('m1'),
      chore('m2'),
      chore('a1', { block: 'afternoon' }),
      chore('a2', { block: 'afternoon' }),
      chore('e1', { block: 'evening' }),
      chore('x1', { block: 'anytime' }),
    ];
    chores.marks = [doneMark('kid', 'm1')];
    const w = mountCard();
    expect(w.get('[data-testid="chore-bean-count"]').text()).toBe('choreboard.block.count');
    const sections = w.findAll('[data-testid="chore-block"]');
    expect(sections.map((s) => s.attributes('data-block'))).toEqual(['morning', 'anytime']);
    expect(sections.every((s) => s.attributes('data-state') === 'open')).toBe(true);
    // Compact rows for the overview.
    expect(w.findAll('[data-testid="chore-row"]')).toHaveLength(3);
    const chips = w.findAll('[data-testid="chore-bean-chip"]');
    expect(chips.map((c) => [c.attributes('data-block'), c.text().replace(/\s/g, '')])).toEqual([
      ['afternoon', '☀️2'],
      ['evening', '🌙1'],
    ]);
  });

  it('a finished Now block folds to its All Done strip', () => {
    chores.list = [chore('m1'), chore('a1', { block: 'afternoon' })];
    chores.marks = [doneMark('kid', 'm1')];
    const w = mountCard();
    const morning = w.get('[data-block="morning"]');
    expect(morning.attributes('data-state')).toBe('done');
    expect(w.find('[data-testid="chore-done-strip"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-done-banner"]').exists()).toBe(false);
  });

  it('a later block finished early is a strip too, not a count', () => {
    chores.list = [chore('m1'), chore('e1', { block: 'evening' })];
    chores.marks = [doneMark('kid', 'e1')];
    const w = mountCard();
    expect(w.get('[data-block="evening"]').attributes('data-state')).toBe('done');
    expect(w.find('[data-testid="chore-bean-chip"]').exists()).toBe(false);
  });

  it('a bean with no chores gets the compact card', () => {
    const w = mountCard({ hasAnyChores: false });
    expect(w.get('[data-testid="chore-bean-empty"]').text()).toBe('choreboard.card.noneYet');
    expect(w.find('[data-testid="chore-block"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-bean-count"]').exists()).toBe(false);
  });

  it('chores on other days only: "No chores today"', () => {
    chores.list = [chore('sat', { days: [6] })]; // Friday today
    const w = mountCard();
    expect(w.get('[data-testid="chore-bean-empty"]').text()).toBe('choreboard.card.none');
  });

  it('grown-up controls (edit, copy, add) only with canEdit; the header opens the day', async () => {
    chores.list = [chore('m1')];
    const child = mountCard();
    for (const id of ['chore-bean-edit', 'chore-bean-copy', 'chore-bean-add', 'chore-row-edit']) {
      expect(child.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    }
    const adult = mountCard({ canEdit: true });
    expect(adult.get('[data-testid="chore-bean-edit"]').attributes('aria-label')).toBe(
      'choreboard.card.editAria'
    );
    await adult.get('[data-testid="chore-bean-copy"]').trigger('click');
    await adult.get('[data-testid="chore-bean-add"]').trigger('click');
    await adult.get('[data-testid="chore-bean-open"]').trigger('click');
    // Edit Chores opens the bean's day too: every chore is listed there with its pencil.
    await adult.get('[data-testid="chore-bean-edit"]').trigger('click');
    expect(adult.emitted('copy')).toHaveLength(1);
    expect(adult.emitted('add')).toHaveLength(1);
    expect(adult.emitted('open')).toHaveLength(2);
    // The open block's rows carry the pencil for a grown-up.
    await adult.get('[data-testid="chore-row-edit"]').trigger('click');
    expect(adult.emitted('edit')).toEqual([['m1']]);
  });

  it('a bean with no chores at all has no Edit Chores (nothing to edit), only "+"', () => {
    const w = mountCard({ canEdit: true, hasAnyChores: false });
    expect(w.find('[data-testid="chore-bean-edit"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-bean-add"]').exists()).toBe(true);
  });

  it('forwards a tick with the chore id', async () => {
    chores.list = [chore('m1')];
    const w = mountCard();
    await w.get('[data-testid="chore-tick"]').trigger('click');
    expect(w.emitted('toggle')).toEqual([['m1']]);
  });
});
