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
