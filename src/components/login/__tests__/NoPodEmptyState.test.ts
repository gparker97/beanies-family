import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import NoPodEmptyState from '../NoPodEmptyState.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('NoPodEmptyState', () => {
  describe('account email rendering', () => {
    it('renders the account email when prop is set', () => {
      const wrapper = mount(NoPodEmptyState, {
        props: { accountEmail: 'gpsp2001@gmail.com' },
      });
      expect(wrapper.text()).toContain('gpsp2001@gmail.com');
    });

    it('omits the account email when prop is undefined', () => {
      const wrapper = mount(NoPodEmptyState);
      expect(wrapper.text()).not.toContain('@');
    });
  });

  describe('CTA emits', () => {
    it("emits 'create' when the Create CTA is clicked", async () => {
      const wrapper = mount(NoPodEmptyState);
      await wrapper.find('[data-testid="no-pod-create-cta"]').trigger('click');
      expect(wrapper.emitted('create')).toHaveLength(1);
    });

    it("emits 'switch-account' when the Switch Account CTA is clicked", async () => {
      const wrapper = mount(NoPodEmptyState);
      await wrapper.find('[data-testid="no-pod-switch-account-cta"]').trigger('click');
      expect(wrapper.emitted('switch-account')).toHaveLength(1);
    });

    it("emits 'load-local' when the Load Local CTA is clicked", async () => {
      const wrapper = mount(NoPodEmptyState);
      await wrapper.find('[data-testid="no-pod-load-local-cta"]').trigger('click');
      expect(wrapper.emitted('load-local')).toHaveLength(1);
    });
  });

  describe('text-link emits', () => {
    it("emits 'retry' when the retry hint is clicked", async () => {
      const wrapper = mount(NoPodEmptyState);
      await wrapper.find('[data-testid="no-pod-retry-hint"]').trigger('click');
      expect(wrapper.emitted('retry')).toHaveLength(1);
    });

    it('renders the join hint as non-interactive copy (no emit)', () => {
      const wrapper = mount(NoPodEmptyState);
      const joinHint = wrapper.find('[data-testid="no-pod-join-hint"]');
      // Join hint is advisory copy — user has to act offline (ask family
      // owner for a link); this app can't help. Should be a <p>, not a
      // button.
      expect(joinHint.element.tagName).toBe('P');
    });
  });
});
