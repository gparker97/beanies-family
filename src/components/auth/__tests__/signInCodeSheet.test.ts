/**
 * The "Sign In Another Device" sheet.
 *
 * ⚠️ THERE IS NO CHOOSER ANY MORE. It used to open on two cards — create a code, or scan
 * one — and the second WAS the in-app scanner: it took a single photo through the OS picker
 * and decoded the file. greg confirmed on a production iPhone that it still failed where the
 * phone's own camera app succeeded instantly, so it was removed, and a chooser with one
 * option is not a choice. The pull direction did not go with it: the other device shows a
 * code and this one reads it with the NATIVE camera, which deep-links into the approval
 * sheet.
 *
 * ⚠️ WHAT IS STILL WORTH PINNING, because it has gone wrong before: the PIN is demanded
 * BEFORE the mint and not alongside it, and a declined PIN leaves the sheet open rather than
 * closing it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const requireReauth = vi.fn().mockResolvedValue(true);
// Hoisted so the test can assert the mint ORDER, not merely that the gate was called.
const mintRun = vi.fn();

vi.mock('@/composables/useReauth', () => ({
  requireReauth: (...a: unknown[]) => requireReauth(...a),
  canStepUp: () => true,
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

describe('SignInCodeSheet — straight to the mint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens straight on the mint, with no chooser to get through', () => {
    const wrapper = mountSheet();
    expect(wrapper.text().toLowerCase()).toContain('create a magic link');
    // The card whose only job was to open the in-app scanner.
    expect(wrapper.text().toLowerCase()).not.toContain('scan a qr code');
  });

  it('still tells you the camera works, since that is now the only scan route', () => {
    const wrapper = mountSheet();
    expect(wrapper.text().toLowerCase()).toContain('camera');
  });

  it('asks for a PIN BEFORE minting, not alongside it', async () => {
    const wrapper = mountSheet();
    await wrapper.find('button.w-full').trigger('click');
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
    await wrapper.find('button.w-full').trigger('click');
    await wrapper.vm.$nextTick();

    expect(mintRun).not.toHaveBeenCalled();
  });

  it('stays open when the PIN is declined, rather than closing', async () => {
    requireReauth.mockResolvedValueOnce(false);
    const wrapper = mountSheet();
    await wrapper.find('button.w-full').trigger('click');
    await wrapper.vm.$nextTick();

    // Closing on a declined gate would punish someone for changing their mind, and would
    // take the camera hint away with it.
    expect(wrapper.emitted('close')).toBeFalsy();
    expect(wrapper.text().toLowerCase()).toContain('create a magic link');
  });
});
