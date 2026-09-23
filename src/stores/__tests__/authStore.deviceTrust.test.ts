/**
 * authStore.setDeviceTrust — the ONE user-facing way to change this device's trust
 * (2026-09-23). Used by trust-on-create, trust-on-join, the trust prompt, the Settings
 * toggle and the sign-out tick, so its contract is load-bearing:
 *   - success means the FLAG was written; it never throws;
 *   - a failed flag write returns false, shows ONE error toast (which reports) and emits
 *     no success event;
 *   - caching the open family's key afterwards is best-effort: a cache failure still
 *     returns true, shows no toast, and reports a warning.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: {
    isTrustedDevice: false,
    trustedDevicePromptShown: false,
    setTrustedDevice: vi.fn(async (_t: boolean) => {}),
    cacheFamilyKey: vi.fn(async () => {}),
  },
  activeFamilyId: 'fam-1' as string | null,
  getExportedFamilyKey: vi.fn(async () => 'exported-key' as string | null),
  showToast: vi.fn(),
  reportError: vi.fn(),
  emitDeviceTrustSet: vi.fn(),
}));

vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => h.settings }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [], resetState: vi.fn(), loadMembers: vi.fn() }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    familyKey: null,
    envelope: null,
    resetState: vi.fn(),
    getExportedFamilyKey: h.getExportedFamilyKey,
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: h.activeFamilyId, allFamilies: [] }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/loginFlowEvents', async (orig) => ({
  ...(await orig<typeof import('@/services/telemetry/loginFlowEvents')>()),
  emitDeviceTrustSet: h.emitDeviceTrustSet,
}));
vi.mock('@/services/analytics/plausible', () => ({ track: vi.fn() }));
vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(),
  isGoogleAuthAvailable: vi.fn(() => false),
  getGoogleAccountEmail: vi.fn(() => null),
  signOutFromGoogle: vi.fn(),
  setUserMeta: vi.fn(),
  clearUserMeta: vi.fn(),
}));
vi.mock('@/services/registry/registryService', () => ({
  getRegistryDatabase: vi.fn(),
  isRegistryConfigured: vi.fn(() => false),
}));
vi.mock('@/services/auth/passkeyService', () => ({
  reconcileDeviceKeysWithRoster: vi.fn(async () => {}),
  resolveDeviceKeys: vi.fn(async () => []),
  hasRegisteredPasskeys: vi.fn(async () => false),
  listRegisteredPasskeys: vi.fn(async () => []),
  MEMBER_MISMATCH: 'member_mismatch',
  WRONG_FAMILY_CREDENTIAL: 'wrong_family_credential',
}));

import { useAuthStore } from '../authStore';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  h.settings.isTrustedDevice = false;
  h.settings.trustedDevicePromptShown = false;
  h.settings.setTrustedDevice.mockResolvedValue(undefined);
  h.settings.cacheFamilyKey.mockResolvedValue(undefined);
  h.activeFamilyId = 'fam-1';
  h.getExportedFamilyKey.mockResolvedValue('exported-key');
});

describe('authStore.setDeviceTrust', () => {
  it('trusting writes the flag, caches the open family key, and emits the success event', async () => {
    const ok = await useAuthStore().setDeviceTrust(true, 'prompt');
    expect(ok).toBe(true);
    expect(h.settings.setTrustedDevice).toHaveBeenCalledWith(true);
    expect(h.settings.cacheFamilyKey).toHaveBeenCalledWith('exported-key', 'fam-1');
    expect(h.emitDeviceTrustSet).toHaveBeenCalledWith({
      source: 'prompt',
      trusted: true,
      was: 'unset',
    });
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('untrusting writes the flag only', async () => {
    h.settings.isTrustedDevice = true;
    const ok = await useAuthStore().setDeviceTrust(false, 'signout-tick');
    expect(ok).toBe(true);
    expect(h.settings.setTrustedDevice).toHaveBeenCalledWith(false);
    expect(h.settings.cacheFamilyKey).not.toHaveBeenCalled();
    expect(h.emitDeviceTrustSet).toHaveBeenCalledWith(
      expect.objectContaining({ trusted: false, was: 'trusted' })
    );
  });

  it('reads `was` BEFORE the write (an earlier decline is visible)', async () => {
    h.settings.trustedDevicePromptShown = true;
    await useAuthStore().setDeviceTrust(true, 'create');
    expect(h.emitDeviceTrustSet).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'create', was: 'declined' })
    );
  });

  it('a failed flag write returns false, never throws, reports ONCE directly, shows a silent toast', async () => {
    h.settings.setTrustedDevice.mockRejectedValueOnce(new Error('IDB blocked'));
    await expect(useAuthStore().setDeviceTrust(true, 'settings')).resolves.toBe(false);
    // Reported directly (a live identical toast would skip the toast's own report).
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'login-flow',
        message: 'device trust write failed',
        context: { action: 'device_trust_set_failed', kind: 'settings' },
      })
    );
    expect(h.showToast).toHaveBeenCalledTimes(1);
    expect(h.showToast).toHaveBeenCalledWith('error', expect.any(String), undefined, {
      silent: true,
    });
    expect(h.emitDeviceTrustSet).not.toHaveBeenCalled();
    expect(h.settings.cacheFamilyKey).not.toHaveBeenCalled();
  });

  it('a failed key cache after a good flag write still returns TRUE, no toast, reports a warning', async () => {
    h.settings.cacheFamilyKey.mockRejectedValueOnce(new Error('keystore'));
    await expect(useAuthStore().setDeviceTrust(true, 'join')).resolves.toBe(true);
    expect(h.showToast).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        context: { action: 'device_trust_key_cache_failed', kind: 'join' },
      })
    );
  });

  it('with no active family it returns true and skips the cache', async () => {
    h.activeFamilyId = null;
    await expect(useAuthStore().setDeviceTrust(true, 'create')).resolves.toBe(true);
    expect(h.getExportedFamilyKey).not.toHaveBeenCalled();
    expect(h.settings.cacheFamilyKey).not.toHaveBeenCalled();
  });
});
