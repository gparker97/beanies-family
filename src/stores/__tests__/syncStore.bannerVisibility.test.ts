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
  stateChangeCallbackHolder,
  isSilentRefreshPendingMock,
  isTokenValidMock,
  saveNowMock,
  loadMock,
  getStateMock,
  getLastSilentRefreshDiagnosticsMock,
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
  stateChangeCallbackHolder: {
    cb: null as
      | ((state: {
          lastError: string | null;
          isInitialized: boolean;
          isConfigured: boolean;
          fileName: string | null;
          isSyncing: boolean;
        }) => void)
      | null,
  },
  isSilentRefreshPendingMock: vi.fn(() => false),
  isTokenValidMock: vi.fn(() => false),
  saveNowMock: vi.fn(async () => true),
  loadMock: vi.fn(async () => null as string | null),
  getStateMock: vi.fn(() => ({
    isInitialized: true,
    isConfigured: true,
    fileName: 'test.beanpod',
    isSyncing: false,
    lastError: null as string | null,
  })),
  getLastSilentRefreshDiagnosticsMock: vi.fn(
    () =>
      null as null | {
        attempts: unknown[];
        hadRefreshToken: boolean;
        consecutiveFailures: number;
        reason?: 'no-token-stored' | 'revoked' | 'exhausted';
        refreshTokenAgeMs?: number | null;
      }
  ),
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
    onStateChange: vi.fn((cb) => {
      stateChangeCallbackHolder.cb = cb;
      return () => {};
    }),
    saveNow: saveNowMock,
    load: loadMock,
    getState: getStateMock,
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
  isTokenValid: isTokenValidMock,
  getLastSilentRefreshDiagnostics: getLastSilentRefreshDiagnosticsMock,
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
const { reportErrorMock } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: reportErrorMock,
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
    stateChangeCallbackHolder.cb = null;
    isSilentRefreshPendingMock.mockReturnValue(false);
    isTokenValidMock.mockReturnValue(false);
    saveNowMock.mockResolvedValue(true);
    loadMock.mockResolvedValue(null);
    getLastSilentRefreshDiagnosticsMock.mockReturnValue(null);
    reportErrorMock.mockClear();
    getStateMock.mockReturnValue({
      isInitialized: true,
      isConfigured: true,
      fileName: 'test.beanpod',
      isSyncing: false,
      lastError: null,
    });

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

  // ─── Cold-start reconnect escalation (2026-05-08 regression fix) ─────────────
  //
  // Closes the gap where boot-time `loadFromFile` failures with
  // `TokenExpiredError` left the user on stale cache with no UI signal —
  // the in-flight escalation counter only crossed threshold after multiple
  // separate refresh attempts, but each page reload reset the counter.
  describe('cold-start reconnect escalation', () => {
    /**
     * Drive the store into the auth-transient cold-start path:
     *   1. Set the syncService state so `storageProviderType.value` is
     *      'google_drive' (the gate inside scheduleColdStartReconnectEscalation).
     *   2. Make `syncService.load()` return null and `getState().lastError`
     *      match the silent-refresh-failed regex.
     *   3. Call `backgroundSyncFromFile()` to trigger the auth-transient
     *      branch and schedule the deferred banner.
     */
    async function triggerColdStartAuthTransient(
      store: ReturnType<typeof useSyncStore>
    ): Promise<void> {
      // Push the state-change subscription past the provider-type read so the
      // store's storageProviderType ref reflects 'google_drive' for the gate.
      stateChangeCallbackHolder.cb?.({
        isInitialized: true,
        isConfigured: true,
        fileName: 'test.beanpod',
        isSyncing: false,
        lastError: 'Drive read failed: token rejected and silent refresh failed',
      });
      loadMock.mockResolvedValue(null);
      getStateMock.mockReturnValue({
        isInitialized: true,
        isConfigured: true,
        fileName: 'test.beanpod',
        isSyncing: false,
        lastError: 'Drive read failed: token rejected and silent refresh failed',
      });
      await store.backgroundSyncFromFile();
    }

    it('schedules deferred banner on auth-transient cold-start; surfaces after ~4s if still expired', async () => {
      const store = useSyncStore();
      await store.initialize();

      await triggerColdStartAuthTransient(store);

      // Banner not shown immediately — still inside the defer window.
      expect(store.showGoogleReconnect).toBe(false);

      // Token still invalid at fire time → banner surfaces.
      isTokenValidMock.mockReturnValue(false);
      vi.advanceTimersByTime(3999);
      expect(store.showGoogleReconnect).toBe(false);

      vi.advanceTimersByTime(2);
      expect(store.showGoogleReconnect).toBe(true);
    });

    it('cancels the deferred banner when onTokenAcquired fires before the window expires', async () => {
      const store = useSyncStore();
      await store.initialize();

      await triggerColdStartAuthTransient(store);
      expect(store.showGoogleReconnect).toBe(false);

      // Recovery via wake event halfway through the defer window.
      vi.advanceTimersByTime(2000);
      tokenAcquiredCallbackHolder.cb!();

      // Past the original 4s mark — banner stays hidden.
      vi.advanceTimersByTime(5000);
      expect(store.showGoogleReconnect).toBe(false);
    });

    it('skips the banner if isTokenValid returns true at fire time (recovered, no event captured)', async () => {
      const store = useSyncStore();
      await store.initialize();

      await triggerColdStartAuthTransient(store);

      // Token quietly recovered (the wake-event path silently restored
      // state without firing onTokenAcquired in this test scenario).
      isTokenValidMock.mockReturnValue(true);
      vi.advanceTimersByTime(5000);
      expect(store.showGoogleReconnect).toBe(false);
    });

    it('does NOT schedule the timer for non-auth-transient errors (network, 5xx, decrypt)', async () => {
      const store = useSyncStore();
      await store.initialize();

      stateChangeCallbackHolder.cb?.({
        isInitialized: true,
        isConfigured: true,
        fileName: 'test.beanpod',
        isSyncing: false,
        lastError: 'Network unreachable',
      });
      getStateMock.mockReturnValue({
        isInitialized: true,
        isConfigured: true,
        fileName: 'test.beanpod',
        isSyncing: false,
        lastError: 'Network unreachable',
      });
      loadMock.mockResolvedValue(null);

      await store.backgroundSyncFromFile();

      vi.advanceTimersByTime(10_000);
      expect(store.showGoogleReconnect).toBe(false);
    });

    it('resetState cancels a scheduled cold-start banner timer', async () => {
      const store = useSyncStore();
      await store.initialize();

      await triggerColdStartAuthTransient(store);

      store.resetState();

      vi.advanceTimersByTime(10_000);
      expect(store.showGoogleReconnect).toBe(false);
    });

    // Closes the 2026-05-19 Lafleur (iPhone PWA) Slack noise — repeated
    // `cold-start-reconnect-escalation` alerts for a user with no stored
    // refresh token were the system working as designed (nothing to refresh
    // with → banner is the correct UX) but polluted #beanies-errors.
    //
    // The suppression is keyed on `error_code`, NOT `hadRefreshToken` — see
    // the `revoked` test below for why that distinction is load-bearing.
    it('skips Slack alert (but still shows banner) when no token was ever stored', async () => {
      const store = useSyncStore();
      await store.initialize();

      getLastSilentRefreshDiagnosticsMock.mockReturnValue({
        attempts: [],
        hadRefreshToken: false,
        consecutiveFailures: 0,
        reason: 'no-token-stored',
      });

      await triggerColdStartAuthTransient(store);

      isTokenValidMock.mockReturnValue(false);
      vi.advanceTimersByTime(4001);

      // Banner UX still fires — the user genuinely needs to reconnect.
      expect(store.showGoogleReconnect).toBe(true);
      // …but Slack stays quiet for this by-design terminal state.
      const coldStartCalls = reportErrorMock.mock.calls.filter(
        (call) => (call[0] as { surface?: string })?.surface === 'cold-start-reconnect-escalation'
      );
      expect(coldStartCalls).toHaveLength(0);
    });

    // Regression guard for the 2026-07-09 blindness: after Google revokes the
    // grant, `performSilentRefresh` clears the stored token, so EVERY later
    // refresh this session reports `hadRefreshToken: false` — identical in shape
    // to the by-design case above. Keying suppression on that flag silently
    // swallowed a week of real revocations. Key on `error_code` instead.
    it('STILL alerts when the token was revoked, even though hadRefreshToken=false', async () => {
      const store = useSyncStore();
      await store.initialize();

      getLastSilentRefreshDiagnosticsMock.mockReturnValue({
        attempts: [],
        hadRefreshToken: false, // token already cleared by the permanent branch
        consecutiveFailures: 0,
        reason: 'revoked',
        refreshTokenAgeMs: 604_800_000,
      });

      await triggerColdStartAuthTransient(store);

      isTokenValidMock.mockReturnValue(false);
      vi.advanceTimersByTime(4001);

      expect(store.showGoogleReconnect).toBe(true);
      const coldStartCalls = reportErrorMock.mock.calls.filter(
        (call) => (call[0] as { surface?: string })?.surface === 'cold-start-reconnect-escalation'
      );
      expect(coldStartCalls).toHaveLength(1);
      // The age at revocation is the payload that names the root cause.
      const ctx = (coldStartCalls[0][0] as { context?: Record<string, unknown> }).context;
      expect(ctx?.error_code).toBe('silent-refresh:revoked');
      expect(ctx?.refresh_token_age_ms).toBe(604_800_000);
    });

    it('still emits Slack alert when hadRefreshToken=true (genuine silent-refresh failure)', async () => {
      const store = useSyncStore();
      await store.initialize();

      getLastSilentRefreshDiagnosticsMock.mockReturnValue({
        attempts: [
          {
            attempt: 1,
            durationMs: 800,
            classification: 'network',
            errorName: 'TypeError',
            errorMessage: 'Failed to fetch',
          },
        ],
        hadRefreshToken: true,
        consecutiveFailures: 2,
      });

      await triggerColdStartAuthTransient(store);

      isTokenValidMock.mockReturnValue(false);
      vi.advanceTimersByTime(4001);

      expect(store.showGoogleReconnect).toBe(true);
      const coldStartCalls = reportErrorMock.mock.calls.filter(
        (call) => (call[0] as { surface?: string })?.surface === 'cold-start-reconnect-escalation'
      );
      expect(coldStartCalls).toHaveLength(1);
      const arg = coldStartCalls[0][0] as {
        context: { silent_refresh_had_refresh_token: boolean };
      };
      expect(arg.context.silent_refresh_had_refresh_token).toBe(true);
    });
  });
});
