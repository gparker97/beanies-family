/**
 * Tests for syncStore.migrateStorage — moving the active pod between local
 * file and Google Drive — plus coverage of the shared `installProvider`
 * sequence it relies on (exercised here via `configureSyncFileGoogleDrive`).
 *
 * Heavy mock scaffolding mirrors `syncAutoSave.test.ts`: syncStore imports a
 * large dependency graph; only the modules `migrateStorage` actually touches
 * are given meaningful behaviour, the rest are stubbed.
 */
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import type { Settings, GlobalSettings } from '@/types/models';

const {
  mockSave,
  mockRemoteChanged,
  mockSetProvider,
  mockGetProvider,
  mockCreateNew,
  mockFromSavePicker,
  mockReportError,
  mockRegisterFamily,
} = vi.hoisted(() => ({
  mockSave: vi.fn(async () => true),
  mockRemoteChanged: vi.fn<
    () => Promise<{
      status: string;
      basis: string;
      revision: string | null;
      modifiedTime: string | null;
    }>
  >(async () => ({ status: 'unchanged', basis: 'revision', revision: null, modifiedTime: null })),
  mockSetProvider: vi.fn(),
  mockGetProvider: vi.fn(() => null as unknown),
  mockCreateNew: vi.fn(),
  mockFromSavePicker: vi.fn(),
  mockReportError: vi.fn(),
  mockRegisterFamily: vi.fn(async () => {}),
}));

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

// Mutable settings state — lets country-watcher tests below seed/change country
// without hitting real persistence. Reset to defaults in beforeEach.
const settingsState: { current: Settings } = { current: { ...defaultSettings } };

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ ...defaultSettings }),
  getSettings: vi.fn(async () => ({ ...settingsState.current })),
  saveSettings: vi.fn(async (partial: Partial<Settings>) => {
    settingsState.current = {
      ...settingsState.current,
      ...partial,
      id: 'app_settings',
      updatedAt: new Date().toISOString(),
    };
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
    remoteChanged: (...a: unknown[]) => (mockRemoteChanged as (...x: unknown[]) => unknown)(...a),
    setProvider: (...a: unknown[]) => mockSetProvider(...a),
    getProvider: () => mockGetProvider(),
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
}));

vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a

  // test-local `'4.0'` here would hide the one regression the derivation

  // exists to prevent (a compacted pod written as 4.0).

  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  reEncryptEnvelope: vi.fn(async () => '{"version":"4.0"}'),
  parseBeanpodV4: vi.fn(() => ({})),
  createBeanpodV4: vi.fn(async () => '{"version":"4.0"}'),
  tryUnwrapFamilyKey: vi.fn(async () => null),
  detectFileVersion: vi.fn(() => '4.0'),
}));

vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: { createNew: (...a: unknown[]) => mockCreateNew(...a) },
}));
vi.mock('@/services/sync/providers/localProvider', () => ({
  LocalStorageProvider: { fromSavePicker: (...a: unknown[]) => mockFromSavePicker(...a) },
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
  isTokenValid: vi.fn(() => false),
  // Replicate the real predicate so buildProviderForTarget can classify
  // a cancelled Google chooser correctly.
  isUserCancellation: (e: unknown) => {
    if ((e as { name?: string } | null)?.name === 'AbortError') return true;
    const msg = e instanceof Error ? e.message : String(e);
    return /cancel|dismiss|popup_closed|user_cancel/i.test(msg);
  },
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

// Family stores — minimal stubs
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

// --- Helpers --------------------------------------------------------------

function makeProvider(
  type: 'local' | 'google_drive',
  displayName: string,
  opts: { persistThrows?: boolean } = {}
) {
  return {
    type,
    persist: vi.fn(async () => {
      if (opts.persistThrows) throw new Error('persist boom');
    }),
    getDisplayName: () => displayName,
    getFileId: () => (type === 'google_drive' ? 'drive-file-id' : null),
  };
}

describe('syncStore.migrateStorage', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    mockSave.mockResolvedValue(true);
    mockRemoteChanged.mockResolvedValue({
      status: 'unchanged',
      basis: 'revision',
      revision: null,
      modifiedTime: null,
    });
    mockCreateNew.mockReset();
    mockFromSavePicker.mockReset();
    mockGetProvider.mockReturnValue(null);
  });

  function configuredStore(from: 'local' | 'google_drive') {
    const store = useSyncStore();
    store.isConfigured = true;
    store.storageProviderType = from;
    store.fileName = from === 'local' ? 'my-family.beanpod' : 'pod-on-drive.beanpod';
    return store;
  }

  it('moves local → Google Drive: installs the new provider, fires the ok ping, no rollback', async () => {
    const store = configuredStore('local');
    const localProvider = makeProvider('local', 'my-family.beanpod');
    mockGetProvider.mockReturnValue(localProvider);
    const driveProvider = makeProvider('google_drive', 'pod.beanpod');
    mockCreateNew.mockResolvedValue(driveProvider);

    const result = await store.migrateStorage('google_drive');

    expect(result).toEqual({ outcome: 'success', dest: 'pod.beanpod' });
    expect(mockCreateNew).toHaveBeenCalledWith('my-family.beanpod', { forceConsent: false });
    expect(driveProvider.persist).toHaveBeenCalledWith('family-123');
    expect(mockSetProvider).toHaveBeenCalledWith(driveProvider);
    expect(localProvider.persist).not.toHaveBeenCalled(); // no rollback
    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ provider: 'google_drive', fileId: 'drive-file-id' })
    );
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'storage-migration-ok', severity: 'warning' })
    );
    expect(store.isMigratingStorage).toBe(false);
  });

  it('moves Google Drive → local file via the save picker', async () => {
    const { requestAccessToken } = await import('@/services/google/googleAuth');
    const store = configuredStore('google_drive');
    mockGetProvider.mockReturnValue(makeProvider('google_drive', 'pod-on-drive.beanpod'));
    const localProvider = makeProvider('local', 'my-family.beanpod');
    mockFromSavePicker.mockResolvedValue(localProvider);

    const result = await store.migrateStorage('local');

    expect(result).toEqual({ outcome: 'success', dest: 'my-family.beanpod' });
    expect(mockFromSavePicker).toHaveBeenCalledWith('my-family.beanpod');
    expect(localProvider.persist).toHaveBeenCalledWith('family-123');
    expect(mockSetProvider).toHaveBeenCalledWith(localProvider);
    expect(requestAccessToken).not.toHaveBeenCalled(); // Drive target only
    expect(mockCreateNew).not.toHaveBeenCalled();
  });

  it('returns "cancelled" when the user dismisses the save picker', async () => {
    const store = configuredStore('google_drive');
    mockGetProvider.mockReturnValue(makeProvider('google_drive', 'pod.beanpod'));
    mockFromSavePicker.mockResolvedValue(null); // AbortError swallowed → null

    const result = await store.migrateStorage('local');

    expect(result).toEqual({ outcome: 'cancelled' });
    expect(mockSetProvider).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'storage-migration-failed' })
    );
  });

  it('returns "cancelled" when the Google account chooser is dismissed', async () => {
    const store = configuredStore('local');
    mockGetProvider.mockReturnValue(makeProvider('local', 'my-family.beanpod'));
    mockCreateNew.mockRejectedValue(new Error('popup_closed_by_user'));

    const result = await store.migrateStorage('google_drive');

    expect(result).toEqual({ outcome: 'cancelled' });
    expect(mockSetProvider).not.toHaveBeenCalled();
  });

  it('aborts before the swap when the source flush fails', async () => {
    const store = configuredStore('local');
    mockGetProvider.mockReturnValue(makeProvider('local', 'my-family.beanpod'));
    mockSave.mockResolvedValueOnce(false); // pre-swap syncNow() fails

    const result = await store.migrateStorage('google_drive');

    expect(result.outcome).toBe('failed');
    expect(mockCreateNew).not.toHaveBeenCalled();
    expect(mockSetProvider).not.toHaveBeenCalled();
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'storage-migration-failed',
        context: expect.objectContaining({ step: 'pre-swap' }),
      })
    );
  });

  it('rolls back to the previous provider when the new provider fails to install', async () => {
    const store = configuredStore('local');
    const localProvider = makeProvider('local', 'my-family.beanpod');
    mockGetProvider.mockReturnValue(localProvider);
    const driveProvider = makeProvider('google_drive', 'pod.beanpod', { persistThrows: true });
    mockCreateNew.mockResolvedValue(driveProvider);

    const result = await store.migrateStorage('google_drive');

    expect(result.outcome).toBe('failed');
    expect(driveProvider.persist).toHaveBeenCalled(); // attempted
    expect(localProvider.persist).toHaveBeenCalledWith('family-123'); // rollback re-installed it
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'storage-migration-failed',
        context: expect.objectContaining({ step: 'install' }),
      })
    );
  });

  it('returns "recovery-needed" when the rollback itself fails', async () => {
    const store = configuredStore('local');
    const localProvider = makeProvider('local', 'my-family.beanpod', { persistThrows: true });
    mockGetProvider.mockReturnValue(localProvider);
    const driveProvider = makeProvider('google_drive', 'pod.beanpod', { persistThrows: true });
    mockCreateNew.mockResolvedValue(driveProvider);

    const result = await store.migrateStorage('google_drive');

    expect(result.outcome).toBe('recovery-needed');
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'storage-migration-failed',
        context: expect.objectContaining({ step: 'rollback' }),
      })
    );
  });

  it('guard rails: fails when not configured / target equals current; ignores re-entrant calls', async () => {
    const store = useSyncStore();

    // not configured
    expect((await store.migrateStorage('google_drive')).outcome).toBe('failed');

    // target equals current
    store.isConfigured = true;
    store.storageProviderType = 'local';
    expect((await store.migrateStorage('local')).outcome).toBe('failed');

    // re-entrancy
    store.isMigratingStorage = true;
    expect(await store.migrateStorage('google_drive')).toEqual({ outcome: 'cancelled' });
  });
});

// NOTE: a `syncStore.configureSyncFileGoogleDrive` describe lived here. That
// function existed only to serve the silent re-home path removed on 2026-08-10
// (see docs/plans/2026-08-10-never-fork-a-family-pod.md) and had no other caller,
// so it went with it. The shared installProvider sequence it exercised — persist
// -> setProvider -> syncNow -> saveSettings -> registerCurrentFamily — is covered
// by the `syncStore.migrateStorage` describe above, which together with
// createNewFile is now the only path that reaches it.

// ---------------------------------------------------------------------------
// Registry country sync — verifies the country field flows through every
// registerCurrentFamily payload + the syncStore-side watcher fires
// ensureRegistered() on Settings.country changes (own + Automerge-synced).
// ---------------------------------------------------------------------------

describe('syncStore — registry country sync', () => {
  beforeEach(async () => {
    settingsState.current = { ...defaultSettings };
    globalSettingsState.current = { ...defaultGlobalSettings };
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSave.mockResolvedValue(true);
    mockRemoteChanged.mockResolvedValue({
      status: 'unchanged',
      basis: 'revision',
      revision: null,
      modifiedTime: null,
    });
    mockGetProvider.mockReturnValue(null);
  });

  it('includes country in the registerFamily payload when settings has it', async () => {
    settingsState.current = { ...defaultSettings, country: 'US' };
    const { useSettingsStore } = await import('@/stores/settingsStore');
    const settings = useSettingsStore();
    await settings.loadSettings(); // pulls the seeded US country into the store
    const store = useSyncStore();
    store.isConfigured = true;
    store.storageProviderType = 'local';
    mockGetProvider.mockReturnValue(makeProvider('local', 'my-family.beanpod'));

    store.ensureRegistered();
    await nextTick();

    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ country: 'US' })
    );
  });

  it('sends country: null when no country has been picked', async () => {
    // defaults already have no country — exercise the null fallback
    const store = useSyncStore();
    store.isConfigured = true;
    store.storageProviderType = 'local';
    mockGetProvider.mockReturnValue(makeProvider('local', 'my-family.beanpod'));

    store.ensureRegistered();
    await nextTick();

    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ country: null })
    );
  });

  it('fires registerFamily automatically when Settings.country changes (watcher path)', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore');
    const store = useSyncStore();
    store.isConfigured = true;
    store.storageProviderType = 'local';
    mockGetProvider.mockReturnValue(makeProvider('local', 'my-family.beanpod'));

    const settings = useSettingsStore();
    await settings.loadSettings();
    mockRegisterFamily.mockClear(); // baseline: ignore the initial null fire from store setup

    await settings.setCountry('JP');
    await nextTick();

    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ country: 'JP' })
    );
  });
});

// ---------------------------------------------------------------------------
// Registry usage signals — the login flag (isLoginEvent) and beanpod size.
// lastLoginAt must move ONLY on a genuine login/resume, so ensureRegistered()
// (the country-watcher default) sends false and ensureRegistered(true) (the
// LoginPage site) sends true. beanpodSizeKb is the last persisted size in KB.
// ---------------------------------------------------------------------------

describe('syncStore — registry usage signals (login flag + size)', () => {
  beforeEach(async () => {
    settingsState.current = { ...defaultSettings };
    globalSettingsState.current = { ...defaultGlobalSettings };
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSave.mockResolvedValue(true);
    mockRemoteChanged.mockResolvedValue({
      status: 'unchanged',
      basis: 'revision',
      revision: null,
      modifiedTime: null,
    });
    mockGetProvider.mockReturnValue(makeProvider('local', 'my-family.beanpod'));
  });

  function armStore() {
    const store = useSyncStore();
    store.isConfigured = true;
    store.storageProviderType = 'local';
    return store;
  }

  it('sends isLoginEvent: false from ensureRegistered() (non-login, e.g. country watcher)', async () => {
    const store = armStore();
    store.ensureRegistered();
    await nextTick();
    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ isLoginEvent: false })
    );
  });

  it('sends isLoginEvent: true from ensureRegistered(true) (the canonical login site)', async () => {
    const store = armStore();
    store.ensureRegistered(true);
    await nextTick();
    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ isLoginEvent: true })
    );
  });

  it('includes beanpodSizeKb rounded from the last persisted byte size', async () => {
    const svc = await import('@/services/sync/syncService');
    vi.mocked(svc.getLastPersistedBytes).mockReturnValue(35840); // 35 KB exactly
    const store = armStore();
    store.ensureRegistered(true);
    await nextTick();
    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ beanpodSizeKb: 35 })
    );
  });

  it('sends beanpodSizeKb: null when no size has been persisted yet', async () => {
    const svc = await import('@/services/sync/syncService');
    vi.mocked(svc.getLastPersistedBytes).mockReturnValue(null);
    const store = armStore();
    store.ensureRegistered();
    await nextTick();
    expect(mockRegisterFamily).toHaveBeenCalledWith(
      'family-123',
      expect.objectContaining({ beanpodSizeKb: null })
    );
  });
});
