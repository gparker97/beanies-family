/**
 * Tests for syncStore.verifyPodAccess — the VERIFY-ONLY replacement for the
 * former `establishDurableHomeAfterLoad` re-home action.
 *
 * ## What these tests exist to prevent
 *
 * Until 2026-08-10 this code path answered "is this file my home?" with "do I own
 * this Drive file?". For every non-owner family member the answer is *no* — the
 * family's `.beanpod` is owned by the inviter and shared with edit access — so the
 * app silently minted them a private copy, seeded it with the live document (hence
 * identical-looking data), and their family's data diverged with no symptom until
 * someone noticed their to-dos never reached anyone else.
 *
 * The two tests that pinned that behaviour as CORRECT are inverted below:
 *   - "re-homes a FOREIGN Drive file"        -> now: KEEPS a foreign editable file
 *   - "re-homes conservatively when the      -> now: KEEPS the binding and reports
 *      ownership fetch throws"
 *
 * The load-bearing assertion across the whole file is `mockCreateNew` never being
 * called. `verifyPodAccess` MUTATES NOTHING: it reports, and the user chooses a
 * recovery that restores access to the ORIGINAL file.
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
  mockGetProviderType,
  mockSelectNativeLocalFile,
  mockCreateNew,
  mockFromExisting,
  mockReportError,
  mockLogEvent,
  mockRegisterFamily,
  mockIsNative,
  mockIsTokenValid,
  mockGetFileMetadata,
  mockResolveExistingBeanpod,
  mockLookupFamily,
  mockSearchBeanpodFilesGlobal,
  mockTryGetSilentToken,
  mockLookupFamilyResult,
} = vi.hoisted(() => ({
  mockSave: vi.fn(async () => true),
  mockSetProvider: vi.fn(),
  mockGetProvider: vi.fn(() => null as unknown),
  mockGetProviderFamilyId: vi.fn<() => string | null>(() => null),
  mockGetProviderType: vi.fn<() => string | null>(() => null),
  mockSelectNativeLocalFile: vi.fn(async () => true),
  mockCreateNew: vi.fn(),
  mockFromExisting: vi.fn(),
  mockReportError: vi.fn(),
  mockLogEvent: vi.fn(),
  mockRegisterFamily: vi.fn(async () => {}),
  mockIsNative: vi.fn(() => false),
  mockIsTokenValid: vi.fn(() => false),
  mockGetFileMetadata: vi.fn(async () => ({ capabilities: { canEdit: true }, trashed: false })),
  mockResolveExistingBeanpod: vi.fn(),
  mockLookupFamily: vi.fn(),
  mockSearchBeanpodFilesGlobal: vi.fn(async () => [] as unknown[]),
  mockTryGetSilentToken: vi.fn(async () => 'mock-token' as string | null),
  mockLookupFamilyResult: vi.fn(async () => ({ status: 'absent' }) as unknown),
}));

const { DriveApiErrorMock, DriveFileNotFoundErrorMock } = vi.hoisted(() => {
  class DriveApiErrorMock extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  class DriveFileNotFoundErrorMock extends DriveApiErrorMock {}
  return { DriveApiErrorMock, DriveFileNotFoundErrorMock };
});

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
    getProviderType: () => mockGetProviderType(),
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
  detectFileVersion: vi.fn(() => '4.0'),
  downloadAsFile: vi.fn(),
}));

vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: {
    createNew: (...a: unknown[]) => mockCreateNew(...a),
    fromExisting: (...a: unknown[]) => mockFromExisting(...a),
  },
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
  tryGetSilentToken: (...a: unknown[]) =>
    (mockTryGetSilentToken as (...x: unknown[]) => Promise<string | null>)(...a),
  TokenExpiredError: class TokenExpiredError extends Error {},
}));

vi.mock('@/services/google/driveService', () => ({
  searchBeanpodFilesGlobal: (...a: unknown[]) =>
    (mockSearchBeanpodFilesGlobal as (...x: unknown[]) => Promise<unknown[]>)(...a),
  clearFolderCache: vi.fn(),
  getAppFolderId: vi.fn(() => null),
  getFileMetadata: (...a: unknown[]) =>
    (mockGetFileMetadata as (...x: unknown[]) => Promise<Record<string, unknown>>)(...a),
  // `status`-carrying, because classifyDriveFailure discriminates 403 from 404 by
  // status and BOTH arrive as DriveFileNotFoundError from the real service.
  DriveApiError: DriveApiErrorMock,
  DriveFileNotFoundError: DriveFileNotFoundErrorMock,
}));

vi.mock('@/services/sync/connectStorage', () => ({
  beginDriveAuthRedirectIfNeeded: vi.fn(async () => false),
  RESUME_SETUP_PATH: '/resume-setup',
  resolveExistingBeanpod: (...a: unknown[]) => mockResolveExistingBeanpod(...a),
}));

vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => mockLogEvent(...a),
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
  lookupFamily: (...a: unknown[]) =>
    (mockLookupFamily as (...x: unknown[]) => Promise<unknown>)(...a),
  lookupFamilyResult: (...a: unknown[]) =>
    (mockLookupFamilyResult as (...x: unknown[]) => Promise<unknown>)(...a),
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
import { TokenExpiredError } from '@/services/google/googleAuth';

function makeDriveProvider() {
  return {
    type: 'google_drive' as const,
    persist: vi.fn(async () => {}),
    getDisplayName: () => 'Test Family.beanpod',
    getFileId: () => 'drive-file-id',
  };
}

describe('syncStore.verifyPodAccess', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    featuresState.drive = true;
    featuresState.oauthProxy = true;
    mockIsTokenValid.mockReturnValue(true);
    mockTryGetSilentToken.mockResolvedValue('mock-token');
    mockGetFileMetadata.mockResolvedValue({ capabilities: { canEdit: true }, trashed: false });
    mockLookupFamilyResult.mockResolvedValue({ status: 'absent' });
    mockGetProviderFamilyId.mockReturnValue('family-123');
    mockGetProviderType.mockReturnValue('google_drive');
    mockGetProvider.mockReturnValue(makeDriveProvider());
  });

  // ── The inverted tests: the exact behaviour that caused the incident ───────

  it('KEEPS a Drive file owned by ANOTHER account when the member can edit it', async () => {
    // The regression test. This is every non-owner family member's normal state:
    // the family file is owned by the inviter and shared with edit access.
    // The old code re-homed here, silently forking the family's data.
    const store = useSyncStore();
    mockGetFileMetadata.mockResolvedValue({ capabilities: { canEdit: true }, trashed: false });

    const result = await store.verifyPodAccess();

    expect(result).toEqual({ ok: true });
    expect(mockCreateNew).not.toHaveBeenCalled();
    expect(store.podAccessError).toBeNull();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'kept-home' }) })
    );
  });

  it('never asks Drive about ownership', async () => {
    // `ownedByMe` must not appear anywhere on a load path again — it is not a
    // writability signal, and treating it as one is the whole bug.
    const store = useSyncStore();
    await store.verifyPodAccess();

    const fields = mockGetFileMetadata.mock.calls.map((c) => String((c as unknown[])[2]));
    expect(fields).toEqual(['capabilities/canEdit,trashed']);
    expect(fields.join()).not.toContain('ownedByMe');
  });

  it('KEEPS the binding when the metadata probe throws, and reports instead', async () => {
    // Previously commented "conservative re-home". Forking a family's data on a
    // transient Drive 5xx is the least conservative outcome available.
    const store = useSyncStore();
    mockGetFileMetadata.mockRejectedValue(new DriveApiErrorMock('server error', 500));

    const result = await store.verifyPodAccess();

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'VERIFY_UNAVAILABLE' }));
    expect(mockCreateNew).not.toHaveBeenCalled();
    expect(mockSetProvider).not.toHaveBeenCalled();
    expect(store.podAccessError?.code).toBe('VERIFY_UNAVAILABLE');
  });

  // ── The rest of the taxonomy ──────────────────────────────────────────────

  it('keeps a local/native provider without touching the network', async () => {
    const store = useSyncStore();
    mockGetProviderType.mockReturnValue('local');

    expect(await store.verifyPodAccess()).toEqual({ ok: true });
    expect(mockGetFileMetadata).not.toHaveBeenCalled();
  });

  it('reports NO_HOME when the provider belongs to a different family', async () => {
    const store = useSyncStore();
    mockGetProviderFamilyId.mockReturnValue('another-family');

    const result = await store.verifyPodAccess();

    expect(result).toEqual({ ok: false, code: 'NO_HOME' });
    expect(mockGetFileMetadata).not.toHaveBeenCalled();
    expect(mockCreateNew).not.toHaveBeenCalled();
  });

  it('reports NO_HOME when no provider is installed (the restored-backup case)', async () => {
    const store = useSyncStore();
    mockGetProvider.mockReturnValue(null);

    expect(await store.verifyPodAccess()).toEqual({ ok: false, code: 'NO_HOME' });
    expect(mockCreateNew).not.toHaveBeenCalled();
  });

  it('reports PERMISSION_DENIED when sharing has been revoked', async () => {
    const store = useSyncStore();
    mockGetFileMetadata.mockResolvedValue({ capabilities: { canEdit: false }, trashed: false });

    expect(await store.verifyPodAccess()).toEqual(
      expect.objectContaining({ ok: false, code: 'PERMISSION_DENIED' })
    );
    expect(mockCreateNew).not.toHaveBeenCalled();
  });

  it('reports FILE_NOT_FOUND when the file is in the bin', async () => {
    const store = useSyncStore();
    mockGetFileMetadata.mockResolvedValue({ capabilities: { canEdit: true }, trashed: true });

    expect(await store.verifyPodAccess()).toEqual(
      expect.objectContaining({ ok: false, code: 'FILE_NOT_FOUND' })
    );
  });

  it('reports CONSENT_EXPIRED without popping an interactive OAuth dialog', async () => {
    // A background durability check must never interrupt a load with a consent
    // prompt — hence tryGetSilentToken, never requestAccessToken.
    const store = useSyncStore();
    mockTryGetSilentToken.mockResolvedValue(null);

    expect(await store.verifyPodAccess()).toEqual({ ok: false, code: 'CONSENT_EXPIRED' });
    expect(mockGetFileMetadata).not.toHaveBeenCalled();
  });

  it('maps a token expiry to CONSENT_EXPIRED', async () => {
    const store = useSyncStore();
    mockGetFileMetadata.mockRejectedValue(new TokenExpiredError('silent refresh failed'));

    expect(await store.verifyPodAccess()).toEqual(
      expect.objectContaining({ ok: false, code: 'CONSENT_EXPIRED' })
    );
  });

  // ── Canonical-pod detection ───────────────────────────────────────────────

  it('raises CANONICAL_MISMATCH when writing to a file that is not the family pod', async () => {
    // The in-app symptom the incident had no way to surface.
    const store = useSyncStore();
    mockLookupFamilyResult.mockResolvedValue({
      status: 'found',
      entry: {
        familyId: 'family-123',
        provider: 'google_drive',
        fileId: 'THE-REAL-FAMILY-FILE',
        displayPath: 'Family.beanpod',
        updatedAt: '2026-08-10',
      },
    });

    await store.verifyPodAccess();
    await vi.waitFor(() => expect(store.podAccessError?.code).toBe('CANONICAL_MISMATCH'));
    expect(store.podAccessError?.data?.canonicalFileId).toBe('THE-REAL-FAMILY-FILE');
    expect(mockCreateNew).not.toHaveBeenCalled();
  });

  it('stays silent when the registry is UNAVAILABLE (fail-open)', async () => {
    // A registry hiccup must never accuse someone of working on a copy.
    const store = useSyncStore();
    mockLookupFamilyResult.mockResolvedValue({ status: 'unavailable' });

    await store.verifyPodAccess();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.podAccessError).toBeNull();
  });

  it('stays silent when the family has no registry row', async () => {
    const store = useSyncStore();
    mockLookupFamilyResult.mockResolvedValue({ status: 'absent' });

    await store.verifyPodAccess();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.podAccessError).toBeNull();
  });

  it('checks the canonical pod at most once per family per session', async () => {
    // verifyPodAccess runs on every load path INCLUDING retry, so an unguarded
    // check turns a retry loop into a registry request loop.
    const store = useSyncStore();
    await store.verifyPodAccess();
    await store.verifyPodAccess();
    await store.verifyPodAccess();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLookupFamilyResult).toHaveBeenCalledTimes(1);
  });

  // ── The invariant ─────────────────────────────────────────────────────────

  it('NEVER creates a .beanpod, whatever the outcome', async () => {
    const store = useSyncStore();
    const scenarios: Array<() => void> = [
      () =>
        mockGetFileMetadata.mockResolvedValue({ capabilities: { canEdit: false }, trashed: false }),
      () =>
        mockGetFileMetadata.mockResolvedValue({ capabilities: { canEdit: true }, trashed: true }),
      () => mockGetFileMetadata.mockRejectedValue(new DriveFileNotFoundErrorMock('gone', 404)),
      () => mockGetFileMetadata.mockRejectedValue(new DriveFileNotFoundErrorMock('nope', 403)),
      () => mockGetFileMetadata.mockRejectedValue(new DriveApiErrorMock('timeout', 408)),
      () => mockTryGetSilentToken.mockResolvedValue(null),
      () => mockGetProvider.mockReturnValue(null),
    ];
    for (const scenario of scenarios) {
      vi.clearAllMocks();
      mockGetProviderFamilyId.mockReturnValue('family-123');
      mockGetProviderType.mockReturnValue('google_drive');
      mockGetProvider.mockReturnValue(makeDriveProvider());
      mockTryGetSilentToken.mockResolvedValue('mock-token');
      scenario();
      await store.verifyPodAccess();
      expect(mockCreateNew).not.toHaveBeenCalled();
      expect(mockSelectNativeLocalFile).not.toHaveBeenCalled();
    }
  });
});
