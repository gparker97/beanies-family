/**
 * Manual `.beanpod` export — the store half of the split.
 *
 * `manualExport` used to build the envelope, deliver it AND stamp the export
 * timestamp in one call, so a delivery that produced no file still moved
 * "Last Saved" forward: the user was told their data was safely exported when
 * nothing had left the device. The store now hands back bytes
 * (`buildExportEnvelope`) and the page stamps (`markExported`) only once a file
 * genuinely landed. These tests pin both halves, including the throw that
 * replaced a silent no-op.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onSaveFailureChange: vi.fn(() => () => {}),
    onStateChange: vi.fn(() => () => {}),
    getState: vi.fn(() => ({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    })),
    initialize: vi.fn(async () => true),
    getProviderType: vi.fn(() => 'google_drive'),
    hasPermission: vi.fn(async () => true),
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
  getVerifiedGoogleAccountEmail: vi.fn(() => null),
  isSilentRefreshPending: vi.fn(() => false),
  isTokenValid: vi.fn(() => false),
  getLastSilentRefreshDiagnostics: vi.fn(() => null),
}));

vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ googleDrive: true, manualSync: true }),
  canAutoSync: () => true,
}));
const { exportEncryptedPayloadMock, reEncryptEnvelopeMock } = vi.hoisted(() => ({
  exportEncryptedPayloadMock: vi.fn(async () => ({ payload: 'cipher' })),
  reEncryptEnvelopeMock: vi.fn(() => '{"v":4}'),
}));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a
  // test-local `'4.0'` here would hide the one regression the derivation
  // exists to prevent (a compacted pod written as 4.0).
  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  reEncryptEnvelope: reEncryptEnvelopeMock,
  parseBeanpodV4: vi.fn(() => ({})),
  createBeanpodV4: vi.fn(),
  tryUnwrapFamilyKey: vi.fn(),
}));
vi.mock('@/services/automerge/worker/docClient', () => ({
  exportEncryptedPayload: exportEncryptedPayloadMock,
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({ GoogleDriveProvider: vi.fn() }));
vi.mock('@/services/google/driveService', () => ({
  searchBeanpodFilesGlobal: vi.fn(async () => []),
  clearFolderCache: vi.fn(),
  getAppFolderId: vi.fn(() => null),
  DriveApiError: class DriveApiError extends Error {},
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
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
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

describe('syncStore — manual export', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    vi.resetModules();
    ({ useSyncStore } = await import('@/stores/syncStore'));
  });

  it('throws when there is no family key instead of silently doing nothing', async () => {
    const store = useSyncStore();
    // The old shape set `error.value` and returned — and nothing on this path
    // rendered `error.value`, so the export failed invisibly.
    await expect(store.buildExportEnvelope()).rejects.toThrow(/family key/i);
    expect(exportEncryptedPayloadMock).not.toHaveBeenCalled();
  });

  it('does NOT stamp the export timestamp when the envelope cannot be built', async () => {
    const store = useSyncStore();
    expect(store.lastSync).toBeNull();
    await expect(store.buildExportEnvelope()).rejects.toThrow();
    expect(store.lastSync).toBeNull();
  });

  it('markExported is what moves lastSync — the page calls it only once a file landed', () => {
    const store = useSyncStore();
    expect(store.lastSync).toBeNull();
    store.markExported();
    expect(store.lastSync).toEqual(expect.any(String));
  });
});
