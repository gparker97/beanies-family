/**
 * authStore.invalidateRecoveryKit (tracker #99): the outcome mapper between
 * `syncStore.revokeRecoveryKit` and the UI. Never throws, every branch emits ONE
 * `kit_invalidate_outcome`, no copy is resolved here, and the store's refusals pass
 * straight through. `createRecoveryKit` stamps the creator on the package.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  currentMember: null as null | { id: string; role: string; canManagePod?: boolean },
  revokeRecoveryKit: vi.fn(),
  addRecoveryKey: vi.fn(),
  liveRecoveryKitCount: 1,
  reportError: vi.fn(),
  emitKitInvalidateOutcome: vi.fn(),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ isTrustedDevice: false, trustedDevicePromptShown: false }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: [],
    get currentMember() {
      return h.currentMember;
    },
    resetState: vi.fn(),
    loadMembers: vi.fn(),
  }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    familyKey: {} as CryptoKey,
    envelope: { version: '4.0' },
    resetState: vi.fn(),
    addRecoveryKey: h.addRecoveryKey,
    revokeRecoveryKit: h.revokeRecoveryKit,
    syncNowBounded: vi.fn(async () => true),
    get liveRecoveryKitCount() {
      return h.liveRecoveryKitCount;
    },
  }),
}));
vi.mock('@/services/auth/recoveryKit', () => ({
  generateRecoveryKit: vi.fn(async () => ({
    kitId: 'kit12345',
    code: 'CODE',
    pkg: { salt: 's', wrapped: 'w', createdAt: '2026-09-24T00:00:00.000Z' },
  })),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1', allFamilies: [] }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/loginFlowEvents', async (orig) => ({
  ...(await orig<typeof import('@/services/telemetry/loginFlowEvents')>()),
  emitKitInvalidateOutcome: h.emitKitInvalidateOutcome,
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
  h.liveRecoveryKitCount = 1;
  h.currentMember = null;
});

describe('authStore.invalidateRecoveryKit', () => {
  it('saved: returns the outcome with the live count and emits invalidated', async () => {
    h.revokeRecoveryKit.mockResolvedValueOnce({
      committed: true,
      outcome: 'saved',
      observed: true,
      liveRemaining: 2,
    });
    const r = await useAuthStore().invalidateRecoveryKit('k1', { kind: 'invalidate' });
    expect(r).toEqual({ invalidated: true, save: 'saved', liveRemaining: 2 });
    expect(h.revokeRecoveryKit).toHaveBeenCalledWith('k1', undefined);
    expect(h.emitKitInvalidateOutcome).toHaveBeenCalledTimes(1);
    expect(h.emitKitInvalidateOutcome).toHaveBeenCalledWith({
      outcome: 'invalidated',
      kind: 'invalidate',
      liveRemaining: 2,
      observed: true,
    });
  });

  it('timeout: still invalidated (tombstone staged), emits not_synced with the save status', async () => {
    h.revokeRecoveryKit.mockResolvedValueOnce({
      committed: true,
      outcome: 'timeout',
      observed: false,
      liveRemaining: 1,
    });
    const r = await useAuthStore().invalidateRecoveryKit('k1', { kind: 'replace' });
    expect(r).toEqual({ invalidated: true, save: 'timeout', liveRemaining: 1 });
    expect(h.emitKitInvalidateOutcome).toHaveBeenCalledWith({
      outcome: 'not_synced',
      kind: 'replace',
      saveStatus: 'timeout',
      liveRemaining: 1,
      observed: false,
    });
  });

  it.each(['last_kit', 'no_envelope'] as const)(
    'passes the store refusal %s through',
    async (refusal) => {
      h.revokeRecoveryKit.mockResolvedValueOnce({ committed: false, refusal });
      const r = await useAuthStore().invalidateRecoveryKit('k1', { kind: 'invalidate' });
      expect(r).toEqual({ invalidated: false, refusal });
      expect(h.emitKitInvalidateOutcome).toHaveBeenCalledWith({
        outcome: 'refused',
        kind: 'invalidate',
        errorCode: refusal,
      });
    }
  );

  it('a throw is reported once and becomes refusal error, never a rejection', async () => {
    h.revokeRecoveryKit.mockRejectedValueOnce(new Error('boom'));
    const r = await useAuthStore().invalidateRecoveryKit('k1', { kind: 'invalidate' });
    expect(r).toEqual({ invalidated: false, refusal: 'error' });
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'login-flow',
        severity: 'error',
        context: { action: 'kit_invalidate_failed', kind: 'invalidate' },
      })
    );
    expect(h.emitKitInvalidateOutcome).toHaveBeenCalledWith({
      outcome: 'refused',
      kind: 'invalidate',
      errorCode: 'error',
    });
  });
});

describe('authStore.createRecoveryKit attribution (#99)', () => {
  it('stores the package without createdBy when no member is signed in', async () => {
    const r = await useAuthStore().createRecoveryKit();
    expect(r).toMatchObject({ success: true, kitId: 'kit12345' });
    expect(h.addRecoveryKey).toHaveBeenCalledWith('kit12345', {
      salt: 's',
      wrapped: 'w',
      createdAt: '2026-09-24T00:00:00.000Z',
    });
  });

  it('refuses a signed-in member without canManagePod, reports once, mints nothing', async () => {
    h.currentMember = { id: 'm-kid', role: 'member' };
    const r = await useAuthStore().createRecoveryKit();
    // The real translation store resolves the key; only the shape and the refusal matter here.
    expect(r).toMatchObject({ success: false });
    expect((r as { error: string }).error.length).toBeGreaterThan(0);
    expect(h.addRecoveryKey).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { action: 'kit_generate_refused', error_code: 'not_authorized' },
      })
    );
  });

  it('allows the owner even when canManagePod was never written, and a manager', async () => {
    h.currentMember = { id: 'm-owner', role: 'owner' };
    expect((await useAuthStore().createRecoveryKit()).success).toBe(true);
    h.currentMember = { id: 'm-mgr', role: 'member', canManagePod: true };
    expect((await useAuthStore().createRecoveryKit()).success).toBe(true);
    expect(h.addRecoveryKey).toHaveBeenCalledTimes(2);
  });

  it('stamps createdBy with the signed-in member', async () => {
    const store = useAuthStore();
    (store as unknown as { currentUser: { memberId: string } | null }).currentUser = {
      memberId: 'm-greg',
    } as never;
    await store.createRecoveryKit();
    expect(h.addRecoveryKey).toHaveBeenCalledWith(
      'kit12345',
      expect.objectContaining({ createdBy: 'm-greg' })
    );
  });
});
