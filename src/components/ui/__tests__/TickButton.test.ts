import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TickButton from '../TickButton.vue';

describe('TickButton', () => {
  it('reflects selection in aria-pressed and carries its label', async () => {
    const wrapper = mount(TickButton, { props: { selected: false, label: 'Swim class' } });
    const btn = wrapper.find('button');
    expect(btn.attributes('type')).toBe('button');
    expect(btn.attributes('aria-pressed')).toBe('false');
    expect(btn.attributes('aria-label')).toBe('Swim class');

    await wrapper.setProps({ selected: true });
    expect(btn.attributes('aria-pressed')).toBe('true');
  });

  it('emits toggle on click', async () => {
    const wrapper = mount(TickButton, { props: { selected: true, label: 'x' } });
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });

  it('does not emit when disabled', async () => {
    const wrapper = mount(TickButton, {
      props: { selected: false, disabled: true, label: 'x' },
    });
    const btn = wrapper.find('button');
    expect(btn.attributes('disabled')).toBeDefined();
    await btn.trigger('click');
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });
});
