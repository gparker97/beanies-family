/**
 * The step-up (#80) with biometric as the DEFAULT (2026-09-23): no "which method?" screen.
 * Biometric starts by itself where it is set up; a PIN-only member gets the pad at once;
 * "Use PIN instead?" is always one tap away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const svc = vi.hoisted(() => ({
  authenticateWithPasskey: vi.fn(),
  resolveDeviceKeys: vi.fn(async () => [] as Array<{ memberId: string }>),
  native: { value: false },
}));
vi.mock('@/services/auth/passkeyService', () => ({
  authenticateWithPasskey: svc.authenticateWithPasskey,
  resolveDeviceKeys: svc.resolveDeviceKeys,
  MEMBER_MISMATCH: 'MEMBER_MISMATCH',
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => svc.native.value }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ currentUser: { familyId: 'fam-1', memberId: 'm1' } }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import ReauthChallenge from '../ReauthChallenge.vue';

const member = { id: 'm1', name: 'Me', pinHash: 'hash' } as never;

function mountIt() {
  return mount(ReauthChallenge, {
    props: { member, open: true },
    global: { stubs: { Teleport: true, PasswordModal: true } },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  svc.native.value = false;
  svc.resolveDeviceKeys.mockResolvedValue([]);
});

describe('ReauthChallenge — biometric by default, PIN one tap away', () => {
  it('a PIN-only member gets the pad straight away, with no chooser', async () => {
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain('pin.enterPin');
    expect(w.text()).not.toContain('pin.useInstead');
    expect(svc.authenticateWithPasskey).not.toHaveBeenCalled();
  });

  it('starts biometric by itself, ONCE, where it is set up on this device', async () => {
    svc.native.value = true;
    svc.resolveDeviceKeys.mockResolvedValue([{ memberId: 'm1' }]);
    svc.authenticateWithPasskey.mockReturnValue(new Promise(() => {})); // prompt still up
    const w = mountIt();
    await flushPromises();
    expect(svc.authenticateWithPasskey).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('reauth.passkeyWaiting');
    expect(w.text()).toContain('pin.useInstead');
  });

  it('after the OS prompt is cancelled, "Use PIN instead?" opens the pad', async () => {
    svc.native.value = true;
    svc.resolveDeviceKeys.mockResolvedValue([{ memberId: 'm1' }]);
    svc.authenticateWithPasskey.mockResolvedValue({ success: false, cancelled: true });
    const w = mountIt();
    await flushPromises();
    // Not re-prompted on its own: the person gets a retry button instead.
    expect(svc.authenticateWithPasskey).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('reauth.passkeyButton');

    const usePin = w.findAll('button').find((b) => b.text() === 'pin.useInstead');
    await usePin!.trigger('click');
    expect(w.text()).toContain('pin.enterPin');
  });

  it('a successful biometric check verifies without any tap', async () => {
    svc.native.value = true;
    svc.resolveDeviceKeys.mockResolvedValue([{ memberId: 'm1' }]);
    svc.authenticateWithPasskey.mockResolvedValue({ success: true });
    const w = mountIt();
    await flushPromises();
    expect(w.emitted('verified')).toHaveLength(1);
  });
});
