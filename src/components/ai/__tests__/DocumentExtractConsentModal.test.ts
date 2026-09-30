/**
 * Unit tests for the #133 consent modal's own logic: the optional "remember" checkbox, the
 * resolution payload, and the reset-on-open guarantee. BeanieFormModal is stubbed to a
 * minimal save/close emitter — we're testing THIS component's behaviour, not the shell.
 *
 * The modal became SELF-CONTAINED in #64: no props, no emits. It reads `consentOpen` from the
 * `useDocumentConsent` singleton and the tier from `useAiCapability`, and settles the gate
 * itself. The tests therefore drive it through the singleton — the same way the app does —
 * and assert on what `requestConsent()` resolves to, which is the behaviour callers depend on.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import DocumentExtractConsentModal from '../DocumentExtractConsentModal.vue';
import { requestConsent, resolveConsent } from '@/composables/useDocumentConsent';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useAiCapability', () => ({
  useAiCapability: () => ({
    tier: { value: 'managed' },
    // #95: the read-only refusal runs first in requestConsent; a writable family passes.
    refuseManagedReadIfReadOnly: () => false,
  }),
}));

const setSkip = vi.fn().mockResolvedValue(undefined);
let skipPrompt = false;
let ingredientsAckAt: string | null = null;
const acknowledgeIngredients = vi.fn(async () => {
  ingredientsAckAt = '2026-09-30T00:00:00.000Z';
});
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get skipDocumentConsentPrompt() {
      return skipPrompt;
    },
    get aiIngredientsConsentAcknowledgedAt() {
      return ingredientsAckAt;
    },
    setSkipDocumentConsentPrompt: setSkip,
    acknowledgeIngredientsConsent: acknowledgeIngredients,
  }),
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

function mountModal() {
  return mount(DocumentExtractConsentModal, {
    global: { stubs: { BeanieFormModal: BeanieFormModalStub } },
  });
}

/** Opening is asynchronous: a request waits for any prompt ahead of it before opening. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('DocumentExtractConsentModal (#133, singleton form #64)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    skipPrompt = false;
    ingredientsAckAt = null;
    setSkip.mockClear();
    acknowledgeIngredients.mockClear();
    // Settle anything a previous test left pending so state cannot leak between cases, then
    // let the serialization tail drain (a request now waits for any prompt ahead of it).
    resolveConsent(false);
    await flush();
    resolveConsent(false);
  });

  it('grants consent and does not persist the skip when the box is untouched', async () => {
    const wrapper = mountModal();
    const pending = requestConsent();
    await flush();
    await wrapper.vm.$nextTick();

    await wrapper.find('button.t-save').trigger('click');

    expect(await pending).not.toBeNull();
    expect(setSkip).not.toHaveBeenCalled();
  });

  it('persists the family-scoped skip when the box is ticked', async () => {
    const wrapper = mountModal();
    const pending = requestConsent();
    await flush();
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="checkbox"]').setValue(true);
    await wrapper.find('button.t-save').trigger('click');

    expect(await pending).not.toBeNull();
    expect(setSkip).toHaveBeenCalledWith(true);
  });

  it('resets the tick on each open so it never carries across reopen', async () => {
    const wrapper = mountModal();

    const first = requestConsent();
    await flush();
    await wrapper.vm.$nextTick();
    await wrapper.find('input[type="checkbox"]').setValue(true);
    resolveConsent(false);
    await first;
    setSkip.mockClear();

    const second = requestConsent();
    await flush();
    await wrapper.vm.$nextTick();
    await wrapper.find('button.t-save').trigger('click');

    expect(await second).not.toBeNull();
    // The tick did not survive the reopen, so nothing was persisted.
    expect(setSkip).not.toHaveBeenCalled();
  });

  it('declines on close', async () => {
    const wrapper = mountModal();
    const pending = requestConsent();
    await flush();
    await wrapper.vm.$nextTick();

    await wrapper.find('button.t-close').trigger('click');

    expect(await pending).toBeNull();
  });

  it('renders the consent label', async () => {
    const wrapper = mountModal();
    void requestConsent();
    await flush();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('ai.consent.remember');
    expect(wrapper.text()).not.toContain('ai.consent.privacyLink');
  });

  it('the ingredients variant says only the list lines are sent (#116)', async () => {
    const wrapper = mountModal();
    void requestConsent({ kind: 'ingredients' });
    await flush();
    await wrapper.vm.$nextTick();

    // The generic line promises "never any of your family's data", which Find Duplicates is not.
    expect(wrapper.text()).toContain('ai.consent.ingredients.whatValue');
    expect(wrapper.text()).not.toContain('ai.consent.whatValue');
    // A free list tidy, not a document read: its own intro, after line and button.
    expect(wrapper.text()).toContain('ai.consent.ingredients.intro');
    expect(wrapper.text()).not.toContain('ai.consent.intro');
    expect(wrapper.text()).toContain('ai.consent.ingredients.afterValue');
    expect(wrapper.text()).not.toContain('ai.consent.afterValue');
    const modal = wrapper.findComponent({ name: 'BeanieFormModal' });
    expect(modal.props('saveLabel')).toBe('ai.consent.ingredients.confirm');
    expect(modal.props('title')).toBe('ai.consent.title');
    resolveConsent(false);
  });

  it('the ingredients "don\'t ask again" has its own line and never skips the generic prompt (#116)', async () => {
    const wrapper = mountModal();
    const pending = requestConsent({ kind: 'ingredients' });
    await flush();
    await wrapper.vm.$nextTick();

    // "process the documents I choose" is not what this prompt is about.
    expect(wrapper.text()).toContain('ai.consent.ingredients.remember');
    expect(wrapper.text()).not.toContain('ai.consent.remember');

    await wrapper.find('input[type="checkbox"]').setValue(true);
    await wrapper.find('button.t-save').trigger('click');
    expect(await pending).not.toBeNull();
    expect(acknowledgeIngredients).toHaveBeenCalledTimes(1);
    expect(setSkip).not.toHaveBeenCalled();

    // The generic photo/document prompt still asks, with its own line.
    const generic = requestConsent();
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('ai.consent.remember');
    await wrapper.find('button.t-close').trigger('click');
    expect(await generic).toBeNull();

    // And the ingredients prompt itself is now skipped.
    expect(await requestConsent({ kind: 'ingredients' })).not.toBeNull();
    expect(wrapper.text()).not.toContain('ai.consent.ingredients.intro');
  });
});
