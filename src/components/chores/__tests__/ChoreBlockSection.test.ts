/**
 * A block's four states come from the read model alone: open (with the Now ring and tag),
 * later (one quiet line that opens on the day view), done (the one-line strip) and the all-done
 * banner (with one star per chore, reopenable so a mistaken tick can be undone). A grown-up can
 * tap a chore's name (the page opens the bean's chore list); this section only ticks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import ChoreBlockSection from '../ChoreBlockSection.vue';
import { chore, resetKit } from './choreTestKit';
import { DEFAULT_CHORE_BLOCK_STARTS, type ChoreDayBlock } from '@/utils/chores';

function block(over: Partial<ChoreDayBlock> = {}): ChoreDayBlock {
  const items = over.chores ?? [
    { chore: chore('c1', { title: 'Make bed', emoji: '🛏️' }), done: true },
    { chore: chore('c2', { title: 'Brush teeth', emoji: '🪥' }), done: false },
  ];
  const done = items.filter((i) => i.done).length;
  return {
    block: 'morning',
    chores: items,
    done,
    total: items.length,
    allDone: items.length > 0 && done === items.length,
    celebrated: false,
    isNow: true,
    ended: false,
    ...over,
  };
}

function mountSection(props: Record<string, unknown>) {
  return mount(ChoreBlockSection, {
    // Each test supplies `block` and its own extras; the spread loses the prop types.
    props: {
      memberId: 'kid',
      beanName: 'Pip',
      starts: DEFAULT_CHORE_BLOCK_STARTS,
      ...props,
    } as never,
    global: { stubs: { CardArt: true } },
  });
}

beforeEach(() => resetKit());

describe('ChoreBlockSection', () => {
  it('open + now: the ring, the Now tag, every chore tickable', async () => {
    const w = mountSection({ block: block() });
    const root = w.get('[data-testid="chore-block"]');
    expect(root.attributes('data-state')).toBe('open');
    expect(root.attributes('data-now')).toBe('true');
    expect(root.classes()).toContain('ring-2');
    expect(w.find('[data-testid="chore-now-tag"]').exists()).toBe(true);
    // "1 to go" on a bean's day.
    expect(w.text()).toContain('choreboard.block.toGo');
    const rows = w.findAll('[data-testid="chore-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attributes('data-done')).toBe('true');
    await rows[1]!.get('[data-testid="chore-tick"]').trigger('click');
    expect(w.emitted('toggle')).toEqual([['c2']]);
  });

  it('later: one quiet line that opens its chores on the day view', async () => {
    const w = mountSection({ block: block({ block: 'evening', isNow: false }), open: false });
    expect(w.get('[data-testid="chore-block"]').attributes('data-state')).toBe('later');
    expect(w.find('[data-testid="chore-row"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-now-tag"]').exists()).toBe(false);
    await w.get('[data-testid="chore-block-later"]').trigger('click');
    expect(w.findAll('[data-testid="chore-row"]')).toHaveLength(2);
  });

  it('done + celebrate on the day: the banner with one star per chore, reopenable', async () => {
    const items = [
      { chore: chore('c1'), done: true },
      { chore: chore('c2'), done: true },
      { chore: chore('c3'), done: true },
    ];
    const w = mountSection({ block: block({ chores: items }), celebrate: true });
    expect(w.get('[data-testid="chore-block"]').attributes('data-state')).toBe('banner');
    const banner = w.get('[data-testid="chore-done-banner"]');
    expect(banner.text()).toContain('choreboard.done.title');
    expect(banner.text()).toContain('⭐⭐⭐');
    expect(banner.text()).not.toContain('⭐⭐⭐⭐');
    expect(w.find('[data-testid="chore-row"]').exists()).toBe(false);
    await w.get('[data-testid="celebration-banner-action"]').trigger('click');
    expect(w.findAll('[data-testid="chore-row"]')).toHaveLength(3);
  });

  it('done without celebrate, or on a card: the one-line All Done strip', () => {
    const items = [{ chore: chore('c1'), done: true }];
    const day = mountSection({ block: block({ chores: items, isNow: false, ended: true }) });
    expect(day.get('[data-testid="chore-block"]').attributes('data-state')).toBe('done');
    expect(day.get('[data-testid="chore-done-strip"]').text()).toContain(
      'choreboard.block.allDone'
    );
    const card = mountSection({
      block: block({ chores: items }),
      variant: 'card',
      celebrate: true,
    });
    expect(card.get('[data-testid="chore-block"]').attributes('data-state')).toBe('done');
    expect(card.find('[data-testid="chore-done-banner"]').exists()).toBe(false);
  });

  it('an ended later line counts what is left, in the plural of that number', () => {
    // Two chores, one done, the block over: "1 chore", never "1 chores".
    const w = mountSection({
      block: block({ block: 'morning', isNow: false, ended: true }),
      open: false,
    });
    const line = w.get('[data-testid="chore-block-later"]').text();
    expect(line).toContain('choreboard.block.chores.one');
    expect(line).not.toContain('choreboard.block.chores.other');
    // Not ended: the whole block's count, two chores.
    const later = mountSection({ block: block({ block: 'evening', isNow: false }), open: false });
    expect(later.get('[data-testid="chore-block-later"]').text()).toContain(
      'choreboard.block.chores.other'
    );
  });

  it('a block with no chores is never all done (the read model says so)', () => {
    const w = mountSection({ block: block({ chores: [] }) });
    expect(w.get('[data-testid="chore-block"]').attributes('data-state')).toBe('open');
  });

  it('a viewer who may not tick sees no tick buttons; a grown-up can tap a name to edit', async () => {
    const readOnly = mountSection({ block: block(), canTick: false });
    expect(readOnly.find('[data-testid="chore-tick"]').exists()).toBe(false);
    expect(readOnly.find('[data-testid="chore-edit"]').exists()).toBe(false);
    const grownUp = mountSection({ block: block(), canEdit: true });
    await grownUp.findAll('[data-testid="chore-edit"]')[0]!.trigger('click');
    expect(grownUp.emitted('edit')).toEqual([['c1']]);
    // No pencils, no handles, no checkboxes: editing lives in the bean's chore list.
    for (const id of ['chore-row-edit', 'chore-drag-handle', 'chore-row-select']) {
      expect(grownUp.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    }
  });

  it('a shared chore names the other bean', () => {
    const items = [{ chore: chore('c1', { assigneeIds: ['kid', 'sib'] }), done: false }];
    const w = mountSection({ block: block({ chores: items }) });
    expect(w.get('[data-testid="chore-shared-with"]').text()).toBe('choreboard.row.with');
  });
});
