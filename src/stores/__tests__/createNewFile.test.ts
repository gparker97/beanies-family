/**
 * End-to-end tests for the full pod creation flow.
 *
 * Validates the COMPLETE sequence as CreatePodView performs it:
 *   Step 1: authStore.signUp() → creates family + member (writes to Automerge doc)
 *   Step 2: select storage provider → createNewFile() → initialize doc + crypto + write
 *   Step 3: handleFinish() → syncNow() → save encrypted file
 *
 * TDD approach: tests MUST FAIL first (reproducing the real bug), then pass after the fix.
 *
 * The real bug: authStore.signUp() calls familyStore.createMember() which calls
 * changeDoc() — but no Automerge document exists yet (initDoc() hasn't been called).
 * This throws "No Automerge document loaded. Call initDoc() or loadDoc() first."
 *
 * Strategy: Use the REAL docService, automergeRepository, familyStore, and authStore
 * so we hit the actual changeDoc() call. Only mock infrastructure (IndexedDB, crypto, etc).
 */
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before vi.mock factories reference them
// ---------------------------------------------------------------------------
const {
  mockProvider,
  mockSelectSyncFile,
  mockSave,
  stateChangeCallbackHolder,
  mockFamilyKey,
  mockInitPersistenceDB,
  mockPersistDoc,
  mockPersistEnvelope,
} = vi.hoisted(() => {
  const mockFamilyKey = {} as CryptoKey;
  const mockProviderWrite = vi.fn(async () => {});
  // read() is called by `verifyJustWritten` after every successful write —
  // return a parseable V4 envelope so the verify step's decrypt call (also
  // mocked at the fileSync level) doesn't trip on empty bytes.
  const mockProviderRead = vi.fn(async () =>
    JSON.stringify({
      version: '4.0',
      familyId: 'fam-test-1',
      familyName: 'Test Family',
      keyId: 'k',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: 'base64==',
    })
  );
  const mockProvider = {
    write: mockProviderWrite,
    read: mockProviderRead,
    getAccountEmail: () => null,
    getDisplayName: () => 'test.beanpod',
    getFileId: () => 'mock-file-id',
    type: 'local' as const,
  };
  return {
    mockProvider,
    mockSelectSyncFile: vi.fn(async () => true),
    mockSave: vi.fn(async () => true),
    stateChangeCallbackHolder: {
      callback: null as ((state: Record<string, unknown>) => void) | null,
    },
    mockFamilyKey,
    mockInitPersistenceDB: vi.fn(async () => {}),
    mockPersistDoc: vi.fn(async () => {}),
    mockPersistEnvelope: vi.fn(async () => {}),
  };
});

// ---------------------------------------------------------------------------
// REAL modules (NOT mocked) — these are the ones that trigger the bug:
//   docService (initDoc, changeDoc, getDoc, saveDoc)
//   automergeRepository (calls changeDoc)
//   familyMemberRepository (uses automergeRepository)
//   familyStore (calls familyRepo.createFamilyMember)
//   authStore (calls familyStore.createMember in signUp)
//   settingsRepository (calls getDoc/changeDoc)
//   settingsStore (calls settingsRepository)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mocked infrastructure — things that need IndexedDB, file system, crypto, etc.
// ---------------------------------------------------------------------------

// Password hashing — avoid real crypto overhead
vi.mock('@/services/auth/passwordService', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed-${pw}`),
  verifyPassword: vi.fn(async () => true),
}));

// Passkey service
vi.mock('@/services/auth/passkeyService', () => ({
  registerPasskeyForMember: vi.fn(),
  authenticateWithPasskey: vi.fn(),
  hasRegisteredPasskeys: vi.fn(() => false),
}));

// Registry database — mock IndexedDB
vi.mock('@/services/indexeddb/registryDatabase', () => ({
  getRegistryDatabase: vi.fn(async () => ({
    getAll: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    add: vi.fn(async () => {}),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  })),
}));

// Family context service — mock the IDB-dependent parts
vi.mock('@/services/familyContext', () => ({
  createNewFamily: vi.fn(async (name: string) => ({
    id: 'fam-test-1',
    name,
    createdAt: '2026-03-03',
    updatedAt: '2026-03-03',
  })),
  activateFamily: vi.fn(async () => null),
  getAllFamilies: vi.fn(async () => []),
  getLastActiveFamily: vi.fn(async () => null),
  createFamilyWithId: vi.fn(),
  hasActiveFamily: vi.fn(() => true),
}));

// Database — mock IDB family database
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'fam-test-1'),
  setActiveFamily: vi.fn(async () => {}),
  closeDatabase: vi.fn(async () => {}),
  deleteFamilyDatabase: vi.fn(async () => {}),
}));

// Global settings repo — mock IDB
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
  getGlobalSettings: vi.fn(async () => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
    lastActiveFamilyId: null,
    exchangeRates: [],
    exchangeRateAutoUpdate: true,
    exchangeRateLastFetch: null,
    isTrustedDevice: false,
    trustedDevicePromptShown: false,
  })),
  saveGlobalSettings: vi.fn(async () => ({})),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(async () => ({})),
}));

// Sync service — mock the sync engine (uses file handles, providers, etc.)
vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onStateChange: vi.fn((cb: (state: Record<string, unknown>) => void) => {
      stateChangeCallbackHolder.callback = cb;
      return () => {};
    }),
    getProvider: vi.fn(() => mockProvider),
    setFamilyKey: vi.fn(),
    setEnvelope: vi.fn(),
    save: mockSave,
    selectSyncFile: (...args: unknown[]) => {
      stateChangeCallbackHolder.callback?.({
        isInitialized: true,
        isConfigured: true,
        fileName: 'test.beanpod',
        isSyncing: false,
        lastError: null,
      });
      return (mockSelectSyncFile as (...a: unknown[]) => unknown)(...args);
    },
  };
});

// Sync capabilities
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({
    fileSystemAccess: true,
    showSaveFilePicker: true,
    showOpenFilePicker: true,
    webCrypto: true,
    googleDrive: false,
    manualSync: true,
  }),
  canAutoSync: () => true,
}));

// File sync — mock crypto-dependent parts but keep format logic
vi.mock('@/services/sync/fileSync', () => ({
  createBeanpodV4: vi.fn(async () => '{"version":"4.0","familyId":"fam-test-1"}'),
  parseBeanpodV4: vi.fn(() => ({
    version: '4.0',
    familyId: 'fam-test-1',
    familyName: 'Test Family',
    keyId: 'key-1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'base64==',
  })),
  reEncryptEnvelope: vi.fn(async () => '{"version":"4.0"}'),
  detectFileVersion: vi.fn(() => '4.0'),
  downloadAsFile: vi.fn(),
  tryUnwrapFamilyKey: vi.fn(),
  decryptBeanpodPayload: vi.fn(),
}));

// Crypto — mock Web Crypto API
vi.mock('@/services/crypto/familyKeyService', () => ({
  generateFamilyKey: vi.fn(async () => mockFamilyKey),
  deriveMemberKey: vi.fn(async () => ({}) as CryptoKey),
  wrapFamilyKey: vi.fn(async () => 'wrapped-key-base64'),
  unwrapFamilyKey: vi.fn(),
  encryptPayload: vi.fn(),
  decryptPayload: vi.fn(),
  SALT_LENGTH: 16,
}));

// Encoding utilities
vi.mock('@/utils/encoding', () => ({
  bufferToBase64: vi.fn(() => 'base64salt'),
  base64ToBuffer: vi.fn(() => new ArrayBuffer(16)),
}));

// Persistence service — mock IDB
vi.mock('@/services/automerge/persistenceService', () => ({
  initPersistenceDB: mockInitPersistenceDB,
  persistDoc: mockPersistDoc,
  persistEnvelope: mockPersistEnvelope,
  loadCachedDoc: vi.fn(async () => null),
  loadCachedEnvelope: vi.fn(async () => null),
  isCacheReady: vi.fn(() => false),
}));

// Google Drive deps
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: vi.fn(),
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
vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenExpired: vi.fn(() => () => {}),
  revokeToken: vi.fn(async () => {}),
  isTokenValid: vi.fn(() => false),
  fetchGoogleUserEmail: vi.fn(async () => null),
}));
vi.mock('@/services/google/driveService', () => ({
  getOrCreateAppFolder: vi.fn(async () => 'folder-id'),
  listBeanpodFiles: vi.fn(async () => []),
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
vi.mock('@/services/sync/offlineQueue', () => ({
  clearQueue: vi.fn(),
}));

// Registry service
vi.mock('@/services/registry/registryService', () => ({
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
  removeFamily: vi.fn(async () => {}),
}));

// Translation cache repo (imported by translationCacheRepository)
vi.mock('@/services/indexeddb/repositories/translationCacheRepository', () => ({
  getTranslationCache: vi.fn(async () => null),
  saveTranslationCache: vi.fn(async () => {}),
}));

// Store stubs for stores only used in reloadAllStores — these don't touch the doc themselves
vi.mock('@/stores/syncHighlightStore', () => ({
  useSyncHighlightStore: () => ({
    snapshotBeforeReload: vi.fn(),
    detectChanges: vi.fn(),
    clearHighlights: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import REAL stores and services AFTER mocks are set up
// ---------------------------------------------------------------------------
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { resetDoc } from '@/services/automerge/docService';

// ---------------------------------------------------------------------------
// Tests — full end-to-end pod creation flow
// ---------------------------------------------------------------------------

describe('pod creation: full end-to-end flow', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    // Ensure clean Automerge state — no document loaded
    resetDoc();
    // authStore.podCreated defaults to TRUE when localStorage key is absent
    // (migration-true semantics — see restorePodCreated). Reset to '0' so
    // failure-path tests can assert it never flips to '1'.
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('beanies_pod_created', '0');
    }
  });

  afterEach(() => {
    resetDoc();
  });

  /**
   * This test reproduces the REAL bug:
   * authStore.signUp() calls familyStore.createMember() which calls changeDoc()
   * on a null Automerge document, throwing "No Automerge document loaded".
   *
   * This test MUST FAIL before the fix, and PASS after.
   */
  it('signUp creates a family member without throwing "No Automerge document loaded"', async () => {
    const authStore = useAuthStore();

    // This is what CreatePodView.handleStep1Next() does — it should NOT throw
    const result = await authStore.signUp({
      email: 'test@example.com',
      password: 'password123',
      familyName: 'Test Family',
      memberName: 'Test User',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  /**
   * Full 3-step pod creation as CreatePodView performs it:
   *   1. signUp (creates family + member in Automerge doc)
   *   2. select storage + createNewFile (crypto + V4 envelope)
   *   3. syncNow (save to file)
   */
  it('complete pod creation: signUp → selectStorage → createNewFile → syncNow', async () => {
    const authStore = useAuthStore();
    const syncStore = useSyncStore();

    // --- Step 1: Sign up (handleStep1Next) ---
    const signUpResult = await authStore.signUp({
      email: 'test@example.com',
      password: 'password123',
      familyName: 'Test Family',
      memberName: 'Test User',
    });
    expect(signUpResult.success).toBe(true);
    expect(authStore.currentUser).not.toBeNull();
    const memberId = authStore.currentUser!.memberId;

    // --- Step 2a: Select storage provider (handleChooseLocalStorage) ---
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });

    // --- Step 2b: Create new file (handleStep2Next) ---
    const createResult = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password-123',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(createResult.ok).toBe(true);
    expect(syncStore.familyKey).toBe(mockFamilyKey);
    expect(syncStore.envelope).not.toBeNull();
    // criticalWriteState must return to idle after every createNewFile call
    // (success or failure) — otherwise the router beforeEach guard would
    // block every subsequent navigation.
    expect(syncStore.criticalWriteState.kind).toBe('idle');

    // --- Step 3: Final save (handleFinish) ---
    const syncResult = await syncStore.syncNow(true);
    // syncService.save is mocked to return true
    expect(syncResult).toBe(true);
  });

  // ── Discriminated-result failure paths ──────────────────────────────────
  //
  // Every reason in `CreatePodFailureReason` is exercised here so the
  // markPodCreated point-of-no-return invariant has a unit test for every
  // path that could otherwise reach it. On every failure we also assert
  // `criticalWriteState` returns to idle (the router/beforeunload guards
  // depend on this) and `authStore.podCreated` is NOT set.

  async function signUpAndConfigureStorage() {
    const authStore = useAuthStore();
    const signUp = await authStore.signUp({
      email: 'test@example.com',
      password: 'password123',
      familyName: 'Test Family',
      memberName: 'Test User',
    });
    expect(signUp.success).toBe(true);
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });
    return { authStore, memberId: authStore.currentUser!.memberId };
  }

  it('returns reason="precondition" when the owner member is missing from the family store', async () => {
    const syncStore = useSyncStore();
    // No signUp — so familyStore.members is empty, the precondition guard at
    // the top of createNewFile catches it before any I/O runs.
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      'no-such-member',
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrow
    expect(result.reason).toBe('precondition');
    expect(mockProvider.write).not.toHaveBeenCalled();
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    const authStore = useAuthStore();
    expect(authStore.podCreated).toBe(false);
  });

  it('returns reason="write" when provider.write throws', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    mockProvider.write.mockRejectedValueOnce(new Error('Network down'));
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('write');
    expect(result.error.message).toContain('Network down');
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    expect(useAuthStore().podCreated).toBe(false);
  });

  it('returns reason="verify" when the read-back envelope is empty', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    // Simulate Shaun-class corruption: write returns 200 OK but the file we
    // read back is empty/inconsistent. verifyJustWritten throws → reason=verify.
    mockProvider.read.mockResolvedValueOnce('');
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('verify');
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    expect(useAuthStore().podCreated).toBe(false);
  });

  it('returns reason="persist" when persistDoc throws', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    mockPersistDoc.mockRejectedValueOnce(new Error('IndexedDB quota'));
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('persist');
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    expect(useAuthStore().podCreated).toBe(false);
  });

  it('returns reason="register" when registry.registerFamilyOrThrow throws', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    const registry = await import('@/services/registry/registryService');
    vi.mocked(registry.registerFamilyOrThrow).mockRejectedValueOnce(new Error('Registry 503'));
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('register');
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    expect(useAuthStore().podCreated).toBe(false);
  });

  it('returns reason="concurrent-write" when called while another createNewFile is in flight', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    // Block the first call's `provider.write` so the critical section stays
    // open; fire the second call and assert it's refused with the typed
    // reason. Then unblock the first call.
    let releaseWrite: () => void;
    const writeBlocker = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    mockProvider.write.mockImplementationOnce(async () => {
      await writeBlocker;
    });

    const first = syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    // Microtask: let the first call enter the critical section and flip the flag.
    await Promise.resolve();
    expect(syncStore.criticalWriteState.kind).toBe('creating');

    const second = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('concurrent-write');

    releaseWrite!();
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    expect(syncStore.criticalWriteState.kind).toBe('idle');
  });

  /**
   * After signUp + createNewFile, adding more family members should also work.
   * This is what happens in Step 3 of CreatePodView (handleAddMember).
   */
  it('adding family members after pod creation works', async () => {
    const authStore = useAuthStore();
    const { useFamilyStore } = await import('@/stores/familyStore');
    const familyStore = useFamilyStore();

    // Step 1: signUp
    const signUpResult = await authStore.signUp({
      email: 'owner@example.com',
      password: 'password123',
      familyName: 'Test Family',
      memberName: 'Owner',
    });
    expect(signUpResult.success).toBe(true);

    // Step 3: Add another member (handleAddMember in CreatePodView)
    const newMember = await familyStore.createMember({
      name: 'Child Bean',
      email: 'child@setup.local',
      gender: 'other',
      ageGroup: 'child',
      role: 'member',
      color: '#ef4444',
      requiresPassword: true,
    });
    expect(newMember).not.toBeNull();
    expect(newMember!.name).toBe('Child Bean');
  });
});
