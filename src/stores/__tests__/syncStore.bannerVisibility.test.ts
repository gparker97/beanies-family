/**
 * Save-failure banner visibility tests for syncStore.
 *
 * Covers:
 *   - fix #1 (root cause): saveNow is called when onTokenAcquired fires while
 *     saveFailureLevel === 'critical', so success → recordSaveSuccess clears
 *     the banner via the existing failure-tracking callback chain.
 *   - fix #2 (defer banner): when isSilentRefreshPending() is true at the
 *     moment a 'critical' level event arrives, the banner is deferred 5s.
 *     If the failure clears in that window (recovery worked), banner stays
 *     hidden. Otherwise it shows.
 *   - shouldShowSaveFailureBanner computed: banner is mutually exclusive
 *     with showGoogleReconnect (the GoogleReconnectToast is the canonical
 *     surface for permanent expiry).
 *   - resetState() cancels any pending defer timer.
 *
 * See docs/plans/2026-05-07-quiet-save-failure-banner.md.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  saveFailureCallbackHolder,
  tokenAcquiredCallbackHolder,
  tokenPermanentlyExpiredCallbackHolder,
  isSilentRefreshPendingMock,
  saveNowMock,
} = vi.hoisted(() => ({
  saveFailureCallbackHolder: {
    cb: null as ((level: string, error: string | null) => void) | null,
  },
  tokenAcquiredCallbackHolder: {
    cb: null as (() => void) | null,
  },
  tokenPermanentlyExpiredCallbackHolder: {
    cb: null as (() => void) | null,
  },
  isSilentRefreshPendingMock: vi.fn(() => false),
  saveNowMock: vi.fn(async () => true),
}));

// Auto-mock for syncService — picked up via the shared __mocks__ defaults,
// then we override onSaveFailureChange + saveNow to capture/drive them.
vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onSaveFailureChange: vi.fn((cb: (level: string, error: string | null) => void) => {
      saveFailureCallbackHolder.cb = cb;
      return () => {};
    }),
    saveNow: saveNowMock,
    initialize: vi.fn(async () => true),
    getProviderType: vi.fn(() => 'google_drive'),
    hasPermission: vi.fn(async () => true),
  };
});

vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(async () => {}),
  migratePendingRefreshToken: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenPermanentlyExpired: vi.fn((cb: () => void) => {
    tokenPermanentlyExpiredCallbackHolder.cb = cb;
    return () => {};
  }),
  onTokenAcquired: vi.fn((cb: () => void) => {
    tokenAcquiredCallbackHolder.cb = cb;
    return () => {};
  }),
  fetchGoogleUserEmail: vi.fn(async () => null),
  isSilentRefreshPending: isSilentRefreshPendingMock,
}));

// Minimal stubs for the rest of syncStore's import surface
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
  decryptBeanpodPayload: vi.fn(),
  downloadAsFile: vi.fn(),
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: vi.fn(),
}));
vi.mock('@/services/google/driveService', () => ({
  searchBeanpodFilesGlobal: vi.fn(async () => []),
  clearFolderCache: vi.fn(),
  getAppFolderId: vi.fn(() => null),
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
vi.mock('@/services/automerge/docService', () => ({
  replaceDoc: vi.fn(),
  mergeDoc: vi.fn(),
}));
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
vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));
vi.mock('@/config/features', () => ({
  features: { drive: true, oauthProxy: true },
}));

// Stub other Pinia stores that syncStore imports
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

// Import after mocks
let useSyncStore: typeof import('@/stores/syncStore').useSyncStore;

describe('syncStore — save-failure banner visibility', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    saveFailureCallbackHolder.cb = null;
    tokenAcquiredCallbackHolder.cb = null;
    tokenPermanentlyExpiredCallbackHolder.cb = null;
    isSilentRefreshPendingMock.mockReturnValue(false);
    saveNowMock.mockResolvedValue(true);

    setActivePinia(createPinia());

    // Re-import to ensure fresh module state per test
    vi.resetModules();
    ({ useSyncStore } = await import('@/stores/syncStore'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleSaveFailureChange (fix #2 — deferred banner)', () => {
    it('shows banner immediately when level=critical and no silent refresh pending', () => {
      const store = useSyncStore();
      expect(saveFailureCallbackHolder.cb).toBeTruthy();

      isSilentRefreshPendingMock.mockReturnValue(false);
      saveFailureCallbackHolder.cb!('critical', 'token rejected');

      expect(store.showSaveFailureBanner).toBe(true);
      expect(store.saveFailureLevel).toBe('critical');
      expect(store.lastSaveError).toBe('token rejected');
    });

    it('defers banner when silent refresh is pending; shows after BANNER_DEFER_MS if level stays critical', () => {
      const store = useSyncStore();

      isSilentRefreshPendingMock.mockReturnValue(true);
      saveFailureCallbackHolder.cb!('critical', 'silent refresh failed');

      // Banner not shown immediately while recovery is in flight
      expect(store.showSaveFailureBanner).toBe(false);

      // Advance just under defer threshold — still hidden
      vi.advanceTimersByTime(4999);
      expect(store.showSaveFailureBanner).toBe(false);

      // Cross the threshold — alarm fires
      vi.advanceTimersByTime(2);
      expect(store.showSaveFailureBanner).toBe(true);
    });

    it('keeps banner hidden if level returns to none during defer window (fix #1 cleared the failure)', () => {
      const store = useSyncStore();

      isSilentRefreshPendingMock.mockReturnValue(true);
      saveFailureCallbackHolder.cb!('critical', 'silent refresh failed');
      expect(store.showSaveFailureBanner).toBe(false);

      // Recovery succeeded — fix #1's saveNow → recordSaveSuccess → 'none'
      saveFailureCallbackHolder.cb!('none', null);

      // Past the defer threshold; banner should stay hidden
      vi.advanceTimersByTime(10_000);
      expect(store.showSaveFailureBanner).toBe(false);
      expect(store.saveFailureLevel).toBe('none');
    });

    it('clears banner immediately when level returns to none', () => {
      const store = useSyncStore();

      // Force banner up
      isSilentRefreshPendingMock.mockReturnValue(false);
      saveFailureCallbackHolder.cb!('critical', 'err');
      expect(store.showSaveFailureBanner).toBe(true);

      // Save succeeded
      saveFailureCallbackHolder.cb!('none', null);
      expect(store.showSaveFailureBanner).toBe(false);
    });

    it('warning level does not show banner (only critical does)', () => {
      const store = useSyncStore();

      saveFailureCallbackHolder.cb!('warning', 'err');
      expect(store.showSaveFailureBanner).toBe(false);
    });
  });

  describe('shouldShowSaveFailureBanner (computed mutual exclusion with reconnect toast)', () => {
    it('is false when showGoogleReconnect is true, even with critical save failure', () => {
      const store = useSyncStore();

      // Drive the public refs directly. The handler in setupTokenExpiryHandler
      // gates on storageProviderType === 'google_drive', which would require
      // additional state plumbing here; the rule we care about is the
      // computed itself.
      store.showGoogleReconnect = true;
      saveFailureCallbackHolder.cb!('critical', 'err');

      expect(store.showSaveFailureBanner).toBe(true); // raw flag
      expect(store.shouldShowSaveFailureBanner).toBe(false); // suppressed by reconnect
    });

    it('is true when showSaveFailureBanner is true and showGoogleReconnect is false', () => {
      const store = useSyncStore();

      saveFailureCallbackHolder.cb!('critical', 'err');

      expect(store.showSaveFailureBanner).toBe(true);
      expect(store.showGoogleReconnect).toBe(false);
      expect(store.shouldShowSaveFailureBanner).toBe(true);
    });
  });

  describe('onTokenAcquired (fix #1 — saveNow on silent recovery)', () => {
    it('calls saveNow when token is acquired while saveFailureLevel is critical', async () => {
      const store = useSyncStore();
      await store.initialize();
      expect(tokenAcquiredCallbackHolder.cb).toBeTruthy();

      saveFailureCallbackHolder.cb!('critical', 'silent refresh failed');
      expect(store.saveFailureLevel).toBe('critical');

      saveNowMock.mockClear();
      tokenAcquiredCallbackHolder.cb!();

      expect(saveNowMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT call saveNow when driveFileNotFound is true (separate recovery path)', async () => {
      const store = useSyncStore();
      await store.initialize();

      saveFailureCallbackHolder.cb!('critical', 'err');
      store.driveFileNotFound = true;

      saveNowMock.mockClear();
      tokenAcquiredCallbackHolder.cb!();

      expect(saveNowMock).not.toHaveBeenCalled();
    });

    it('does NOT call saveNow when saveFailureLevel is not critical', async () => {
      const store = useSyncStore();
      await store.initialize();

      // Default level is 'none'
      saveNowMock.mockClear();
      tokenAcquiredCallbackHolder.cb!();

      expect(saveNowMock).not.toHaveBeenCalled();
    });
  });

  describe('resetState cancels pending banner defer timer', () => {
    it('does not show banner after reset, even if defer timer would have fired', () => {
      const store = useSyncStore();

      isSilentRefreshPendingMock.mockReturnValue(true);
      saveFailureCallbackHolder.cb!('critical', 'err');
      expect(store.showSaveFailureBanner).toBe(false);

      // Reset (e.g. sign-out) cancels the defer timer
      store.resetState();

      // Past where the timer would have fired
      vi.advanceTimersByTime(10_000);
      expect(store.showSaveFailureBanner).toBe(false);
    });
  });
});
