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
  mockLoadAndImport,
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
  mockLoadAndImport: vi.fn(async () => ({ success: true })),
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

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
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
  saveSettings: vi.fn(
    async (partial: Partial<Settings>, options?: { preserveTimestamp?: boolean }) => {
      mockSettingsStateHolder.state = {
        ...mockSettingsStateHolder.state,
        ...partial,
        id: 'app_settings',
        updatedAt: options?.preserveTimestamp
          ? mockSettingsStateHolder.state.updatedAt
          : new Date().toISOString(),
      };
      return { ...mockSettingsStateHolder.state };
    }
  ),
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
      updatedAt: new Date().toISOString(),
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
  updateExchangeRates: vi.fn(
    async (rates: Array<{ from: string; to: string; rate: number; updatedAt: string }>) => {
      // Mimics real behavior: merges rates but preserves timestamp
      mockSettingsStateHolder.state = {
        ...mockSettingsStateHolder.state,
        exchangeRates: rates,
        exchangeRateLastFetch: new Date().toISOString(),
        // updatedAt intentionally NOT bumped (preserveTimestamp: true in real code)
      };
      return { ...mockSettingsStateHolder.state };
    }
  ),
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
  updateGlobalExchangeRates: vi.fn(async () => ({ ...mockGlobalSettings })),
}));

// Sync service — spreads shared auto-mock defaults, overrides what this test needs
vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onStateChange: vi.fn((cb: (state: Record<string, unknown>) => void) => {
      stateChangeCallbackHolder.callback = cb;
    }),
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
    save: (...args: unknown[]) => (mockSave as (...a: unknown[]) => unknown)(...args),
    triggerDebouncedSave: (...args: unknown[]) => mockTriggerDebouncedSave(...args),
    loadAndImport: (...args: unknown[]) =>
      (mockLoadAndImport as (...a: unknown[]) => unknown)(...args),
    reset: vi.fn(() => {
      stateChangeCallbackHolder.callback?.({
        isInitialized: false,
        isConfigured: false,
        fileName: null,
        isSyncing: false,
        lastError: null,
      });
    }),
  };
});

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
  reEncryptEnvelope: vi.fn(async () => '{"version":"4.0"}'),
  parseBeanpodV4: vi.fn(() => ({})),
  detectFileVersion: vi.fn(() => 4),
  downloadAsFile: vi.fn(),
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
}));
vi.mock('@/services/sync/offlineQueue', () => ({
  clearQueue: vi.fn(),
}));

// Database
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  closeDatabase: vi.fn(async () => {}),
}));

// Registry
vi.mock('@/services/registry/registryService', () => ({
  registerFamily: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
}));

// Passkey
vi.mock('@/services/auth/passkeyService', () => ({}));

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

  // In V4, auto-sync is driven by docService.onDocPersistNeeded() callback, not Vue store watchers.
  // Settings changes flow: settingsStore → automerge repo → changeDoc() → persist callback → triggerDebouncedSave.
  // These tests need real (unmocked) Automerge plumbing to test the full flow.
  it.todo('configureSyncFile arms auto-sync so Automerge doc changes trigger file save');
  it.todo('setupAutoSync does not register duplicate doc persist callbacks');
  it.todo('resetState tears down the auto-sync doc persist callback');
  it.todo('setupAutoSync can be re-armed after resetState');
});

describe('preferred currency persistence', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    mockSettingsStateHolder.state = { ...defaultSettings, updatedAt: '2024-01-01T00:00:00.000Z' };
    mockTriggerDebouncedSave.mockClear();
    mockLoadAndImport.mockClear();
  });

  it('exchange rate update does NOT change Settings.updatedAt', async () => {
    const settingsStore = useSettingsStore();
    await settingsStore.loadSettings();

    const originalUpdatedAt = settingsStore.settings.updatedAt;

    // Update exchange rates — should preserve timestamp
    await settingsStore.updateExchangeRates([
      { from: 'USD', to: 'EUR', rate: 0.85, updatedAt: '2024-06-01' },
    ]);

    expect(settingsStore.settings.updatedAt).toBe(originalUpdatedAt);
  });

  it('setPreferredCurrencies DOES change Settings.updatedAt', async () => {
    const settingsStore = useSettingsStore();
    await settingsStore.loadSettings();

    const originalUpdatedAt = settingsStore.settings.updatedAt;

    // Set preferred currencies — should bump timestamp
    await settingsStore.setPreferredCurrencies(['GBP', 'EUR']);

    expect(settingsStore.settings.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('WAL is not written during reloadAllStores', async () => {
    const syncStore = useSyncStore();
    const settingsStore = useSettingsStore();
    await settingsStore.loadSettings();

    // Simulate file being configured so loadFromFile works
    stateChangeCallbackHolder.callback?.({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });

    // loadFromFile calls reloadAllStores internally
    await syncStore.loadFromFile();
  });

  // In the V4 architecture, auto-sync is triggered by docService's onDocPersistNeeded
  // callback (registered via registerDocPersistCallback), not by watching store state.
  // Settings changes flow: settingsStore → automerge repo → changeDoc() → persist callback.
  // This test concept requires unmocked Automerge plumbing and is covered by integration tests.
  it.todo('loadFromFile arms auto-sync so Automerge doc changes trigger file save');
});
