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
 *
 * ⚠️ THE FLOW IS NOW THREE STEPS, AND THE PIN MOVED. It used to be CTA -> PIN -> mint, with the
 * recipient defaulted to you and a small "create one for someone else" link that was easy to
 * miss. It is now CTA -> MANDATORY pick -> PIN -> mint, because picking the wrong person
 * DESTROYS the magic link they are holding (`memberLinkKeys` is newest-wins), so a defaulted
 * target made a mis-tap invisible. The PIN comes after the pick so nobody proves themselves for
 * an action they then abandon at the picker.
 *
 * ⚠️ SELECTORS ARE TESTIDS, NOT `button.w-full`. That class now matches the CTA and controls
 * inside the picker step, so a positional selector silently picks the wrong one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const requireReauth = vi.fn().mockResolvedValue(true);
// Hoisted so the test can assert the mint ORDER, not merely that the gate was called.
const mintRun = vi.fn();

const MEMBERS = [
  { id: 'me', name: 'Greg', requiresPassword: false, color: '#F15D22' },
  { id: 'sp', name: 'Mary', requiresPassword: false, color: '#AED6F1' },
];

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
// The pick step needs a roster and the permission that lets you mint for someone else.
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: [MEMBERS[0], MEMBERS[1]],
    sortedHumans: [MEMBERS[0], MEMBERS[1]],
  }),
}));
vi.mock('@/composables/usePermissions', async () => {
  const { computed } = await import('vue');
  return { usePermissions: () => ({ canManagePod: computed(() => true) }) };
});
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ currentUser: { memberId: 'me' } }),
}));

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

  it('does NOT ask for a PIN until a recipient has been chosen', async () => {
    const wrapper = mountSheet();
    await wrapper.find('[data-testid="magic-link-create"]').trigger('click');
    await wrapper.vm.$nextTick();

    // The CTA opens the pick step and nothing else. Prompting here would be asking someone to
    // prove themselves for an action they have not described yet.
    expect(requireReauth).not.toHaveBeenCalled();
    expect(mintRun).not.toHaveBeenCalled();
    expect(wrapper.text().toLowerCase()).toContain('which beanie is logging in');
  });

  it('asks for a PIN BEFORE minting, once a recipient is chosen', async () => {
    const wrapper = mountSheet();
    await wrapper.find('[data-testid="magic-link-create"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="magic-link-tile-sp"]').trigger('click');
    await wrapper.vm.$nextTick();
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
    await wrapper.find('[data-testid="magic-link-create"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="magic-link-tile-sp"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mintRun).not.toHaveBeenCalled();
  });

  it('stays open on the PICK step when the PIN is declined, rather than closing', async () => {
    requireReauth.mockResolvedValueOnce(false);
    const wrapper = mountSheet();
    await wrapper.find('[data-testid="magic-link-create"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="magic-link-tile-sp"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // Closing on a declined gate would punish someone for changing their mind. Landing back on
    // the PICK step rather than the CTA is also deliberate: the recipient they already chose is
    // still on screen, so retrying is one tap instead of starting the flow over.
    expect(wrapper.emitted('close')).toBeFalsy();
    expect(wrapper.text().toLowerCase()).toContain('which beanie is logging in');
  });
});
