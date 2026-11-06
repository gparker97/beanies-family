import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import NotifyParentsToggle from '../NotifyParentsToggle.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('NotifyParentsToggle', () => {
  it('renders the title and the off hint, with the switch carrying the test id', () => {
    const w = mount(NotifyParentsToggle, { props: { modelValue: false, testid: 'np' } });
    expect(w.text()).toContain('recurrence.notifyParents.title');
    expect(w.text()).toContain('recurrence.notifyParents.hintOff');
    expect(w.get('[role="switch"]').attributes('data-testid')).toBe('np');
    expect(w.get('[role="switch"]').attributes('aria-checked')).toBe('false');
  });

  it('shows the on hint when on', () => {
    const w = mount(NotifyParentsToggle, { props: { modelValue: true } });
    expect(w.text()).toContain('recurrence.notifyParents.hintOn');
    expect(w.text()).not.toContain('recurrence.notifyParents.hintOff');
  });

  it('emits update:modelValue when toggled', async () => {
    const w = mount(NotifyParentsToggle, { props: { modelValue: false } });
    await w.get('[role="switch"]').trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([[true]]);
  });

  it('readonly renders only the hint paragraph, no switch', () => {
    const w = mount(NotifyParentsToggle, {
      props: { modelValue: true, readonly: true, testid: 'ro' },
    });
    expect(w.find('[role="switch"]').exists()).toBe(false);
    expect(w.findAll('p')).toHaveLength(1);
    const p = w.get('[data-testid="ro"]');
    expect(p.text()).toBe('recurrence.notifyParents.hintOn');
    expect(w.text()).not.toContain('recurrence.notifyParents.title');
  });
});
