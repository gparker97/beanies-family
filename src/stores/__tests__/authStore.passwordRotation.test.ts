/**
 * Tests for the three password-rotation flows that share
 * `rotateMemberPassword`: `changePassword` (refactored), `signIn`'s
 * self-heal, and `resetMemberPassword`. All three live in one file so
 * helper-level changes propagate to one place.
 *
 * Mock harness mirrors `authStoreChangePassword.test.ts` so any future
 * change to the syncStore/familyStore contract touches one shape.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { raceTimeout } from '@/utils/timing';
import { hashPassword } from '@/services/auth/passwordService';
import type { BeanpodFileV4, WrappedMemberKey } from '@/types/syncFileV4';

// ── familyStore mock ───────────────────────────────────────────────────────
const updateMemberMock = vi.fn<
  (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>
>(async (id) => ({ id, updated: true }));
const membersRef = { value: [] as Array<Record<string, unknown>> };
const setCurrentMemberMock = vi.fn();

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: membersRef.value,
    updateMember: updateMemberMock,
    setCurrentMember: setCurrentMemberMock,
    resetState: vi.fn(),
    createMember: vi.fn(),
    loadMembers: vi.fn(),
  }),
}));

// ── syncStore mock ─────────────────────────────────────────────────────────
const syncStoreState = {
  familyKey: null as CryptoKey | null,
  envelope: null as BeanpodFileV4 | null,
};
const wrapForMemberMock = vi.fn(async (_id: string, _password: string) => {
  // Default: success. Per-test overrides via mockRejectedValueOnce when needed.
});
const syncNowMock = vi.fn<(force?: boolean) => Promise<boolean>>(async () => true);

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get familyKey() {
      return syncStoreState.familyKey;
    },
    get envelope() {
      return syncStoreState.envelope;
    },
    wrapFamilyKeyForMember: wrapForMemberMock,
    syncNow: syncNowMock,
    // Mirror the real syncNowBounded: race syncNow(true) against the timeout so the
    // 'syncNow called with true' + syncDeferred + never-settles assertions still hold.
    syncNowBounded: async (ms = 5000) => !!(await raceTimeout(syncNowMock(true), ms)),
    resetState: vi.fn(),
  }),
}));

// ── fileSync mock — controls unwrapWrappedKey result for self-heal tests
const { unwrapWrappedKeyMock } = vi.hoisted(() => ({
  unwrapWrappedKeyMock: vi.fn<(wrappedKey: unknown, password: string) => Promise<CryptoKey | null>>(
    async () => null
  ),
}));

vi.mock('@/services/sync/fileSync', () => ({
  unwrapWrappedKey: unwrapWrappedKeyMock,
  // syncService.ts imports a bunch of names from fileSync. Stub them so the
  // module can load (we're not exercising any of these paths).
  parseBeanpodV4: vi.fn(),
  reEncryptEnvelope: vi.fn(),
  decryptBeanpodPayload: vi.fn(),
  detectFileVersion: vi.fn(() => '4.0'),
  tryUnwrapFamilyKey: vi.fn(),
  createBeanpodV4: vi.fn(),
}));

// ── translationStore mock — t() returns the key untouched so we can assert
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

// ── showToast spy — captured via vi.hoisted so the mock factory can see it
const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));
vi.mock('@/composables/useToast', () => ({
  showToast: showToastMock,
}));

// ── Misc stubs (same shape as authStoreChangePassword.test.ts) ─────────────
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

import { useAuthStore } from '../authStore';

const FAKE_KEY = {} as CryptoKey;
const FAKE_UNWRAPPED_KEY = {} as CryptoKey;

function buildEnvelope(wrappedKeys: Record<string, WrappedMemberKey> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys,
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
  };
}

async function memberWithPassword(
  id: string,
  password: string,
  overrides: Record<string, unknown> = {}
) {
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
    canManagePod: false,
    isPet: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  membersRef.value = [];
  syncStoreState.familyKey = FAKE_KEY;
  syncStoreState.envelope = buildEnvelope();
  // Default sync returns true and updateMember returns truthy.
  syncNowMock.mockResolvedValue(true);
  updateMemberMock.mockImplementation(async (id) => ({ id, updated: true }));
  unwrapWrappedKeyMock.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────
// changePassword — proves the refactor preserves existing behaviour and
// fixes the previously-silent updateMember failure.
// ─────────────────────────────────────────────────────────────────────────
describe('authStore.changePassword (after rotateMemberPassword refactor)', () => {
  it('happy path — wrap + updateMember + syncNow all called', async () => {
    const member = await memberWithPassword('m1', 'real-pw');
    membersRef.value = [member];
    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('real-pw', 'new-strong-pw');

    expect(result.success).toBe(true);
    expect(wrapForMemberMock).toHaveBeenCalledWith('m1', 'new-strong-pw');
    expect(updateMemberMock).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ passwordHash: expect.any(String), requiresPassword: false })
    );
    expect(syncNowMock).toHaveBeenCalledWith(true);
  });

  it('surfaces updateMember failure (previously silent bug)', async () => {
    const member = await memberWithPassword('m1', 'real-pw');
    membersRef.value = [member];
    updateMemberMock.mockResolvedValueOnce(null);

    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('real-pw', 'new-strong-pw');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/locally/);
  });

  it('returns familyKeyMissing when syncStore.familyKey is null', async () => {
    const member = await memberWithPassword('m1', 'real-pw');
    membersRef.value = [member];
    syncStoreState.familyKey = null;

    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('real-pw', 'new-strong-pw');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/family key/i);
    expect(wrapForMemberMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// signIn self-heal — proves the divergence-recovery path works AND fails loudly.
// ─────────────────────────────────────────────────────────────────────────
describe('authStore.signIn — self-heal stale wrappedKey', () => {
  async function setupMember(memberId = 'm1', password = 'real-pw') {
    const member = await memberWithPassword(memberId, password);
    membersRef.value = [member];
    return member;
  }

  it('no-op when envelope.wrappedKeys[memberId] is fresh', async () => {
    await setupMember();
    syncStoreState.envelope = buildEnvelope({ m1: { wrapped: 'w', salt: 's' } });
    unwrapWrappedKeyMock.mockResolvedValueOnce(FAKE_UNWRAPPED_KEY); // fresh

    const store = useAuthStore();
    const result = await store.signIn('m1', 'real-pw');

    expect(result.success).toBe(true);
    expect(wrapForMemberMock).not.toHaveBeenCalled();
    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it('re-wraps when wrappedKey entry exists but unwrap returns null (stale)', async () => {
    await setupMember();
    syncStoreState.envelope = buildEnvelope({ m1: { wrapped: 'stale', salt: 'stale' } });
    unwrapWrappedKeyMock.mockResolvedValueOnce(null); // stale entry

    const store = useAuthStore();
    const result = await store.signIn('m1', 'real-pw');

    expect(result.success).toBe(true);
    expect(wrapForMemberMock).toHaveBeenCalledWith('m1', 'real-pw');
    expect(syncNowMock).toHaveBeenCalledWith(true);
  });

  it('re-wraps when wrappedKey entry is missing entirely', async () => {
    await setupMember();
    syncStoreState.envelope = buildEnvelope({}); // no entry for m1

    const store = useAuthStore();
    const result = await store.signIn('m1', 'real-pw');

    expect(result.success).toBe(true);
    expect(unwrapWrappedKeyMock).not.toHaveBeenCalled();
    expect(wrapForMemberMock).toHaveBeenCalledWith('m1', 'real-pw');
    expect(syncNowMock).toHaveBeenCalledWith(true);
  });

  it('sign-in still succeeds when syncNow fails (banner handles user surface)', async () => {
    await setupMember();
    syncStoreState.envelope = buildEnvelope({ m1: { wrapped: 'stale', salt: 'stale' } });
    unwrapWrappedKeyMock.mockResolvedValueOnce(null);
    syncNowMock.mockResolvedValueOnce(false);

    const store = useAuthStore();
    const result = await store.signIn('m1', 'real-pw');

    // Auth succeeded — heal failure is non-blocking.
    expect(result.success).toBe(true);
  });

  it('sign-in still succeeds when wrap throws unexpectedly + shows error toast', async () => {
    await setupMember();
    syncStoreState.envelope = buildEnvelope({ m1: { wrapped: 'stale', salt: 'stale' } });
    unwrapWrappedKeyMock.mockResolvedValueOnce(null);
    wrapForMemberMock.mockRejectedValueOnce(new Error('crypto API gone'));

    const store = useAuthStore();
    const result = await store.signIn('m1', 'real-pw');

    expect(result.success).toBe(true);
    // wrap throw is caught inside rotateMemberPassword (returns wrapFailed),
    // not by the defensive outer catch. No defensive toast in this path —
    // reportError captures it for telemetry, banner handles sync, sign-in OK.
  });

  it('skips heal when envelope is null (cache-only / passkey sign-in)', async () => {
    await setupMember();
    syncStoreState.envelope = null;

    const store = useAuthStore();
    const result = await store.signIn('m1', 'real-pw');

    expect(result.success).toBe(true);
    expect(unwrapWrappedKeyMock).not.toHaveBeenCalled();
    expect(wrapForMemberMock).not.toHaveBeenCalled();
  });

  it('skips heal when familyKey is null', async () => {
    await setupMember();
    syncStoreState.envelope = buildEnvelope({ m1: { wrapped: 'stale', salt: 'stale' } });
    syncStoreState.familyKey = null;

    const store = useAuthStore();
    const result = await store.signIn('m1', 'real-pw');

    expect(result.success).toBe(true);
    expect(wrapForMemberMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resetMemberPassword — every authz reject + every RotateError propagation.
// ─────────────────────────────────────────────────────────────────────────
describe('authStore.resetMemberPassword', () => {
  it('rejects when not authenticated', async () => {
    const store = useAuthStore();
    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'notAuthenticated' });
  });

  it('rejects when caller tries to reset themselves', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true, role: 'admin' });
    membersRef.value = [me];
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('admin', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'cannotResetSelf' });
    expect(wrapForMemberMock).not.toHaveBeenCalled();
  });

  it('rejects when target not found', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    membersRef.value = [me];
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('ghost', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'memberNotFound' });
  });

  it('rejects pets', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const pet = await memberWithPassword('p1', 'na', { isPet: true });
    membersRef.value = [me, pet];
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('p1', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'isPet' });
  });

  it('rejects owner target (must use Settings → Change Password)', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const owner = await memberWithPassword('o1', 'pw', { role: 'owner' });
    membersRef.value = [me, owner];
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('o1', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'cannotResetOwner' });
  });

  it('rejects non-admin caller (canManagePod false)', async () => {
    const me = await memberWithPassword('me', 'pw', { canManagePod: false });
    const target = await memberWithPassword('m2', 'pw');
    membersRef.value = [me, target];
    const store = useAuthStore();
    store.currentUser = { memberId: 'me', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'notAuthorized' });
    expect(wrapForMemberMock).not.toHaveBeenCalled();
  });

  it('propagates familyKeyMissing from rotateMemberPassword', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'pw');
    membersRef.value = [me, target];
    syncStoreState.familyKey = null;
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'familyKeyMissing' });
  });

  it('propagates wrapFailed when wrapFamilyKeyForMember throws', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'pw');
    membersRef.value = [me, target];
    wrapForMemberMock.mockRejectedValueOnce(new Error('crypto failure'));

    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'wrapFailed' });
    // passwordHash NOT updated when wrap failed
    expect(updateMemberMock).not.toHaveBeenCalled();
  });

  it('propagates updateFailed when updateMember returns null', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'pw');
    membersRef.value = [me, target];
    updateMemberMock.mockResolvedValueOnce(null);

    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'updateFailed' });
  });

  it('happy path — calls wrap + updateMember + syncNow, returns syncDeferred:false', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'oldpw');
    membersRef.value = [me, target];
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: true, syncDeferred: false });
    expect(wrapForMemberMock).toHaveBeenCalledWith('m2', 'temp-pw');
    expect(updateMemberMock).toHaveBeenCalledWith(
      'm2',
      expect.objectContaining({ passwordHash: expect.any(String), requiresPassword: false })
    );
    expect(syncNowMock).toHaveBeenCalledWith(true);
  });

  it('returns syncDeferred:true when syncNow fails', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'oldpw');
    membersRef.value = [me, target];
    syncNowMock.mockResolvedValueOnce(false);
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: true, syncDeferred: true });
  });

  // Regression (2026-07-15): a degraded Drive sync made syncNow(true) hang
  // forever, so rotateMemberPassword never resolved → the reset modal's spinner
  // spun indefinitely. raceTimeout now bounds the post-rotation push: the
  // rotation still succeeds (already cached) and reports syncDeferred:true.
  it('still resolves (syncDeferred:true) when syncNow never settles — spinner-hang fix', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'oldpw');
    membersRef.value = [me, target];
    // Never-settling push simulates a wedged worker / offline Drive. Real timers
    // here (rotateMemberPassword awaits real PBKDF2 before the raceTimeout, which
    // doesn't flush under fake timers); the raceTimeout ceiling is 5s, so the
    // test timeout is raised to give it headroom. Pre-fix this hung forever.
    syncNowMock.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: true, syncDeferred: true });
    expect(syncNowMock).toHaveBeenCalledWith(true);
  }, 10000);
});
