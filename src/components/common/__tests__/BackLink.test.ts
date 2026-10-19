import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';

const goBack = vi.fn();
vi.mock('@/composables/useAppBack', () => ({ useAppBack: () => ({ goBack }) }));

import BackLink from '../BackLink.vue';

describe('BackLink', () => {
  it('renders the label, takes the call-site class, and goes back with its fallback', async () => {
    const wrapper = mount(BackLink, {
      props: { fallback: '/pod', label: 'Back to Pod' },
      attrs: { class: 'mb-3' },
    });
    expect(wrapper.text()).toContain('Back to Pod');
    expect(wrapper.classes()).toContain('mb-3');
    await wrapper.trigger('click');
    expect(goBack).toHaveBeenCalledWith('/pod', { onlyTo: undefined });
  });

  it('passes `onlyTo` through, so a link that names a place goes back only to it', async () => {
    goBack.mockClear();
    const wrapper = mount(BackLink, {
      props: { fallback: { path: '/travel' }, label: 'All trips', onlyTo: '/travel' },
    });
    await wrapper.trigger('click');
    expect(goBack).toHaveBeenCalledWith({ path: '/travel' }, { onlyTo: '/travel' });
  });

  it('never dims its text with an opacity modifier, and lifts on dark hover', () => {
    const wrapper = mount(BackLink, { props: { fallback: '/pod', label: 'Back' } });
    const cls = wrapper.attributes('class') ?? '';
    expect(cls).not.toMatch(/text-[\w-]+\/\d+/);
    expect(cls).toContain('dark:text-ink-soft');
    expect(cls).toContain('dark:hover:text-accent-lift');
  });
});
