import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ToggleRow from '../ToggleRow.vue';

describe('ToggleRow', () => {
  it('renders title and hint, and names the switch after the title', () => {
    const w = mount(ToggleRow, {
      props: { modelValue: false, title: 'Repeat', hint: 'Off', testid: 'todo-repeat' },
    });
    expect(w.text()).toContain('Repeat');
    expect(w.text()).toContain('Off');
    const sw = w.get('[role="switch"]');
    expect(sw.attributes('aria-label')).toBe('Repeat');
    expect(sw.attributes('data-testid')).toBe('todo-repeat');
    expect(sw.attributes('aria-checked')).toBe('false');
  });

  it('emits update:modelValue when the switch is toggled', async () => {
    const w = mount(ToggleRow, { props: { modelValue: true, title: 'Repeat' } });
    await w.get('[role="switch"]').trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('does not emit when disabled', async () => {
    const w = mount(ToggleRow, { props: { modelValue: false, title: 'Repeat', disabled: true } });
    await w.get('[role="switch"]').trigger('click');
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it('omits the hint line when empty and renders the default slot', () => {
    const w = mount(ToggleRow, {
      props: { modelValue: false, title: 'Repeat' },
      slots: { default: '<span data-testid="extra">weekly on Wed</span>' },
    });
    expect(w.findAll('p')).toHaveLength(1);
    expect(w.get('[data-testid="extra"]').text()).toBe('weekly on Wed');
  });
});
