import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import HamburgerButton from '../HamburgerButton.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('HamburgerButton', () => {
  it('renders a labelled menu button and emits click', async () => {
    const wrapper = mount(HamburgerButton);
    const btn = wrapper.get('button');
    expect(btn.attributes('aria-label')).toBe('mobile.menu');
    await btn.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});
