/**
 * Auto-save arming tests for syncStore.
 *
 * Validates that after configureSyncFile / loadFromNewFile / loadFromDroppedFile,
 * the auto-sync watcher is armed so that store changes trigger
 * triggerDebouncedSave. Without this, changes made in the session (including
 * preferredCurrencies) are never written to the .beanpod file and are lost on
 * refresh.
 */
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import type { Settings, GlobalSettings } from '@/types/models';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above const declarations,
// so any mock fn referenced inside a factory must be created with vi.hoisted().
// ---------------------------------------------------------------------------

const {
  mockTriggerDebouncedSave,
  mockSelectSyncFile,
  mockSave,
  mockSettingsStateHolder,
  stateChangeCallbackHolder,
} = vi.hoisted(() => ({
  mockTriggerDebouncedSave: vi.fn(),
  mockSelectSyncFile: vi.fn(async () => true),
  mockSave: vi.fn(async () => true),
  // Wrap in object so the factory can read/write the shared state
  mockSettingsStateHolder: {
    state: null as unknown as Settings,
  },
  // Capture the onStateChange callback so we can simulate syncService state changes
  stateChangeCallbackHolder: {
    callback: null as ((state: Record<string, unknown>) => void) | null,
  },
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

// Initialize shared state (used inside hoisted mock factories)
mockSettingsStateHolder.state = { ...defaultSettings };

vi.mock('@/services/indexeddb/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({
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
  }),
  getSettings: vi.fn(async () => ({ ...mockSettingsStateHolder.state })),
  saveSettings: vi.fn(async (partial: Partial<Settings>) => {
    mockSettingsStateHolder.state = {
      ...mockSettingsStateHolder.state,
      ...partial,
      id: 'app_settings',
    };
    return { ...mockSettingsStateHolder.state };
  }),
  setBaseCurrency: vi.fn(async (c: string) => {
    mockSettingsStateHolder.state = {
      ...mockSettingsStateHolder.state,
      baseCurrency: c as Settings['baseCurrency'],
    };
    return { ...mockSettingsStateHolder.state };
  }),
  setDisplayCurrency: vi.fn(async (c: string) => {
    mockSettingsStateHolder.state = {
      ...mockSettingsStateHolder.state,
      displayCurrency: c as Settings['displayCurrency'],
    };
    return { ...mockSettingsStateHolder.state };
  }),
  setPreferredCurrencies: vi.fn(async (currencies: string[]) => {
    mockSettingsStateHolder.state = {
      ...mockSettingsStateHolder.state,
      preferredCurrencies: currencies as Settings['preferredCurrencies'],
    };
    return { ...mockSettingsStateHolder.state };
  }),
  setTheme: vi.fn(),
  setLanguage: vi.fn(),
  setSyncEnabled: vi.fn(),
  setAutoSyncEnabled: vi.fn(),
  setAIProvider: vi.fn(),
  setAIApiKey: vi.fn(),
  setExchangeRateAutoUpdate: vi.fn(),
  setExchangeRateLastFetch: vi.fn(),
  updateExchangeRates: vi.fn(),
  addExchangeRate: vi.fn(),
  removeExchangeRate: vi.fn(),
  addCustomInstitution: vi.fn(),
  removeCustomInstitution: vi.fn(),
  convertAmount: vi.fn(),
  getExchangeRate: vi.fn(),
}));

const mockGlobalSettings: GlobalSettings = {
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

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...mockGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...mockGlobalSettings })),
  saveGlobalSettings: vi.fn(async (partial: Partial<GlobalSettings>) => ({
    ...mockGlobalSettings,
    ...partial,
    id: 'global_settings',
  })),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(),
}));

vi.mock('@/services/sync/syncService', () => ({
  onStateChange: vi.fn((cb: (state: Record<string, unknown>) => void) => {
    stateChangeCallbackHolder.callback = cb;
  }),
  setEncryptionRequiredCallback: vi.fn(),
  initialize: vi.fn(async () => false),
  hasPermission: vi.fn(async () => true),
  requestPermission: vi.fn(async () => true),
  selectSyncFile: (...args: unknown[]) => {
    // Simulate syncService internal state update when a file is selected
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });
    return (mockSelectSyncFile as (...a: unknown[]) => unknown)(...args);
  },
  loadAndImport: vi.fn(async () => ({ success: true })),
  openAndLoadFile: vi.fn(async () => ({ success: true })),
  loadDroppedFile: vi.fn(async () => ({ success: true })),
  decryptAndImport: vi.fn(async () => ({ success: true })),
  save: (...args: unknown[]) => (mockSave as (...a: unknown[]) => unknown)(...args),
  getFileTimestamp: vi.fn(async () => null),
  triggerDebouncedSave: (...args: unknown[]) => mockTriggerDebouncedSave(...args),
  cancelPendingSave: vi.fn(),
  flushPendingSave: vi.fn(async () => {}),
  reset: vi.fn(() => {
    stateChangeCallbackHolder.callback?.({
      isInitialized: false,
      isConfigured: false,
      fileName: null,
      isSyncing: false,
      lastError: null,
    });
  }),
  disconnect: vi.fn(async () => {}),
  setSessionPassword: vi.fn(),
  getSessionFileHandle: vi.fn(() => null),
  getProviderType: vi.fn(() => null),
  getProvider: vi.fn(() => null),
  setProvider: vi.fn(),
}));

// Capabilities — must return true so setupAutoSync is not short-circuited
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({
    fileSystemAccess: true,
    showSaveFilePicker: true,
    showOpenFilePicker: true,
    webCrypto: true,
    googleDrive: false,
    manualSync: true,
  }),
  supportsGoogleDrive: () => false,
  canAutoSync: () => true,
}));

// File sync
vi.mock('@/services/sync/fileSync', () => ({
  exportToFile: vi.fn(async () => {}),
  importFromFile: vi.fn(async () => ({ success: true })),
}));

// Google Drive dependencies (imported by syncStore)
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
}));
vi.mock('@/services/google/googleAuth', () => ({
  loadGIS: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenExpired: vi.fn(() => () => {}),
  revokeToken: vi.fn(),
}));
vi.mock('@/services/google/driveService', () => ({
  getOrCreateAppFolder: vi.fn(async () => 'folder-id'),
  listBeanpodFiles: vi.fn(async () => []),
  clearFolderCache: vi.fn(),
}));
vi.mock('@/services/sync/offlineQueue', () => ({
  clearQueue: vi.fn(),
}));

// Database
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));

// Registry
vi.mock('@/services/registry/registryService', () => ({
  registerFamily: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
}));

// Passkey
vi.mock('@/services/auth/passkeyService', () => ({
  invalidatePasskeysForPasswordChange: vi.fn(async () => {}),
}));

// Family stores — minimal stubs for the auto-sync watcher sources
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
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: 'family-123',
    activeFamilyName: 'Test Family',
  }),
}));

// ---------------------------------------------------------------------------
// Import stores AFTER mocks are set up
// ---------------------------------------------------------------------------
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';

describe('syncStore auto-save arming', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    mockSettingsStateHolder.state = { ...defaultSettings };
    mockTriggerDebouncedSave.mockClear();
    mockSelectSyncFile.mockClear();
    mockSave.mockClear();
  });

  it('configureSyncFile arms auto-sync so settings changes trigger file save', async () => {
    const syncStore = useSyncStore();
    const settingsStore = useSettingsStore();

    // Load initial settings so the store is ready
    await settingsStore.loadSettings();

    // Configure sync file — this should arm auto-sync
    await syncStore.configureSyncFile();

    // Reset the mock after configureSyncFile's own save calls
    mockTriggerDebouncedSave.mockClear();

    // Now change preferred currencies — this should trigger the watcher
    await settingsStore.setPreferredCurrencies(['GBP', 'EUR']);
    await nextTick();
    // Vue watchers fire asynchronously, give them a tick
    await nextTick();

    expect(mockTriggerDebouncedSave).toHaveBeenCalled();
  });

  it('setupAutoSync does not register duplicate watchers when called multiple times', async () => {
    const syncStore = useSyncStore();
    const settingsStore = useSettingsStore();

    await settingsStore.loadSettings();

    // Simulate file being configured so isConfigured is true
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });

    // Call setupAutoSync multiple times (simulating multiple callers)
    syncStore.setupAutoSync();
    syncStore.setupAutoSync();
    syncStore.setupAutoSync();

    mockTriggerDebouncedSave.mockClear();

    // Change settings
    await settingsStore.setPreferredCurrencies(['GBP']);
    await nextTick();
    await nextTick();

    // Should only fire once (not 3 times from 3 watchers)
    expect(mockTriggerDebouncedSave).toHaveBeenCalledTimes(1);
  });

  it('resetState tears down the auto-sync watcher', async () => {
    const syncStore = useSyncStore();
    const settingsStore = useSettingsStore();

    await settingsStore.loadSettings();

    // Simulate file being configured
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });

    // Arm auto-sync
    syncStore.setupAutoSync();
    mockTriggerDebouncedSave.mockClear();

    // Verify watcher is active
    await settingsStore.setPreferredCurrencies(['GBP']);
    await nextTick();
    await nextTick();
    expect(mockTriggerDebouncedSave).toHaveBeenCalledTimes(1);

    // Reset state (simulates sign-out or family switch)
    syncStore.resetState();
    mockTriggerDebouncedSave.mockClear();

    // Change settings again — watcher should NOT fire
    await settingsStore.setPreferredCurrencies(['USD', 'EUR']);
    await nextTick();
    await nextTick();
    expect(mockTriggerDebouncedSave).not.toHaveBeenCalled();
  });

  it('setupAutoSync can be re-armed after resetState', async () => {
    const syncStore = useSyncStore();
    const settingsStore = useSettingsStore();

    await settingsStore.loadSettings();

    // Simulate file being configured
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });

    // Arm, then tear down (resetState calls syncService.reset which sets isConfigured=false)
    syncStore.setupAutoSync();
    syncStore.resetState();
    mockTriggerDebouncedSave.mockClear();

    // Re-configure and re-arm
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });
    syncStore.setupAutoSync();

    // Changes should trigger save again
    await settingsStore.setPreferredCurrencies(['JPY']);
    await nextTick();
    await nextTick();
    expect(mockTriggerDebouncedSave).toHaveBeenCalledTimes(1);
  });
});
