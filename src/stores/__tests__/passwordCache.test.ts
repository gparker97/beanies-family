import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../settingsStore';
import { useSyncStore } from '../syncStore';
import type { GlobalSettings } from '@/types/models';

// Mock global settings repository
const mockGlobalSettings: GlobalSettings = {
  id: 'global_settings',
  theme: 'system',
  language: 'en',
  lastActiveFamilyId: null,
  exchangeRates: [],
  exchangeRateAutoUpdate: true,
  exchangeRateLastFetch: null,
  isTrustedDevice: false,
  trustedDevicePromptShown: false,
  cachedEncryptionPassword: null,
};

let savedGlobalSettings = { ...mockGlobalSettings };

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...mockGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...savedGlobalSettings })),
  saveGlobalSettings: vi.fn(async (partial: Partial<GlobalSettings>) => {
    savedGlobalSettings = { ...savedGlobalSettings, ...partial, id: 'global_settings' };
    return { ...savedGlobalSettings };
  }),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    theme: 'light',
    syncEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
  }),
  getSettings: vi.fn(async () => ({
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    theme: 'light',
    syncEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
  })),
  saveSettings: vi.fn(),
  setBaseCurrency: vi.fn(),
  setDisplayCurrency: vi.fn(),
  setTheme: vi.fn(),
  setLanguage: vi.fn(),
  setSyncEnabled: vi.fn(),
  setAutoSyncEnabled: vi.fn(),
  setAIProvider: vi.fn(),
  setAIApiKey: vi.fn(),
  setExchangeRateAutoUpdate: vi.fn(),
  updateExchangeRates: vi.fn(),
  addExchangeRate: vi.fn(),
  removeExchangeRate: vi.fn(),
  setPreferredCurrencies: vi.fn(),
  addCustomInstitution: vi.fn(),
  removeCustomInstitution: vi.fn(),
  convertAmount: vi.fn(),
}));

describe('Password Cache - settingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Reset global settings to default
    savedGlobalSettings = { ...mockGlobalSettings };
  });

  it('should not cache password when device is not trusted', async () => {
    const store = useSettingsStore();
    // Device is not trusted by default
    expect(store.isTrustedDevice).toBe(false);

    await store.cacheEncryptionPassword('my-secret-password');

    // Password should NOT be cached
    expect(store.getCachedEncryptionPassword()).toBeNull();
  });

  it('should cache password when device is trusted', async () => {
    const store = useSettingsStore();

    // Trust the device first
    await store.setTrustedDevice(true);
    expect(store.isTrustedDevice).toBe(true);

    // Now cache a password
    await store.cacheEncryptionPassword('my-secret-password');

    // Password should be cached
    expect(store.getCachedEncryptionPassword()).toBe('my-secret-password');
  });

  it('should return null when no password is cached', () => {
    const store = useSettingsStore();
    expect(store.getCachedEncryptionPassword()).toBeNull();
  });

  it('should clear cached password', async () => {
    const store = useSettingsStore();

    // Trust and cache
    await store.setTrustedDevice(true);
    await store.cacheEncryptionPassword('my-secret-password');
    expect(store.getCachedEncryptionPassword()).toBe('my-secret-password');

    // Clear
    await store.clearCachedEncryptionPassword();
    expect(store.getCachedEncryptionPassword()).toBeNull();
  });

  it('should clear cached password when untrusting device', async () => {
    const store = useSettingsStore();

    // Trust and cache
    await store.setTrustedDevice(true);
    await store.cacheEncryptionPassword('my-secret-password');

    // Untrust — setTrustedDevice(false) does not auto-clear password,
    // but signOutAndClearData does both
    await store.setTrustedDevice(false);
    // Password is still cached until explicitly cleared
    expect(store.getCachedEncryptionPassword()).toBe('my-secret-password');

    // Explicit clear
    await store.clearCachedEncryptionPassword();
    expect(store.getCachedEncryptionPassword()).toBeNull();
  });
});

describe('Password Cache - syncStore integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    savedGlobalSettings = { ...mockGlobalSettings };
  });

  // Mock sync service at module level
  vi.mock('@/services/sync/syncService', () => ({
    onStateChange: vi.fn(),
    setEncryptionRequiredCallback: vi.fn(),
    initialize: vi.fn(async () => false),
    hasPermission: vi.fn(async () => true),
    loadAndImport: vi.fn(async () => ({ success: true })),
    decryptAndImport: vi.fn(async () => ({ success: true })),
    save: vi.fn(async () => true),
    selectSyncFile: vi.fn(async () => false),
    disconnect: vi.fn(async () => {}),
    requestPermission: vi.fn(async () => false),
    getFileTimestamp: vi.fn(async () => null),
    setSessionPassword: vi.fn(),
    setSessionDEK: vi.fn(),
    triggerDebouncedSave: vi.fn(),
    cancelPendingSave: vi.fn(),
    flushPendingSave: vi.fn(async () => {}),
    reset: vi.fn(),
  }));

  vi.mock('@/services/sync/capabilities', () => ({
    getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
    canAutoSync: () => true,
  }));

  vi.mock('@/services/sync/fileSync', () => ({
    exportToFile: vi.fn(async () => {}),
    importFromFile: vi.fn(async () => ({ success: true })),
  }));

  vi.mock('@/services/registry/registryService', () => ({
    registerFamily: vi.fn(async () => {}),
    removeFamily: vi.fn(async () => {}),
  }));

  it('should cache password after successful decryption on trusted device', async () => {
    const settingsStore = useSettingsStore();
    const syncStore = useSyncStore();

    // Trust the device
    await settingsStore.setTrustedDevice(true);

    // Set up a pending encrypted file
    syncStore.pendingEncryptedFile = {
      fileHandle: {} as FileSystemFileHandle,
      rawSyncData: {} as any,
    };

    // Decrypt with password
    await syncStore.decryptPendingFile('test-password-123');

    // Password should be cached in global settings
    expect(settingsStore.getCachedEncryptionPassword()).toBe('test-password-123');
  });

  it('should NOT cache password after decryption on untrusted device', async () => {
    const settingsStore = useSettingsStore();
    const syncStore = useSyncStore();

    // Device is NOT trusted
    expect(settingsStore.isTrustedDevice).toBe(false);

    // Set up a pending encrypted file
    syncStore.pendingEncryptedFile = {
      fileHandle: {} as FileSystemFileHandle,
      rawSyncData: {} as any,
    };

    // Decrypt with password
    await syncStore.decryptPendingFile('test-password-123');

    // Password should NOT be cached
    expect(settingsStore.getCachedEncryptionPassword()).toBeNull();
  });

  it('should expose currentSessionPassword after decryption', async () => {
    const syncStore = useSyncStore();

    // Set up a pending encrypted file
    syncStore.pendingEncryptedFile = {
      fileHandle: {} as FileSystemFileHandle,
      rawSyncData: {} as any,
    };

    // Decrypt
    await syncStore.decryptPendingFile('my-password');

    // Session password should be accessible
    expect(syncStore.currentSessionPassword).toBe('my-password');
    expect(syncStore.hasSessionPassword).toBe(true);
  });

  it('should clear cached password on disconnect', async () => {
    const settingsStore = useSettingsStore();
    const syncStore = useSyncStore();

    // Trust and cache a password
    await settingsStore.setTrustedDevice(true);
    await settingsStore.cacheEncryptionPassword('cached-pw');
    expect(settingsStore.getCachedEncryptionPassword()).toBe('cached-pw');

    // Disconnect
    await syncStore.disconnect();

    // Cached password should be cleared
    expect(settingsStore.getCachedEncryptionPassword()).toBeNull();
  });

  it('should cache password when enabling encryption on trusted device', async () => {
    const settingsStore = useSettingsStore();
    const syncStore = useSyncStore();

    // Trust the device
    await settingsStore.setTrustedDevice(true);

    // Enable encryption
    await syncStore.enableEncryption('new-encryption-pw');

    // Password should be cached
    expect(settingsStore.getCachedEncryptionPassword()).toBe('new-encryption-pw');
  });
});
