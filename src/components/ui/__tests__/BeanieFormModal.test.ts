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

  describe('saveReady — the not-ready Save still answers a tap', () => {
    // The panel teleports to <body>, so the button is found in the document, not the wrapper.
    const saveButton = () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('action.save'))!;

    it('draws a not-ready Save neutral, with no white ink, gradient or hover shadow', () => {
      for (const saveGradient of ['orange', 'purple', 'teal'] as const) {
        const w = mount(BeanieFormModal, {
          props: { ...baseProps, saveReady: false, saveGradient },
          attachTo: document.body,
        });
        const cls = [...saveButton().classList];
        expect(cls).toContain('bg-[var(--tint-slate-10)]');
        expect(cls).not.toContain('text-white');
        expect(cls).not.toContain('hover:shadow-md');
        expect(cls).not.toContain('bg-gradient-to-r');
        w.unmount();
        document.body.innerHTML = '';
      }
    });

    it('is still clickable and still emits save — it is not disabled', async () => {
      const w = mount(BeanieFormModal, {
        props: { ...baseProps, saveReady: false },
        attachTo: document.body,
      });
      const btn = saveButton();
      expect(btn.hasAttribute('disabled')).toBe(false);
      btn.click();
      expect(w.emitted('save')).toHaveLength(1);
    });

    it("keeps today's gradient when ready", () => {
      mount(BeanieFormModal, { props: baseProps, attachTo: document.body });
      const cls = [...saveButton().classList];
      expect(cls).toContain('text-white');
      expect(cls).toContain('bg-gradient-to-r');
    });
  });

  describe('deleteDisabledReason', () => {
    const deleteTile = () =>
      document.body.querySelector<HTMLButtonElement>('[data-testid="form-modal-delete"]');
    const reason = () => document.body.querySelector('[data-testid="form-modal-delete-reason"]');

    it('renders no delete tile by default', () => {
      mount(BeanieFormModal, { props: baseProps, attachTo: document.body });
      expect(deleteTile()).toBeNull();
    });

    it('showDelete renders an enabled tile with no reason badge', async () => {
      const w = mount(BeanieFormModal, {
        props: { ...baseProps, showDelete: true },
        attachTo: document.body,
      });
      expect(deleteTile()!.disabled).toBe(false);
      expect(reason()).toBeNull();
      deleteTile()!.click();
      expect(w.emitted('delete')).toHaveLength(1);
    });

    it('renders the tile disabled with an InfoHintBadge carrying the reason', () => {
      const w = mount(BeanieFormModal, {
        props: { ...baseProps, deleteDisabledReason: 'Built-in cards stay in the deck.' },
        attachTo: document.body,
      });
      expect(deleteTile()!.disabled).toBe(true);
      expect(reason()).not.toBeNull();
      const badge = w.findComponent({ name: 'InfoHintBadge' });
      expect(badge.props('text')).toBe('Built-in cards stay in the deck.');
      deleteTile()!.click();
      expect(w.emitted('delete')).toBeUndefined();
    });
  });
});
