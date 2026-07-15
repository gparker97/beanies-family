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

// Only `isTokenValid` is overridden; everything else in googleAuth (notably
// `whenRedirectAuthSettled`, awaited by loadFromFile) stays real. A Drive 404 is
// classified 'not-found' ONLY when the token is valid; an invalid token means
// the 404 is auth-masked ("not accessible to this caller") → 'auth'. Default
// true so the pre-existing 404 test keeps its 'not-found' meaning.
const { isTokenValidMock } = vi.hoisted(() => ({ isTokenValidMock: vi.fn(() => true) }));
vi.mock('@/services/google/googleAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/google/googleAuth')>()),
  isTokenValid: isTokenValidMock,
}));

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
    // clearAllMocks wipes call history but not queued return values; re-assert
    // the valid-token default so a prior test's mockReturnValue(false) can't leak.
    isTokenValidMock.mockReturnValue(true);
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

  it("classifies a DriveApiError:404 with a VALID token as 'not-found' (file truly gone)", async () => {
    setDriveFailure('DriveApiError:404: File not found');
    isTokenValidMock.mockReturnValue(true);
    const store = useSyncStore();
    const r = await store.loadFromFile();
    expect(r).toEqual({ success: false, reason: 'not-found' });
    expect(store.driveFileNotFound).toBe(true);
  });

  it("classifies a DriveApiError:404 with an INVALID token as 'auth' (not a missing file)", async () => {
    // Regression (2026-07-15): a long-idle iPhone lost its refresh token, so a
    // cold-load 404 (Google masking permission-denied as not-found) was shown as
    // the scary "your data is missing" recovery overlay. An invalid token must
    // route to reconnect ('auth') and NEVER set driveFileNotFound.
    setDriveFailure('DriveApiError:404: File not found');
    isTokenValidMock.mockReturnValue(false);
    // Fake timers so the deferred (4s) reconnect-escalation queued by loadFromFile
    // doesn't leak past the test; we only assert the synchronous classification.
    vi.useFakeTimers();
    try {
      const store = useSyncStore();
      const r = await store.loadFromFile();
      expect(r).toEqual({ success: false, reason: 'auth' });
      expect(store.driveFileNotFound).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("classifies any other failure as 'error' (no focused reconnect)", async () => {
    setDriveFailure('NetworkError: failed to fetch');
    const r = await useSyncStore().loadFromFile();
    expect(r).toEqual({ success: false, reason: 'error' });
  });
});
