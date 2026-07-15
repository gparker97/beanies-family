import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { raceTimeout } from '@/utils/timing';
import { hashPassword } from '@/services/auth/passwordService';

// ── Mocks for authStore's transitive deps ──────────────────────────────────

// familyStore: provide members array + updateMember spy. The real
// updateMember returns FamilyMember | null; rotateMemberPassword treats
// null as a failure ('updateFailed' error), so the mock must return a
// truthy value on the happy path.
const updateMemberMock = vi.fn<
  (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>
>(async (id) => ({ id, updated: true }));
const membersRef = { value: [] as Array<Record<string, unknown>> };

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: membersRef.value,
    updateMember: updateMemberMock,
    setCurrentMember: vi.fn(),
    resetState: vi.fn(),
    createMember: vi.fn(),
    loadMembers: vi.fn(),
  }),
}));

// syncStore: lazy-imported by changePassword; familyKey toggleable per test
const syncStoreState = {
  familyKey: null as CryptoKey | null,
};
const wrapForMemberMock = vi.fn(async () => {});
const syncNowMock = vi.fn<(force?: boolean) => Promise<boolean>>(async () => true);

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get familyKey() {
      return syncStoreState.familyKey;
    },
    wrapFamilyKeyForMember: wrapForMemberMock,
    syncNow: syncNowMock,
    syncNowBounded: async (ms = 5000) => !!(await raceTimeout(syncNowMock(true), ms)),
    resetState: vi.fn(),
  }),
}));

// familyContextStore: not used in changePassword directly but signOut path
// imports it — provide a stub so authStore's module load succeeds.
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1', allFamilies: [] }),
}));

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
  authenticateWithPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  hasRegisteredPasskeys: vi.fn(async () => false),
  listRegisteredPasskeys: vi.fn(async () => []),
}));

vi.mock('@/services/sync/passwordCache', () => ({
  isPasswordCacheValid: vi.fn(() => false),
  getCachedPassword: vi.fn(),
  cachePassword: vi.fn(),
  clearPasswordCache: vi.fn(),
}));

// ── Now import the store under test ────────────────────────────────────────

import { useAuthStore } from '../authStore';

const FAKE_KEY = {} as CryptoKey;

async function makeMemberWithPassword(id: string, password: string) {
  const passwordHash = await hashPassword(password);
  return {
    id,
    name: 'Test',
    email: 't@example.com',
    gender: 'other',
    ageGroup: 'adult',
    role: 'member',
    color: '#000',
    requiresPassword: false,
    passwordHash,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('authStore.changePassword', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    membersRef.value = [];
    syncStoreState.familyKey = FAKE_KEY;
  });

  it('rejects when not authenticated', async () => {
    const store = useAuthStore();
    const result = await store.changePassword('current', 'new');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not authenticated');
  });

  it('rejects empty new password', async () => {
    const member = await makeMemberWithPassword('m1', 'current-pw');
    membersRef.value = [member];
    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('current-pw', '');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('rejects when new password equals current', async () => {
    const member = await makeMemberWithPassword('m1', 'same-pw');
    membersRef.value = [member];
    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('same-pw', 'same-pw');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/different/i);
  });

  it('rejects wrong current password', async () => {
    const member = await makeMemberWithPassword('m1', 'real-pw');
    membersRef.value = [member];
    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('wrong-pw', 'new-pw');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/incorrect/i);
    expect(updateMemberMock).not.toHaveBeenCalled();
    expect(wrapForMemberMock).not.toHaveBeenCalled();
  });

  it('rejects when member has no passwordHash (passkey-only)', async () => {
    membersRef.value = [
      {
        id: 'm1',
        passwordHash: undefined,
        requiresPassword: true,
      },
    ];
    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('anything', 'new-pw');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no current password/i);
  });

  it('rejects when family key is not loaded', async () => {
    const member = await makeMemberWithPassword('m1', 'real-pw');
    membersRef.value = [member];
    syncStoreState.familyKey = null;
    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('real-pw', 'new-pw');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/family key/i);
    expect(wrapForMemberMock).not.toHaveBeenCalled();
  });

  it('happy path — re-wraps key, updates hash, syncs', async () => {
    const member = await makeMemberWithPassword('m1', 'real-pw');
    membersRef.value = [member];
    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('real-pw', 'new-strong-pw');

    expect(result.success).toBe(true);
    expect(wrapForMemberMock).toHaveBeenCalledWith('m1', 'new-strong-pw');
    expect(updateMemberMock).toHaveBeenCalledTimes(1);
    expect(updateMemberMock).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ passwordHash: expect.any(String) })
    );
    expect(syncNowMock).toHaveBeenCalledWith(true);
  });
});

describe('authStore.needsPodSetup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('is false when not authenticated (no session to recover)', () => {
    const store = useAuthStore();
    store.isAuthenticated = false;
    expect(store.needsPodSetup).toBe(false);
  });

  it('is true when authenticated but the pod file does not exist yet', () => {
    const store = useAuthStore();
    store.isAuthenticated = true;
    store.podCreated = false;
    expect(store.needsPodSetup).toBe(true);
  });

  it('is false once markPodCreated() flips podCreated true', () => {
    const store = useAuthStore();
    store.isAuthenticated = true;
    store.podCreated = false;
    expect(store.needsPodSetup).toBe(true);
    store.markPodCreated();
    expect(store.needsPodSetup).toBe(false);
  });
});
