/**
 * A block's four states come from the read model alone: open (with the Now ring and tag),
 * later (one quiet line that opens on the day view), done (the one-line strip) and the all-done
 * banner (with one star per chore, reopenable so a mistaken tick can be undone). A grown-up's
 * rows carry the pencil; a failed reorder puts the rows back; select mode shows every row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

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

  it('a viewer who may not tick sees no tick buttons; a grown-up can edit by the title', async () => {
    const readOnly = mountSection({ block: block(), canTick: false });
    expect(readOnly.find('[data-testid="chore-tick"]').exists()).toBe(false);
    // No pencil without edit rights (a child).
    expect(readOnly.find('[data-testid="chore-row-edit"]').exists()).toBe(false);
    const grownUp = mountSection({ block: block(), canEdit: true });
    await grownUp.findAll('[data-testid="chore-edit"]')[0]!.trigger('click');
    expect(grownUp.emitted('edit')).toEqual([['c1']]);
    // The visible pencil does the same, labelled with the chore.
    const pencil = grownUp.findAll('[data-testid="chore-row-edit"]')[1]!;
    expect(pencil.attributes('aria-label')).toBe('choreboard.row.edit');
    expect(pencil.attributes('title')).toBe('choreboard.row.edit');
    await pencil.trigger('click');
    expect(grownUp.emitted('edit')).toEqual([['c1'], ['c2']]);
  });

  it('a shared chore names the other bean', () => {
    const items = [{ chore: chore('c1', { assigneeIds: ['kid', 'sib'] }), done: false }];
    const w = mountSection({ block: block({ chores: items }) });
    expect(w.get('[data-testid="chore-shared-with"]').text()).toBe('choreboard.row.with');
  });
});

/** vuedraggable without Sortable: renders `#item` per element and lets a test drive a move. */
const DraggableStub = defineComponent({
  name: 'Draggable',
  props: { modelValue: { type: Array, default: () => [] }, handle: String },
  emits: ['update:modelValue', 'change'],
  setup(props, { slots, attrs }) {
    return () =>
      h(
        'div',
        { 'data-testid': attrs['data-testid'], 'data-handle': props.handle },
        props.modelValue.map((element) => slots.item?.({ element }))
      );
  },
});

describe('ChoreBlockSection: reorder (grown-ups, a bean’s day)', () => {
  const mountDraggable = (props: Record<string, unknown>) =>
    mount(ChoreBlockSection, {
      props: {
        memberId: 'kid',
        beanName: 'Pip',
        starts: DEFAULT_CHORE_BLOCK_STARTS,
        ...props,
      } as never,
      global: { stubs: { CardArt: true, draggable: DraggableStub } },
    });

  it('reorderable: each row has the drag handle, and a move sends the new id order', async () => {
    const reorder = vi.fn(async () => true);
    const w = mountDraggable({ block: block(), reorderable: true, canEdit: true, reorder });
    expect(w.get('[data-testid="chore-block-rows"]').attributes('data-handle')).toBe(
      '.drag-handle'
    );
    expect(w.findAll('[data-testid="chore-drag-handle"]')).toHaveLength(2);
    const drag = w.findComponent(DraggableStub);
    const [a, b] = drag.props('modelValue') as unknown[];
    await drag.vm.$emit('update:modelValue', [b, a]);
    await drag.vm.$emit('change', { moved: { oldIndex: 1, newIndex: 0 } });
    await flushPromises();
    expect(reorder).toHaveBeenCalledWith(['c2', 'c1']);
    // Landed: the copy keeps the new order until the store's re-read flows back.
    expect(drag.props('modelValue')).toEqual([b, a]);
  });

  it('a reorder that does not land puts the rows back in the stored order', async () => {
    const reorder = vi.fn(async () => false); // refused or failed: the read model never changed
    const w = mountDraggable({ block: block(), reorderable: true, canEdit: true, reorder });
    const drag = w.findComponent(DraggableStub);
    const [a, b] = drag.props('modelValue') as unknown[];
    await drag.vm.$emit('update:modelValue', [b, a]);
    await drag.vm.$emit('change', { moved: { oldIndex: 1, newIndex: 0 } });
    await flushPromises();
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(drag.props('modelValue')).toEqual([a, b]);
  });

  it('select mode: no drag list, every row has its checkbox, a later block shows its rows', async () => {
    const w = mountDraggable({
      block: block({ block: 'evening', isNow: false }),
      open: false,
      reorderable: true,
      canEdit: true,
      selecting: true,
      selectedIds: ['c2'],
    });
    expect(w.findComponent(DraggableStub).exists()).toBe(false);
    const boxes = w.findAll('[data-testid="chore-row-select"]');
    expect(boxes.map((b) => b.attributes('aria-checked'))).toEqual(['false', 'true']);
    expect(w.find('[data-testid="chore-row-edit"]').exists()).toBe(false);
    await boxes[0]!.trigger('click');
    expect(w.emitted('select')).toEqual([['c1']]);
  });

  it('not reorderable (a child, or the home card): no handles, no drag list', () => {
    const w = mountDraggable({ block: block() });
    expect(w.findComponent(DraggableStub).exists()).toBe(false);
    expect(w.find('[data-testid="chore-drag-handle"]').exists()).toBe(false);
  });

  it('one chore has nothing to reorder', () => {
    const w = mountDraggable({
      block: block({ chores: [{ chore: chore('c1'), done: false }] }),
      reorderable: true,
    });
    expect(w.findComponent(DraggableStub).exists()).toBe(false);
  });
});
