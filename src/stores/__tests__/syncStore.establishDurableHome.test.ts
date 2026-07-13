/**
 * Tests for syncStore.establishDurableHomeAfterLoad — the #47 re-home action
 * that gives a just-loaded (cross-account / restored-backup) family a durable,
 * writable save target after a successful decrypt.
 *
 * Precedence under test:
 *   1. provider already set FOR THIS family -> idempotent skip
 *   2. Drive available + valid token        -> configureSyncFileGoogleDrive (re-home)
 *   3. native, Drive off                     -> selectNativeLocalFile + syncNow(true)
 *   4. neither                               -> critical reportError, never silent
 *   +  stale provider from a DIFFERENT family -> does NOT skip
 *
 * Heavy mock scaffolding mirrors syncStore.migrate.test.ts (syncStore imports a
 * large dependency graph; only the modules this action touches get behaviour).
 */
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Settings, GlobalSettings } from '@/types/models';

const {
  mockSave,
  mockSetProvider,
  mockGetProvider,
  mockGetProviderFamilyId,
  mockSelectNativeLocalFile,
  mockCreateNew,
  mockReportError,
  mockRegisterFamily,
  mockIsNative,
  mockIsTokenValid,
} = vi.hoisted(() => ({
  mockSave: vi.fn(async () => true),
  mockSetProvider: vi.fn(),
  mockGetProvider: vi.fn(() => null as unknown),
  mockGetProviderFamilyId: vi.fn<() => string | null>(() => null),
  mockSelectNativeLocalFile: vi.fn(async () => true),
  mockCreateNew: vi.fn(),
  mockReportError: vi.fn(),
  mockRegisterFamily: vi.fn(async () => {}),
  mockIsNative: vi.fn(() => false),
  mockIsTokenValid: vi.fn(() => false),
}));

// Mutable Drive-availability flags (isGoogleDriveAvailable = drive && oauthProxy).
const featuresState = { drive: true, oauthProxy: true };

const defaultSettings: Settings = {
  id: 'app_settings',
  baseCurrency: 'USD',
  displayCurrency: 'USD',
  exchangeRates: [],
  exchangeRateAutoUpdate: true,
  exchangeRateLastFetch: null,
  theme: 'light',
  language: 'en',
  syncEnabled: false,
  autoSyncEnabled: true,
  encryptionEnabled: false,
  aiProvider: 'none',
  aiApiKeys: {},
  preferredCurrencies: [],
  customInstitutions: [],
  onboardingCompleted: true,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};
const settingsState: { current: Settings } = { current: { ...defaultSettings } };

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ ...defaultSettings }),
  getSettings: vi.fn(async () => ({ ...settingsState.current })),
  saveSettings: vi.fn(async (partial: Partial<Settings>) => {
    settingsState.current = { ...settingsState.current, ...partial, id: 'app_settings' };
    return { ...settingsState.current };
  }),
}));

const defaultGlobalSettings: GlobalSettings = {
  id: 'global_settings',
  theme: 'light',
  language: 'en',
  lastActiveFamilyId: null,
  exchangeRates: [],
  exchangeRateAutoUpdate: true,
  exchangeRateLastFetch: null,
  isTrustedDevice: false,
  trustedDevicePromptShown: false,
};
const globalSettingsState: { current: GlobalSettings } = { current: { ...defaultGlobalSettings } };
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...defaultGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...globalSettingsState.current })),
  saveGlobalSettings: vi.fn(async (partial: Partial<GlobalSettings>) => {
    globalSettingsState.current = {
      ...globalSettingsState.current,
      ...partial,
      id: 'global_settings',
    };
    return { ...globalSettingsState.current };
  }),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(async () => ({ ...globalSettingsState.current })),
}));

vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    save: (...a: unknown[]) => (mockSave as (...x: unknown[]) => unknown)(...a),
    setProvider: (...a: unknown[]) => mockSetProvider(...a),
    getProvider: () => mockGetProvider(),
    getProviderFamilyId: () => mockGetProviderFamilyId(),
    selectNativeLocalFile: (...a: unknown[]) =>
      (mockSelectNativeLocalFile as (...x: unknown[]) => Promise<boolean>)(...a),
    onStateChange: vi.fn(() => () => {}),
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
  isNative: () => mockIsNative(),
}));

vi.mock('@/config/features', () => ({
  get features() {
    return featuresState;
  },
}));

vi.mock('@/services/sync/fileSync', () => ({
  reEncryptEnvelope: vi.fn(async () => '{"version":"4.0"}'),
  parseBeanpodV4: vi.fn(() => ({})),
  createBeanpodV4: vi.fn(async () => '{"version":"4.0"}'),
  tryUnwrapFamilyKey: vi.fn(async () => null),
  decryptBeanpodPayload: vi.fn(async () => ({})),
  detectFileVersion: vi.fn(() => '4.0'),
  downloadAsFile: vi.fn(),
}));

vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: { createNew: (...a: unknown[]) => mockCreateNew(...a) },
}));
vi.mock('@/services/sync/providers/localProvider', () => ({
  LocalStorageProvider: { fromSavePicker: vi.fn() },
}));

vi.mock('@/services/sync/fileHandleStore', () => ({
  storeFileHandle: vi.fn(async () => {}),
  getFileHandle: vi.fn(async () => null),
  clearFileHandle: vi.fn(async () => {}),
  clearFileHandleForFamily: vi.fn(async () => {}),
  verifyPermission: vi.fn(async () => true),
  hasValidFileHandle: vi.fn(async () => false),
  getProviderConfig: vi.fn(async () => null),
  storeProviderConfig: vi.fn(async () => {}),
  clearProviderConfig: vi.fn(async () => {}),
}));

vi.mock('@/services/google/googleAuth', () => ({
  whenRedirectAuthSettled: vi.fn(async () => {}),
  initializeAuth: vi.fn(async () => {}),
  migratePendingRefreshToken: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenPermanentlyExpired: vi.fn(() => () => {}),
  onTokenAcquired: vi.fn(() => () => {}),
  fetchGoogleUserEmail: vi.fn(async () => null),
  isSilentRefreshPending: vi.fn(() => false),
  isTokenValid: () => mockIsTokenValid(),
  isUserCancellation: () => false,
}));

vi.mock('@/services/google/driveService', () => ({
  searchBeanpodFilesGlobal: vi.fn(async () => []),
  clearFolderCache: vi.fn(),
  getAppFolderId: vi.fn(() => null),
  DriveApiError: class DriveApiError extends Error {},
}));

vi.mock('@/services/sync/offlineQueue', () => ({ clearQueue: vi.fn() }));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  closeDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/registry/registryService', () => ({
  registerFamily: (...a: unknown[]) =>
    (mockRegisterFamily as (...x: unknown[]) => Promise<void>)(...a),
  removeFamily: vi.fn(async () => {}),
}));
vi.mock('@/services/auth/passkeyService', () => ({}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => mockReportError(...a),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [], loadMembers: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => ({ accounts: [], loadAccounts: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => ({ transactions: [], loadTransactions: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/assetsStore', () => ({
  useAssetsStore: () => ({ assets: [], loadAssets: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/goalsStore', () => ({
  useGoalsStore: () => ({ goals: [], loadGoals: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/recurringStore', () => ({
  useRecurringStore: () => ({ recurringItems: [], loadRecurringItems: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({ todos: [], loadTodos: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activities: [], loadActivities: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/syncHighlightStore', () => ({
  useSyncHighlightStore: () => ({
    snapshotBeforeReload: vi.fn(),
    detectChanges: vi.fn(),
    clearHighlights: vi.fn(),
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'family-123', activeFamilyName: 'Test Family' }),
}));

import { useSyncStore } from '@/stores/syncStore';

function makeDriveProvider() {
  return {
    type: 'google_drive' as const,
    persist: vi.fn(async () => {}),
    getDisplayName: () => 'Test Family.beanpod',
    getFileId: () => 'drive-file-id',
  };
}

describe('syncStore.establishDurableHomeAfterLoad', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    featuresState.drive = true;
    featuresState.oauthProxy = true;
    mockSave.mockResolvedValue(true);
    mockGetProvider.mockReturnValue(null);
    mockGetProviderFamilyId.mockReturnValue(null);
    mockSelectNativeLocalFile.mockResolvedValue(true);
    mockIsNative.mockReturnValue(false);
    mockIsTokenValid.mockReturnValue(false);
  });

  it('is an idempotent no-op when a provider is already installed for this family', async () => {
    const store = useSyncStore();
    mockGetProvider.mockReturnValue(makeDriveProvider());
    mockGetProviderFamilyId.mockReturnValue('family-123'); // matches active family

    await store.establishDurableHomeAfterLoad();

    expect(mockCreateNew).not.toHaveBeenCalled();
    expect(mockSelectNativeLocalFile).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('re-homes to the signed-in account Drive when available with a valid token', async () => {
    const store = useSyncStore();
    mockIsTokenValid.mockReturnValue(true);
    mockCreateNew.mockResolvedValue(makeDriveProvider());

    await store.establishDurableHomeAfterLoad();

    // configureSyncFileGoogleDrive → GoogleDriveProvider.createNew → installProvider
    expect(mockCreateNew).toHaveBeenCalledWith('Test Family.beanpod');
    expect(mockSetProvider).toHaveBeenCalled();
    expect(mockSelectNativeLocalFile).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('falls back to a native local file (+ forced write) when Drive is off on native', async () => {
    const store = useSyncStore();
    featuresState.drive = false; // Drive not available
    mockIsNative.mockReturnValue(true);

    await store.establishDurableHomeAfterLoad();

    expect(mockCreateNew).not.toHaveBeenCalled();
    expect(mockSelectNativeLocalFile).toHaveBeenCalledWith('Test Family');
    expect(mockSave).toHaveBeenCalled(); // syncNow(true) → save
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('pages loudly (critical) when no durable home can be established', async () => {
    const store = useSyncStore();
    featuresState.drive = false; // no Drive
    mockIsNative.mockReturnValue(false); // no native

    await store.establishDurableHomeAfterLoad();

    expect(mockCreateNew).not.toHaveBeenCalled();
    expect(mockSelectNativeLocalFile).not.toHaveBeenCalled();
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'load-existing-family',
        severity: 'critical',
        context: expect.objectContaining({ action: 'no-backend' }),
      })
    );
  });

  it('does NOT skip when a stale provider belongs to a different family', async () => {
    const store = useSyncStore();
    mockGetProvider.mockReturnValue(makeDriveProvider());
    mockGetProviderFamilyId.mockReturnValue('some-other-family'); // stale
    mockIsTokenValid.mockReturnValue(true);
    mockCreateNew.mockResolvedValue(makeDriveProvider());

    await store.establishDurableHomeAfterLoad();

    // Proceeds to establish for the just-loaded family rather than skipping.
    expect(mockCreateNew).toHaveBeenCalled();
  });

  it('never reuses createNewFile (avoids its brand-new-family preconditions)', async () => {
    const store = useSyncStore();
    mockIsTokenValid.mockReturnValue(true);
    mockCreateNew.mockResolvedValue(makeDriveProvider());

    const spy = vi.spyOn(store, 'createNewFile');
    await store.establishDurableHomeAfterLoad();

    expect(spy).not.toHaveBeenCalled();
  });
});
