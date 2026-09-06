/**
 * Unit tests for `attemptResumeFromRegistry` + `completeAutoLoad`.
 *
 * These are the orchestrators that make `ResumePodSetup` non-destructive —
 * they look up the family's existing pod in the registry and load it
 * instead of calling `createNewFile` (which generated a fresh family key
 * and orphaned the user's real data in the 2026-05-15 incident).
 *
 * UI-independent: each test asserts a specific `kind` in the discriminated
 * result. The UI's role is just to switch on the kind and pick the right
 * surface — covered separately by `ResumePodSetup.test.ts`.
 */
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// The real reporter DEDUPES by surface+message, so a second identical failure in
// the same run records nothing and an assertion on it fails for the wrong reason.
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const { mockLookupFamily, mockProviderRead, mockProvider } = vi.hoisted(() => {
  const mockProviderRead = vi.fn(async () => '');
  const mockProvider = {
    write: vi.fn(async () => {}),
    read: mockProviderRead,
    getAccountEmail: () => null,
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'mock-file-id',
    type: 'google_drive' as const,
  };
  return {
    mockLookupFamily: vi.fn(),
    mockProviderRead,
    mockProvider,
  };
});

vi.mock('@/services/registry/registryService', () => ({
  lookupFamily: mockLookupFamily,
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
}));

// IndexedDB layers — all mocked
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'fam-resume-1'),
  setActiveFamily: vi.fn(async () => {}),
  closeDatabase: vi.fn(async () => {}),
  deleteFamilyDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/indexeddb/registryDatabase', () => ({
  getRegistryDatabase: vi.fn(async () => ({
    getAll: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    add: vi.fn(async () => {}),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  })),
}));
vi.mock('@/services/familyContext', () => ({
  createNewFamily: vi.fn(),
  activateFamily: vi.fn(async () => null),
  getAllFamilies: vi.fn(async () => []),
  getLastActiveFamily: vi.fn(async () => null),
  createFamilyWithId: vi.fn(async () => ({ id: 'fam-resume-1', name: 'Test' })),
  hasActiveFamily: vi.fn(() => true),
}));
// ADR-032: the worker owns decrypt/merge/cache/persist. syncStore drives it via
// docClient. The resume/auto-load orchestrators under test call these RPCs; the
// CorruptPayloadError that is thrown by the worker's loadAndVerify (the old
// main-thread fileSync.decryptBeanpodPayload copy was deleted 2026-08-13)
// now surfaces from docClient.mergeRemoteEnvelope (worker decrypt + materialize).
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(async () => {}),
  persistEnvelope: vi.fn(async () => {}),
  initAndLoadCache: vi.fn(async () => ({ loaded: false, remoteBaseline: null })),
  mergeRemoteEnvelope: vi.fn(async () => ({
    action: 'merged' as const,
    dirty: false,
  })),
  // The adopt half of the lineage guard. Absent here, a test that exercises
  // an adopt or a publish-local throws 'No export is defined' instead of
  // asserting anything — the same blind spot as the syncService mock.
  adoptRemoteEnvelope: vi.fn(async () => ({
    heads: [],
    dirty: false,
    changed: true,
    remoteHeads: [],
  })),
  verifyEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64==' })),
  dropDoc: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  clearCache: vi.fn(async () => {}),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
}));
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
    lastActiveFamilyId: null,
    exchangeRates: [],
    exchangeRateAutoUpdate: true,
    exchangeRateLastFetch: null,
    isTrustedDevice: false,
    trustedDevicePromptShown: false,
  }),
  getGlobalSettings: vi.fn(async () => ({})),
  saveGlobalSettings: vi.fn(async () => ({})),
}));
vi.mock('@/services/indexeddb/repositories/translationCacheRepository', () => ({
  getTranslationCache: vi.fn(async () => null),
  saveTranslationCache: vi.fn(async () => {}),
}));

// Sync service
vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onStateChange: vi.fn(() => () => {}),
    getProvider: vi.fn(() => mockProvider),
    getProviderType: vi.fn(() => 'google_drive'),
    setProvider: vi.fn(),
    setFamilyKey: vi.fn(),
  };
});
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({
    fileSystemAccess: true,
    showSaveFilePicker: true,
    showOpenFilePicker: true,
    webCrypto: true,
    googleDrive: true,
    manualSync: true,
  }),
  canAutoSync: () => true,
}));

// Google layers
vi.mock('@/services/google/googleAuth', () => ({
  whenRedirectAuthSettled: vi.fn(async () => {}),
  initializeAuth: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenAcquired: vi.fn(() => () => {}),
  onTokenPermanentlyExpired: vi.fn(() => () => {}),
  fetchGoogleUserEmail: vi.fn(async () => 'owner@example.com'),
  isTokenValid: vi.fn(() => true),
  shouldUseRedirectAuth: vi.fn(() => false),
  startRedirectAuth: vi.fn(async () => {}),
  isSilentRefreshPending: vi.fn(() => false),
  isUserCancellation: vi.fn(() => false),
  migratePendingRefreshToken: vi.fn(async () => {}),
  getLastSilentRefreshDiagnostics: vi.fn(() => null),
}));
vi.mock('@/services/google/driveService', () => ({
  getOrCreateAppFolder: vi.fn(async () => 'folder-id'),
  listBeanpodFiles: vi.fn(async () => []),
  searchBeanpodFilesGlobal: vi.fn(async () => []),
  clearFolderCache: vi.fn(),
  getAppFolderId: vi.fn(() => null),
  DriveApiError: class DriveApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: {
    fromExisting: vi.fn(() => mockProvider),
    createNew: vi.fn(),
  },
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  storeFileHandle: vi.fn(async () => {}),
  getFileHandle: vi.fn(async () => null),
  clearFileHandle: vi.fn(async () => {}),
  verifyPermission: vi.fn(async () => true),
  hasValidFileHandle: vi.fn(async () => false),
  getProviderConfig: vi.fn(async () => null),
  storeProviderConfig: vi.fn(async () => {}),
  clearProviderConfig: vi.fn(async () => {}),
  clearFileHandleForFamily: vi.fn(async () => {}),
}));
vi.mock('@/services/sync/offlineQueue', () => ({
  clearQueue: vi.fn(),
}));

// File sync — keep parseBeanpodV4 + detectFileVersion real-shape but mock the
// key-unwrap (crypto). Decrypt/materialize now lives in the worker (docClient).
vi.mock('@/services/sync/fileSync', async () => {
  const actual = await vi.importActual<typeof import('@/services/sync/fileSync')>(
    '@/services/sync/fileSync'
  );
  return {
    ...actual,
    tryUnwrapFamilyKey: vi.fn(),
  };
});

// Auth-related
vi.mock('@/services/auth/passwordService', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed-${pw}`),
  verifyPassword: vi.fn(async () => true),
}));
vi.mock('@/services/auth/passkeyService', () => ({
  registerPasskeyForMember: vi.fn(),
  authenticateWithPasskey: vi.fn(),
  hasRegisteredPasskeys: vi.fn(() => false),
}));
vi.mock('@/stores/syncHighlightStore', () => ({
  useSyncHighlightStore: () => ({
    snapshotBeforeReload: vi.fn(),
    detectChanges: vi.fn(),
    clearHighlights: vi.fn(),
  }),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { useSyncStore } from '@/stores/syncStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { CorruptPayloadError } from '@/types/sync';
import { tryUnwrapFamilyKey as mockedTryUnwrapFamilyKey } from '@/services/sync/fileSync';
import * as docClient from '@/services/automerge/worker/docClient';

const envelopeJsonFor = (familyId: string, familyName: string): string =>
  JSON.stringify({
    version: '4.0',
    familyId,
    familyName,
    keyId: 'k',
    wrappedKeys: { 'm-1': { salt: 'AAAA', wrapped: 'BBBB' } },
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'base64==',
  });

// ─── attemptResumeFromRegistry ─────────────────────────────────────────────

describe('syncStore.attemptResumeFromRegistry', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    // Pre-populate the family context (the user has an authenticated
    // session pointing at this family even though the IndexedDB
    // providerConfig row was evicted). `activeFamilyId`/`Name` are
    // computeds; setting `activeFamily` is the supported write site.
    const ctx = useFamilyContextStore();
    ctx.activeFamily = {
      id: 'fam-resume-1',
      name: 'LaFleur',
      createdAt: '2026-05-10',
      updatedAt: '2026-05-14',
    };
    // `podCreated` defaults to TRUE on absent key — reset to '0' so the
    // failure-path assertions see the expected starting state.
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('beanies_pod_created', '0');
    }
  });

  it('returns auto-loadable when the registry has a fileId AND the envelope fetch succeeds', async () => {
    mockLookupFamily.mockResolvedValueOnce({
      familyId: 'fam-resume-1',
      provider: 'google_drive',
      fileId: 'drive-file-abc',
      displayPath: 'LaFleur.beanpod',
      familyName: 'LaFleur',
      ownerEmail: 'owner@example.com',
      subscribeNewsletter: false,
      country: null,
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-14T12:00:00.000Z',
    });
    mockProviderRead.mockResolvedValueOnce(envelopeJsonFor('fam-resume-1', 'LaFleur'));

    const syncStore = useSyncStore();
    const result = await syncStore.attemptResumeFromRegistry();
    expect(result.kind).toBe('auto-loadable');
    if (result.kind !== 'auto-loadable') return;
    expect(result.fileId).toBe('drive-file-abc');
    expect(result.familyName).toBe('LaFleur');
    expect(result.lastSaved).toBe('2026-05-14T12:00:00.000Z');
    // pendingEncryptedFile must be set so the password phase can decrypt
    expect(syncStore.pendingEncryptedFile?.driveFileId).toBe('drive-file-abc');
    // criticalWriteState must return to idle so the user can interact with
    // the password form
    expect(syncStore.criticalWriteState.kind).toBe('idle');
  });

  it('returns no-registry-entry when lookupFamily returns null', async () => {
    mockLookupFamily.mockResolvedValueOnce(null);
    const syncStore = useSyncStore();
    const result = await syncStore.attemptResumeFromRegistry();
    expect(result.kind).toBe('no-registry-entry');
    // Should NOT have attempted any provider.read (no point)
    expect(mockProviderRead).not.toHaveBeenCalled();
  });

  it('returns no-registry-entry when the entry has provider=local (cannot auto-load local files)', async () => {
    mockLookupFamily.mockResolvedValueOnce({
      familyId: 'fam-resume-1',
      provider: 'local',
      fileId: null,
      displayPath: 'LaFleur.beanpod',
      familyName: 'LaFleur',
      ownerEmail: null,
      subscribeNewsletter: false,
      country: null,
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-14T12:00:00.000Z',
    });
    const syncStore = useSyncStore();
    const result = await syncStore.attemptResumeFromRegistry();
    expect(result.kind).toBe('no-registry-entry');
  });

  it('returns load-failed when the registry has a fileId but the envelope read returns empty', async () => {
    mockLookupFamily.mockResolvedValueOnce({
      familyId: 'fam-resume-1',
      provider: 'google_drive',
      fileId: 'drive-file-abc',
      displayPath: 'LaFleur.beanpod',
      familyName: 'LaFleur',
      ownerEmail: 'owner@example.com',
      subscribeNewsletter: false,
      country: null,
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-14T12:00:00.000Z',
    });
    mockProviderRead.mockResolvedValueOnce(''); // empty body — Drive 200 with no bytes
    const syncStore = useSyncStore();
    const result = await syncStore.attemptResumeFromRegistry();
    expect(result.kind).toBe('load-failed');
  });
});

// ─── completeAutoLoad ──────────────────────────────────────────────────────

describe('syncStore.completeAutoLoad', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.resetAllMocks();
    const ctx = useFamilyContextStore();
    ctx.activeFamily = {
      id: 'fam-resume-1',
      name: 'LaFleur',
      createdAt: '2026-05-10',
      updatedAt: '2026-05-14',
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('beanies_pod_created', '0');
    }
  });

  function preloadPendingFile(syncStore: ReturnType<typeof useSyncStore>) {
    syncStore.pendingEncryptedFile = {
      envelope: {
        version: '4.0',
        familyId: 'fam-resume-1',
        familyName: 'LaFleur',
        keyId: 'k',
        wrappedKeys: { 'm-1': { salt: 'AAAA', wrapped: 'BBBB' } },
        passkeyWrappedKeys: {},
        inviteKeys: {},
        encryptedPayload: 'base64==',
      },
      driveFileId: 'drive-file-abc',
      driveFileName: 'LaFleur.beanpod',
      driveAccountEmail: 'owner@example.com',
    };
  }

  it('returns network-error when there is no pendingEncryptedFile (resume probe never ran)', async () => {
    const syncStore = useSyncStore();
    const result = await syncStore.completeAutoLoad('any-password');
    expect(result.kind).toBe('network-error');
  });

  it('returns wrong-password when tryUnwrapFamilyKey throws "Incorrect password"', async () => {
    vi.mocked(mockedTryUnwrapFamilyKey).mockRejectedValueOnce(new Error('Incorrect password'));
    const syncStore = useSyncStore();
    preloadPendingFile(syncStore);
    const result = await syncStore.completeAutoLoad('wrong');
    expect(result.kind).toBe('wrong-password');
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    expect(useAuthStore().podCreated).toBe(false);
  });

  it('returns corrupted when the worker merge throws CorruptPayloadError', async () => {
    vi.mocked(mockedTryUnwrapFamilyKey).mockResolvedValueOnce({
      familyKey: {} as CryptoKey,
      memberIds: ['m-1'],
    });
    // ADR-032: decrypt + materialize-check moved into the worker; the corrupt
    // payload now surfaces from docClient.mergeRemoteEnvelope (via
    // replaceDocWithCacheRecovery), i.e. inside the worker, not on the main thread.
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(
      new CorruptPayloadError('Out of bounds', 'materialize', 'fam-resume-1')
    );
    const syncStore = useSyncStore();
    preloadPendingFile(syncStore);
    const result = await syncStore.completeAutoLoad('right-pw');
    expect(result.kind).toBe('corrupted');
    if (result.kind !== 'corrupted') return;
    expect(result.fileId).toBe('drive-file-abc');
    expect(result.familyId).toBe('fam-resume-1');
    expect(result.error.step).toBe('materialize');
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    // CRITICAL invariant: the corrupted path must NEVER flip podCreated.
    // If it did, the next reload would route to /nook with no doc.
    expect(useAuthStore().podCreated).toBe(false);
  });

  // Cross-family data-integrity regression (2026-07-06): a cache MISS must adopt
  // the remote FRESH, never CRDT-merge it into whatever (possibly foreign) doc the
  // worker still holds — else A∪B gets persisted + uploaded to B's file.
  it('cross-family safety: a cache MISS installs the remote WHOLESALE, never merging', async () => {
    vi.mocked(mockedTryUnwrapFamilyKey).mockResolvedValueOnce({
      familyKey: {} as CryptoKey,
      memberIds: ['m-1'],
    });
    vi.mocked(docClient.initAndLoadCache).mockResolvedValueOnce({
      loaded: false,
      remoteBaseline: null,
    }); // B never cached here
    // `changed: true` — a wholesale install always brings a brand-new projection.
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValueOnce({
      action: 'adopted' as const,
      heads: [],
      dirty: false,
      changed: true,
      remoteHeads: [],
    });

    const syncStore = useSyncStore();
    preloadPendingFile(syncStore);
    await syncStore.completeAutoLoad('right-pw');

    // ⚠️ The guarantee is unchanged; the mechanism is. It used to be a separate
    // `dropDoc()` RPC before the merge, which is not atomic: a respawn between
    // the two rehydrates a document and the merge then finds one. The basis
    // says it inside the SAME call, so a retry re-decides from scratch.
    //
    // And it must be `no-local-document`, NOT `user-file`: `user-file` would let
    // a `same` verdict return `merge`, CRDT-merging the remote into whatever
    // (possibly FOREIGN) family's document the worker still holds — the exact
    // A∪B corruption this test was written for.
    expect(docClient.mergeRemoteEnvelope).toHaveBeenCalledTimes(1);
    expect(vi.mocked(docClient.mergeRemoteEnvelope).mock.calls[0]![2]).toEqual({
      kind: 'no-local-document',
    });
    expect(docClient.dropDoc).not.toHaveBeenCalled();
  });

  it('cross-family safety: a cache HIT merges into THIS family cached doc WITHOUT dropping it', async () => {
    vi.mocked(mockedTryUnwrapFamilyKey).mockResolvedValueOnce({
      familyKey: {} as CryptoKey,
      memberIds: ['m-1'],
    });
    vi.mocked(docClient.initAndLoadCache).mockResolvedValueOnce({
      loaded: true,
      remoteBaseline: null,
    }); // this family's cache present
    // `changed: false` — cache and remote already agree, so this is a no-op merge.
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValueOnce({
      action: 'merged' as const,
      heads: [],
      dirty: false,
      changed: false,
      remoteHeads: [],
    });

    const syncStore = useSyncStore();
    preloadPendingFile(syncStore);
    await syncStore.completeAutoLoad('right-pw');

    expect(docClient.dropDoc).not.toHaveBeenCalled();
    expect(docClient.mergeRemoteEnvelope).toHaveBeenCalledTimes(1);
  });
});

// ─── Open-cycle gates (2026-08-13) ─────────────────────────────────────────────
//
// These live here rather than in a new file because this suite already builds the
// exact harness they need — a family key unlocked via `completeAutoLoad`, a mocked
// `docClient`, and a provider that serves a real envelope — and duplicating ~250
// lines of mocks to re-create it would violate the project's DRY rule for the sake
// of filename tidiness.
//
// What they lock: `loadFromFile({merge:true})` must re-project only when the merge
// actually moved the doc, and re-upload only when local holds changes the remote
// lacks. Both were unconditional before 2026-08-13, which is why every open — even
// one where nothing had changed anywhere — re-projected ~21 stores and pushed a
// full 2-3MB file back to Drive.
describe('syncStore — open-cycle gates on the merge path', () => {
  let pinia: Pinia;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    const ctx = useFamilyContextStore();
    ctx.activeFamily = {
      id: 'fam-resume-1',
      name: 'LaFleur',
      createdAt: '2026-05-10',
      updatedAt: '2026-05-14',
    };
    mockProviderRead.mockResolvedValue(envelopeJsonFor('fam-resume-1', 'LaFleur'));
  });

  /** Unlock a family key, then run the merge path with a given merge outcome. */
  async function mergeWith(outcome: { dirty: boolean; changed: boolean }) {
    const syncStore = useSyncStore();
    vi.mocked(mockedTryUnwrapFamilyKey).mockResolvedValueOnce({
      familyKey: {} as CryptoKey,
      memberIds: ['m-1'],
    });
    vi.mocked(docClient.initAndLoadCache).mockResolvedValueOnce({
      loaded: true,
      remoteBaseline: null,
    });
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValueOnce({
      action: 'merged' as const,
      heads: [],
      dirty: false,
      changed: false,
      remoteHeads: [],
    });
    syncStore.pendingEncryptedFile = {
      envelope: JSON.parse(envelopeJsonFor('fam-resume-1', 'LaFleur')),
      driveFileId: 'drive-file-abc',
      driveFileName: 'LaFleur.beanpod',
      driveAccountEmail: 'owner@example.com',
    };
    await syncStore.completeAutoLoad('right-pw');

    const syncService = await import('@/services/sync/syncService');
    vi.mocked(syncService.triggerDebouncedSave).mockClear();
    vi.mocked(syncService.cancelPendingSave).mockClear();
    // Clear this too: `completeAutoLoad` above already drove it to 1, so a bare
    // `toHaveBeenCalled()` afterwards would be satisfied by the SETUP and the
    // anti-vacuity guard would itself be vacuous (an unconditional `return` at the
    // top of `backgroundSyncFromFile` would still pass).
    vi.mocked(docClient.mergeRemoteEnvelope).mockClear();
    // `load()` must return a real envelope or `loadFromFile` bails before the merge
    // branch and the assertions below would pass vacuously.
    vi.mocked(syncService.load).mockResolvedValue(envelopeJsonFor('fam-resume-1', 'LaFleur'));
    vi.mocked(syncService.getProviderType).mockReturnValue('google_drive');
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValueOnce({
      action: 'merged' as const,
      heads: [],
      remoteHeads: [],
      ...outcome,
    });

    await syncStore.backgroundSyncFromFile();
    // Now meaningful: exactly the merge this call made, not the setup's.
    expect(docClient.mergeRemoteEnvelope).toHaveBeenCalledTimes(1);
    return { syncStore, syncService };
  }

  it('rolls the remote marker BACK — and latches — when the merge throws', async () => {
    // THE data-loss path, and the one a `doSave` guard alone could not close.
    // `syncService.load()` stamps the remote's revision BEFORE the download, but
    // the merge happens in the store — so a payload failure used to leave that
    // baseline standing, the next change check answered 'unchanged',
    // `fetchAndMergeRemote` returned without throwing, and the following save
    // wrote a full base over a revision the document never contained,
    // destroying every peer edit that lived only in that copy.
    const { PayloadTooLargeError } = await import('@/types/sync');
    const syncStore = useSyncStore();
    vi.mocked(mockedTryUnwrapFamilyKey).mockResolvedValueOnce({
      familyKey: {} as CryptoKey,
      memberIds: ['m-1'],
    });
    vi.mocked(docClient.initAndLoadCache).mockResolvedValueOnce({
      loaded: true,
      remoteBaseline: null,
    });
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValueOnce({
      action: 'merged' as const,
      heads: [],
      dirty: false,
      changed: false,
      remoteHeads: [],
    });
    syncStore.pendingEncryptedFile = {
      envelope: JSON.parse(envelopeJsonFor('fam-resume-1', 'LaFleur')),
      driveFileId: 'drive-file-abc',
      driveFileName: 'LaFleur.beanpod',
      driveAccountEmail: 'owner@example.com',
    };
    await syncStore.completeAutoLoad('right-pw');

    const syncService = await import('@/services/sync/syncService');
    vi.mocked(syncService.rollbackRemoteMarker).mockClear();
    vi.mocked(syncService.confirmRemoteMerged).mockClear();
    vi.mocked(syncService.load).mockResolvedValue(envelopeJsonFor('fam-resume-1', 'LaFleur'));
    vi.mocked(syncService.getProviderType).mockReturnValue('google_drive');
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(
      new PayloadTooLargeError('oom', 'materialize', 'fam-resume-1', 3_000_000)
    );

    await expect(syncStore.loadFromFile()).rejects.toBeInstanceOf(PayloadTooLargeError);

    expect(syncService.rollbackRemoteMarker).toHaveBeenCalled();
    // `noteRemoteBlocked` is the one dispatcher for all three blocker classes;
    // it routes a PayloadLoadError to `noteRemoteUnreadable` (pinned by
    // `blockerDispatch.test.ts`). Asserting the dispatcher here is what keeps
    // this test honest for a lineage or merge block too.
    expect(syncService.noteRemoteBlocked).toHaveBeenCalled();
    expect(syncService.confirmRemoteMerged).not.toHaveBeenCalled();
  });

  it('does NOT re-upload when the merge left nothing to push back (dirty:false)', async () => {
    const { syncService } = await mergeWith({ dirty: false, changed: false });
    // A no-op write still costs a full saveDoc + encrypt + whole-file upload, and
    // two clients doing it on one file is what produced the 2026-08-12 save-storm.
    expect(syncService.triggerDebouncedSave).not.toHaveBeenCalled();
  });

  it('DOES re-upload when the converged doc still carries local changes (dirty:true)', async () => {
    const { syncService } = await mergeWith({ dirty: true, changed: true });
    // The invariant that matters more than the optimisation: a local change must
    // always reach the file.
    expect(syncService.triggerDebouncedSave).toHaveBeenCalled();
  });

  it('re-projects the stores ONLY when the merge moved the doc (the `changed` gate)', async () => {
    // Observed through `reloadAllStores`'s own first statement,
    // `syncService.cancelPendingSave()` — the store function itself is internal.
    // Asserted COMPARATIVELY because that path has an unrelated baseline call; an
    // absolute count would encode the baseline and break on any adjacent change.
    // This half of B2 fails UNSAFE if inverted (21 stores left showing pre-merge
    // data), so it needs its own assertion rather than riding the `dirty` tests.
    const quiet = await mergeWith({ dirty: false, changed: false });
    const quietCalls = vi.mocked(quiet.syncService.cancelPendingSave).mock.calls.length;

    setActivePinia(createPinia());
    vi.clearAllMocks();
    const ctx = useFamilyContextStore();
    ctx.activeFamily = {
      id: 'fam-resume-1',
      name: 'LaFleur',
      createdAt: '2026-05-10',
      updatedAt: '2026-05-14',
    };
    mockProviderRead.mockResolvedValue(envelopeJsonFor('fam-resume-1', 'LaFleur'));

    const moved = await mergeWith({ dirty: false, changed: true });
    const movedCalls = vi.mocked(moved.syncService.cancelPendingSave).mock.calls.length;

    expect(movedCalls).toBeGreaterThan(quietCalls);
  });

  it('re-uploads when the merge outcome is unknown (fail-safe default)', async () => {
    const syncStore = useSyncStore();
    vi.mocked(mockedTryUnwrapFamilyKey).mockResolvedValueOnce({
      familyKey: {} as CryptoKey,
      memberIds: ['m-1'],
    });
    vi.mocked(docClient.initAndLoadCache).mockResolvedValueOnce({
      loaded: true,
      remoteBaseline: null,
    });
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValueOnce({
      action: 'merged' as const,
      heads: [],
      dirty: false,
      changed: false,
      remoteHeads: [],
    });
    syncStore.pendingEncryptedFile = {
      envelope: JSON.parse(envelopeJsonFor('fam-resume-1', 'LaFleur')),
      driveFileId: 'drive-file-abc',
      driveFileName: 'LaFleur.beanpod',
      driveAccountEmail: 'owner@example.com',
    };
    await syncStore.completeAutoLoad('right-pw');

    const syncService = await import('@/services/sync/syncService');
    vi.mocked(syncService.triggerDebouncedSave).mockClear();
    vi.mocked(syncService.load).mockResolvedValue(envelopeJsonFor('fam-resume-1', 'LaFleur'));
    vi.mocked(syncService.getProviderType).mockReturnValue('google_drive');
    // An older/partial worker or test double that omits the fields: "unknown"
    // must resolve to the safe direction (upload), never to silently dropping it.
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValueOnce({
      action: 'merged' as const,
      heads: [],
    } as unknown as Awaited<ReturnType<typeof docClient.mergeRemoteEnvelope>>);

    await syncStore.backgroundSyncFromFile();
    expect(docClient.mergeRemoteEnvelope).toHaveBeenCalled();
    expect(syncService.triggerDebouncedSave).toHaveBeenCalled();
  });
});

/**
 * The lineage recovery, driven through the store rather than through the
 * banner's mock of it.
 *
 * ⚠️ WHY THIS EXISTS. A test audit proved that BOTH `user-file` producers could
 * be deleted outright and 875 tests stayed green, because the shared
 * `syncService` double defaults `consumeUserFileIntent` to `false` and nothing
 * anywhere overrode it. The POLICY table's `user-file` column — the one context
 * that never blocks, and whose `adopt` destroys the local document — had zero
 * TESTED producers. These are that coverage.
 */
describe('syncStore — the lineage banner recovery', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.resetAllMocks();
    const ctx = useFamilyContextStore();
    ctx.activeFamily = {
      id: 'fam-resume-1',
      name: 'LaFleur',
      createdAt: '2026-05-10',
      updatedAt: '2026-05-14',
    };
  });

  async function svc() {
    return await import('@/services/sync/syncService');
  }

  it('cancels the armed save, unlatches, and declares the intent before re-opening', async () => {
    const syncService = await svc();
    const syncStore = useSyncStore();
    // No provider configured -> loadFromFile returns a plain failure. The
    // ORDERING is what this pins, and it holds on both outcomes.
    await syncStore.useRemoteFileOverLocalDocument();

    // Cancelling first is what stops a debounced save from running its own merge
    // concurrently with the re-open once the latch is clear.
    expect(syncService.cancelPendingSave).toHaveBeenCalled();
    expect(syncService.retryAfterRemoteBlock).toHaveBeenCalled();
    // THE producer. Deleting this call used to leave the whole suite green.
    expect(syncService.noteUserChoseRemoteFile).toHaveBeenCalled();
  });

  it('reports a failed adopt instead of letting the banner vanish silently', async () => {
    const { reportError } = await import('@/utils/errorReporter');
    const syncStore = useSyncStore();

    const ok = await syncStore.useRemoteFileOverLocalDocument();

    expect(ok).toBe(false);
    // The latch was cleared before the re-open, so the banner is already gone;
    // without this report the failure reaches nobody at all.
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'pod-lineage',
        severity: 'critical',
        context: expect.objectContaining({ action: 'user-file-recovery-failed' }),
      })
    );
  });

  it('sends `user-file` to the worker when the intent is armed', async () => {
    // The store terminus. `consumeUserFileIntent` defaults to false in the shared
    // double, which is why nothing exercised this arm.
    const syncService = await svc();
    vi.mocked(syncService.consumeUserFileIntent).mockReturnValue(true);
    vi.mocked(syncService.load).mockResolvedValue(envelopeJsonFor('fam-resume-1', 'LaFleur'));
    vi.mocked(docClient.initAndLoadCache).mockResolvedValue({
      loaded: true,
    } as unknown as Awaited<ReturnType<typeof docClient.initAndLoadCache>>);
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValue({
      action: 'adopted' as const,
      heads: [],
      dirty: false,
      changed: true,
      remoteHeads: [],
    } as unknown as Awaited<ReturnType<typeof docClient.mergeRemoteEnvelope>>);

    const syncStore = useSyncStore();
    syncStore.familyKey = {} as CryptoKey;
    await syncStore.loadFromFile();

    const basis = vi.mocked(docClient.mergeRemoteEnvelope).mock.calls[0]?.[2];
    expect(basis).toEqual({ kind: 'user-file' });
  });

  it('sends a plain baseline when no one armed it', async () => {
    const syncService = await svc();
    vi.mocked(syncService.consumeUserFileIntent).mockReturnValue(false);
    vi.mocked(syncService.load).mockResolvedValue(envelopeJsonFor('fam-resume-1', 'LaFleur'));
    vi.mocked(docClient.initAndLoadCache).mockResolvedValue({
      loaded: true,
    } as unknown as Awaited<ReturnType<typeof docClient.initAndLoadCache>>);
    vi.mocked(docClient.mergeRemoteEnvelope).mockResolvedValue({
      action: 'adopted' as const,
      heads: [],
      dirty: false,
      changed: true,
      remoteHeads: [],
    } as unknown as Awaited<ReturnType<typeof docClient.mergeRemoteEnvelope>>);

    const syncStore = useSyncStore();
    syncStore.familyKey = {} as CryptoKey;
    await syncStore.loadFromFile();

    expect(vi.mocked(docClient.mergeRemoteEnvelope).mock.calls[0]?.[2]).toMatchObject({
      kind: 'baseline',
    });
  });
});
