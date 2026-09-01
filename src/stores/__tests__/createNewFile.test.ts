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

// #80: mock the seal so the restore tests exercise authStore's handling of each outcome
// rather than the crypto, and never lean on the dated legacy branch.
vi.mock('@/services/auth/sessionSeal', () => ({
  seal: vi.fn(async () => 'sealed-envelope'),
  open: vi.fn(async () => null),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before vi.mock factories reference them
// ---------------------------------------------------------------------------
const { mockProvider, mockSelectSyncFile, mockSave, stateChangeCallbackHolder, mockFamilyKey } =
  vi.hoisted(() => {
    const mockFamilyKey = {} as CryptoKey;
    const mockProviderWrite = vi.fn(async (_envelopeJson: string) => {});
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

// File sync — mock crypto-dependent parts but keep the REAL format logic
// (createBeanpodV4/parseBeanpodV4 are pure JSON assembly/validation; keeping them
// real lets the tests assert the ACTUAL envelope bytes handed to provider.write —
// Phase 4's recoveryKeys-only birth contract lives in that JSON).
vi.mock('@/services/sync/fileSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sync/fileSync')>();
  return {
    ...actual,
    reEncryptEnvelope: vi.fn(async () => '{"version":"4.0"}'),
    downloadAsFile: vi.fn(),
    tryUnwrapFamilyKey: vi.fn(),
  };
});

// Recovery kit (Phase 4): createNewFile generates the pod's ONLY birth wrap via
// this service. Mocked so the kit is deterministic and its failure injectable.
vi.mock('@/services/auth/recoveryKit', () => ({
  generateRecoveryKit: vi.fn(async () => ({
    kitId: 'kit0001',
    code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
    pkg: {
      salt: 'kit-salt-b64',
      wrapped: 'kit-wrapped-key-b64',
      createdAt: '2026-08-28',
    },
  })),
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

// REVIEW-DEMO: the pod-created Slack ping fires from INSIDE createNewFile
// (step 8), not from CreatePodView — mocked so the suppression tests below can
// assert on it.
vi.mock('@/utils/slackNotify', () => ({
  slackNotify: vi.fn(),
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
import * as sessionSeal from '@/services/auth/sessionSeal';
import { reportError } from '@/utils/errorReporter';
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
  it('complete pod creation: signUp(defer) → rehydrateOwnerDoc(PIN) → selectStorage → createNewFile → syncNow', async () => {
    const authStore = useAuthStore();
    const syncStore = useSyncStore();

    // --- Step 1: Sign up (handleStep1Next — Phase 4: password-free) ---
    const signUpResult = await authStore.signUp({
      deferPassword: true,
      email: 'test@example.com',
      familyName: 'Test Family',
      memberName: 'Test User',
    });
    expect(signUpResult.success).toBe(true);
    expect(authStore.currentUser).not.toBeNull();
    const memberId = authStore.currentUser!.memberId;

    // --- Step 1b: Apply the owner's 6-digit PIN on the finish surface ---
    const rehydrate = await authStore.rehydrateOwnerDoc('Test User', '123456');
    expect(rehydrate.success).toBe(true);

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
      memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return; // type narrow
    // Phase 4: the pod is born password-free — success returns the freshly
    // generated recovery kit for the wizard's mandatory display step.
    expect(createResult.kit.kitId).toBe('kit0001');
    expect(createResult.kit.code.length).toBeGreaterThan(0);
    expect(syncStore.familyKey).toBe(mockFamilyKey);
    expect(syncStore.envelope).not.toBeNull();
    // The WRITTEN envelope is the contract: no member wraps at birth, exactly
    // one recovery-kit wrap, and the kit's one-time code never persisted.
    expect(mockProvider.write).toHaveBeenCalledTimes(1);
    const writtenJson = mockProvider.write.mock.calls[0]![0];
    const written = JSON.parse(writtenJson);
    expect(written.wrappedKeys).toEqual({});
    expect(Object.keys(written.recoveryKeys)).toHaveLength(1);
    expect(writtenJson).not.toContain(createResult.kit.code);
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
    // Phase 4 unified flow: password-free signUp, then the 6-digit PIN applied
    // via rehydrateOwnerDoc — createNewFile's fail-closed guard requires the
    // owner to carry a pinHash before any write.
    const signUp = await authStore.signUp({
      deferPassword: true,
      email: 'test@example.com',
      familyName: 'Test Family',
      memberName: 'Test User',
    });
    expect(signUp.success).toBe(true);
    const rehydrate = await authStore.rehydrateOwnerDoc('Test User', '123456');
    expect(rehydrate.success).toBe(true);
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

  it('a generateRecoveryKit throw aborts BEFORE provider.write (kit is the only birth wrap)', async () => {
    const { memberId } = await signUpAndConfigureStorage();
    const syncStore = useSyncStore();
    const kitSvc = await import('@/services/auth/recoveryKit');
    vi.mocked(kitSvc.generateRecoveryKit).mockRejectedValueOnce(new Error('entropy source failed'));
    mockProvider.write.mockClear();

    const result = await syncStore.createNewFile(
      'test.beanpod',
      memberId,
      'fam-test-1',
      'Test Family'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Kit generation lives in the critical section's first step, before any
    // I/O — classified in the 'write' step region by the mapped-error path.
    expect(result.reason).toBe('write');
    expect(result.error.message).toContain('entropy source failed');
    // Nothing was written: a pod may never be born without its recovery wrap.
    expect(mockProvider.write).not.toHaveBeenCalled();
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

    const first = syncStore.createNewFile('test.beanpod', memberId, 'fam-test-1', 'Test Family');
    // Microtask: let the first call enter the critical section and flip the flag.
    await Promise.resolve();
    expect(syncStore.criticalWriteState.kind).toBe('creating');

    const second = await syncStore.createNewFile(
      'test.beanpod',
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

  /**
   * REVIEW-DEMO: `createNewFile`'s remote-side-effect suppression.
   *
   * Demo mode drives the real create path, so the three REMOTE things this
   * function does — the pre-write existing-pod registry lookup, the registry
   * registration, and the pod-created Slack ping — must all be skippable. One
   * option controls all three, deliberately: three separate flags could be set
   * inconsistently.
   *
   * The second test here is the one that matters most. It pins the DEFAULT, so a
   * flag that gets inverted or defaults wrong shows up as a failure rather than as
   * silently unregistered real families.
   */
  describe('createNewFile — REVIEW-DEMO remote side-effect suppression', () => {
    async function createPod(opts?: { suppressRemoteSideEffects?: boolean }) {
      const authStore = useAuthStore();
      const syncStore = useSyncStore();

      // seedDemoFamily now uses the unified deferred flow: password-free
      // signUp, then the demo PIN via rehydrateOwnerDoc.
      await authStore.signUp({
        deferPassword: true,
        email: 'demo@example.invalid',
        familyName: 'Demo Family',
        memberName: 'Demo Owner',
      });
      const rehydrate = await authStore.rehydrateOwnerDoc('Demo Owner', '123456');
      expect(rehydrate.success).toBe(true);
      const memberId = authStore.currentUser!.memberId;

      stateChangeCallbackHolder.callback?.({
        isInitialized: true,
        isConfigured: true,
        fileName: 'demo.beanpod',
        isSyncing: false,
        lastError: null,
      });

      return syncStore.createNewFile(
        'demo.beanpod',
        memberId,
        // The shared mock provider reads back a fixture pinned to this family
        // id; using anything else fails verify with a familyId mismatch.
        'fam-test-1',
        'Demo Family',
        null,
        opts
      );
    }

    it('skips the registry lookup, the registration and the Slack ping when suppressed', async () => {
      const registryService = await import('@/services/registry/registryService');
      const { slackNotify } = await import('@/utils/slackNotify');

      const result = await createPod({ suppressRemoteSideEffects: true });

      expect(result.ok).toBe(true);
      expect(vi.mocked(registryService.lookupFamilyResult)).not.toHaveBeenCalled();
      expect(vi.mocked(registryService.registerFamilyOrThrow)).not.toHaveBeenCalled();
      expect(vi.mocked(slackNotify)).not.toHaveBeenCalled();
    });

    it('still does all three by default — every real create must register', async () => {
      const registryService = await import('@/services/registry/registryService');
      const { slackNotify } = await import('@/utils/slackNotify');

      const result = await createPod();

      expect(result.ok).toBe(true);
      expect(vi.mocked(registryService.lookupFamilyResult)).toHaveBeenCalled();
      expect(vi.mocked(registryService.registerFamilyOrThrow)).toHaveBeenCalled();
      expect(vi.mocked(slackNotify)).toHaveBeenCalled();
    });
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

  it('rehydrateOwnerDoc applies the PIN hash to a deferred owner EVEN when it already exists (desktop, no reload)', async () => {
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
    expect(familyStore.owner!.pinHash).toBeUndefined();

    // Desktop hand-off: the owner is STILL in the in-memory doc (no redirect
    // reload). rehydrateOwnerDoc must NOT early-return while the owner has no
    // pinHash — it must stamp the PIN hash in place, or createNewFile's
    // fail-closed guard blocks.
    const r = await authStore.rehydrateOwnerDoc('Owner', '123456');
    expect(r.success).toBe(true);
    expect(familyStore.owner!.id).toBe(ownerIdBefore); // same memberId preserved
    // Phase 4: the PIN is the credential — pinHash + pinVersion:1 are written,
    // and the owner keeps the '' password sentinel PERMANENTLY (kit-born
    // families are password-free).
    expect(familyStore.owner!.pinHash).toBe('hashed-123456');
    expect(familyStore.owner!.pinVersion).toBe(1);
    expect(familyStore.owner!.passwordHash).toBe(DEFERRED_PASSWORD_HASH);
    // A PIN is a first-class claim credential → no longer reads as unclaimed.
    expect(familyStore.owner!.requiresPassword).toBe(false);
  });

  it('rehydrateOwnerDoc rejects a non-6-digit PIN (isValidPin) and leaves the owner deferred', async () => {
    const authStore = useAuthStore();
    const familyStore = useFamilyStore();

    await authStore.signUp({
      deferPassword: true,
      email: 'owner@example.com',
      familyName: 'Test Family',
      memberName: 'Owner',
    });

    for (const badPin of ['12345', '1234567', 'abcdef', '12 456']) {
      const r = await authStore.rehydrateOwnerDoc('Owner', badPin);
      expect(r.success).toBe(false);
    }
    // Nothing was written — the owner still has no credential.
    expect(familyStore.owner!.pinHash).toBeUndefined();
    expect(familyStore.owner!.passwordHash).toBe(DEFERRED_PASSWORD_HASH);
  });

  it('rehydrateOwnerDoc early-returns success (no rewrite) when the owner already holds a REAL pinHash', async () => {
    const authStore = useAuthStore();
    const familyStore = useFamilyStore();

    await authStore.signUp({
      deferPassword: true,
      email: 'owner@example.com',
      familyName: 'Test Family',
      memberName: 'Owner',
    });
    await authStore.rehydrateOwnerDoc('Owner', '123456');
    expect(familyStore.owner!.pinHash).toBe('hashed-123456');

    // Genuine recovery re-entry on the same session: must not overwrite the
    // established PIN with a different one.
    const r = await authStore.rehydrateOwnerDoc('Owner', '654321');
    expect(r.success).toBe(true);
    expect(familyStore.owner!.pinHash).toBe('hashed-123456'); // unchanged
    expect(familyStore.owner!.pinVersion).toBe(1);
  });

  it('createNewFile refuses (precondition, no write) when the owner has NO pinHash (PIN step skipped)', async () => {
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

    // The PIN step was skipped (owner still sentinel + no pinHash) — the
    // fail-closed guard must refuse the write.
    const result = await syncStore.createNewFile(
      'test.beanpod',
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

  it('full deferred happy path: signUp(defer) → rehydrateOwnerDoc(PIN) → createNewFile succeeds with a kit', async () => {
    const authStore = useAuthStore();
    const syncStore = useSyncStore();

    await authStore.signUp({
      deferPassword: true,
      email: 'owner@example.com',
      familyName: 'Test Family',
      memberName: 'Owner',
    });
    const rehydrate = await authStore.rehydrateOwnerDoc('Owner', '123456');
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
      authStore.currentUser!.memberId,
      'fam-test-1',
      'Test Family'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kit.code.length).toBeGreaterThan(0);
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

  /**
   * These assert authStore's HANDLING of each seal outcome, so the seal itself is mocked
   * (#80). Deliberately NOT written as bare pre-#80 sessions: that would ride the dated
   * legacy branch and turn this suite into a time bomb on LEGACY_SESSION_SUNSET.
   */
  function seed(result: Record<string, unknown>) {
    localStorage.setItem(SESSION_KEY, 'sealed-envelope');
    vi.mocked(sessionSeal.open).mockResolvedValue(result as never);
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(sessionSeal.seal).mockResolvedValue('sealed-envelope');
  });

  it('(i) common case: registry has families + a valid sealed session → restores it', async () => {
    const registryDb = await import('@/services/indexeddb/registryDatabase');
    vi.mocked(registryDb.getRegistryDatabase).mockResolvedValueOnce({
      getAll: vi.fn(async () => [{ id: 'fam-1', name: 'Fam' }]),
    } as never);
    seed({ ok: true, user: sampleUser, legacy: false });

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(true);
    expect(authStore.currentUser?.email).toBe('returning@example.com');
  });

  it('(ii) common case: empty registry + NO session → stays unauthenticated (WelcomeGate)', async () => {
    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(false);
    expect(authStore.currentUser).toBeNull();
    expect(authStore.isInitialized).toBe(true);
  });

  it('(iii) ITP case: empty registry BUT a VALID sealed session survives → restores it', async () => {
    seed({ ok: true, user: sampleUser, legacy: false });

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(true);
    expect(authStore.currentUser?.email).toBe('returning@example.com');
    expect(authStore.hasFamilies).toBe(true);
  });

  it('(iv) ITP case, device secret gone: key-changed → NOT authenticated, but not treated as new', async () => {
    // The accepted regression of #80, pinned explicitly: an evicted registry takes the
    // signing key with it, so the session can no longer be verified and must not be
    // honoured. hasFamilies still records that a returning user exists here.
    seed({ ok: false, reason: 'key-changed' });

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(false);
    expect(authStore.currentUser).toBeNull();
    expect(authStore.hasFamilies).toBe(true);
  });

  it('(v) a tampered session is rejected and reported', async () => {
    seed({ ok: false, reason: 'bad-signature' });

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'session-integrity',
        context: expect.objectContaining({ kind: 'bad-signature' }),
      })
    );
  });

  it('(vi) no signing key available is NOT tampering: no session, no accusation', async () => {
    seed({ ok: false, reason: 'unavailable' });

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    expect(authStore.isAuthenticated).toBe(false);
    expect(reportError).not.toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'session-integrity' })
    );
  });

  it('(vii) a legacy unsigned session is accepted but NOT sealed until the roster vouches', async () => {
    const registryDb = await import('@/services/indexeddb/registryDatabase');
    vi.mocked(registryDb.getRegistryDatabase).mockResolvedValueOnce({
      getAll: vi.fn(async () => [{ id: 'fam-1', name: 'Fam' }]),
    } as never);
    seed({ ok: true, user: sampleUser, legacy: true });

    const authStore = useAuthStore();
    await authStore.initializeAuth();

    // Nobody is logged out by the upgrade.
    expect(authStore.isAuthenticated).toBe(true);
    // But sealing here would HMAC an UNVERIFIED payload: `open` accepts any bare JSON
    // object with a string memberId, no signature checked. An earlier cut re-sealed at
    // this point, which turned a hand-written localStorage blob into a permanently valid
    // session that outlived LEGACY_SESSION_SUNSET — the exact escalation the seal exists
    // to stop.
    expect(sessionSeal.seal).not.toHaveBeenCalled();
    expect(authStore.sessionIsLegacy).toBe(true);

    // The roster is what vouches for it. Only then is it worth committing.
    authStore.confirmSessionMember();
    expect(sessionSeal.seal).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-1' }));
    expect(authStore.sessionIsLegacy).toBe(false);

    // Idempotent: a second roster load must not re-seal.
    vi.mocked(sessionSeal.seal).mockClear();
    authStore.confirmSessionMember();
    expect(sessionSeal.seal).not.toHaveBeenCalled();
  });
});
