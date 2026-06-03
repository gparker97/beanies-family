/**
 * Unit tests for the #133 consent modal's own logic: the optional "remember" checkbox,
 * the confirm payload, and the reset-on-open guarantee. BeanieFormModal is stubbed to a
 * minimal save/close emitter — we're testing THIS component's behaviour, not the shell.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import DocumentExtractConsentModal from '../DocumentExtractConsentModal.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Minimal stub: renders the slot (so the checkbox is in the DOM) + buttons that fire the
// save/close events our component wires to.
const BeanieFormModalStub = {
  name: 'BeanieFormModal',
  props: ['open', 'title', 'saveLabel', 'icon', 'iconBg', 'variant', 'size'],
  emits: ['save', 'close'],
  template:
    '<div v-if="open"><slot /><button class="t-save" @click="$emit(\'save\')">save</button><button class="t-close" @click="$emit(\'close\')">close</button></div>',
};

function mountModal(open = true) {
  return mount(DocumentExtractConsentModal, {
    props: { open, tier: 'managed' as const },
    global: { stubs: { BeanieFormModal: BeanieFormModalStub } },
  });
}

describe('DocumentExtractConsentModal (#133)', () => {
  it('confirm emits remember=false when the box is untouched', async () => {
    const wrapper = mountModal();
    await wrapper.find('button.t-save').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[false]]);
  });

  it('confirm emits remember=true when the box is ticked', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[type="checkbox"]').setValue(true);
    await wrapper.find('button.t-save').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[true]]);
  });

  it('resets the tick on each open so it never carries across reopen', async () => {
    const wrapper = mountModal(true);
    await wrapper.find('input[type="checkbox"]').setValue(true);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await wrapper.find('button.t-save').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[false]]);
  });

  it('cancel emits on close', async () => {
    const wrapper = mountModal();
    await wrapper.find('button.t-close').trigger('click');
    expect(wrapper.emitted('cancel')).toBeTruthy();
  });

  it('renders the consent label but NOT the privacy link until the help article is live', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('ai.consent.remember');
    // PRIVACY_ARTICLE_LIVE is false → the link button is not rendered (no 404).
    expect(wrapper.text()).not.toContain('ai.consent.privacyLink');
  });
});
