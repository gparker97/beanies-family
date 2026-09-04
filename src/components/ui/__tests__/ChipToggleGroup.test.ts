import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import ChipToggleGroup from '../ChipToggleGroup.vue';
import type { ChipOption } from '../FrequencyChips.vue';

const OPTIONS: ChipOption[] = [
  { value: 'breakfast', label: 'Breakfast', icon: '🍳' },
  { value: 'lunch', label: 'Lunch', icon: '🥪' },
  { value: 'dinner', label: 'Dinner', icon: '🍽️' },
];

function factory(modelValue: string[] = [], props: Record<string, unknown> = {}) {
  return mount(ChipToggleGroup, { props: { modelValue, options: OPTIONS, ...props } });
}

describe('ChipToggleGroup', () => {
  it('adds a value on first tap', async () => {
    const wrapper = factory([]);
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['lunch']]);
  });

  it('removes a value on second tap', async () => {
    const wrapper = factory(['lunch', 'dinner']);
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['dinner']]);
  });

  it('preserves the other selections when adding', async () => {
    const wrapper = factory(['breakfast']);
    await wrapper.findAll('button')[2]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['breakfast', 'dinner']]);
  });

  it('emits a NEW array rather than mutating the prop', async () => {
    const original = ['breakfast'];
    const wrapper = factory(original);
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(original).toEqual(['breakfast']);
    expect(wrapper.emitted('update:modelValue')![0]![0]).not.toBe(original);
  });

  it('marks every selected chip, not just one', () => {
    const wrapper = factory(['breakfast', 'dinner']);
    const selected = wrapper
      .findAll('button')
      .map((b) => b.classes().join(' ').includes('border-primary-500'));
    expect(selected).toEqual([true, false, true]);
  });

  it('renders nothing selected for an empty value', () => {
    const wrapper = factory([]);
    for (const btn of wrapper.findAll('button')) {
      expect(btn.classes().join(' ')).not.toContain('border-primary-500');
    }
  });

  it('does not emit when the group is disabled', async () => {
    const wrapper = factory([], { disabled: true });
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('scrolls on one row when asked, instead of wrapping', () => {
    const cls = factory([], { layout: 'scroll' }).find('div').classes();
    expect(cls).toContain('flex-nowrap');
    expect(cls).toContain('overflow-x-auto');
    expect(cls).not.toContain('flex-wrap');
  });
});
