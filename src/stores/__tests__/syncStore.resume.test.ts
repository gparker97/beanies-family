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
vi.mock('@/services/automerge/persistenceService', () => ({
  initPersistenceDB: vi.fn(async () => {}),
  persistDoc: vi.fn(async () => {}),
  persistEnvelope: vi.fn(async () => {}),
  loadCachedDoc: vi.fn(async () => null),
  loadCachedEnvelope: vi.fn(async () => null),
  isCacheReady: vi.fn(() => false),
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
  initializeAuth: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenAcquired: vi.fn(() => () => {}),
  onTokenPermanentlyExpired: vi.fn(() => () => {}),
  fetchGoogleUserEmail: vi.fn(async () => 'owner@example.com'),
  isTokenValid: vi.fn(() => true),
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

// File sync — keep parseBeanpodV4 + detectFileVersion real-shape but mock crypto-y ones
vi.mock('@/services/sync/fileSync', async () => {
  const actual = await vi.importActual<typeof import('@/services/sync/fileSync')>(
    '@/services/sync/fileSync'
  );
  return {
    ...actual,
    decryptBeanpodPayload: vi.fn(),
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
import {
  decryptBeanpodPayload as mockedDecryptBeanpodPayload,
  tryUnwrapFamilyKey as mockedTryUnwrapFamilyKey,
} from '@/services/sync/fileSync';

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

  it('returns corrupted when decryptBeanpodPayload throws CorruptPayloadError', async () => {
    vi.mocked(mockedTryUnwrapFamilyKey).mockResolvedValueOnce({
      familyKey: {} as CryptoKey,
      memberIds: ['m-1'],
    });
    vi.mocked(mockedDecryptBeanpodPayload).mockRejectedValueOnce(
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
});
