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
import { confirm, confirmChoice, useConfirm } from '@/composables/useConfirm';
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

  it('shows the real info icon, NOT the unknown-name placeholder', async () => {
    // ⚠️ THE BUG THIS PINS was visible in the product for as long as this modal has existed.
    // `ConfirmModal` asks for `info` on its non-danger variant, but no `info` icon was ever
    // registered — so `BeanieIcon` fell back to its deliberately-quiet unknown-name placeholder
    // (a circle with three dots) on roughly two dozen confirms and alerts across the app. The
    // placeholder path is the fingerprint: three `h.01` dots before the circle.
    const PLACEHOLDER = 'M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
    void confirm({ ...base });
    const w = mountModal();
    await nextTick();

    const paths = w.findAll('svg path').map((p) => p.attributes('d'));
    expect(paths).not.toContain(PLACEHOLDER);
    expect(paths.some((d) => d?.startsWith('M12 16v-4M12 8h.01'))).toBe(true);
    useConfirm().handleCancel();
  });

  it('renders a mascot INSTEAD of the icon squircle when one is given', async () => {
    const MASCOT = '/brand/beanies_family_hugging_transparent_512x512.png';
    void confirm({ ...base, mascotSrc: MASCOT });
    const w = mountModal();
    await nextTick();

    const img = w.find(`img[src="${MASCOT}"]`);
    expect(img.exists()).toBe(true);
    // Decorative: the title and message carry the meaning.
    expect(img.attributes('alt')).toBe('');
    expect(img.attributes('aria-hidden')).toBe('true');
    // The squircle must be GONE, not merely hidden behind it. Identified by the icon it holds,
    // since `.rounded-2xl` also matches unrelated chrome in this sheet.
    expect(w.find('.h-12.w-12.rounded-2xl').exists()).toBe(false);
    useConfirm().handleCancel();
  });

  it('falls back to the squircle when no mascot is given, which is every other caller', async () => {
    void confirm({ ...base });
    const w = mountModal();
    await nextTick();

    expect(w.find('img[src^="/brand/"]').exists()).toBe(false);
    expect(w.find('.h-12.w-12.rounded-2xl').exists()).toBe(true);
    useConfirm().handleCancel();
  });

  it('cancelling still resolves false with an href present', async () => {
    const w = mountModal();
    const answer = confirm({ ...base, confirmHref: STORE });
    await nextTick();
    await w.findAll('button')[0]!.trigger('click');
    await expect(answer).resolves.toBe(false);
  });

  describe('choices', () => {
    const choices = [
      { id: 'keep', label: 'Keep my own cards' },
      { id: 'clear', label: 'Clear my own cards' },
    ];

    it('renders a radio group with the default selected, and confirm() still resolves a boolean', async () => {
      const w = mountModal();
      const answer = confirm({ ...base, choices, defaultChoice: 'keep' });
      await nextTick();

      const radios = w.findAll<HTMLInputElement>(
        '[data-testid="confirm-choices"] input[type="radio"]'
      );
      expect(radios).toHaveLength(2);
      expect(radios[0]!.element.checked).toBe(true);
      expect(w.text()).toContain('Clear my own cards');

      await confirmControl(w).trigger('click');
      await expect(answer).resolves.toBe(true);
    });

    it('confirmChoice resolves the picked choice on confirm', async () => {
      const w = mountModal();
      const answer = confirmChoice({ ...base, choices, defaultChoice: 'keep' });
      await nextTick();

      await w.findAll('[data-testid="confirm-choices"] input[type="radio"]')[1]!.setValue(true);
      await confirmControl(w).trigger('click');
      await expect(answer).resolves.toBe('clear');
    });

    it('confirmChoice resolves null on cancel', async () => {
      mountModal();
      const answer = confirmChoice({ ...base, choices, defaultChoice: 'keep' });
      await nextTick();
      useConfirm().handleCancel();
      await expect(answer).resolves.toBeNull();
    });

    it('confirmChoice without choices resolves the default on confirm', async () => {
      const w = mountModal();
      const answer = confirmChoice({ ...base, defaultChoice: 'keep' });
      await nextTick();
      expect(w.find('[data-testid="confirm-choices"]').exists()).toBe(false);
      await confirmControl(w).trigger('click');
      await expect(answer).resolves.toBe('keep');
    });

    it('a plain confirm after a choices confirm renders no radio group', async () => {
      const w = mountModal();
      const first = confirmChoice({ ...base, choices, defaultChoice: 'keep' });
      await nextTick();
      expect(w.find('[data-testid="confirm-choices"]').exists()).toBe(true);
      await confirmControl(w).trigger('click');
      await first;

      void confirm({ title: base.title, message: base.message });
      await nextTick();
      expect(w.find('[data-testid="confirm-choices"]').exists()).toBe(false);
      expect(useConfirm().state.value.selectedChoice).toBeUndefined();
    });
  });
});
