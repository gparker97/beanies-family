import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AllDayChip from '../AllDayChip.vue';

const base = { title: 'Vesak Day', color: '#b5654a', bgColor: 'rgb(181 101 74 / 7%)' };

describe('AllDayChip', () => {
  it('renders the title (default slot) + leading emoji on the start cell', () => {
    const wrapper = mount(AllDayChip, {
      props: { ...base, leadingEmoji: '🇸🇬', isStart: true, isEnd: true },
    });
    expect(wrapper.text()).toContain('🇸🇬');
    expect(wrapper.text()).toContain('Vesak Day');
    expect(wrapper.attributes('title')).toBe('Vesak Day');
    expect(wrapper.classes()).toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('renders the slot content over the title fallback when a slot is provided', () => {
    const wrapper = mount(AllDayChip, {
      props: { ...base, isStart: true, isEnd: true },
      slots: { default: 'Custom <b>label</b>' },
    });
    expect(wrapper.text()).toContain('Custom');
    expect(wrapper.text()).not.toContain('Vesak Day');
  });

  it('hides the label on a multi-day middle cell and renders square corners', () => {
    const wrapper = mount(AllDayChip, { props: { ...base, isStart: false, isEnd: false } });
    expect(wrapper.text()).not.toContain('Vesak Day');
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).not.toContain('rounded-r-md');
  });

  it('rounds right only on a multi-day end cell', () => {
    const wrapper = mount(AllDayChip, { props: { ...base, isStart: false, isEnd: true } });
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('applies the italic class when italic is set', () => {
    const wrapper = mount(AllDayChip, {
      props: { ...base, italic: true, isStart: true, isEnd: true },
    });
    expect(wrapper.classes()).toContain('italic');
  });

  it('uses the testid prop for the root data-testid (default "all-day-chip")', () => {
    expect(
      mount(AllDayChip, { props: { ...base, isStart: true, isEnd: true } }).attributes(
        'data-testid'
      )
    ).toBe('all-day-chip');
    expect(
      mount(AllDayChip, {
        props: { ...base, isStart: true, isEnd: true, testid: 'holiday-chip' },
      }).attributes('data-testid')
    ).toBe('holiday-chip');
  });

  it('emits click with the native MouseEvent', async () => {
    const wrapper = mount(AllDayChip, { props: { ...base, isStart: true, isEnd: true } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});
