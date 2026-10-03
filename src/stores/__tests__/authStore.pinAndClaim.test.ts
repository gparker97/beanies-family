/**
 * C10 (2026-10-03 data-layer audit): auth and member writes that could lock someone out.
 *
 *   - `setMemberPin` routes through the checked `applyPinReset`: a write that did not land
 *     fails BEFORE this device's wrap is enrolled under the new PIN, and a deferred push is
 *     counted (`pin_change_push_deferred`).
 *   - `joinFamily` observes the remote and re-reads the member before claiming, and refuses
 *     a member someone else claimed first (`claim_conflict`) instead of overwriting their PIN.
 *   - `rehydrateOwnerDoc` reports a throw (critical, `owner_rehydrate_failed`), never silent.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  members: [] as Array<Record<string, unknown>>,
  owner: null as Record<string, unknown> | null,
  updateMemberCredentials: vi.fn(
    async (_id: string, _p: Record<string, unknown>) => ({}) as unknown
  ),
  updateMember: vi.fn(async () => ({}) as unknown),
  syncNowBounded: vi.fn(async () => true),
  observeRemote: vi.fn(async () => true),
  enrollPinUnlock: vi.fn(async () => ({ success: true })),
  projection: new Map<string, Record<string, unknown>>(),
  reportError: vi.fn(),
  logEvent: vi.fn(),
  registryAdd: vi.fn(async () => {}),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    isTrustedDevice: false,
    trustedDevicePromptShown: false,
    setTrustedDevice: vi.fn(async () => {}),
    cacheFamilyKey: vi.fn(async () => {}),
    setOnboardingCompleted: vi.fn(async () => {}),
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return h.members;
    },
    get owner() {
      return h.owner;
    },
    updateMemberCredentials: h.updateMemberCredentials,
    updateMember: h.updateMember,
    preselectSessionMember: vi.fn(),
    resetState: vi.fn(),
    loadMembers: vi.fn(),
  }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    familyKey: { type: 'secret' },
    envelope: { keyId: 'key-1' },
    resetState: vi.fn(),
    syncNowBounded: h.syncNowBounded,
    observeRemote: h.observeRemote,
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1', allFamilies: [] }),
}));
vi.mock('@/services/automerge/projection', () => ({
  getById: (_c: string, id: string) => h.projection.get(id),
}));
vi.mock('@/services/indexeddb/registryDatabase', () => ({
  getRegistryDatabase: vi.fn(async () => ({ add: h.registryAdd })),
  isStorageBlockedError: vi.fn(() => false),
}));
vi.mock('@/services/auth/passwordService', () => ({
  hashPassword: vi.fn(async (p: string) => `hash:${p}`),
  verifyPassword: vi.fn(async (p: string, hash: string) => hash === `hash:${p}`),
}));
vi.mock('@/services/auth/deviceUnlock', async (orig) => ({
  ...(await orig<typeof import('@/services/auth/deviceUnlock')>()),
  enrollPinUnlock: h.enrollPinUnlock,
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/analytics/plausible', () => ({ track: vi.fn() }));
vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(),
  isGoogleAuthAvailable: vi.fn(() => false),
  getGoogleAccountEmail: vi.fn(() => null),
  signOutFromGoogle: vi.fn(),
  clearGoogleSessionState: vi.fn(),
  setUserMeta: vi.fn(),
  clearUserMeta: vi.fn(),
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

const member = (over: Record<string, unknown> = {}) => ({
  id: 'm-1',
  name: 'Mum',
  email: 'mum@example.com',
  role: 'member',
  pinVersion: 1,
  ...over,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  h.members = [];
  h.owner = null;
  h.projection.clear();
  h.updateMemberCredentials.mockResolvedValue({});
  h.syncNowBounded.mockResolvedValue(true);
  h.observeRemote.mockResolvedValue(true);
});

describe('setMemberPin (C10)', () => {
  it('a write that did not land fails BEFORE enrolling this device under the new PIN', async () => {
    h.members = [member({ pinHash: 'hash:111111' })];
    h.updateMemberCredentials.mockResolvedValueOnce(null);

    const result = await useAuthStore().setMemberPin('m-1', '222222', '111111');

    expect(result.success).toBe(false);
    expect(h.enrollPinUnlock).not.toHaveBeenCalled();
    expect(h.syncNowBounded).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: expect.objectContaining({ action: 'pin_write_failed', kind: 'change' }),
      })
    );
  });

  it('still refuses without the current PIN, and writes nothing', async () => {
    h.members = [member({ pinHash: 'hash:111111' })];
    const result = await useAuthStore().setMemberPin('m-1', '222222', '999999');
    expect(result.success).toBe(false);
    expect(h.updateMemberCredentials).not.toHaveBeenCalled();
  });

  it('a landed change enrols the wrap with the new hash and bumps the version', async () => {
    h.members = [member({ pinHash: 'hash:111111', pinVersion: 4 })];
    const result = await useAuthStore().setMemberPin('m-1', '222222', '111111');
    expect(result.success).toBe(true);
    expect(h.updateMemberCredentials).toHaveBeenCalledWith('m-1', {
      pinHash: 'hash:222222',
      pinVersion: 5,
    });
    expect(h.enrollPinUnlock).toHaveBeenCalledWith(
      expect.objectContaining({
        member: expect.objectContaining({ pinVersion: 5, pinHash: 'hash:222222' }),
      })
    );
  });

  it('counts a deferred push instead of discarding the boolean', async () => {
    h.members = [member()];
    h.syncNowBounded.mockResolvedValueOnce(false);
    const result = await useAuthStore().setMemberPin('m-1', '222222');
    expect(result.success).toBe(true);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'pin_change_push_deferred' } })
    );
  });
});

describe('joinFamily claim fence (C10)', () => {
  it('refuses a member someone else claimed while this joiner was choosing a PIN', async () => {
    h.members = [member()];
    // The observe merged in the other joiner's claim: the raw projection row now holds a PIN.
    h.observeRemote.mockImplementationOnce(async () => {
      h.projection.set('m-1', { id: 'm-1', pinHash: 'hash:other' });
      return true;
    });

    const result = await useAuthStore().joinFamily({
      memberId: 'm-1',
      pin: '123456',
      familyId: 'fam-1',
    });

    expect(result).toMatchObject({ success: false, code: 'claim_conflict' });
    expect(h.updateMemberCredentials).not.toHaveBeenCalled();
    // Refused before the registry mapping, so nothing is left pointing at someone else.
    expect(h.registryAdd).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'claim_conflict' }) })
    );
  });

  it("continues over the joiner's OWN earlier claim (their PIN opens the stored hash)", async () => {
    // A previous attempt wrote this PIN and then failed (or the same person joins again).
    h.members = [member({ pinHash: 'hash:123456' })];
    h.projection.set('m-1', { id: 'm-1', pinHash: 'hash:123456' });

    const result = await useAuthStore().joinFamily({
      memberId: 'm-1',
      pin: '123456',
      familyId: 'fam-1',
    });

    expect(result.success).toBe(true);
    expect(h.reportError).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'claim_conflict' }) })
    );
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'claim_own_earlier', stage: 'after-observe' } })
    );
  });

  it('still refuses a password-claimed member, whatever the PIN', async () => {
    h.members = [member({ passwordHash: 'hash:123456' })];
    const result = await useAuthStore().joinFamily({
      memberId: 'm-1',
      pin: '123456',
      familyId: 'fam-1',
    });
    expect(result).toMatchObject({ success: false, code: 'claim_conflict' });
  });

  it('observes the remote BEFORE claiming an unclaimed member', async () => {
    h.members = [member()];
    const result = await useAuthStore().joinFamily({
      memberId: 'm-1',
      pin: '123456',
      familyId: 'fam-1',
    });
    expect(result.success).toBe(true);
    const observedAt = h.observeRemote.mock.invocationCallOrder[0]!;
    const claimedAt = h.updateMemberCredentials.mock.invocationCallOrder[0]!;
    expect(observedAt).toBeLessThan(claimedAt);
  });

  it('a failed observe is counted, and the claim still proceeds (offline joiner)', async () => {
    h.members = [member()];
    h.observeRemote.mockResolvedValueOnce(false);
    const result = await useAuthStore().joinFamily({
      memberId: 'm-1',
      pin: '123456',
      familyId: 'fam-1',
    });
    expect(result.success).toBe(true);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'join_observe_degraded' } })
    );
  });
});

describe('rehydrateOwnerDoc (C10)', () => {
  it('reports a throw as critical instead of returning it silently', async () => {
    const store = useAuthStore();
    store.currentUser = {
      memberId: 'o-1',
      email: 'o@example.com',
      familyId: 'fam-1',
      role: 'owner',
    };
    h.owner = member({ id: 'o-1', role: 'owner', name: 'Owner' });
    h.updateMemberCredentials.mockRejectedValueOnce(new Error('worker gone'));

    const result = await store.rehydrateOwnerDoc('Owner', '123456');

    expect(result.success).toBe(false);
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'login-flow',
        severity: 'critical',
        context: { action: 'owner_rehydrate_failed' },
      })
    );
  });
});
