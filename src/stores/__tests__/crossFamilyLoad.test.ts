/**
 * Loading ANOTHER family's file must leave a working app, not a crippled one.
 *
 * ⚠️ THE BUG THIS PINS. `reloadAllStores()` → `familyStore.loadMembers` resolves
 * who you are against the roster it just loaded, and on a cross-family load the
 * session it finds names the PREVIOUS family's member: present, authenticated,
 * and absent from this pod. `resolveSessionMember` correctly refuses to fall
 * through to the owner — that IS the escalation it exists to stop — so it
 * rejects the session, and the app rendered with every permission false: no
 * sidebar, no Family Data section. A page refresh fixed it, which is how it
 * reached a user twice.
 *
 * The fix is ordering, not repair: bind the identity BEFORE the roster loads, so
 * the rejection never fires. `memberIds` is earned — it lists the members whose
 * wrapped key the password just opened — and it is trusted only when there is
 * exactly one, because more than one cannot say WHICH person this is.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const { storeProviderConfigMock, clearFileHandleForFamilyMock, persistMock, setProviderMock } =
  vi.hoisted(() => ({
    storeProviderConfigMock: vi.fn(async () => {}),
    clearFileHandleForFamilyMock: vi.fn(async () => {}),
    persistMock: vi.fn(async () => {}),
    setProviderMock: vi.fn(),
  }));

vi.mock('@/services/sync/fileHandleStore', () => ({
  storeProviderConfig: storeProviderConfigMock,
  clearFileHandleForFamily: clearFileHandleForFamilyMock,
  getProviderConfig: vi.fn(async () => null),
  clearProviderConfig: vi.fn(async () => {}),
  storeFileHandle: vi.fn(async () => {}),
  getFileHandle: vi.fn(async () => null),
  clearFileHandle: vi.fn(async () => {}),
  verifyPermission: vi.fn(async () => true),
  hasValidFileHandle: vi.fn(async () => false),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'fam-old'),
  setActiveFamily: vi.fn(async () => {}),
  closeDatabase: vi.fn(async () => {}),
  deleteFamilyDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/familyContext', () => ({
  createNewFamily: vi.fn(),
  activateFamily: vi.fn(async () => null),
  getAllFamilies: vi.fn(async () => []),
  getLastActiveFamily: vi.fn(async () => null),
  // Echo the id it was asked for, or the harness would report a family switch
  // on every load and the same-family case could never be expressed.
  createFamilyWithId: vi.fn(async (id: string, name: string) => ({ id, name })),
  hasActiveFamily: vi.fn(() => true),
}));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/fileSync')>()),
  tryUnwrapFamilyKey: vi.fn(async () => ({
    familyKey: {} as CryptoKey,
    memberIds: memberIds.value,
  })),
}));
vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(async () => {}),
  whenRedirectAuthSettled: vi.fn(async () => {}),
  isTokenValid: vi.fn(() => true),
  onTokenAcquired: vi.fn(() => () => {}),
  onTokenPermanentlyExpired: vi.fn(() => () => {}),
}));

/** Who the password opened a wrapped key for. One id = an unambiguous identity. */
const memberIds = vi.hoisted(() => ({ value: ['m-new'] as string[] }));
const providerType = vi.hoisted(() => ({ value: 'google_drive' as string | null }));
/** Which family the INSTALLED provider belongs to — not necessarily this one. */
const providerFamilyId = vi.hoisted(() => ({ value: 'fam-1' as string | null }));
vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('@/services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onStateChange: vi.fn(() => () => {}),
    getProviderType: vi.fn(() => providerType.value),
    getProviderFamilyId: vi.fn(() => providerFamilyId.value),
    setProvider: setProviderMock,
    setFamilyKey: vi.fn(),
  };
});
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: {
    fromExisting: vi.fn(() => ({ type: 'google_drive' })),
    createNew: vi.fn(),
  },
}));
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(async () => {}),
  initAndLoadCache: vi.fn(async () => ({ loaded: true, remoteBaseline: null })),
  mergeRemoteEnvelope: vi.fn(async () => ({
    action: 'merged' as const,
    heads: [],
    dirty: false,
    changed: true,
    remoteHeads: [],
  })),
  persistEnvelope: vi.fn(async () => {}),
  reseedCacheFromLiveDoc: vi.fn(async () => ({ reseeded: true })),
  verifyEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64==' })),
  dropDoc: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  clearCache: vi.fn(async () => {}),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  logMergeTerminus: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  mutate: vi.fn(async () => undefined),
  fireAndForgetMutate: vi.fn(),
}));

import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';
import type { StorageProvider } from '@/services/sync/storageProvider';

/** The file belongs to a DIFFERENT family than the one currently open. */
const OTHER_FAMILY_ENVELOPE = {
  version: '4.0' as const,
  familyId: 'fam-new',
  familyName: 'Their Family',
  keyId: 'k',
  wrappedKeys: { 'm-new': { salt: 'AAAA', wrapped: 'BBBB' } },
  passkeyWrappedKeys: {},
  inviteKeys: {},
  encryptedPayload: 'base64==',
};

/** The new family's roster. The previous family's member is NOT in it. */
const NEW_ROSTER = [
  { id: 'm-new', name: 'Ada', email: 'ada@example.com', role: 'member' as const },
  { id: 'm-owner', name: 'Owner', email: 'owner@example.com', role: 'owner' as const },
];

function localProvider(): StorageProvider {
  return {
    type: 'local',
    persist: persistMock,
    read: vi.fn(async () => ''),
    write: vi.fn(async () => {}),
    getDisplayName: () => 'theirs.beanpod',
    getFileId: () => null,
    getAccountEmail: () => null,
    getLastModified: vi.fn(async () => null),
    isReady: vi.fn(async () => true),
    requestAccess: vi.fn(async () => true),
    clearPersisted: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  } as unknown as StorageProvider;
}

describe("loading another family's data file", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    memberIds.value = ['m-new'];
    providerType.value = 'local';
    providerFamilyId.value = 'fam-old';
    vi.spyOn(familyRepo, 'getAllFamilyMembers').mockResolvedValue(
      NEW_ROSTER as unknown as Awaited<ReturnType<typeof familyRepo.getAllFamilyMembers>>
    );
  });

  /** An authenticated session belonging to the family we are leaving. */
  function signedIntoPreviousFamily() {
    const auth = useAuthStore();
    auth.currentUser = { memberId: 'm-old', email: 'a@b.c', familyId: 'fam-old', role: 'owner' };
    auth.isAuthenticated = true;
    const family = useFamilyStore();
    family.currentMemberId = 'm-old';
    useFamilyContextStore().activeFamily = {
      id: 'fam-old',
      name: 'Our Family',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
  }

  it('binds the identity BEFORE the roster loads, so the session is never rejected', async () => {
    signedIntoPreviousFamily();
    const sync = useSyncStore();
    sync.isConfigured = true;
    sync.pendingEncryptedFile = { envelope: OTHER_FAMILY_ENVELOPE, provider: localProvider() };

    const result = await sync.decryptPendingFile('pw', {
      userChoseThisFile: true,
      keepCurrentPod: false,
    });

    expect(result.success).toBe(true);
    // The app is usable: somebody real is bound, and nothing was rejected.
    expect(useFamilyStore().currentMemberId).toBe('m-new');
    expect(useAuthStore().sessionRejected).toBe(false);
  });

  it('binds NOBODY when the password opened more than one wrapped key', async () => {
    // Guessing would hand this person another member's permissions. The caller
    // asks instead — `SettingsPage` closes the modal and says so.
    memberIds.value = ['m-new', 'm-owner'];
    signedIntoPreviousFamily();
    const sync = useSyncStore();
    sync.isConfigured = true;
    sync.pendingEncryptedFile = { envelope: OTHER_FAMILY_ENVELOPE, provider: localProvider() };

    await sync.decryptPendingFile('pw', { userChoseThisFile: true, keepCurrentPod: false });

    expect(useFamilyStore().currentMemberId).not.toBe('m-new');
  });

  it('does NOT re-bind when the file belongs to the family already open', async () => {
    // A restore is not a family switch. The session is already correct and this
    // must not touch it.
    signedIntoPreviousFamily();
    const sync = useSyncStore();
    sync.isConfigured = true;
    sync.pendingEncryptedFile = {
      envelope: { ...OTHER_FAMILY_ENVELOPE, familyId: 'fam-old' },
      provider: localProvider(),
    };

    await sync.decryptPendingFile('pw', { userChoseThisFile: true, keepCurrentPod: true });

    expect(useFamilyStore().currentMemberId).not.toBe('m-new');
  });
});

describe('the recovery-kit sign-in binds identity too (the owner-with-no-permissions bug)', () => {
  // ⚠️ ITS OWN `setActivePinia`. The describe above has one in ITS `beforeEach`, which does
  // not reach this block — so these passed only when the whole file ran in order and failed on
  // `-t` or `.only`, the two ways anyone actually runs a single test while fixing it.
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  /**
   * ⚠️ THE SAME BUG, ON THE OTHER DECRYPT PATH — reported by a pod OWNER.
   *
   * Signing in with the recovery kit and setting a new PIN left the owner with no permissions at
   * all: could not edit family members, no Family Data section. Signing out and back in fixed it.
   *
   * That signature is exact. `usePermissions` ignores the session role once the roster is loaded
   * (`rosterLoaded`), so an unresolved `currentMember` over a populated roster is every permission
   * false. And sign-out/sign-in "fixes" it only because it forces a fresh `loadMembers`, which is
   * the single place identity is ever re-resolved.
   *
   * The mechanism: `setCurrentMember` checks the id against `members` and does NOTHING when it is
   * absent — silently. The kit path decrypts via `decryptPendingFileWithKey`, which has no
   * identity-before-roster bind (unlike the password path tested above), so the roster can be
   * empty or stale at the moment the session tail runs.
   */
  it('setCurrentMember is a SILENT no-op for an id the roster does not hold', () => {
    const family = useFamilyStore();
    family.members = [] as never;
    family.setCurrentMember('m-owner');
    // No throw, no warning, no assignment. This silence is the entire defect.
    expect(family.currentMemberId).toBeNull();
  });

  it('preselectSessionMember binds anyway, deferring the check to loadMembers', () => {
    const family = useFamilyStore();
    family.members = [] as never;
    family.preselectSessionMember('m-owner');
    expect(family.currentMemberId).toBe('m-owner');
  });

  it('resetMemberPinViaRecovery uses the binding call that cannot silently fail', async () => {
    // A source-level guard, because the runtime path needs the whole kit-redeem stack. It pins
    // the one line that mattered: swapping it back to `setCurrentMember` reintroduces the bug
    // with every existing test still green, which is how it shipped.
    // ⚠️ COMMENTS STRIPPED. The sibling guard in `joinClaimRollback.test.ts` learned this the
    // hard way: a prose mention in an explanatory comment satisfied the assertion, so deleting
    // the real call left the test green. Shared helper, so there is one implementation of the
    // stripping rather than two that can drift.
    const { codeOfAuthStoreFn } = await import('./helpers/authStoreSource');
    const fn = await codeOfAuthStoreFn(
      'async function resetMemberPinViaRecovery',
      'async function verifyMemberPin'
    );
    expect(fn).toContain('preselectSessionMember');
    expect(fn).not.toContain('familyStore.setCurrentMember(');
  });
});

describe('round 3, item 1: a cross-family decrypt that fails past its key swap restores the previous family', () => {
  const KEY_A = { id: 'key-a' } as unknown as CryptoKey;

  async function failingCrossFamilyDecrypt() {
    const docClient = await import('@/services/automerge/worker/docClient');
    const syncService = await import('@/services/sync/syncService');
    const release = vi.fn();
    vi.mocked(syncService.holdSaves).mockReturnValueOnce(release);
    // The merge of the OTHER family's file fails after its key was posted.
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(new Error('merge boom'));
    const sync = useSyncStore();
    sync.familyKey = KEY_A;
    sync.isConfigured = true;
    sync.pendingEncryptedFile = { envelope: OTHER_FAMILY_ENVELOPE, provider: localProvider() };
    const result = await sync.decryptPendingFile('pw', { userChoseThisFile: true });
    return { docClient, syncService, release, result, sync };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    memberIds.value = ['m-new'];
    providerType.value = 'local';
    providerFamilyId.value = 'fam-old';
  });

  it('waits for in-flight sync work, swaps, then puts family A back BEFORE the hold releases', async () => {
    const { docClient, syncService, release, result, sync } = await failingCrossFamilyDecrypt();
    expect(result.success).toBe(false);
    const keyPosts = vi.mocked(docClient.setFamilyKey).mock.calls.map((c) => c[1]);
    expect(keyPosts).toEqual(['fam-new', 'fam-old']);
    expect(vi.mocked(syncService.whenIdle).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(docClient.setFamilyKey).mock.invocationCallOrder[0]!
    );
    expect(vi.mocked(docClient.initAndLoadCache).mock.calls.at(-1)).toEqual(['fam-old']);
    expect(release).toHaveBeenCalledTimes(1);
    expect(vi.mocked(docClient.initAndLoadCache).mock.invocationCallOrder.at(-1)).toBeLessThan(
      release.mock.invocationCallOrder[0]!
    );
    expect(sync.familyKey).toBe(KEY_A);
  });

  it('a restore that cannot reload family A keeps the hold latched and raises the fatal overlay', async () => {
    const docClient = await import('@/services/automerge/worker/docClient');
    vi.mocked(docClient.initAndLoadCache)
      .mockResolvedValueOnce({ loaded: true, remoteBaseline: null }) // family B's cache
      .mockResolvedValueOnce({ loaded: false, remoteBaseline: null }); // family A's: a miss
    const { release, result } = await failingCrossFamilyDecrypt();
    expect(result.success).toBe(false);
    expect(release).not.toHaveBeenCalled();
    const { useFatalErrorStore } = await import('@/stores/fatalErrorStore');
    expect(useFatalErrorStore().message).not.toBeNull();
    const { reportError } = await import('@/utils/errorReporter');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: expect.objectContaining({ action: 'cross-family-restore-failed' }),
      })
    );
  });

  it('the swap is marked (hold epoch) after whenIdle and before the key post', async () => {
    const { docClient, syncService } = await failingCrossFamilyDecrypt();
    const idle = vi.mocked(syncService.whenIdle).mock.invocationCallOrder[0]!;
    const epoch = vi.mocked(syncService.advanceHoldEpoch).mock.invocationCallOrder[0]!;
    const post = vi.mocked(docClient.setFamilyKey).mock.invocationCallOrder[0]!;
    expect(idle).toBeLessThan(epoch);
    expect(epoch).toBeLessThan(post);
  });

  it('nothing unlocked before (loading B from the login screen): reset the worker, release, no fatal', async () => {
    const docClient = await import('@/services/automerge/worker/docClient');
    const syncService = await import('@/services/sync/syncService');
    const release = vi.fn();
    vi.mocked(syncService.holdSaves).mockReturnValueOnce(release);
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(new Error('merge boom'));
    const sync = useSyncStore();
    // A cold boot restored family A's provider; nothing is unlocked (no family key).
    sync.pendingEncryptedFile = { envelope: OTHER_FAMILY_ENVELOPE, provider: localProvider() };
    const result = await sync.decryptPendingFile('pw', { userChoseThisFile: true });

    expect(result.success).toBe(false);
    expect(docClient.reset).toHaveBeenCalledTimes(1);
    expect(vi.mocked(docClient.setFamilyKey).mock.calls.map((c) => c[1])).toEqual(['fam-new']);
    expect(release).toHaveBeenCalledTimes(1);
    expect(sync.familyKey).toBeNull();
    const { useFatalErrorStore } = await import('@/stores/fatalErrorStore');
    expect(useFatalErrorStore().message).toBeNull();
    const { reportError } = await import('@/utils/errorReporter');
    expect(reportError).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('nothing unlocked before, failing at installPendingProvider: no key lingers in syncService or the worker', async () => {
    const docClient = await import('@/services/automerge/worker/docClient');
    const syncService = await import('@/services/sync/syncService');
    // Stateful keys: what syncService and the worker would each still hold afterwards.
    let serviceKey: CryptoKey | null = null;
    let workerKey: CryptoKey | null = null;
    vi.mocked(syncService.setFamilyKey).mockImplementation((k) => void (serviceKey = k));
    vi.mocked(syncService.clearFamilyKey).mockImplementation(() => void (serviceKey = null));
    vi.mocked(syncService.getFamilyKey).mockImplementation(() => serviceKey as never);
    vi.mocked(docClient.setFamilyKey).mockImplementation(async (k) => void (workerKey = k));
    vi.mocked(docClient.reset).mockImplementation(async () => void (workerKey = null));
    const release = vi.fn();
    vi.mocked(syncService.holdSaves).mockReturnValueOnce(release);
    persistMock.mockRejectedValueOnce(new Error('persist boom')); // installPendingProvider
    const sync = useSyncStore();
    sync.pendingEncryptedFile = { envelope: OTHER_FAMILY_ENVELOPE, provider: localProvider() };
    const result = await sync.decryptPendingFile('pw', { userChoseThisFile: true });

    expect(result.success).toBe(false);
    expect(syncService.setFamilyKey).toHaveBeenCalled(); // the failed family's key got this far
    expect(syncService.getFamilyKey()).toBeNull();
    expect(workerKey).toBeNull();
    expect(vi.mocked(syncService.clearFamilyKey).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(docClient.reset).mock.invocationCallOrder[0]!
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('no provider before the decrypt: the provider the failed install bound is unbound', async () => {
    const docClient = await import('@/services/automerge/worker/docClient');
    const syncService = await import('@/services/sync/syncService');
    const release = vi.fn();
    vi.mocked(syncService.holdSaves).mockReturnValueOnce(release);
    vi.mocked(syncService.getProvider)
      .mockReturnValueOnce(null) // captured at the start: nothing bound
      .mockReturnValue({ type: 'local', id: 'provider-b' } as never);
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(new Error('merge boom'));
    const sync = useSyncStore();
    sync.familyKey = KEY_A;
    sync.isConfigured = true;
    sync.pendingEncryptedFile = { envelope: OTHER_FAMILY_ENVELOPE, provider: localProvider() };
    expect((await sync.decryptPendingFile('pw', { userChoseThisFile: true })).success).toBe(false);
    expect(syncService.clearProvider).toHaveBeenCalledTimes(1);
    expect(setProviderMock).not.toHaveBeenCalledWith(expect.anything(), 'fam-old');
    expect(release).toHaveBeenCalledTimes(1);
  });

  /** Family A is open; the decrypt of B gets past the family switch and then fails. */
  async function lateFailure() {
    const docClient = await import('@/services/automerge/worker/docClient');
    const syncService = await import('@/services/sync/syncService');
    const familyContext = await import('@/services/familyContext');
    const release = vi.fn();
    vi.mocked(syncService.holdSaves).mockReturnValueOnce(release);
    const providerA = { type: 'local', id: 'provider-a' } as never;
    // Bound at the start; whatever the failed install left bound afterwards is someone else's.
    vi.mocked(syncService.getProvider)
      .mockReturnValueOnce(providerA)
      .mockReturnValue({ type: 'local', id: 'provider-b' } as never);
    persistMock.mockRejectedValueOnce(new Error('persist boom')); // installPendingProvider
    useFamilyContextStore().activeFamily = {
      id: 'fam-old',
      name: 'Our Family',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    const sync = useSyncStore();
    sync.familyKey = KEY_A;
    sync.isConfigured = true;
    sync.pendingEncryptedFile = { envelope: OTHER_FAMILY_ENVELOPE, provider: localProvider() };
    const run = () => sync.decryptPendingFile('pw', { userChoseThisFile: true });
    return { docClient, familyContext, release, providerA, run, sync };
  }

  it('a failure after the family switch puts the active family and the provider back', async () => {
    const { familyContext, release, providerA, run, sync } = await lateFailure();
    vi.mocked(familyContext.activateFamily).mockImplementation(async (id: string) => ({
      id,
      name: 'Our Family',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }));
    expect((await run()).success).toBe(false);
    expect(useFamilyContextStore().activeFamilyId).toBe('fam-old');
    expect(setProviderMock).toHaveBeenLastCalledWith(providerA, 'fam-old');
    expect(sync.familyKey).toBe(KEY_A);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('a failure after the family switch that cannot switch back takes the fatal route', async () => {
    const { familyContext, release, run } = await lateFailure();
    vi.mocked(familyContext.activateFamily).mockResolvedValue(null);
    expect((await run()).success).toBe(false);
    expect(release).not.toHaveBeenCalled(); // saves stay held
    const { useFatalErrorStore } = await import('@/stores/fatalErrorStore');
    expect(useFatalErrorStore().message).not.toBeNull();
  });
});

describe('final pass, item 8: the reseed after a chosen family file logs its own failure', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    providerType.value = 'local';
    providerFamilyId.value = 'fam-old';
  });

  it('error_code is the reseed error, detail carries the original cache cause', async () => {
    const docClient = await import('@/services/automerge/worker/docClient');
    const { CacheInitError } = await import('@/types/sync');
    const { logEvent } = await import('@/services/telemetry/logEvent');
    vi.mocked(docClient.initAndLoadCache).mockRejectedValueOnce(
      new CacheInitError('load', 'something-to-lose', 'QuotaExceededError')
    );
    vi.mocked(docClient.reseedCacheFromLiveDoc).mockRejectedValueOnce(
      Object.assign(new Error('blocked'), { name: 'InvalidStateError' })
    );
    const sync = useSyncStore();
    sync.pendingEncryptedFile = {
      envelope: { ...OTHER_FAMILY_ENVELOPE, familyId: 'fam-old' },
      provider: localProvider(),
    };
    await sync.decryptPendingFile('pw', { userChoseThisFile: true });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          action: 'cache-reseeded-user-choice',
          error_code: 'InvalidStateError',
          detail: 'cause=QuotaExceededError/load/something-to-lose',
        },
      })
    );
  });
});
