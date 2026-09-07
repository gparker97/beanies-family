/**
 * No test existed for this component before the Beanie List tiles started using it,
 * yet three call sites already depended on its default shape. These lock that default
 * so the generalisation cannot silently change Accounts or Transactions.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ActionButtons from '../ActionButtons.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('ActionButtons', () => {
  it('defaults to exactly edit + delete, with no copy button', () => {
    const wrapper = mount(ActionButtons);
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    expect(wrapper.findAll('[title="action.copy"]')).toHaveLength(0);
    expect(wrapper.find('[title="action.edit"]').exists()).toBe(true);
    expect(wrapper.find('[title="action.delete"]').exists()).toBe(true);
  });

  it('gives every button type="button" so it cannot submit an enclosing form', () => {
    const wrapper = mount(ActionButtons, { props: { showCopy: true } });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.attributes('type') === 'button')).toBe(true);
  });

  it('emits the action that was clicked', () => {
    const wrapper = mount(ActionButtons, { props: { showCopy: true } });
    wrapper.find('[title="action.copy"]').trigger('click');
    expect(wrapper.emitted('copy')).toHaveLength(1);
    expect(wrapper.emitted('edit')).toBeUndefined();
  });

  it('pairs the lg button box with the small glyph, not the lg glyph', () => {
    // BeanieIcon's `lg` is 24px, but the brand convention is a 36px button around a
    // 16px glyph. A bare `:size="size"` passthrough would get this wrong.
    const wrapper = mount(ActionButtons, { props: { size: 'lg' } });
    const button = wrapper.find('[title="action.edit"]');
    expect(button.classes()).toContain('h-9');
    expect(button.classes()).toContain('w-9');
    expect(button.find('svg').classes()).toContain('h-4');
  });

  it('keeps the sm default box unchanged for the existing call sites', () => {
    const wrapper = mount(ActionButtons);
    expect(wrapper.find('[title="action.edit"]').classes()).toContain('p-1.5');
  });
});
