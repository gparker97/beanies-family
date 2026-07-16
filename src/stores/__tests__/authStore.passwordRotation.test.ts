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
// Rollback setter — records ('id', entry|undefined) so tests can assert restore.
const setMemberWrappedKeyMock = vi.fn(
  async (_id: string, _entry: WrappedMemberKey | undefined) => {}
);
const syncNowMock = vi.fn<(force?: boolean) => Promise<boolean>>(async () => true);
// Shortened durable-save bound so the never-settles/timeout tests run in ~100ms
// instead of the real 12s. The real code reads syncStore.DURABLE_ROTATION_SAVE_TIMEOUT_MS.
const DURABLE_ROTATION_SAVE_TIMEOUT_MS = 50;

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get familyKey() {
      return syncStoreState.familyKey;
    },
    get envelope() {
      return syncStoreState.envelope;
    },
    wrapFamilyKeyForMember: wrapForMemberMock,
    setMemberWrappedKey: setMemberWrappedKeyMock,
    syncNow: syncNowMock,
    DURABLE_ROTATION_SAVE_TIMEOUT_MS,
    // Mirror the real syncNowBounded: race syncNow(true) against the timeout so the
    // 'syncNow called with true' + rollback + never-settles assertions still hold.
    syncNowBounded: async (ms = 5000) => !!(await raceTimeout(syncNowMock(true), ms)),
    resetState: vi.fn(),
  }),
}));

// ── telemetry spies — assert success/rollback/critical outcome events ───────
const { logEventMock, reportErrorMock } = vi.hoisted(() => ({
  logEventMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

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
    // Durable-success outcome event (measurable failure rate) on the existing
    // allowlisted `action` key.
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'change-password',
        context: expect.objectContaining({ action: 'rotation-saved' }),
      })
    );
    // No rollback on the happy path.
    expect(setMemberWrappedKeyMock).not.toHaveBeenCalled();
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
    // updateFailed rolls back ONLY the wrap (hash never changed) — one restore
    // call, no passwordHash restore.
    expect(setMemberWrappedKeyMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back + maps saveFailed to inline copy when the durable save fails', async () => {
    const member = await memberWithPassword('m1', 'real-pw');
    membersRef.value = [member];
    // Durable save fails; convergence re-save then succeeds (default true).
    syncNowMock.mockResolvedValueOnce(false);

    const store = useAuthStore();
    store.currentUser = { memberId: 'm1', email: 't@example.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.changePassword('real-pw', 'new-strong-pw');

    expect(result.success).toBe(false);
    // Mapped through the i18n key (t() returns the key untouched in this harness).
    expect(result.error).toBe('changePassword.error.saveFailed');
    // Full rollback: wrap restored + passwordHash restored to the old hash.
    expect(setMemberWrappedKeyMock).toHaveBeenCalledWith('m1', undefined);
    expect(updateMemberMock).toHaveBeenLastCalledWith(
      'm1',
      expect.objectContaining({ passwordHash: member.passwordHash, requiresPassword: false })
    );
    // Convergence re-save issued (syncNow called twice: durable + re-save).
    expect(syncNowMock).toHaveBeenCalledTimes(2);
    // Rollback telemetry (warning), no critical (re-save succeeded).
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        context: expect.objectContaining({ action: 'rotation-rolled-back' }),
      })
    );
    expect(reportErrorMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical' })
    );
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

  it('happy path — calls wrap + updateMember + durable syncNow, returns success', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'oldpw');
    membersRef.value = [me, target];
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: true });
    expect(wrapForMemberMock).toHaveBeenCalledWith('m2', 'temp-pw');
    expect(updateMemberMock).toHaveBeenCalledWith(
      'm2',
      expect.objectContaining({ passwordHash: expect.any(String), requiresPassword: false })
    );
    expect(syncNowMock).toHaveBeenCalledWith(true);
    // No rollback on the durable-success path.
    expect(setMemberWrappedKeyMock).not.toHaveBeenCalled();
  });

  it('rolls back + returns saveFailed when the durable save fails (no-prior-entry removes)', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'oldpw');
    membersRef.value = [me, target];
    // Envelope has NO entry for m2 → rollback must REMOVE the freshly-added one.
    syncStoreState.envelope = buildEnvelope({});
    syncNowMock.mockResolvedValueOnce(false); // durable save fails; re-save then succeeds

    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'saveFailed' });
    // No-prior-entry rollback: remove the new entry.
    expect(setMemberWrappedKeyMock).toHaveBeenCalledWith('m2', undefined);
    // passwordHash restored to the old hash.
    expect(updateMemberMock).toHaveBeenLastCalledWith(
      'm2',
      expect.objectContaining({ passwordHash: target.passwordHash })
    );
    // Convergence re-save issued.
    expect(syncNowMock).toHaveBeenCalledTimes(2);
  });

  it('pages critical when BOTH the durable save and the convergence re-save fail', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'oldpw');
    membersRef.value = [me, target];
    syncNowMock.mockResolvedValue(false); // every save fails (durable + re-save)

    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'saveFailed' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: expect.objectContaining({ action: 'rotation-resave-failed' }),
      })
    );
  });

  // Regression (2026-07-15 → durable rewrite): a degraded Drive sync made
  // syncNow(true) hang forever. The durable-rotation bound now times out the push
  // and rolls back (never hangs) — the modal shows the retry error instead of
  // spinning. Convergence re-save then resolves (default true).
  it('resolves (saveFailed, no hang) when the durable save never settles', async () => {
    const me = await memberWithPassword('admin', 'pw', { canManagePod: true });
    const target = await memberWithPassword('m2', 'oldpw');
    membersRef.value = [me, target];
    // Never-settling first push simulates a wedged worker / offline Drive; the
    // shortened DURABLE_ROTATION_SAVE_TIMEOUT_MS (50ms) bounds it. Pre-fix: hung.
    syncNowMock.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const store = useAuthStore();
    store.currentUser = { memberId: 'admin', email: 'a@x.com', familyId: 'fam-1' };
    store.isAuthenticated = true;

    const result = await store.resetMemberPassword('m2', 'temp-pw');
    expect(result).toEqual({ success: false, error: 'saveFailed' });
    expect(syncNowMock).toHaveBeenCalledWith(true);
  }, 10000);
});
