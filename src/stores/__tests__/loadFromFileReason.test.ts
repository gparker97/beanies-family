import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSyncStore } from '../syncStore';
import * as syncService from '@/services/sync/syncService';
import type { GlobalSettings } from '@/types/models';

/**
 * Locks the `reason` contract `loadFromFile()` exposes — the signal
 * `LoginPage.handleFamilySelected` branches on to offer a focused reconnect
 * (reason 'auth') vs the generic load-pod fallback. Both `TokenExpiredError`
 * message variants must classify as 'auth' (the message-contract guard); a
 * `DriveApiError:404:` as 'not-found'; anything else as 'error'.
 */

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
  getDefaultSettings: () => ({ id: 'app_settings', baseCurrency: 'USD', aiApiKeys: {} }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', baseCurrency: 'USD', aiApiKeys: {} })),
  saveSettings: vi.fn(),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'family-123', activeFamilyName: 'Test Family' }),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));

vi.mock('@/services/registry/registryService', () => ({
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));

vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
  supportsFileSystemAccess: () => true,
  // loadFromFile now awaits whenRedirectAuthSettled() → ensureRedirectAuthSettled(),
  // which reads isNative(); web (false) → no pending code → immediate no-op.
  isNative: () => false,
}));

vi.mock('@/services/sync/fileSync', () => ({
  exportToFile: vi.fn(async () => {}),
  importFromFile: vi.fn(async () => ({ success: true })),
}));

// Shared auto-mock — we override load/getState/getProviderType per test.
vi.mock('@/services/sync/syncService');

function setDriveFailure(lastError: string | null) {
  vi.mocked(syncService.load).mockResolvedValue(null);
  vi.mocked(syncService.getProviderType).mockReturnValue('google_drive');
  vi.mocked(syncService.getState).mockReturnValue({
    isInitialized: true,
    isConfigured: true,
    fileName: 'my-family.beanpod',
    isSyncing: false,
    lastError,
  });
}

describe('syncStore.loadFromFile — failure reason classification', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    savedGlobalSettings = { ...mockGlobalSettings };
  });

  it("classifies the default TokenExpiredError message (post-sign-out) as 'auth'", async () => {
    setDriveFailure('Google access token expired and silent refresh failed');
    const r = await useSyncStore().loadFromFile();
    expect(r).toEqual({ success: false, reason: 'auth' });
  });

  it("classifies the explicit Drive-401 TokenExpiredError message as 'auth'", async () => {
    setDriveFailure('Drive read failed: token rejected and silent refresh failed');
    const r = await useSyncStore().loadFromFile();
    expect(r).toEqual({ success: false, reason: 'auth' });
  });

  it("classifies a DriveApiError:404 as 'not-found'", async () => {
    setDriveFailure('DriveApiError:404: File not found');
    const r = await useSyncStore().loadFromFile();
    expect(r).toEqual({ success: false, reason: 'not-found' });
  });

  it("classifies any other failure as 'error' (no focused reconnect)", async () => {
    setDriveFailure('NetworkError: failed to fetch');
    const r = await useSyncStore().loadFromFile();
    expect(r).toEqual({ success: false, reason: 'error' });
  });
});
