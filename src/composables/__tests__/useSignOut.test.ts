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
  // What the store says after a session end; the deferred-release rule reads it.
  isAuthenticated: true,
  signOut: vi.fn(async () => ({ cacheDeleted: null as boolean | null })),
  signOutAndClearData: vi.fn(async () => ({ cacheDeleted: true as boolean | null })),
  endSessionClearedElsewhere: vi.fn(async () => {}),
  setDeviceTrust: vi.fn(async () => true),
  resetAllAppStores: vi.fn(),
  routerReplace: vi.fn(async () => {}),
  showToast: vi.fn(),
  emitKitGuard: vi.fn(),
  emitKitGuardOutcome: vi.fn(),
  emitCacheKept: vi.fn(),
  logEvent: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/router', () => ({ default: { replace: h.routerReplace } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    currentUser: { memberId: 'm1' },
    get isAuthenticated() {
      return h.isAuthenticated;
    },
    signOut: h.signOut,
    signOutAndClearData: h.signOutAndClearData,
    endSessionClearedElsewhere: h.endSessionClearedElsewhere,
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
  emitCacheKept: h.emitCacheKept,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));

import {
  useSignOut,
  useSignOutHost,
  endSessionClearedElsewhere,
  __resetSignOutForTests,
} from '@/composables/useSignOut';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  __resetSignOutForTests();
  h.isTrustedDevice = true;
  h.settings = { recoveryKitConfirmedVia: 'acknowledged' };
  h.members = [{ id: 'm1', canManagePod: true, passwordHash: '' }];
  h.envelope = null;
  h.isDemo = false;
  h.isAuthenticated = true;
  h.setDeviceTrust.mockResolvedValue(true);
  h.signOut.mockResolvedValue({ cacheDeleted: null });
  h.signOutAndClearData.mockResolvedValue({ cacheDeleted: true });
  h.endSessionClearedElsewhere.mockResolvedValue(undefined);
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
    h.signOut.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r({ cacheDeleted: null })))
    );
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

  // ─── #100 ────────────────────────────────────────────────────────────────
  describe('#100: a cache another tab kept', () => {
    it('a clear-data sign-out whose cache was kept warns on the login screen, and counts it', async () => {
      h.settings = { recoveryKitConfirmedVia: 'saved' }; // no guard, straight through
      h.signOutAndClearData.mockResolvedValue({ cacheDeleted: false });
      const { requestSignOut, signOut } = useSignOut();
      requestSignOut();
      expect(await signOut('clear', { trust: false })).toBe('signed-out');

      expect(h.showToast).toHaveBeenCalledWith(
        'warning',
        'auth.cacheKeptTitle',
        'auth.cacheKept',
        expect.anything()
      );
      expect(h.emitCacheKept).toHaveBeenCalledWith('sign-out-clear');
      // After the route, so it is read on the login screen.
      expect(h.routerReplace.mock.invocationCallOrder[0]!).toBeLessThan(
        h.showToast.mock.invocationCallOrder[0]!
      );
    });

    it.each([true, null])(
      'cacheDeleted %s is not a kept cache: no warning',
      async (cacheDeleted) => {
        h.settings = { recoveryKitConfirmedVia: 'saved' };
        h.signOutAndClearData.mockResolvedValue({ cacheDeleted });
        const { requestSignOut, signOut } = useSignOut();
        requestSignOut();
        await signOut('clear', { trust: false });
        expect(h.showToast).not.toHaveBeenCalled();
        expect(h.emitCacheKept).not.toHaveBeenCalled();
      }
    );
  });

  describe('#100: endSessionClearedElsewhere (another tab deleted this family)', () => {
    it('from idle: tears down, lands on login, says why, and counts it', async () => {
      await endSessionClearedElsewhere();
      expect(h.endSessionClearedElsewhere).toHaveBeenCalledTimes(1);
      expect(h.resetAllAppStores).toHaveBeenCalledTimes(1);
      expect(h.routerReplace).toHaveBeenCalledWith('/login');
      expect(h.showToast).toHaveBeenCalledWith('info', 'auth.signedOutElsewhere');
      expect(h.logEvent).toHaveBeenCalledTimes(1);
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'cache-persist',
          context: { action: 'cache-released', detail: 'direct' },
        })
      );
      expect(useSignOut().phase.value).toBe('idle');
    });

    it("during this tab's own sign-out it WAITS, then does nothing if that ended the session", async () => {
      h.settings = { recoveryKitConfirmedVia: 'saved' };
      let finish!: () => void;
      h.signOut.mockImplementation(
        () =>
          new Promise((r) => {
            finish = () => {
              h.isAuthenticated = false; // finalizeSession ran
              r({ cacheDeleted: null });
            };
          })
      );
      const { requestSignOut, signOut } = useSignOut();
      requestSignOut();
      const own = signOut('sign-out', { trust: true });
      await tick();

      const release = endSessionClearedElsewhere(); // arrives mid-sign-out
      await tick();
      expect(h.endSessionClearedElsewhere).not.toHaveBeenCalled(); // waiting, not racing

      finish();
      expect(await own).toBe('signed-out');
      await release;
      expect(h.endSessionClearedElsewhere).not.toHaveBeenCalled();
      expect(h.logEvent).toHaveBeenCalledTimes(1);
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { action: 'cache-released', detail: 'deferred-already-ended' },
        })
      );
    });

    it('from the confirm: the confirm closes and the teardown runs', async () => {
      const { requestSignOut, phase } = useSignOut();
      requestSignOut();
      expect(phase.value).toBe('confirm');
      const ending = endSessionClearedElsewhere();
      expect(phase.value).toBe('signing-out'); // confirm (v-if'd on its phase) is gone
      await ending;
      expect(h.endSessionClearedElsewhere).toHaveBeenCalledTimes(1);
      expect(phase.value).toBe('idle');
    });

    it('from an open kit guard: the phase HOLDS for the whole teardown, the guard resolves after', async () => {
      const { requestSignOut, signOut, phase } = useSignOut();
      requestSignOut();
      const parked = signOut('clear', { trust: true });
      expect(phase.value).toBe('guard');

      let finishTeardown!: () => void;
      h.endSessionClearedElsewhere.mockImplementation(
        () => new Promise<void>((r) => (finishTeardown = r))
      );
      const ending = endSessionClearedElsewhere();
      await tick();
      // The race Pass 3 found: resolving the guard first would let the parked sign-out's
      // `finally` reset the phase to idle under the running teardown.
      expect(phase.value).toBe('signing-out');
      expect(h.emitKitGuardOutcome).not.toHaveBeenCalled();

      finishTeardown();
      await ending;
      expect(await parked).toBe('cancelled');
      expect(h.emitKitGuardOutcome).toHaveBeenCalledWith('superseded'); // not the person's cancel
      expect(h.signOutAndClearData).not.toHaveBeenCalled(); // the parked sign-out never ran
      expect(phase.value).toBe('idle');
    });

    it('a throw is reported like a failed sign-out, and the phase recovers', async () => {
      h.endSessionClearedElsewhere.mockRejectedValue(new Error('boom'));
      await endSessionClearedElsewhere();
      expect(h.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'critical',
          context: { action: 'sign_out_failed', kind: 'cleared-elsewhere' },
        })
      );
      expect(h.showToast).toHaveBeenCalledWith('error', 'auth.signOutFailed', undefined, {
        silent: true,
      });
      expect(useSignOut().phase.value).toBe('idle');
    });
  });

  describe('#100 review fixes', () => {
    it('an untrusted ordinary sign-out whose cache was kept warns too', async () => {
      h.isTrustedDevice = false;
      h.settings = { recoveryKitConfirmedVia: 'saved' };
      h.signOut.mockResolvedValue({ cacheDeleted: false });
      const { requestSignOut, signOut } = useSignOut();
      requestSignOut();
      expect(await signOut('sign-out', { trust: false })).toBe('signed-out');
      expect(h.emitCacheKept).toHaveBeenCalledWith('sign-out');
    });

    it('a kit-guard action that finishes AFTER the takeover cannot start a second sign-out', async () => {
      const { requestSignOut, signOut, phase } = useSignOut();
      requestSignOut();
      const parked = signOut('clear', { trust: true });
      expect(phase.value).toBe('guard');

      let finishTeardown!: () => void;
      h.endSessionClearedElsewhere.mockImplementation(
        () => new Promise<void>((r) => (finishTeardown = r))
      );
      const ending = endSessionClearedElsewhere();
      await tick();

      // "I saved it" resolved late, while the evicted teardown owns the phase.
      useSignOutHost().resolveKitGuard('kit_saved');
      finishTeardown();
      await ending;

      expect(await parked).toBe('cancelled');
      expect(h.signOutAndClearData).not.toHaveBeenCalled();
    });

    it("a release during this tab's own sign-out is finished if that sign-out FAILED before the teardown", async () => {
      h.settings = { recoveryKitConfirmedVia: 'saved' };
      let fail!: (e: Error) => void;
      h.signOut.mockImplementationOnce(() => new Promise((_r, rej) => (fail = rej)));
      const { requestSignOut, signOut } = useSignOut();
      requestSignOut();
      const own = signOut('sign-out', { trust: true });
      await tick();

      const release = endSessionClearedElsewhere();
      fail(new Error('boom')); // still signed in: the store never finalized
      expect(await own).toBe('failed');
      await release;
      expect(h.endSessionClearedElsewhere).toHaveBeenCalledTimes(1);
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { action: 'cache-released', detail: 'deferred-then-ran' },
        })
      );
    });

    it('a sign-out that ended the session but then failed to navigate is NOT torn down twice (R2-1)', async () => {
      h.settings = { recoveryKitConfirmedVia: 'saved' };
      let finish!: () => void;
      h.signOut.mockImplementationOnce(
        () =>
          new Promise((r) => {
            finish = () => {
              h.isAuthenticated = false;
              r({ cacheDeleted: null });
            };
          })
      );
      h.routerReplace.mockRejectedValueOnce(new Error('navigation aborted'));
      const { requestSignOut, signOut } = useSignOut();
      requestSignOut();
      const own = signOut('sign-out', { trust: true });
      await tick();

      const release = endSessionClearedElsewhere();
      finish();
      expect(await own).toBe('failed'); // the navigation threw
      await release;
      expect(h.endSessionClearedElsewhere).not.toHaveBeenCalled();
    });

    it('a second release during the cleared-elsewhere teardown is the same release: one teardown', async () => {
      let finishTeardown!: () => void;
      h.endSessionClearedElsewhere.mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            finishTeardown = () => {
              h.isAuthenticated = false;
              r();
            };
          })
      );
      const first = endSessionClearedElsewhere();
      await tick();
      const second = endSessionClearedElsewhere();
      finishTeardown();
      await first;
      await second;
      expect(h.endSessionClearedElsewhere).toHaveBeenCalledTimes(1);
    });

    it('a kept cache is COUNTED even when the navigation afterwards throws (R2-6)', async () => {
      h.isTrustedDevice = false;
      h.settings = { recoveryKitConfirmedVia: 'saved' };
      h.signOut.mockResolvedValue({ cacheDeleted: false });
      h.routerReplace.mockRejectedValueOnce(new Error('navigation aborted'));
      const { requestSignOut, signOut } = useSignOut();
      requestSignOut();
      expect(await signOut('sign-out', { trust: false })).toBe('failed');
      expect(h.emitCacheKept).toHaveBeenCalledWith('sign-out');
    });
  });
});
