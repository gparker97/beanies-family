/**
 * The confirm sheet's control, which is a button for every caller in the app
 * and an anchor for exactly one.
 *
 * ⚠️ THE DEFECT THIS PINS is a tap that appears to do nothing. `confirm()`
 * resolves a promise, so `if (await confirm(...)) openExternal(url)` resumes a
 * microtask after the click handler returned and the popup blocker treats the
 * navigation as programmatic. The anchor makes the browser's own default
 * action do the work. The button case is pinned just as hard, because that is
 * every existing call site in the app.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ConfirmModal from '../ConfirmModal.vue';
import { confirm, useConfirm } from '@/composables/useConfirm';
import type { UIStringKey } from '@/services/translation/uiStrings';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const STORE = 'https://apps.apple.com/app/id123';

function mountModal() {
  return mount(ConfirmModal, { global: { stubs: { teleport: true } } });
}

/** The confirm control is always the last control in the footer row. */
function confirmControl(w: ReturnType<typeof mountModal>) {
  const controls = w.findAll('button, a');
  return controls[controls.length - 1]!;
}

const base = {
  title: 'appUpdate.prompt.title' as UIStringKey,
  message: 'appUpdate.prompt.message' as UIStringKey,
  confirmLabel: 'appUpdate.prompt.confirm' as UIStringKey,
  cancelLabel: 'appUpdate.prompt.notNow' as UIStringKey,
  variant: 'info' as const,
};

describe('ConfirmModal', () => {
  beforeEach(() => setActivePinia(createPinia()));

  afterEach(() => {
    useConfirm().handleCancel();
    document.body.innerHTML = '';
  });

  it('renders a plain BUTTON when no href is given, which is every existing caller', async () => {
    const w = mountModal();
    void confirm({ title: base.title, message: base.message });
    await nextTick();
    const control = confirmControl(w);
    expect(control.element.tagName).toBe('BUTTON');
    expect(control.attributes('href')).toBeUndefined();
    expect(control.attributes('type')).toBe('button');
  });

  it('renders an ANCHOR to the store when an href is given, and still resolves', async () => {
    const w = mountModal();
    const answer = confirm({ ...base, confirmHref: STORE });
    await nextTick();
    const control = confirmControl(w);
    expect(control.element.tagName).toBe('A');
    expect(control.attributes('href')).toBe(STORE);
    expect(control.attributes('target')).toBe('_blank');
    expect(control.attributes('rel')).toBe('noopener noreferrer');
    await control.trigger('click');
    await expect(answer).resolves.toBe(true);
  });

  it('keeps the same classes either way, so the sheet does not change shape', async () => {
    const w = mountModal();
    void confirm({ ...base });
    await nextTick();
    const asButton = confirmControl(w).classes().sort();
    useConfirm().handleCancel();
    void confirm({ ...base, confirmHref: STORE });
    await nextTick();
    expect(confirmControl(w).classes().sort()).toEqual(asButton);
  });

  it('refuses a non-http(s) href and falls back to a button rather than rendering it', async () => {
    // Defence, not expectation: the one caller passes a frozen constant. But a
    // javascript: url reaching an href is the failure worth being sure about.
    const w = mountModal();
    void confirm({ ...base, confirmHref: 'javascript:alert(1)' });
    await nextTick();
    const control = confirmControl(w);
    expect(control.element.tagName).toBe('BUTTON');
    expect(control.attributes('href')).toBeUndefined();
  });

  it('cancelling still resolves false with an href present', async () => {
    const w = mountModal();
    const answer = confirm({ ...base, confirmHref: STORE });
    await nextTick();
    await w.findAll('button')[0]!.trigger('click');
    await expect(answer).resolves.toBe(false);
  });
});
