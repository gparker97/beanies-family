/**
 * The consolidated "Sign In Another Device" sheet.
 *
 * ⚠️ THE TWO THINGS MOST WORTH PINNING HERE are both places this has already gone wrong:
 * that the SCAN branch is not PIN-gated (gating it would demand a PIN from someone who has
 * not chosen to do anything sensitive), and that picking scan opens the picker rather than
 * merely calling a handler — the previous menu item passed a handler test while being dead
 * on every device.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const requireReauth = vi.fn().mockResolvedValue(true);
const captureOpen = vi.fn().mockReturnValue(true);
// Hoisted so the test can assert the mint ORDER, not merely that the gate was called.
const mintRun = vi.fn();

vi.mock('@/composables/useReauth', () => ({
  requireReauth: (...a: unknown[]) => requireReauth(...a),
  canStepUp: () => true,
}));
vi.mock('@/composables/useQrCapture', () => ({
  useQrCapture: () => ({
    inputRef: { value: null },
    bindings: { type: 'file' },
    open: captureOpen,
    isBusy: { value: false },
    error: { value: null },
  }),
}));
vi.mock('@/composables/useMintedLink', () => ({
  useMintedLink: () => ({
    link: { value: '' },
    qr: { value: '' },
    isMinting: { value: false },
    errorKey: { value: null },
    qrUnavailable: { value: false },
    run: mintRun,
  }),
}));
vi.mock('@/services/auth/linkMint', () => ({ mintDeviceLink: vi.fn() }));

import SignInCodeSheet from '../SignInCodeSheet.vue';

function mountSheet() {
  setActivePinia(createPinia());
  return mount(SignInCodeSheet, {
    props: { open: true },
    global: { stubs: { BaseModal: { template: '<div><slot /></div>' }, Teleport: true } },
  });
}

function cardWith(wrapper: ReturnType<typeof mountSheet>, re: RegExp) {
  return wrapper.findAll('button').find((b) => re.test(b.text()));
}

describe('SignInCodeSheet — the chooser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers both directions', () => {
    const wrapper = mountSheet();
    expect(cardWith(wrapper, /create a magic link/i)).toBeTruthy();
    expect(cardWith(wrapper, /scan a qr code/i)).toBeTruthy();
  });

  it('does NOT ask for a PIN to scan a code', async () => {
    const wrapper = mountSheet();
    await cardWith(wrapper, /scan a qr code/i)!.trigger('click');

    // Scanning hands over nothing; its gate is at the approve step, not here.
    expect(requireReauth).not.toHaveBeenCalled();
    expect(captureOpen).toHaveBeenCalled();
  });

  it('asks for a PIN BEFORE minting, not alongside it', async () => {
    const wrapper = mountSheet();
    await cardWith(wrapper, /create a magic link/i)!.trigger('click');
    await wrapper.vm.$nextTick();

    // The link transports the family key and is not single-use. Asserting only that the
    // gate was called would stay green if a regression minted first and gated after —
    // which is exactly the ordering this consolidation moved.
    expect(requireReauth).toHaveBeenCalled();
    expect(mintRun).toHaveBeenCalled();
    expect(requireReauth.mock.invocationCallOrder[0]).toBeLessThan(
      mintRun.mock.invocationCallOrder[0]
    );
  });

  it('does NOT mint when the PIN is declined', async () => {
    requireReauth.mockResolvedValueOnce(false);
    const wrapper = mountSheet();
    await cardWith(wrapper, /create a magic link/i)!.trigger('click');
    await wrapper.vm.$nextTick();

    expect(mintRun).not.toHaveBeenCalled();
  });

  it('returns to the chooser when the PIN is declined, rather than closing', async () => {
    requireReauth.mockResolvedValueOnce(false);
    const wrapper = mountSheet();
    await cardWith(wrapper, /create a magic link/i)!.trigger('click');
    await wrapper.vm.$nextTick();

    // Closing here would make scanning unreachable to anyone who changed their mind.
    expect(cardWith(wrapper, /scan a qr code/i)).toBeTruthy();
    expect(wrapper.emitted('close')).toBeFalsy();
  });
});
