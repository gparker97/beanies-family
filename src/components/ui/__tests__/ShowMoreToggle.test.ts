import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ShowMoreToggle from '../ShowMoreToggle.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ShowMoreToggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders the "more" button and emits show-more on click', async () => {
    const wrapper = mount(ShowMoreToggle, {
      props: { canShowMore: true, moreLabel: 'Show all 9' },
    });
    expect(wrapper.findAll('button')).toHaveLength(1);
    expect(wrapper.text()).toContain('Show all 9');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('show-more')).toHaveLength(1);
    expect(wrapper.emitted('show-less')).toBeUndefined();
  });

  it('renders the "less" button (default label = t(action.showLess)) and emits show-less', async () => {
    const wrapper = mount(ShowMoreToggle, {
      props: { canShowMore: false, canShowLess: true, moreLabel: 'unused' },
    });
    expect(wrapper.findAll('button')).toHaveLength(1);
    expect(wrapper.text()).toContain('action.showLess'); // mocked t() echoes the key
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('show-less')).toHaveLength(1);
  });

  it('renders both buttons mid-expansion (incremental mode)', () => {
    const wrapper = mount(ShowMoreToggle, {
      props: {
        canShowMore: true,
        canShowLess: true,
        moreLabel: 'View more',
        lessLabel: 'Show less',
      },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.text()).toContain('View more');
    expect(buttons[1]!.text()).toContain('Show less');
  });

  it('renders nothing when neither flag is set', () => {
    const wrapper = mount(ShowMoreToggle, {
      props: { canShowMore: false, canShowLess: false, moreLabel: 'x' },
    });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('applies the requested tone', () => {
    const onAccent = mount(ShowMoreToggle, {
      props: { canShowMore: true, moreLabel: 'x', tone: 'on-accent' },
    });
    expect(onAccent.find('button').classes().join(' ')).toContain('text-white');
    const onLight = mount(ShowMoreToggle, { props: { canShowMore: true, moreLabel: 'x' } }); // default
    expect(onLight.find('button').classes()).toContain('text-primary-500');
  });
});
