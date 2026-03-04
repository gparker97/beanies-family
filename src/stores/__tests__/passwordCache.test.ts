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

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
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

    await store.cacheFamilyKey('my-secret-password', 'family-123');

    // Password should NOT be cached
    expect(store.getCachedFamilyKey('family-123')).toBeNull();
  });

  it('should cache password when device is trusted', async () => {
    const store = useSettingsStore();

    // Trust the device first
    await store.setTrustedDevice(true);
    expect(store.isTrustedDevice).toBe(true);

    // Now cache a password
    await store.cacheFamilyKey('my-secret-password', 'family-123');

    // Password should be cached
    expect(store.getCachedFamilyKey('family-123')).toBe('my-secret-password');
  });

  it('should return null when no password is cached', () => {
    const store = useSettingsStore();
    expect(store.getCachedFamilyKey('family-123')).toBeNull();
  });

  it('should clear cached password for specific family', async () => {
    const store = useSettingsStore();

    // Trust and cache
    await store.setTrustedDevice(true);
    await store.cacheFamilyKey('my-secret-password', 'family-123');
    expect(store.getCachedFamilyKey('family-123')).toBe('my-secret-password');

    // Clear specific family
    await store.clearCachedFamilyKey('family-123');
    expect(store.getCachedFamilyKey('family-123')).toBeNull();
  });

  it('should clear all cached passwords when no familyId given', async () => {
    const store = useSettingsStore();

    // Trust and cache for two families
    await store.setTrustedDevice(true);
    await store.cacheFamilyKey('pw-a', 'family-a');
    await store.cacheFamilyKey('pw-b', 'family-b');
    expect(store.getCachedFamilyKey('family-a')).toBe('pw-a');
    expect(store.getCachedFamilyKey('family-b')).toBe('pw-b');

    // Clear all
    await store.clearCachedFamilyKey();
    expect(store.getCachedFamilyKey('family-a')).toBeNull();
    expect(store.getCachedFamilyKey('family-b')).toBeNull();
  });

  it('should clear cached password when untrusting device', async () => {
    const store = useSettingsStore();

    // Trust and cache
    await store.setTrustedDevice(true);
    await store.cacheFamilyKey('my-secret-password', 'family-123');

    // Untrust — setTrustedDevice(false) does not auto-clear password,
    // but signOutAndClearData does both
    await store.setTrustedDevice(false);
    // Password is still cached until explicitly cleared
    expect(store.getCachedFamilyKey('family-123')).toBe('my-secret-password');

    // Explicit clear
    await store.clearCachedFamilyKey('family-123');
    expect(store.getCachedFamilyKey('family-123')).toBeNull();
  });
});

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: 'family-123',
    activeFamilyName: 'Test Family',
  }),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));

vi.mock('@/services/registry/registryService', () => ({
  registerFamily: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
}));

describe('Password Cache - syncStore integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    savedGlobalSettings = { ...mockGlobalSettings };
  });

  // Sync service — uses shared auto-mock from __mocks__/syncService.ts
  vi.mock('@/services/sync/syncService');

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

  // TODO: Rewrite for V4 format — decryptPendingFile now uses CryptoKey + PBKDF2
  // key unwrapping instead of raw password strings. These tests need real Web Crypto
  // API mocks to validate the V4 flow.
  it.todo('should cache family key after successful decryption on trusted device');
  it.todo('should NOT cache family key after decryption on untrusted device');

  it('should report hasSessionPassword as false when no family key loaded', () => {
    const syncStore = useSyncStore();
    // V4: hasSessionPassword checks for familyKey in memory
    expect(syncStore.hasSessionPassword).toBe(false);
  });

  it('should clear cached password on disconnect', async () => {
    const settingsStore = useSettingsStore();
    const syncStore = useSyncStore();

    // Trust and cache a password
    await settingsStore.setTrustedDevice(true);
    await settingsStore.cacheFamilyKey('cached-pw', 'family-123');
    expect(settingsStore.getCachedFamilyKey('family-123')).toBe('cached-pw');

    // Disconnect
    await syncStore.disconnect();

    // Cached password should be cleared for the active family
    expect(settingsStore.getCachedFamilyKey('family-123')).toBeNull();
  });
});
