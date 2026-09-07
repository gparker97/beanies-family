/**
 * A restore restores; it does not move the family.
 *
 * ⚠️ TWO OPPOSITE MISTAKES, ONE PREDICATE. These tests pin both.
 *
 *   1. NOT suppressing the re-home is the reported bug: loading a file re-homed
 *      the whole family onto the picked file. On Chromium desktop that meant a
 *      Drive family silently became a LOCAL-file family and every peer was
 *      stranded on the old pod. And once the Settings picker learned to offer
 *      Drive files, the SAME code would have pointed the family at the
 *      pre-compaction SAFETY COPY and moved the registry pointer behind it —
 *      the exact ADR-033 fork that `rebindPodFile`'s `isSafetyCopyName` refusal
 *      exists to prevent, reached by a different door. So the suppression must
 *      cover BOTH branches, and the Drive one is the easy one to miss.
 *
 *   2. Suppressing it UNCONDITIONALLY is a fresh bug in the other direction. The
 *      same Settings handlers serve the unconfigured "load existing data file"
 *      slab, where there is no pod yet — skipping the install there opens the
 *      document with nowhere to save it.
 *
 * `hasPod` decides both the confirmation wording and the flag, and
 * `installPendingProvider` enforces it again as a backstop.
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
  getActiveFamilyId: vi.fn(() => 'fam-1'),
  setActiveFamily: vi.fn(async () => {}),
  closeDatabase: vi.fn(async () => {}),
  deleteFamilyDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/familyContext', () => ({
  createNewFamily: vi.fn(),
  activateFamily: vi.fn(async () => null),
  getAllFamilies: vi.fn(async () => []),
  getLastActiveFamily: vi.fn(async () => null),
  createFamilyWithId: vi.fn(async () => ({ id: 'fam-1', name: 'Test' })),
  hasActiveFamily: vi.fn(() => true),
}));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/fileSync')>()),
  tryUnwrapFamilyKey: vi.fn(async () => ({ familyKey: {} as CryptoKey, memberIds: ['m-1'] })),
}));
vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(async () => {}),
  whenRedirectAuthSettled: vi.fn(async () => {}),
  isTokenValid: vi.fn(() => true),
  onTokenAcquired: vi.fn(() => () => {}),
  onTokenPermanentlyExpired: vi.fn(() => () => {}),
}));

const providerType = vi.hoisted(() => ({ value: 'google_drive' as string | null }));
vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('@/services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onStateChange: vi.fn(() => () => {}),
    getProviderType: vi.fn(() => providerType.value),
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
}));

import { useSyncStore } from '@/stores/syncStore';
import type { StorageProvider } from '@/services/sync/storageProvider';

const ENVELOPE = {
  version: '4.0' as const,
  familyId: 'fam-1',
  familyName: 'Test',
  keyId: 'k',
  wrappedKeys: { 'm-1': { salt: 'AAAA', wrapped: 'BBBB' } },
  passkeyWrappedKeys: {},
  inviteKeys: {},
  encryptedPayload: 'base64==',
};

/**
 * A local-file provider, as `openAndLoadFile` hands one back.
 *
 * Typed through `StorageProvider` so a change to that interface fails HERE
 * rather than letting the test drift into asserting against a shape production
 * no longer uses.
 */
function localProvider(): StorageProvider {
  return {
    type: 'local',
    persist: persistMock,
    read: vi.fn(async () => ''),
    write: vi.fn(async () => {}),
    getDisplayName: () => 'restored.beanpod',
    getFileId: () => null,
    getAccountEmail: () => null,
    getLastModified: vi.fn(async () => null),
    isReady: vi.fn(async () => true),
    requestAccess: vi.fn(async () => true),
    clearPersisted: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  } as unknown as StorageProvider;
}

describe('restore keeps the family on its existing pod', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    providerType.value = 'google_drive';
  });

  it('does NOT re-home on the LOCAL branch when the family already has a pod', async () => {
    const sync = useSyncStore();
    sync.isConfigured = true;
    sync.pendingEncryptedFile = { envelope: ENVELOPE, provider: localProvider() };

    await sync.decryptPendingFile('pw', { userChoseThisFile: true, keepCurrentPod: true });

    expect(persistMock).not.toHaveBeenCalled();
    expect(setProviderMock).not.toHaveBeenCalled();
  });

  it('does NOT re-home on the DRIVE branch either — the ADR-033 fork', async () => {
    // ⚠️ THE MUTATION THAT MATTERS. Suppressing only the local branch ships a
    // restore that points the family at its own pre-compaction safety copy and
    // moves the registry pointer behind it, so every member is healed onto the
    // backup. Delete the Drive half of the guard and this test must fail.
    const sync = useSyncStore();
    sync.isConfigured = true;
    sync.pendingEncryptedFile = {
      envelope: ENVELOPE,
      driveFileId: 'safety-copy-file-id',
      driveFileName: 'Test (before compacting).beanpod',
      driveAccountEmail: 'owner@example.com',
    };

    await sync.decryptPendingFile('pw', { userChoseThisFile: true, keepCurrentPod: true });

    expect(storeProviderConfigMock).not.toHaveBeenCalled();
    expect(clearFileHandleForFamilyMock).not.toHaveBeenCalled();
    expect(setProviderMock).not.toHaveBeenCalled();
  });

  it('DOES re-home when the family has no pod yet — a first load must not be stranded', async () => {
    // ⚠️ THE OPPOSITE MISTAKE. The unconfigured Settings slab shares these
    // handlers; honouring `keepCurrentPod` there would open the document with
    // nowhere to save it. `installPendingProvider` re-homes anyway and logs.
    const sync = useSyncStore();
    sync.isConfigured = false;
    providerType.value = null;
    sync.pendingEncryptedFile = { envelope: ENVELOPE, provider: localProvider() };

    await sync.decryptPendingFile('pw', { userChoseThisFile: true, keepCurrentPod: true });

    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(setProviderMock).toHaveBeenCalledTimes(1);
  });

  it('re-homes normally when no restore was requested', async () => {
    const sync = useSyncStore();
    sync.isConfigured = true;
    sync.pendingEncryptedFile = { envelope: ENVELOPE, provider: localProvider() };

    await sync.decryptPendingFile('pw', { userChoseThisFile: true });

    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(setProviderMock).toHaveBeenCalledTimes(1);
  });

  // ⚠️ NO RUNTIME TEST FOR "the passkey/PIN path cannot request a restore".
  // `decryptPendingFileWithKey` has no `opts` bag, deliberately (its own comment
  // says so), and that is enforced by the COMPILER — passing one is a type
  // error. The obvious runtime assertion, `fn.length === 1`, is worthless here:
  // Pinia wraps every action, so arity reports 0 regardless and the check would
  // pass while the parameter existed. A guard that cannot observe what it claims
  // is the failure mode this whole change set exists to stop, so it is stated
  // here instead of faked.
});
