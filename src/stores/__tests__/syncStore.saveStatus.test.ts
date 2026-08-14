/**
 * Tests for the `saveStatus` presentation projection + its single-owner
 * transition telemetry (drives the sidebar SaveStatusIndicator).
 *
 * Verifies:
 *   - the status mapping (saving / critical / degraded / saved / hidden),
 *     incl. the one-retry debounce (a single failure stays "saved") and the
 *     totality fallback (configured-but-not-yet-saved → hidden);
 *   - transition telemetry fires exactly once per change from the store (not
 *     per component), with `surface: 'save-status'` and the status in context.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

const {
  stateChangeCallbackHolder,
  saveCompleteCallbackHolder,
  saveFailureCallbackHolder,
  saveAttemptCallbackHolder,
  logEventMock,
  reportErrorMock,
} = vi.hoisted(() => ({
  stateChangeCallbackHolder: {
    cb: null as
      | ((state: {
          isInitialized: boolean;
          isConfigured: boolean;
          fileName: string | null;
          isSyncing: boolean;
          lastError: string | null;
        }) => void)
      | null,
  },
  saveCompleteCallbackHolder: { cb: null as ((timestamp: string) => void) | null },
  saveFailureCallbackHolder: {
    cb: null as ((level: string, error: string | null) => void) | null,
  },
  saveAttemptCallbackHolder: { cb: null as ((count: number) => void) | null },
  logEventMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onStateChange: vi.fn((cb) => {
      stateChangeCallbackHolder.cb = cb;
      return () => {};
    }),
    onSaveComplete: vi.fn((cb) => {
      saveCompleteCallbackHolder.cb = cb;
      return () => {};
    }),
    onSaveFailureChange: vi.fn((cb) => {
      saveFailureCallbackHolder.cb = cb;
      return () => {};
    }),
    onSaveAttempt: vi.fn((cb) => {
      saveAttemptCallbackHolder.cb = cb;
      return () => {};
    }),
    getConsecutiveSaveFailures: vi.fn(() => 0),
    getProviderType: vi.fn(() => 'google_drive'),
  };
});

vi.mock('@/services/google/googleAuth', () => ({
  whenRedirectAuthSettled: vi.fn(async () => {}),
  initializeAuth: vi.fn(async () => {}),
  migratePendingRefreshToken: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenPermanentlyExpired: vi.fn(() => () => {}),
  onTokenAcquired: vi.fn(() => () => {}),
  fetchGoogleUserEmail: vi.fn(async () => null),
  isSilentRefreshPending: vi.fn(() => false),
  isTokenValid: vi.fn(() => false),
  getLastSilentRefreshDiagnostics: vi.fn(() => null),
  getVerifiedGoogleAccountEmail: vi.fn(() => null),
}));
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ googleDrive: true, manualSync: true }),
  canAutoSync: () => true,
}));
vi.mock('@/services/sync/fileSync', () => ({
  reEncryptEnvelope: vi.fn(async () => ''),
  parseBeanpodV4: vi.fn(() => ({})),
  detectFileVersion: vi.fn(() => 4),
  createBeanpodV4: vi.fn(),
  tryUnwrapFamilyKey: vi.fn(),
  downloadAsFile: vi.fn(),
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: vi.fn(),
}));
vi.mock('@/services/google/driveService', () => ({
  searchBeanpodFilesGlobal: vi.fn(async () => []),
  clearFolderCache: vi.fn(),
  getAppFolderId: vi.fn(() => null),
  getFileMetadata: vi.fn(async () => null),
  DriveApiError: class DriveApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('@/services/sync/offlineQueue', () => ({ clearQueue: vi.fn() }));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  saveSettings: vi.fn(async () => {}),
}));
vi.mock('@/services/registry/registryService', () => ({
  registerCurrentFamily: vi.fn(async () => {}),
}));
vi.mock('@/services/automerge/docService', () => ({ replaceDoc: vi.fn(), mergeDoc: vi.fn() }));
vi.mock('@/services/automerge/persistenceService', () => ({
  initPersistenceDB: vi.fn(async () => {}),
  persistDoc: vi.fn(async () => {}),
  persistEnvelope: vi.fn(async () => {}),
  loadCachedDoc: vi.fn(async () => null),
  loadCachedEnvelope: vi.fn(async () => null),
}));
vi.mock('@/services/crypto/familyKeyService', () => ({
  generateFamilyKey: vi.fn(),
  deriveMemberKey: vi.fn(),
  wrapFamilyKey: vi.fn(),
}));
vi.mock('@/services/recurring/recurringProcessor', () => ({
  deduplicateRecurringTransactions: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/config/features', () => ({ features: { drive: true, oauthProxy: true } }));

const stubStore =
  (overrides: Record<string, unknown> = {}) =>
  () => ({
    reloadFromCRDT: vi.fn(async () => {}),
    reloadAll: vi.fn(async () => {}),
    reset: vi.fn(),
    ...overrides,
  });
vi.mock('@/stores/accountsStore', () => ({ useAccountsStore: stubStore() }));
vi.mock('@/stores/assetsStore', () => ({ useAssetsStore: stubStore() }));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: stubStore() }));
vi.mock('@/stores/goalsStore', () => ({ useGoalsStore: stubStore() }));
vi.mock('@/stores/recurringStore', () => ({ useRecurringStore: stubStore() }));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: stubStore() }));
vi.mock('@/stores/activityStore', () => ({ useActivityStore: stubStore() }));
vi.mock('@/stores/vacationStore', () => ({ useVacationStore: stubStore() }));
vi.mock('@/stores/budgetStore', () => ({ useBudgetStore: stubStore() }));
vi.mock('@/stores/favoritesStore', () => ({ useFavoritesStore: stubStore() }));
vi.mock('@/stores/sayingsStore', () => ({ useSayingsStore: stubStore() }));
vi.mock('@/stores/memberNotesStore', () => ({ useMemberNotesStore: stubStore() }));
vi.mock('@/stores/allergiesStore', () => ({ useAllergiesStore: stubStore() }));
vi.mock('@/stores/medicationsStore', () => ({ useMedicationsStore: stubStore() }));
vi.mock('@/stores/recipesStore', () => ({ useRecipesStore: stubStore() }));
vi.mock('@/stores/emergencyContactsStore', () => ({ useEmergencyContactsStore: stubStore() }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: stubStore() }));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: stubStore({ activeFamilyId: 'fam-1' }),
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: stubStore() }));
vi.mock('@/stores/transactionsStore', () => ({ useTransactionsStore: stubStore() }));
vi.mock('@/stores/syncHighlightStore', () => ({
  useSyncHighlightStore: stubStore({ clearHighlights: vi.fn() }),
}));

let useSyncStore: typeof import('@/stores/syncStore').useSyncStore;

const CONFIGURED = {
  isInitialized: true,
  isConfigured: true,
  fileName: 'test.beanpod',
  isSyncing: false,
  lastError: null,
};

describe('syncStore — saveStatus projection', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    stateChangeCallbackHolder.cb = null;
    saveCompleteCallbackHolder.cb = null;
    saveFailureCallbackHolder.cb = null;
    saveAttemptCallbackHolder.cb = null;
    setActivePinia(createPinia());
    vi.resetModules();
    ({ useSyncStore } = await import('@/stores/syncStore'));
  });

  it('maps store state to the right SaveStatus (incl. debounce + totality)', () => {
    const store = useSyncStore();

    // Not configured → hidden.
    expect(store.saveStatus).toBe('hidden');

    // Configured but no first save yet, no failures → still hidden (totality).
    stateChangeCallbackHolder.cb!({ ...CONFIGURED });
    expect(store.saveStatus).toBe('hidden');

    // First successful save → saved.
    saveCompleteCallbackHolder.cb!('2026-08-06T00:00:00.000Z');
    expect(store.saveStatus).toBe('saved');

    // In-flight → saving.
    stateChangeCallbackHolder.cb!({ ...CONFIGURED, isSyncing: true });
    expect(store.saveStatus).toBe('saving');

    // Back to idle; a single failure stays "saved" (one-retry debounce).
    stateChangeCallbackHolder.cb!({ ...CONFIGURED, isSyncing: false });
    saveAttemptCallbackHolder.cb!(1);
    expect(store.saveStatus).toBe('saved');

    // Second consecutive failure → degraded (amber).
    saveAttemptCallbackHolder.cb!(2);
    expect(store.saveStatus).toBe('degraded');

    // Critical level (3+ strikes) → critical (banner owns the alarm).
    saveFailureCallbackHolder.cb!('critical', 'server error');
    expect(store.saveStatus).toBe('critical');
  });

  it('emits exactly one save-status transition event per change (single store-level owner)', async () => {
    const store = useSyncStore();

    stateChangeCallbackHolder.cb!({ ...CONFIGURED });
    saveCompleteCallbackHolder.cb!('2026-08-06T00:00:00.000Z');
    await nextTick();
    expect(store.saveStatus).toBe('saved');

    logEventMock.mockClear();

    // saved → saving is a single transition.
    stateChangeCallbackHolder.cb!({ ...CONFIGURED, isSyncing: true });
    await nextTick();

    const saveStatusCalls = logEventMock.mock.calls.filter(
      (c) => (c[0] as { surface?: string })?.surface === 'save-status'
    );
    expect(saveStatusCalls).toHaveLength(1);
    expect(
      (saveStatusCalls[0]![0] as { context: { save_status: string } }).context.save_status
    ).toBe('saving');
  });
});
