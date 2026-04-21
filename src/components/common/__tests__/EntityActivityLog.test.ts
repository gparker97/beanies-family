import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import EntityActivityLog, {
  type ActivityEntry,
  type ActivityFilterDef,
} from '@/components/common/EntityActivityLog.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-04-21',
    subtitle: 'Test entry',
    amount: 10,
    currency: 'USD',
    direction: 'income',
    ...overrides,
  };
}

function mountLog(props: Record<string, unknown> = {}) {
  return mount(EntityActivityLog, {
    props: {
      entries: [],
      emptyStateText: 'No activity',
      ...props,
    },
    global: {
      stubs: { CurrencyAmount: true },
    },
  });
}

describe('EntityActivityLog', () => {
  it('renders empty state when entries is empty', () => {
    const wrapper = mountLog({ emptyStateText: 'nothing-here' });
    expect(wrapper.text()).toContain('nothing-here');
  });

  it('hides the filter-chip row when filters prop is absent', () => {
    const wrapper = mountLog({ entries: [entry()] });
    // No <button> should contain emoji+label text when filters empty
    const chipButtons = wrapper.findAll('button').filter((b) => b.text().includes('filter'));
    expect(chipButtons).toHaveLength(0);
  });

  it('renders chips when filters prop is provided and emits filter-select', async () => {
    const filters: ActivityFilterDef<'all' | 'mine'>[] = [
      { id: 'all', labelKey: 'accountView.filter.all', emoji: '📋' },
      { id: 'mine', labelKey: 'accountView.filter.manual', emoji: '✋' },
    ];
    const wrapper = mountLog({ entries: [], filters, activeFilterId: 'all' });
    const chips = wrapper.findAll('button').filter((b) => b.text().includes('filter'));
    expect(chips.length).toBe(2);
    await chips[1]!.trigger('click');
    expect(wrapper.emitted('filter-select')?.[0]).toEqual(['mine']);
  });

  it('renders title + subtitle two-line stack when title is provided', () => {
    const wrapper = mountLog({
      entries: [entry({ title: 'Bold Title', subtitle: 'smaller line' })],
    });
    expect(wrapper.text()).toContain('Bold Title');
    expect(wrapper.text()).toContain('smaller line');
  });

  it('content area is a <button> when onClick is provided, a <div> otherwise', async () => {
    const clickable = vi.fn();
    const wrapper = mountLog({
      entries: [
        entry({ id: 'c', subtitle: 'clickable row', onClick: clickable }),
        entry({ id: 'nc', subtitle: 'non-clickable row' }),
      ],
    });

    // Row container is always a <div>; the inner content area is a <button>
    // when `onClick` is set so a trailing delete button never nests inside it.
    const rows = wrapper.findAll('[class*="rounded-2xl bg-white"]');
    expect(rows.length).toBe(2);

    const firstContent = rows[0]!.find('[class*="flex-1"]');
    const secondContent = rows[1]!.find('[class*="flex-1"]');
    expect(firstContent.element.tagName).toBe('BUTTON');
    expect(secondContent.element.tagName).toBe('DIV');

    await firstContent.trigger('click');
    expect(clickable).toHaveBeenCalledTimes(1);
    await secondContent.trigger('click');
    expect(clickable).toHaveBeenCalledTimes(1);
  });

  it('renders an inline trash button when onDelete is provided', async () => {
    const deleteFn = vi.fn();
    const wrapper = mountLog({
      entries: [entry({ id: 'd', subtitle: 'deletable', onDelete: deleteFn })],
    });

    const trash = wrapper.find('button[aria-label="action.delete"]');
    expect(trash.exists()).toBe(true);
    await trash.trigger('click');
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  it('hides the trash button when onDelete is absent', () => {
    const wrapper = mountLog({
      entries: [entry({ id: 'nd', subtitle: 'no delete' })],
    });
    expect(wrapper.find('button[aria-label="action.delete"]').exists()).toBe(false);
  });

  it('emits view-all when the "View all" button is clicked', async () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry({ id: `e${i}`, date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}` })
    );
    const wrapper = mountLog({ entries, showViewAll: true });
    const viewAllButton = wrapper.findAll('button').find((b) => b.text().includes('viewAll'));
    expect(viewAllButton).toBeTruthy();
    await viewAllButton!.trigger('click');
    expect(wrapper.emitted('view-all')).toBeTruthy();
  });

  it('does not render the "View all" button when showViewAll is false', () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry({ id: `e${i}`, date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}` })
    );
    const wrapper = mountLog({ entries, showViewAll: false });
    expect(wrapper.text()).not.toContain('viewAll');
  });

  it('caps entries at visibleCap', () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({ id: `e${i}`, subtitle: `row ${i}`, date: '2026-04-21' })
    );
    const wrapper = mountLog({ entries, visibleCap: 5 });
    const rendered = wrapper.findAll('[class*="rounded-2xl bg-white"]');
    expect(rendered.length).toBe(5);
  });
});
