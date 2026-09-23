/**
 * useSignOut — the ONE user-facing sign-out orchestration (2026-09-23).
 *
 * The order matters and is what these pin:
 *   1. the kit guard is decided SYNCHRONOUSLY from the tick's CHOSEN trust, and `phase`
 *      leaves 'confirm' in the same tick (a double tap cannot start a second sign-out);
 *   2. a guard that is dismissed changes NOTHING (the tick has not been applied);
 *   3. a changed tick is applied only after the guard, before any teardown;
 *   4. any throw shows exactly one error toast (which reports) and resets to idle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isTrustedDevice: true,
  settings: { recoveryKitConfirmedVia: 'acknowledged' } as Record<string, unknown> | null,
  members: [{ id: 'm1', canManagePod: true, passwordHash: '' }] as Array<Record<string, unknown>>,
  owner: { id: 'm1', passwordHash: '' } as Record<string, unknown>,
  envelope: null as Record<string, unknown> | null,
  isDemo: false,
  signOut: vi.fn(async () => {}),
  signOutAndClearData: vi.fn(async () => {}),
  setDeviceTrust: vi.fn(async () => true),
  resetAllAppStores: vi.fn(),
  routerReplace: vi.fn(async () => {}),
  showToast: vi.fn(),
  emitKitGuard: vi.fn(),
  emitKitGuardOutcome: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/router', () => ({ default: { replace: h.routerReplace } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    currentUser: { memberId: 'm1' },
    signOut: h.signOut,
    signOutAndClearData: h.signOutAndClearData,
    setDeviceTrust: h.setDeviceTrust,
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: h.members, owner: h.owner }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ isTrustedDevice: h.isTrustedDevice, settings: h.settings }),
}));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({ envelope: h.envelope }) }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/utils/resetStores', () => ({ resetAllAppStores: h.resetAllAppStores }));
vi.mock('@/utils/reviewDemo', () => ({
  isDemoSession: {
    get value() {
      return h.isDemo;
    },
  },
}));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitKitGuard: h.emitKitGuard,
  emitKitGuardOutcome: h.emitKitGuardOutcome,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));

import { useSignOut, useSignOutHost, __resetSignOutForTests } from '@/composables/useSignOut';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  __resetSignOutForTests();
  h.isTrustedDevice = true;
  h.settings = { recoveryKitConfirmedVia: 'acknowledged' };
  h.members = [{ id: 'm1', canManagePod: true, passwordHash: '' }];
  h.envelope = null;
  h.isDemo = false;
  h.setDeviceTrust.mockResolvedValue(true);
  h.signOut.mockResolvedValue(undefined);
});

describe('useSignOut', () => {
  it('requestSignOut opens the confirm once; signOut outside the confirm is refused', async () => {
    const { phase, requestSignOut, signOut } = useSignOut();
    expect(await signOut('sign-out', { trust: true })).toBe('cancelled');
    expect(h.signOut).not.toHaveBeenCalled();
    requestSignOut();
    requestSignOut();
    expect(phase.value).toBe('confirm');
  });

  it('a ticked keep-data sign-out never guards, and signs out', async () => {
    const { requestSignOut, signOut, phase } = useSignOut();
    requestSignOut();
    expect(await signOut('sign-out', { trust: true })).toBe('signed-out');
    expect(h.setDeviceTrust).not.toHaveBeenCalled(); // tick unchanged
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.resetAllAppStores).toHaveBeenCalledTimes(1);
    expect(h.routerReplace).toHaveBeenCalledWith('/login');
    expect(h.emitKitGuard).toHaveBeenCalledWith(expect.objectContaining({ shown: false }));
    expect(phase.value).toBe('idle');
  });

  it('phase leaves confirm synchronously: a double tap runs the sign-out ONCE', async () => {
    const { requestSignOut, signOut } = useSignOut();
    requestSignOut();
    const first = signOut('sign-out', { trust: true });
    const second = signOut('sign-out', { trust: true });
    expect(await second).toBe('cancelled');
    expect(await first).toBe('signed-out');
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('the guard is decided from the TICK: unticked guards even while the device is still trusted', async () => {
    const { requestSignOut, signOut, phase } = useSignOut();
    requestSignOut();
    const pending = signOut('sign-out', { trust: false });
    expect(phase.value).toBe('guard');
    expect(h.setDeviceTrust).not.toHaveBeenCalled(); // not applied before the guard
    useSignOutHost().resolveKitGuard('sign_out_anyway');
    expect(await pending).toBe('signed-out');
    // Applied AFTER the guard and BEFORE the store sign-out.
    expect(h.setDeviceTrust).toHaveBeenCalledWith(false, 'signout-tick');
    expect(h.setDeviceTrust.mock.invocationCallOrder[0]).toBeLessThan(
      h.signOut.mock.invocationCallOrder[0]!
    );
    expect(h.emitKitGuardOutcome).toHaveBeenCalledTimes(1);
    expect(h.emitKitGuardOutcome).toHaveBeenCalledWith('sign_out_anyway');
  });

  it('a dismissed guard changes NOTHING: no trust write, no sign-out', async () => {
    const { requestSignOut, signOut, phase } = useSignOut();
    requestSignOut();
    const pending = signOut('sign-out', { trust: false });
    useSignOutHost().resolveKitGuard('cancelled');
    expect(await pending).toBe('cancelled');
    expect(h.setDeviceTrust).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(phase.value).toBe('idle');
  });

  it('kit_saved continues to the sign-out', async () => {
    const { requestSignOut, signOut } = useSignOut();
    requestSignOut();
    const pending = signOut('clear', { trust: true });
    useSignOutHost().resolveKitGuard('kit_saved');
    expect(await pending).toBe('signed-out');
    expect(h.signOutAndClearData).toHaveBeenCalledTimes(1);
  });

  it('clear-data ignores the tick: guards on an unsaved kit and never writes trust', async () => {
    const { requestSignOut, signOut, phase } = useSignOut();
    requestSignOut();
    const pending = signOut('clear', { trust: true });
    expect(phase.value).toBe('guard');
    useSignOutHost().resolveKitGuard('sign_out_anyway');
    await pending;
    expect(h.setDeviceTrust).not.toHaveBeenCalled();
  });

  it('a second signOut during the guard is refused and does not replace the pending resolver', async () => {
    const { requestSignOut, signOut } = useSignOut();
    requestSignOut();
    const pending = signOut('sign-out', { trust: false });
    expect(await signOut('sign-out', { trust: false })).toBe('cancelled');
    useSignOutHost().resolveKitGuard('sign_out_anyway');
    expect(await pending).toBe('signed-out');
  });

  it('abandonSignOut in the guard resolves cancelled; nothing is written', async () => {
    const { requestSignOut, signOut } = useSignOut();
    requestSignOut();
    const pending = signOut('sign-out', { trust: false });
    useSignOutHost().abandonSignOut();
    expect(await pending).toBe('cancelled');
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.setDeviceTrust).not.toHaveBeenCalled();
  });

  it('abandonSignOut while signing out is a no-op', async () => {
    let finish: () => void = () => {};
    h.signOut.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    const { requestSignOut, signOut, phase } = useSignOut();
    requestSignOut();
    const pending = signOut('sign-out', { trust: true });
    await tick();
    expect(phase.value).toBe('signing-out');
    useSignOutHost().abandonSignOut();
    expect(phase.value).toBe('signing-out');
    finish();
    expect(await pending).toBe('signed-out');
  });

  it('a failed trust change returns failed, never signs out, adds no sign_out_failed toast', async () => {
    h.setDeviceTrust.mockResolvedValueOnce(false);
    h.settings = { recoveryKitConfirmedVia: 'saved' }; // no guard
    const { requestSignOut, signOut } = useSignOut();
    requestSignOut();
    expect(await signOut('sign-out', { trust: false })).toBe('failed');
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('a throw from the store is reported ONCE (sign_out_failed), shown, and resets to idle', async () => {
    h.signOut.mockRejectedValueOnce(new Error('boom'));
    const { requestSignOut, signOut, phase } = useSignOut();
    requestSignOut();
    expect(await signOut('sign-out', { trust: true })).toBe('failed');
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'sign-out failed',
        context: { action: 'sign_out_failed', kind: 'sign-out' },
      })
    );
    expect(h.showToast).toHaveBeenCalledWith('error', 'auth.signOutFailed', undefined, {
      silent: true,
    });
    expect(phase.value).toBe('idle');
  });

  it('never applies the trust tick in the App Review demo (a reviewer device stays untrusted)', async () => {
    h.isDemo = true;
    h.isTrustedDevice = false;
    const { requestSignOut, signOut } = useSignOut();
    requestSignOut();
    expect(await signOut('sign-out', { trust: true })).toBe('signed-out');
    expect(h.setDeviceTrust).not.toHaveBeenCalled();
  });

  it('the demo, a non-manager, a saved kit and a passphrase family are never guarded', async () => {
    const cases: Array<() => void> = [
      () => (h.isDemo = true),
      () => (h.members = [{ id: 'm1', canManagePod: false, passwordHash: '' }]),
      () => (h.settings = { recoveryKitConfirmedVia: 'saved' }),
      () => (h.envelope = { recoveryPassphrase: { salt: 's' } }),
    ];
    for (const setUp of cases) {
      __resetSignOutForTests();
      h.isDemo = false;
      h.members = [{ id: 'm1', canManagePod: true, passwordHash: '' }];
      h.settings = { recoveryKitConfirmedVia: 'acknowledged' };
      h.envelope = null;
      setUp();
      const { requestSignOut, signOut } = useSignOut();
      requestSignOut();
      expect(await signOut('clear', { trust: false })).toBe('signed-out');
    }
  });
});
