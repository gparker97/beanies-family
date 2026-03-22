import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import BeanieFormModal from '../BeanieFormModal.vue';
import BaseSidePanel from '../BaseSidePanel.vue';
import BaseModal from '../BaseModal.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({
    isMobile: { value: false },
  }),
}));

describe('BeanieFormModal', () => {
  const baseProps = { open: true, title: 'Test Title' };

  afterEach(() => {
    // Clean up teleported content
    document.body.innerHTML = '';
  });

  it('renders BaseModal by default', () => {
    const wrapper = mount(BeanieFormModal, { props: baseProps });
    expect(wrapper.findComponent(BaseModal).exists()).toBe(true);
    expect(wrapper.findComponent(BaseSidePanel).exists()).toBe(false);
  });

  it('renders BaseSidePanel when variant="drawer"', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { ...baseProps, variant: 'drawer' },
    });
    expect(wrapper.findComponent(BaseSidePanel).exists()).toBe(true);
    expect(wrapper.findComponent(BaseModal).exists()).toBe(false);
  });

  it('maps size correctly for modal variant', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { ...baseProps, size: 'wide' },
    });
    expect(wrapper.findComponent(BaseModal).props('size')).toBe('2xl');
  });

  it('maps size correctly for drawer variant', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { ...baseProps, variant: 'drawer', size: 'wide' },
    });
    expect(wrapper.findComponent(BaseSidePanel).props('size')).toBe('wide');
  });

  it('passes closable=false when isSubmitting', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { ...baseProps, variant: 'drawer', isSubmitting: true },
    });
    expect(wrapper.findComponent(BaseSidePanel).props('closable')).toBe(false);
  });

  it('passes closable=true when not submitting', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { ...baseProps, variant: 'drawer' },
    });
    expect(wrapper.findComponent(BaseSidePanel).props('closable')).toBe(true);
  });

  it('renders branded content in drawer mode', () => {
    mount(BeanieFormModal, {
      props: { ...baseProps, variant: 'drawer', icon: '📋', showDelete: true },
    });
    // Content is teleported to document.body
    const body = document.body.textContent ?? '';
    expect(body).toContain('📋');
    expect(body).toContain('Test Title');
    expect(body).toContain('🗑️');
    expect(body).toContain('action.save');
  });
});
