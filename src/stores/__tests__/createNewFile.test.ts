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
const { mockProvider, mockSelectSyncFile, mockSave, stateChangeCallbackHolder, mockFamilyKey } =
  vi.hoisted(() => {
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
  isStorageBlockedError: (e: unknown) =>
    e instanceof Error &&
    ['InvalidStateError', 'SecurityError', 'QuotaExceededError'].includes(e.name),
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

// ADR-032: the doc + persistence live in the worker, driven via docClient. This
// test exercises the REAL create-flow doc path (signUp → createMember →
// createNewFile) through the inline backend, so the doc-CRDT methods (mutate,
// initDoc, setFamilyKey, exportEncryptedPayload) stay REAL. The cache/verify RPCs
// touch encrypted IDB + real materialize — which can't round-trip the mocked
// crypto/read-back bytes here — so they're stubbed as controllable no-ops.
vi.mock('@/services/automerge/worker/docClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/automerge/worker/docClient')>();
  return {
    ...actual,
    verifyEnvelope: vi.fn(async () => {}),
    initAndLoadCache: vi.fn(async () => ({ loaded: false })),
    openCache: vi.fn(async () => ({ loaded: false })),
    flush: vi.fn(async () => {}),
    persistEnvelope: vi.fn(async () => {}),
  };
});

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
  getVerifiedGoogleAccountEmail: vi.fn(() => null),
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
  lookupFamilyResult: vi.fn(async () => ({ status: 'absent' })),
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
import { useAuthStore, DEFERRED_PASSWORD_HASH } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useActivityStore } from '@/stores/activityStore';
import { resetDoc } from '@/services/automerge/docService';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import * as docClient from '@/services/automerge/worker/docClient';

// ---------------------------------------------------------------------------
// Tests — full end-to-end pod creation flow
// ---------------------------------------------------------------------------

describe('pod creation: full end-to-end flow', () => {
  let pinia: Pinia;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    // Wire the REAL inline doc backend (docClient → applyAndProject → projection)
    // on the main thread so signUp→createMember→createNewFile drives the true
    // doc path. Starts from a fresh empty doc.
    await installInlineBackend();
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

  it('signUp is idempotent — a second call with an existing session does NOT create a second family', async () => {
    const authStore = useAuthStore();
    const familyContext = await import('@/services/familyContext');
    vi.mocked(familyContext.createNewFamily).mockClear();

    const first = await authStore.signUp({
      email: 'test@example.com',
      password: 'password123',
      familyName: 'Test Family',
      memberName: 'Test User',
    });
    expect(first.success).toBe(true);
    expect(familyContext.createNewFamily).toHaveBeenCalledTimes(1);

    // Re-entry (e.g. Back→step1→Next, or WelcomeGate→Create again). Must NOT
    // mint a second family / orphan the first.
    const second = await authStore.signUp({
      email: 'test@example.com',
      password: 'password123',
      familyName: 'Different Name',
      memberName: 'Test User',
    });
    expect(second.success).toBe(true);
    expect(familyContext.createNewFamily).toHaveBeenCalledTimes(1); // still 1 — no duplicate
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

  // ── ADR-032: create tears down the PREVIOUS family's in-memory state ──────
  //
  // Regression guard for the cross-family data-mixing bug: creating a new family
  // while another family's rows are still resident in the entity store ref arrays
  // must leave the new family with EMPTY stores (only the new owner).

  it('signUp clears leftover entity-store rows from a previous family', async () => {
    const accountsStore = useAccountsStore();
    const activityStore = useActivityStore();
    // Simulate a previous family's data still resident in the store refs.
    accountsStore.accounts.push({ id: 'old-acct', name: 'Old Family Checking' } as never);
    activityStore.activities.push({ id: 'old-act', title: 'Old Family Activity' } as never);
    expect(accountsStore.accounts).toHaveLength(1);
    expect(activityStore.activities).toHaveLength(1);

    const authStore = useAuthStore();
    const result = await authStore.signUp({
      email: 'new@example.com',
      password: 'password123',
      familyName: 'New Family',
      memberName: 'New Owner',
    });
    expect(result.success).toBe(true);

    // The previous family's rows are gone; only the new owner remains.
    expect(accountsStore.accounts).toHaveLength(0);
    expect(activityStore.activities).toHaveLength(0);
    const familyStore = useFamilyStore();
    expect(familyStore.members).toHaveLength(1);
    expect(familyStore.owner?.name).toBe('New Owner');
  });

  it('resetInMemoryFamilyState runs reset → initDoc → reloadAllStores (before createMember)', async () => {
    const resetSpy = vi.spyOn(docClient, 'reset');
    const initSpy = vi.spyOn(docClient, 'initDoc');
    const syncStore = useSyncStore();
    const reloadSpy = vi.spyOn(syncStore, 'reloadAllStores');

    const authStore = useAuthStore();
    await authStore.signUp({
      email: 'order@example.com',
      password: 'password123',
      familyName: 'Order Family',
      memberName: 'Owner',
    });

    // The order is load-bearing: reset (drop old doc + key) → initDoc (fresh doc)
    // → reloadAllStores (clear stale store refs) — all before the owner is written.
    expect(resetSpy).toHaveBeenCalled();
    expect(initSpy).toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalled();
    expect(resetSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      initSpy.mock.invocationCallOrder[0]!
    );
    expect(initSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      reloadSpy.mock.invocationCallOrder[0]!
    );
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

  it('returns reason="persist" when the worker cache flush throws', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    // ADR-032: the worker owns cache persistence — the persist step is
    // docClient.initAndLoadCache → flush → persistEnvelope. A cache-flush failure
    // surfaces as reason="persist".
    vi.mocked(docClient.flush).mockRejectedValueOnce(new Error('IndexedDB quota'));
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

  it('returns reason="existing-pod" and writes nothing when the registry already has a fileId for this family', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    const registry = await import('@/services/registry/registryService');
    // A real pod already exists for this family (e.g. a partial prior create
    // that registered, or a name-mismatch second attempt). createNewFile must
    // refuse rather than orphan it.
    vi.mocked(registry.lookupFamilyResult).mockResolvedValueOnce({
      status: 'found',
      entry: { fileId: 'existing-file-id' },
    } as never);
    mockProvider.write.mockClear();
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('existing-pod');
    // Refused BEFORE any write + before flipping the critical-write state.
    expect(mockProvider.write).not.toHaveBeenCalled();
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    expect(useAuthStore().podCreated).toBe(false);
  });

  it('proceeds with create when the existing-pod lookup throws (fail-open, must not block a new family)', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    const registry = await import('@/services/registry/registryService');
    vi.mocked(registry.lookupFamilyResult).mockRejectedValueOnce(new Error('registry 503'));
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      memberId,
      'fam-test-1',
      'Test Family'
    );
    // A lookup failure must NOT block a legitimate create.
    expect(result.ok).toBe(true);
    expect(useAuthStore().podCreated).toBe(true);
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

describe('unified create flow: deferred password (signUp → rehydrateOwnerDoc → createNewFile)', () => {
  let pinia: Pinia;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    await installInlineBackend();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('beanies_pod_created', '0');
    }
  });

  afterEach(() => {
    resetDoc();
  });

  it('deferred signUp builds the owner with the empty sentinel hash and never hashes a password', async () => {
    const authStore = useAuthStore();
    const familyStore = useFamilyStore();
    const pwSvc = await import('@/services/auth/passwordService');

    const result = await authStore.signUp({
      deferPassword: true,
      email: 'owner@example.com',
      familyName: 'Test Family',
      memberName: 'Owner',
    });

    expect(result.success).toBe(true);
    // No key/hash work at step 1 — the password isn't collected yet.
    expect(pwSvc.hashPassword).not.toHaveBeenCalled();
    expect(familyStore.owner).not.toBeNull();
    expect(familyStore.owner!.passwordHash).toBe(DEFERRED_PASSWORD_HASH);
    // `applyDefaults` derives requiresPassword from the empty hash on read.
    expect(familyStore.owner!.requiresPassword).toBe(true);
    // Still keeps the owner role (never demoted) and no pod yet.
    expect(familyStore.owner!.role).toBe('owner');
    expect(authStore.podCreated).toBe(false);
  });

  it('rehydrateOwnerDoc applies the real hash to a deferred owner EVEN when it already exists (desktop, no reload)', async () => {
    const authStore = useAuthStore();
    const familyStore = useFamilyStore();

    await authStore.signUp({
      deferPassword: true,
      email: 'owner@example.com',
      familyName: 'Test Family',
      memberName: 'Owner',
    });
    const ownerIdBefore = familyStore.owner!.id;
    expect(familyStore.owner!.passwordHash).toBe(DEFERRED_PASSWORD_HASH);

    // Desktop hand-off: the owner is STILL in the in-memory doc (no redirect
    // reload). rehydrateOwnerDoc must NOT early-return — it must rebuild the
    // owner with the real hash, or createNewFile's fail-closed guard blocks.
    const r = await authStore.rehydrateOwnerDoc('Owner', 'realpw123');
    expect(r.success).toBe(true);
    expect(familyStore.owner!.id).toBe(ownerIdBefore); // same memberId preserved
    expect(familyStore.owner!.passwordHash).toBe('hashed-realpw123');
    // Derived from the now-non-empty hash → flips back to false.
    expect(familyStore.owner!.requiresPassword).toBe(false);
  });

  it('createNewFile refuses (precondition, no write) when the owner still carries the deferred sentinel', async () => {
    const authStore = useAuthStore();
    const syncStore = useSyncStore();

    await authStore.signUp({
      deferPassword: true,
      email: 'owner@example.com',
      familyName: 'Test Family',
      memberName: 'Owner',
    });
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });
    mockProvider.write.mockClear();

    // Password step was skipped — the fail-closed guard must refuse the write.
    const result = await syncStore.createNewFile(
      'test.beanpod',
      'pod-password',
      authStore.currentUser!.memberId,
      'fam-test-1',
      'Test Family'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('precondition');
    expect(mockProvider.write).not.toHaveBeenCalled();
    expect(syncStore.criticalWriteState.kind).toBe('idle');
    expect(authStore.podCreated).toBe(false);
  });

  it('full deferred happy path: signUp(defer) → rehydrateOwnerDoc → createNewFile succeeds', async () => {
    const authStore = useAuthStore();
    const syncStore = useSyncStore();

    await authStore.signUp({
      deferPassword: true,
      email: 'owner@example.com',
      familyName: 'Test Family',
      memberName: 'Owner',
    });
    const rehydrate = await authStore.rehydrateOwnerDoc('Owner', 'realpw123');
    expect(rehydrate.success).toBe(true);

    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });

    const result = await syncStore.createNewFile(
      'test.beanpod',
      'realpw123',
      authStore.currentUser!.memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(true);
    expect(authStore.podCreated).toBe(true);
  });
});

describe('authStore.initializeAuth — session restore vs registry (B5, iOS ITP eviction)', () => {
  const SESSION_KEY = 'beanies_auth_session';
  const sampleUser = {
    memberId: 'm-1',
    email: 'returning@example.com',
    familyId: 'fam-1',
    role: 'owner',
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('(i) common case: registry has families + a session → restores the session (unchanged path)', async () => {
    const registryDb = await import('@/services/indexeddb/registryDatabase');
    vi.mocked(registryDb.getRegistryDatabase).mockResolvedValueOnce({
      getAll: vi.fn(async () => [{ id: 'fam-1', name: 'Fam' }]),
    } as never);
    localStorage.setItem(SESSION_KEY, JSON.stringify(sampleUser));

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(true);
    expect(authStore.currentUser?.email).toBe('returning@example.com');
  });

  it('(ii) common case: empty registry + NO session → stays unauthenticated (WelcomeGate)', async () => {
    // default mock: getAll → []
    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(false);
    expect(authStore.currentUser).toBeNull();
    expect(authStore.isInitialized).toBe(true);
  });

  it('(iii) ITP case: empty registry BUT a localStorage session survives → restores instead of WelcomeGate-as-new', async () => {
    // default mock: getAll → [] (registry evicted), but the session persists.
    localStorage.setItem(SESSION_KEY, JSON.stringify(sampleUser));

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(true);
    expect(authStore.currentUser?.email).toBe('returning@example.com');
    expect(authStore.hasFamilies).toBe(true);
  });
});
