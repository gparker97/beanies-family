/**
 * `GroupedChipPicker` (#152): the opt-in search, and the unsearchable output the milestone
 * picker relies on. `MilestoneFormModal.test.ts` stubs this picker, so the class assertions
 * here are what pin the milestone picker through the `ChipButton` swap: a changed chip class
 * IS the regression being guarded against.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import GroupedChipPicker, { type ChipGroup } from '../GroupedChipPicker.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const GROUPS: ChipGroup[] = [
  {
    name: 'Sports',
    icon: '⚽',
    items: [
      { value: 'softball', label: 'Softball', icon: '🥎', keywords: ['softball'] },
      { value: 'baseball', label: 'Baseball', icon: '⚾', keywords: ['baseball'] },
      { value: 'swimming', label: 'Swimming', icon: '🏊', keywords: ['swim', 'pool', '游泳'] },
    ],
  },
  {
    name: 'Social',
    icon: '🎉',
    items: [{ value: 'playdate', label: 'Playdate', icon: '🧸', keywords: ['play date'] }],
  },
];

function factory(props: Record<string, unknown> = {}) {
  return mount(GroupedChipPicker, {
    props: { modelValue: '', groups: GROUPS, ...props },
  });
}

/** Chip labels currently on screen, in order. */
const chipTexts = (wrapper: ReturnType<typeof factory>) =>
  wrapper.findAll('button').map((b) => b.text());

describe('GroupedChipPicker search', () => {
  it('shows the grouped list unchanged while the query is empty', () => {
    const wrapper = factory({ searchable: true });
    expect(wrapper.find('input').exists()).toBe(true);
    expect(wrapper.find('input').attributes('aria-label')).toBe('modal.searchCategories');
    expect(chipTexts(wrapper)).toEqual(['⚽ Sports', '🎉 Social']);
  });

  it('puts the search pill in the chip row, before the group chips or the expanded chip', async () => {
    const collapsed = factory({ searchable: true });
    const row = collapsed.find('label').element.parentElement!;
    expect(row.firstElementChild!.tagName).toBe('LABEL');
    expect(row.querySelectorAll('button')).toHaveLength(2);

    const expanded = factory({ searchable: true, modelValue: 'baseball' });
    const expandedRow = expanded.find('label').element.parentElement!;
    expect(expandedRow.firstElementChild!.tagName).toBe('LABEL');
    expect(expandedRow.textContent).toContain('Sports');
  });

  it('keeps the same input mounted when the first letter turns the row into results', async () => {
    const wrapper = factory({ searchable: true });
    const before = wrapper.find('input').element;
    await wrapper.find('input').setValue('b');
    expect(wrapper.find('input').element).toBe(before);
  });

  it('finds items by label across every group, as one flat row', async () => {
    const wrapper = factory({ searchable: true });
    await wrapper.find('input').setValue('ball');
    expect(chipTexts(wrapper)).toEqual(expect.arrayContaining(['🥎 Softball', '⚾ Baseball']));
    expect(chipTexts(wrapper).some((t) => t.includes('Sports'))).toBe(false);
  });

  it('finds items by a keyword, including a Chinese one', async () => {
    const wrapper = factory({ searchable: true });
    await wrapper.find('input').setValue('pool');
    expect(wrapper.text()).toContain('Swimming');
    await wrapper.find('input').setValue('游泳');
    expect(wrapper.text()).toContain('Swimming');
    expect(wrapper.text()).not.toContain('Softball');
  });

  it('says so when nothing matches', async () => {
    const wrapper = factory({ searchable: true });
    await wrapper.find('input').setValue('zzz');
    // The mocked t() echoes the key; the query is filled into it.
    expect(wrapper.text()).toContain('modal.noCategoryMatch');
    expect(wrapper.findAll('button').filter((b) => b.text().includes('Softball'))).toHaveLength(0);
  });

  it('picking a result emits it and clears the query', async () => {
    const wrapper = factory({ searchable: true });
    const input = wrapper.find('input');
    await input.setValue('date');
    const chip = wrapper.findAll('button').find((b) => b.text().includes('Playdate'))!;
    await chip.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['playdate']]);
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('');
  });

  it('the clear button empties the query', async () => {
    const wrapper = factory({ searchable: true });
    await wrapper.find('input').setValue('ball');
    const clear = wrapper.find('button[aria-label="action.clear"]');
    expect(clear.exists()).toBe(true);
    await clear.trigger('click');
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('');
    expect(chipTexts(wrapper)).toEqual(['⚽ Sports', '🎉 Social']);
  });
});

describe('GroupedChipPicker without search (the milestone picker)', () => {
  it('renders no search control at all', () => {
    expect(factory().find('input').exists()).toBe(false);
    expect(factory().find('label').exists()).toBe(false);
    expect(factory({ modelValue: 'baseball' }).find('input').exists()).toBe(false);
  });

  it('keeps the unselected and selected chip classes, with the dark lift on selected', () => {
    const wrapper = factory({ modelValue: 'baseball' });
    const buttons = wrapper.findAll('button');
    // [0] the expanded group chip, then the group's items.
    const groupCls = buttons[0]!.classes().join(' ');
    expect(groupCls).toContain('text-primary-500');
    expect(groupCls).toContain('dark:text-accent-lift');

    const selected = buttons
      .find((b) => b.text().includes('Baseball'))!
      .classes()
      .join(' ');
    expect(selected).toContain('border-primary-500');
    expect(selected).toContain('text-primary-500');
    expect(selected).toContain('dark:text-accent-lift');
    expect(selected).toContain('dark:bg-primary-500/15');
    expect(selected).toContain('bg-[var(--tint-orange-8)]');
    expect(selected).toContain('border-2');

    const unselected = buttons
      .find((b) => b.text().includes('Softball'))!
      .classes()
      .join(' ');
    expect(unselected).toContain('border-transparent');
    expect(unselected).toContain('bg-[var(--tint-slate-5)]');
    expect(unselected).toContain('text-[var(--color-text-muted)]');
    expect(unselected).toContain('dark:bg-surface-overlay');
    expect(unselected).toContain('dark:text-ink-soft');
    expect(unselected).toContain('hover:bg-[var(--tint-slate-10)]');
  });

  it('a chip click emits its value', async () => {
    const wrapper = factory({ modelValue: 'baseball' });
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Softball'))!
      .trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['softball']]);
  });
});
