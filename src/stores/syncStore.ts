import { defineStore } from 'pinia';
import { ref, computed, shallowRef, nextTick, watch } from 'vue';

// Import stores for auto-sync and reload
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useFamilyStore } from './familyStore';
import { useGoalsStore } from './goalsStore';
import { useRecurringStore } from './recurringStore';
import { useTodoStore } from './todoStore';
import { useActivityStore } from './activityStore';
import { useVacationStore } from './vacationStore';
import { useBudgetStore } from './budgetStore';
import { useFavoritesStore } from './favoritesStore';
import { useSayingsStore } from './sayingsStore';
import { useMemberNotesStore } from './memberNotesStore';
import { useAllergiesStore } from './allergiesStore';
import { useMedicationsStore } from './medicationsStore';
import { useMilestonesStore } from './milestonesStore';
import { useRecipesStore } from './recipesStore';
import { useEmergencyContactsStore } from './emergencyContactsStore';
import { useSettingsStore } from './settingsStore';
import { useFamilyContextStore } from './familyContextStore';
import { useAuthStore } from './authStore';
import { useTransactionsStore } from './transactionsStore';
import { useSyncHighlightStore } from './syncHighlightStore';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import { getSyncCapabilities, canAutoSync } from '@/services/sync/capabilities';
import { features } from '@/config/features';
import { downloadAsFile } from '@/services/sync/fileSync';
import * as registry from '@/services/registry/registryService';
import type { RegistryEntry } from '@/types/models';
import * as syncService from '@/services/sync/syncService';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import { LocalStorageProvider } from '@/services/sync/providers/localProvider';
import {
  initializeAuth,
  migratePendingRefreshToken,
  requestAccessToken,
  onTokenPermanentlyExpired,
  onTokenAcquired,
  fetchGoogleUserEmail,
  isSilentRefreshPending,
  isTokenValid,
  isUserCancellation,
  getLastSilentRefreshDiagnostics,
} from '@/services/google/googleAuth';
import { reportError } from '@/utils/errorReporter';
import { slackNotify } from '@/utils/slackNotify';
import type { SaveFailureLevel } from '@/services/sync/syncService';
import {
  searchBeanpodFilesGlobal,
  clearFolderCache,
  getAppFolderId,
  DriveApiError,
} from '@/services/google/driveService';
import { clearQueue } from '@/services/sync/offlineQueue';
import {
  createBeanpodV4,
  parseBeanpodV4,
  tryUnwrapFamilyKey,
  decryptBeanpodPayload,
  reEncryptEnvelope,
  detectFileVersion,
} from '@/services/sync/fileSync';
import {
  generateFamilyKey,
  deriveMemberKey,
  wrapFamilyKey,
} from '@/services/crypto/familyKeyService';
import { replaceDoc, mergeDoc } from '@/services/automerge/docService';
import {
  initPersistenceDB,
  persistDoc,
  persistEnvelope,
  loadCachedDoc,
  loadCachedEnvelope,
} from '@/services/automerge/persistenceService';
import { bufferToBase64 } from '@/utils/encoding';
import type { BeanpodFileV4, WrappedMemberKey } from '@/types/syncFileV4';
import type { StorageProvider, StorageProviderType } from '@/services/sync/storageProvider';
import { toISODateString } from '@/utils/date';
import { deduplicateRecurringTransactions } from '@/services/recurring/recurringProcessor';
import {
  type CreatePodResult,
  type CreatePodFailureReason,
  type CriticalWriteState,
  type ResumeFromRegistryResult,
  type CompleteAutoLoadResult,
  CorruptPayloadError,
} from '@/types/sync';

/**
 * Outcome of `migrateStorage`. `failed` means the move was rolled back and
 * the pod is still on its original storage; `recovery-needed` means the
 * rollback itself failed (rare — the original and destination both broke in
 * the same window) and the user should sign out and back in to recover.
 */
export type MigrateStorageResult =
  | { outcome: 'success'; dest: string }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'recovery-needed'; reason: string };

// ─── Visibility tracker (module-scope, lazy-registered) ─────────────────────
//
// Tracks `document.visibilityState` transitions so the
// `cold-start-reconnect-escalation` alert can report "how long was the page
// hidden before this failure" — the iOS PWA wake path is the primary suspect,
// and we can't diagnose it without knowing whether the load fired right after
// a wake or during a long-foreground session.
//
// Lazy-registered (on first call to `getHiddenDurationMs`) so importing this
// module doesn't add a visibilitychange listener at module-load time —
// unrelated tests assert listener counts and would break otherwise.
const visibilityTracker = {
  lastHiddenAt: null as number | null,
  lastVisibleAt: typeof document !== 'undefined' ? Date.now() : null,
  listenerRegistered: false,
};

function ensureVisibilityListener(): void {
  if (visibilityTracker.listenerRegistered) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.visibilityState === 'hidden') {
      visibilityTracker.lastHiddenAt = now;
    } else {
      visibilityTracker.lastVisibleAt = now;
    }
  });
  visibilityTracker.listenerRegistered = true;
}

/** ms the page was last hidden before becoming visible, or null if never hidden
 *  this session. Used as a wake-time diagnostic on cold-start failures. */
function getHiddenDurationMs(): number | null {
  ensureVisibilityListener();
  const { lastHiddenAt, lastVisibleAt } = visibilityTracker;
  if (lastHiddenAt === null || lastVisibleAt === null) return null;
  if (lastVisibleAt < lastHiddenAt) return null; // page is still hidden — n/a
  return lastVisibleAt - lastHiddenAt;
}

export const useSyncStore = defineStore('sync', () => {
  // State
  const isInitialized = ref(false);
  const isConfigured = ref(false);
  const fileName = ref<string | null>(null);
  const isSyncing = ref(false);
  const error = ref<string | null>(null);
  const lastSync = ref<string | null>(null);
  const needsPermission = ref(false);
  const isMigratingStorage = ref(false);

  // Family key state — the unwrapped AES-GCM key for the active .beanpod envelope
  const familyKey = shallowRef<CryptoKey | null>(null);
  const envelope = shallowRef<BeanpodFileV4 | null>(null);

  // Pending encrypted file — V4 envelope that needs password to unlock
  const pendingEncryptedFile = ref<{
    envelope: BeanpodFileV4;
    fileHandle?: FileSystemFileHandle;
    provider?: import('@/services/sync/storageProvider').StorageProvider;
    driveFileId?: string;
    driveFileName?: string;
    driveAccountEmail?: string;
  } | null>(null);

  // Single source of truth for "is a non-interruptible write in flight?".
  // Read by the router beforeEach guard (blocks navigation), App.vue's
  // beforeunload handler (returns truthy → native browser confirm), and the
  // SetupProgressModal visibility gate. See `src/types/sync.ts` for shape.
  const criticalWriteState = ref<CriticalWriteState>({ kind: 'idle' });

  // Google Drive state
  const storageProviderType = ref<StorageProviderType | null>(null);
  const providerAccountEmail = ref<string | null>(null);
  const isGoogleDriveConnected = computed(() => storageProviderType.value === 'google_drive');
  // Must be a ref, not a computed over `syncService.getProvider()` — that
  // function is a plain singleton read with no reactive deps, so any
  // computed built on it would stick at its first value and never update.
  // Kept in sync via `onStateChange` below.
  const driveFileId = ref<string | null>(null);
  const driveFolderId = computed(() => getAppFolderId());
  const showGoogleReconnect = ref(false);
  const driveFileNotFound = ref(false);

  // Save failure state
  const saveFailureLevel = ref<'none' | 'warning' | 'critical'>('none');
  const lastSaveError = ref<string | null>(null);
  const showSaveFailureBanner = ref(false);

  // Banner is mutually exclusive with the GoogleReconnectToast (the canonical
  // surface for permanent expiry). When the toast is up, the toast handles
  // recovery — no need to also alarm with a top banner.
  const shouldShowSaveFailureBanner = computed(
    () => showSaveFailureBanner.value && !showGoogleReconnect.value
  );

  // ─── Deferred-action primitive (shared by save-failure-banner and cold-start escalation) ──
  //
  // Why a factory: there are two timer-based deferrals in this store with
  // identical semantics — schedule once, cancel on recovery, re-check
  // condition at fire time. Inlining each one diverges over time. One
  // primitive, two named consumers below.
  type DeferredAction = {
    schedule: (action: () => void) => void;
    cancel: () => void;
    readonly isScheduled: boolean;
  };

  function createDeferredAction(deferMs: number): DeferredAction {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
      schedule(action) {
        if (timer) return; // idempotent — first schedule wins until cancel
        timer = setTimeout(() => {
          timer = null;
          try {
            action();
          } catch (e) {
            console.error('[syncStore] Deferred action threw', e);
            reportError({
              surface: 'syncStore-deferred-action',
              message: 'Deferred action threw',
              error: e instanceof Error ? e : new Error(String(e)),
            });
          }
        }, deferMs);
      },
      cancel() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      get isScheduled() {
        return timer !== null;
      },
    };
  }

  // Wake-time race window — saves can fail briefly while silent refresh is
  // settling. Defer the banner that long so fix #1 (saveNow on tokenAcquired)
  // can clear the failure before the user is alarmed. Tuned from
  // observed silent-refresh timings (~1-3s typically); see docs/plans/
  // 2026-05-07-quiet-save-failure-banner.md.
  const BANNER_DEFER_MS = 5000;
  const saveFailureBannerDefer = createDeferredAction(BANNER_DEFER_MS);

  // Cold-start reconnect window — when the boot-time background load fails
  // with `TokenExpiredError`, give wake-event-triggered refreshes (focus,
  // pageshow, online) a chance to land before alarming with the reconnect
  // banner. The `onTokenAcquired` self-heal handler below cancels this
  // timer on any successful acquisition. See docs/plans/
  // 2026-05-08-silent-refresh-regression.md.
  const COLD_START_RECONNECT_DEFER_MS = 4000;
  const coldStartReconnectDefer = createDeferredAction(COLD_START_RECONNECT_DEFER_MS);

  function showBannerWithTelemetry(deferred: boolean): void {
    showSaveFailureBanner.value = true;
    reportError({
      surface: 'save-failure-banner',
      message: deferred
        ? 'banner shown after deferred recovery window'
        : 'banner shown immediately (no recovery in flight)',
      context: { lastSaveError: lastSaveError.value, deferred },
    });
  }

  function handleSaveFailureChange(level: SaveFailureLevel, failError: string | null): void {
    saveFailureBannerDefer.cancel();
    saveFailureLevel.value = level;
    lastSaveError.value = failError;

    if (level !== 'critical') {
      showSaveFailureBanner.value = false;
      return;
    }

    if (!isSilentRefreshPending()) {
      showBannerWithTelemetry(false);
      return;
    }

    // Recovery in flight — give it a chance. If fix #1 clears the failure
    // (level returns to 'none' via recordSaveSuccess on a post-recovery
    // saveNow), the timer's re-check will skip the alarm.
    saveFailureBannerDefer.schedule(() => {
      if (saveFailureLevel.value !== 'critical') return;
      showBannerWithTelemetry(true);
    });
  }

  // Capabilities
  const capabilities = computed(() => getSyncCapabilities());
  const supportsAutoSync = computed(() => canAutoSync());
  // Drive needs both the OAuth client (`features.drive`, gates the API)
  // AND an OAuth proxy (gates token exchange / refresh). On cloud both are
  // true; on a Path-A self-host neither is set; on Path-B both must be set.
  const isGoogleDriveAvailable = computed(() => features.drive && features.oauthProxy);

  // Encryption is always on in V4 — backward compat computed
  const hasSessionPassword = computed(() => familyKey.value !== null);
  const hasPendingEncryptedFile = computed(() => pendingEncryptedFile.value !== null);

  // Getters
  const syncStatus = computed(() => {
    if (!isConfigured.value) return 'not-configured';
    if (needsPermission.value) return 'needs-permission';
    if (isSyncing.value) return 'syncing';
    if (error.value) return 'error';
    return 'ready';
  });

  // Subscribe to sync service state changes
  syncService.onStateChange((state) => {
    isInitialized.value = state.isInitialized;
    isConfigured.value = state.isConfigured;
    fileName.value = state.fileName;
    isSyncing.value = state.isSyncing;
    storageProviderType.value = syncService.getProviderType();
    providerAccountEmail.value = syncService.getProvider()?.getAccountEmail() ?? null;
    driveFileId.value = syncService.getProvider()?.getFileId() ?? null;
    error.value = state.lastError;
  });

  // Subscribe to save-complete
  syncService.onSaveComplete((timestamp) => {
    lastSync.value = timestamp;
  });

  // Subscribe to save failure level changes — see handleSaveFailureChange above.
  syncService.onSaveFailureChange(handleSaveFailureChange);

  // Background sync state (cache-first loading)
  const isBackgroundSyncing = ref(false);
  const backgroundSyncError = ref<string | null>(null);
  /**
   * Classifies why `backgroundSyncError` is set so consumers can pick an
   * appropriate UI response:
   * - `auth-transient`: token expired + silent refresh failed. The auth
   *   layer (`setupTokenExpiryHandler`) owns the user-facing escalation
   *   (reconnect banner on `invalid_grant`); the sync layer should stay
   *   quiet so the user sees one consistent signal, not two.
   * - `decrypt`: family key couldn't decrypt the remote payload (password
   *   may have changed). Surface to user.
   * - `network`: anything else — transient Drive 5xx, network blip, etc.
   *   Surface to user.
   */
  const backgroundSyncErrorKind = ref<'auth-transient' | 'decrypt' | 'network' | null>(null);

  /**
   * Match the message shapes produced by `TokenExpiredError` (in
   * `googleAuth.ts` and `googleDriveProvider.ts`) — both contain the
   * substring "silent refresh failed". When the auth layer flags this,
   * the reconnect banner (or auth-layer self-heal on next attempt) is
   * the right user-facing signal — not a sync toast.
   */
  function isAuthTransientSyncError(msg: string | null | undefined): boolean {
    return !!msg && /silent refresh failed/i.test(msg);
  }

  // Subscribe to cache persistence failure changes
  const cachePersistFailed = ref(false);
  syncService.onCacheFailureChange((failed) => {
    cachePersistFailed.value = failed;
  });

  // Register docService persist callback → triggers debounced save
  syncService.registerDocPersistCallback();

  /**
   * Initialize sync - restore file handle if available.
   */
  async function initialize(): Promise<void> {
    const restored = await syncService.initialize();

    if (restored) {
      const providerType = syncService.getProviderType();

      if (providerType === 'google_drive') {
        needsPermission.value = false;
        try {
          const ctx = useFamilyContextStore();
          if (ctx.activeFamilyId) {
            await initializeAuth(ctx.activeFamilyId);
          }
        } catch {
          console.warn('[syncStore] Failed to initialize Google auth');
        }
        setupTokenExpiryHandler();
      } else {
        const hasPermission = await syncService.hasPermission();
        needsPermission.value = !hasPermission;
      }
    }
  }

  /**
   * Request permission to access the sync file (user gesture required).
   * If permission is granted, automatically loads from file and sets up auto-sync.
   */
  async function requestPermission(): Promise<boolean> {
    const granted = await syncService.requestPermission();
    needsPermission.value = !granted;

    if (granted) {
      const loadResult = await loadFromFile();
      if (loadResult.success) {
        setupAutoSync();
      }
    }

    return granted;
  }

  /**
   * Make `provider` the active storage backend: persist its config (which
   * also clears the opposite provider type's persisted config), install it
   * in the sync service, write the current encrypted envelope through it,
   * persist the UI-visible sync state, register the family, and wire up
   * auto-sync / token-expiry handling.
   *
   * Pure forward operation — throws on the first failing step and does NOT
   * roll back. The create-pod flows have nothing to roll back to; the
   * migration flow (`migrateStorage`) captures the previous provider and
   * re-installs it on failure.
   *
   * Shared by `configureSyncFile`, `configureSyncFileGoogleDrive`, and
   * `migrateStorage` — keeps the "install this provider" sequence in one place.
   */
  async function installProvider(
    provider: StorageProvider,
    type: StorageProviderType
  ): Promise<void> {
    needsPermission.value = false;

    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) {
      await provider.persist(ctx.activeFamilyId);
    }
    syncService.setProvider(provider);
    // `setProvider` fires `onStateChange` synchronously, which updates
    // `storageProviderType` / `fileName` — no need to set them here.

    isReloading = true;
    try {
      const ok = await syncNow();
      if (!ok) {
        throw new Error(error.value || 'Could not write to the new storage location');
      }
      await settingsRepo.saveSettings({
        syncEnabled: true,
        syncFilePath: provider.getDisplayName(),
        lastSyncTimestamp: toISODateString(new Date()),
      });
    } finally {
      isReloading = false;
    }

    registerCurrentFamily({
      provider: type,
      fileId: provider.getFileId(),
      displayPath: provider.getDisplayName(),
    });

    if (type === 'google_drive') {
      setupTokenExpiryHandler();
    } else {
      setupAutoSync();
    }
  }

  /**
   * Configure a sync file (opens file picker).
   * Creates a new V4 file with the current family key.
   */
  async function configureSyncFile(): Promise<boolean> {
    try {
      const success = await syncService.selectSyncFile();
      if (!success) return false;
      const provider = syncService.getProvider();
      if (!provider) return false;
      await installProvider(provider, 'local');
      return true;
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    }
  }

  /**
   * Check if the sync file has newer data than our last sync
   */
  async function checkForConflicts(): Promise<{
    hasConflict: boolean;
    fileTimestamp: string | null;
    localTimestamp: string | null;
  }> {
    const fileTimestamp = await syncService.getFileTimestamp();
    const localTimestamp = lastSync.value;

    if (!fileTimestamp) {
      return { hasConflict: false, fileTimestamp: null, localTimestamp };
    }

    if (!localTimestamp) {
      return { hasConflict: true, fileTimestamp, localTimestamp: null };
    }

    const hasConflict = new Date(fileTimestamp).getTime() > new Date(localTimestamp).getTime();
    return { hasConflict, fileTimestamp, localTimestamp };
  }

  /**
   * Sync now - save current data to file
   */
  async function syncNow(force = false): Promise<boolean> {
    if (!force) {
      const { hasConflict } = await checkForConflicts();
      if (hasConflict) {
        error.value = 'File has newer data. Load from file first or force sync.';
        return false;
      }
    }

    const success = await syncService.save();
    if (success) {
      await settingsRepo.saveSettings(
        { lastSyncTimestamp: lastSync.value ?? undefined },
        { preserveTimestamp: true }
      );
    }
    return success;
  }

  /**
   * Force sync - save current data to file, overwriting any newer data
   */
  async function forceSyncNow(): Promise<boolean> {
    return syncNow(true);
  }

  /**
   * Replace the in-memory doc with a remote doc, merging any unsynced
   * changes from the local IndexedDB cache to prevent data loss.
   *
   * If the cache has changes not present in the remote doc (e.g. the
   * previous save to Drive failed), Automerge CRDT merge preserves both.
   * If the cache matches the remote, the merge is a no-op.
   */
  async function replaceDocWithCacheRecovery(
    remoteDoc: Parameters<typeof replaceDoc>[0],
    fk: CryptoKey,
    familyId: string
  ): Promise<void> {
    await initPersistenceDB(familyId);

    let cachedDoc: Awaited<ReturnType<typeof loadCachedDoc>> = null;
    try {
      cachedDoc = await loadCachedDoc(fk);
    } catch (e) {
      console.warn('[syncStore] Cache recovery failed — proceeding with remote only:', e);
    }

    replaceDoc(remoteDoc);

    if (cachedDoc) {
      mergeDoc(cachedDoc);
      // Clean up duplicate recurring transactions from CRDT merge
      await deduplicateRecurringTransactions();
      // Persist merged result so the cache reflects the merge
      persistDoc(fk).catch(console.warn);
      // Save merged result back to remote file (debounced)
      syncService.triggerDebouncedSave();
    }
  }

  /**
   * Load data from the currently configured sync file.
   * For V4 files: parses envelope, tries to unlock with cached FK or password.
   * @param options.merge - If true, CRDT merge remote doc with local doc.
   */
  async function loadFromFile(
    options: { merge?: boolean } = {}
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    const merging = !!options.merge;

    if (merging) {
      isReloading = true;
      syncService.cancelPendingSave();
    }

    try {
      console.log('[syncStore.loadFromFile] calling syncService.load()...');
      const text = await syncService.load();
      console.log('[syncStore.loadFromFile] load returned', text ? `${text.length} chars` : 'null');
      if (!text) {
        const lastError = syncService.getState().lastError;
        if (lastError?.startsWith('DriveApiError:404:')) {
          if (syncService.getProviderType() === 'google_drive') {
            driveFileNotFound.value = true;
            showSaveFailureBanner.value = true;
            stopFilePolling();
          }
          return { success: false };
        }
        // Don't fire showGoogleReconnect here. Real auth failures are surfaced
        // by the expiry-callback chain (`setupTokenExpiryHandler`) — that's
        // the single place that should promote the user to a reconnect banner.
        // Other failures (transient network blip, 5xx, brief SW-activation
        // race) shouldn't show a "session expired" prompt — polling will
        // retry on its next cycle.
        if (syncService.getProviderType() === 'google_drive') {
          console.warn(
            '[syncStore.loadFromFile] Drive read returned no text — letting polling/retry recover. lastError:',
            lastError
          );
        }
        return { success: false };
      }

      const version = detectFileVersion(text);
      if (version !== '4.0') {
        error.value = `Unsupported file version: ${version ?? 'unknown'}`;
        return { success: false };
      }

      const remoteEnvelope = parseBeanpodV4(text);

      // If we already have a family key, try to decrypt directly
      if (familyKey.value) {
        try {
          const remoteDoc = await decryptBeanpodPayload(remoteEnvelope, familyKey.value);

          if (merging) {
            // CRDT merge
            mergeDoc(remoteDoc);
          } else {
            // Replace local doc, merging any unsynced cache to prevent data loss
            const famId = useFamilyContextStore().activeFamilyId;
            if (famId && familyKey.value) {
              await replaceDocWithCacheRecovery(remoteDoc, familyKey.value, famId);
            } else {
              replaceDoc(remoteDoc);
            }
          }

          // Update envelope and ensure syncService has the family key
          envelope.value = remoteEnvelope;
          syncService.setFamilyKey(familyKey.value!, remoteEnvelope);

          // Prevent next doSave() from re-fetching what we just loaded
          const loadedTs = await syncService.getFileTimestamp();
          if (loadedTs) syncService.setLastKnownFileTimestamp(loadedTs);

          lastSync.value = toISODateString(new Date());
          await reloadAllStores();

          if (merging) {
            // CRDT merges can produce duplicate recurring transactions
            // (same recurringItemId + date, different UUIDs from different actors).
            // Clean them up before saving back.
            const dupsRemoved = await deduplicateRecurringTransactions();
            if (dupsRemoved > 0) {
              await reloadAllStores();
            }
            // After merge, save back to persist our local changes
            syncService.triggerDebouncedSave();
          }

          if (syncService.getProviderType() === 'google_drive') {
            setupTokenExpiryHandler();
            updateProviderEmailAfterLoad();
          }

          setupAutoSync();
          return { success: true };
        } catch (e) {
          console.warn('[syncStore] Failed to decrypt with current FK, may need re-auth:', e);
        }
      }

      // No family key or decryption failed — store as pending
      const provider = syncService.getProvider();
      pendingEncryptedFile.value = {
        envelope: remoteEnvelope,
        driveFileId: provider?.getFileId() ?? undefined,
        driveFileName: provider?.getDisplayName(),
        driveAccountEmail: provider?.getAccountEmail() ?? undefined,
      };
      return { success: false, needsPassword: true };
    } finally {
      if (merging && isReloading) {
        isReloading = false;
      }
    }
  }

  /**
   * Open file picker to select a new file, load its data, and set it as sync target.
   */
  async function loadFromNewFile(): Promise<{ success: boolean; needsPassword?: boolean }> {
    const result = await syncService.openAndLoadFile();

    if (result.needsPassword && result.envelope) {
      pendingEncryptedFile.value = {
        envelope: result.envelope,
        fileHandle: result.fileHandle,
        provider: result.provider,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());
      await reloadAllStores();
      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );
      setupAutoSync();
    }
    return { success: result.success };
  }

  /**
   * Load a file that was dropped onto the drop zone (drag-and-drop).
   */
  async function loadFromDroppedFile(
    file: File,
    fileHandle?: FileSystemFileHandle
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    const result = await syncService.loadDroppedFile(file, fileHandle);

    if (result.needsPassword && result.envelope) {
      pendingEncryptedFile.value = {
        envelope: result.envelope,
        fileHandle: result.fileHandle,
        provider: result.provider,
      };
      return { success: false, needsPassword: true };
    }

    if (result.success) {
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());
      await reloadAllStores();
      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );
      setupAutoSync();
    }
    return { success: result.success };
  }

  /**
   * Unlock a pending encrypted file with a password.
   * This is the V4 equivalent of decryptPendingFile.
   *
   * The password is used to derive a member wrapping key, which unwraps the
   * family key. The family key then decrypts the Automerge binary payload.
   */
  async function decryptPendingFile(password: string): Promise<{
    success: boolean;
    error?: string;
    memberIds?: string[];
    /** Set when the envelope decrypted but the payload bytes aren't a usable
     *  Automerge doc. Lets the caller distinguish corruption from wrong
     *  password / network failure when picking the user-facing message. */
    corrupted?: CorruptPayloadError;
  }> {
    const pending = pendingEncryptedFile.value;
    if (!pending) {
      return { success: false, error: 'No pending encrypted file' };
    }

    try {
      // Try to unwrap the family key using the password. memberIds is the
      // list of every member whose wrappedKey successfully unwrapped with
      // this password — typically 1, but >1 if multiple members happen to
      // share the same password. Callers must NOT assume the first id is
      // the authenticated user; they should use it for auto-sign-in only
      // when length === 1.
      const { familyKey: fk, memberIds } = await tryUnwrapFamilyKey(pending.envelope, password);

      // Decrypt the Automerge payload
      const doc = await decryptBeanpodPayload(pending.envelope, fk);

      // Replace doc with cache recovery to prevent data loss from failed saves
      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      if (famId) {
        await replaceDocWithCacheRecovery(doc, fk, famId);
      } else {
        replaceDoc(doc);
      }

      // Set the family key and envelope
      familyKey.value = fk;
      envelope.value = pending.envelope;
      syncService.setFamilyKey(fk, pending.envelope);

      // Adopt family identity — ensure the file's family is registered and active
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      let activeFamilyId = getActiveFamilyId();
      const familyCtx = useFamilyContextStore();
      const fileFamilyId = pending.envelope.familyId;

      if (fileFamilyId) {
        // Register the family if it's not yet in the local registry
        const isKnown = familyCtx.allFamilies.some((f) => f.id === fileFamilyId);
        if (!isKnown) {
          await familyCtx.createFamilyWithId(
            fileFamilyId,
            pending.envelope.familyName ?? 'My Family'
          );
        } else if (fileFamilyId !== familyCtx.activeFamilyId) {
          await familyCtx.switchFamily(fileFamilyId);
        }
        activeFamilyId = fileFamilyId;
      } else if (activeFamilyId && activeFamilyId !== familyCtx.activeFamilyId) {
        await familyCtx.switchFamily(activeFamilyId);
      }

      // Bind Google Auth to this family and migrate any pending refresh token
      if (activeFamilyId && pending.driveFileId) {
        await initializeAuth(activeFamilyId);
        await migratePendingRefreshToken(activeFamilyId);
      }

      // If loaded from Google Drive, persist the config
      if (pending.driveFileId && pending.driveFileName) {
        const { storeProviderConfig, clearFileHandleForFamily } =
          await import('@/services/sync/fileHandleStore');
        if (activeFamilyId) {
          await clearFileHandleForFamily(activeFamilyId);
          await storeProviderConfig(activeFamilyId, {
            type: 'google_drive',
            driveFileId: pending.driveFileId,
            driveFileName: pending.driveFileName,
            driveAccountEmail: pending.driveAccountEmail,
          });
        }
        const provider = GoogleDriveProvider.fromExisting(
          pending.driveFileId,
          pending.driveFileName,
          pending.driveAccountEmail
        );
        syncService.setProvider(provider);
      }

      // If file was opened with a provider (local file picker), persist it
      if (pending.provider) {
        if (activeFamilyId) {
          await pending.provider.persist(activeFamilyId);
        }
        syncService.setProvider(pending.provider);
      }

      // Clear pending
      pendingEncryptedFile.value = null;
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Initialize persistence cache (doc + envelope)
      if (familyCtx.activeFamilyId) {
        await initPersistenceDB(familyCtx.activeFamilyId);
        persistDoc(fk).catch(console.warn);
        persistEnvelope(pending.envelope).catch(console.warn);
      }

      // Update settings
      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          encryptionEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );

      // Cache exported family key so auto-decrypt works after page refresh.
      // Force-cache when decrypting a pending file (user entered password on this device).
      const settingsStore = useSettingsStore();
      if (familyCtx.activeFamilyId && fk) {
        const exported = await getExportedFamilyKey();
        if (exported) {
          await settingsStore.cacheFamilyKey(exported, familyCtx.activeFamilyId, { force: true });
        }
      }

      // Reload all stores
      await reloadAllStores();

      // Arm auto-sync
      setupAutoSync();

      return { success: true, memberIds };
    } catch (e) {
      const errorMessage = (e as Error).message;
      if (e instanceof CorruptPayloadError) {
        return { success: false, error: errorMessage, corrupted: e };
      }
      if (errorMessage.includes('Incorrect password')) {
        return { success: false, error: 'Incorrect password' };
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Load data from the local persistence cache (IndexedDB).
   * Used as a fallback when the beanpod file needs permission on page refresh.
   * Imports the family key directly from a base64-encoded raw key.
   */
  async function loadFromPersistenceCache(
    keyB64: string,
    activeFamilyId: string,
    options?: { preservePermissionState?: boolean }
  ): Promise<{ success: boolean }> {
    try {
      await initPersistenceDB(activeFamilyId);

      // Load cached envelope (needed for syncService.setFamilyKey)
      const cachedEnvelope = await loadCachedEnvelope();
      if (!cachedEnvelope) return { success: false };

      // Import family key directly from base64 (not password-derived)
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(keyB64)));

      // Load cached Automerge doc
      const doc = await loadCachedDoc(fk);
      if (!doc) return { success: false };

      // Set up state
      replaceDoc(doc);
      familyKey.value = fk;
      envelope.value = cachedEnvelope;
      syncService.setFamilyKey(fk, cachedEnvelope);
      if (!options?.preservePermissionState) {
        isConfigured.value = true; // Data is loaded — show configured UI
        needsPermission.value = true; // Still need file permission for future saves
      }
      lastSync.value = toISODateString(new Date());

      await reloadAllStores();
      return { success: true };
    } catch (e) {
      console.warn('[syncStore] loadFromPersistenceCache failed:', e);
      return { success: false };
    }
  }

  /**
   * Clear the pending encrypted file (user cancelled)
   */
  function clearPendingEncryptedFile(): void {
    pendingEncryptedFile.value = null;
  }

  /**
   * Verify a freshly-written envelope: read it back from the provider, parse,
   * decrypt with the same family key, and ensure the resulting Automerge doc
   * materializes cleanly (`decryptBeanpodPayload` throws `CorruptPayloadError`
   * if the bytes are bad — Shaun-class corruption).
   *
   * Throws on any inconsistency. Caller classifies the failure as 'verify'.
   */
  async function verifyJustWritten(
    provider: StorageProvider,
    fk: CryptoKey,
    expectedFamilyId: string
  ): Promise<void> {
    const text = await provider.read();
    if (!text) {
      throw new Error('Verify failed: provider.read() returned empty after write');
    }
    const env = parseBeanpodV4(text);
    if (env.familyId !== expectedFamilyId) {
      throw new Error(
        `Verify failed: envelope familyId mismatch (read ${env.familyId}, expected ${expectedFamilyId})`
      );
    }
    // Throws CorruptPayloadError on bad payload; propagates to the caller.
    await decryptBeanpodPayload(env, fk);
  }

  /**
   * Awaited variant of `registerCurrentFamily` — used only by `createNewFile`,
   * which treats registry write as critical (it's the recovery anchor for the
   * resume-from-registry path). The public `registerCurrentFamily` keeps its
   * fire-and-forget contract for non-critical background syncs.
   */
  async function _registerCurrentFamilySync(): Promise<void> {
    const ctx = useFamilyContextStore();
    if (!ctx.activeFamilyId) {
      throw new Error('Cannot register family: no active family ID');
    }
    const authStoreInst = useAuthStore();
    const provider = syncService.getProvider();
    // `registerFamilyOrThrow` (not `registerFamily`) — the latter swallows
    // network failures by design (fire-and-forget for background syncs).
    // Pod creation NEEDS this write to surface as a failure so the recovery
    // anchor invariant holds: post-`markPodCreated`, the registry has fileId.
    await registry.registerFamilyOrThrow(ctx.activeFamilyId, {
      provider: storageProviderType.value ?? 'local',
      fileId: provider?.getFileId() ?? null,
      displayPath: provider?.getDisplayName() ?? fileName.value ?? null,
      familyName: ctx.activeFamilyName,
      ownerEmail: authStoreInst.currentUser?.email ?? null,
      subscribeNewsletter: authStoreInst.newsletterOptIn ?? null,
      country: useSettingsStore().country ?? null,
    });
  }

  /**
   * Cleanup after a failed `createNewFile`. Best-effort, never throws — the
   * caller's catch already has the originating error; this helper exists to
   * reduce the blast radius of the failure (don't leave a corrupt file under
   * its expected name where a future load attempt would pick it up).
   *
   * Steps:
   *   1. If we have a Drive fileId, rename it to `<name>.corrupt-<ts>` via
   *      `patchFileMetadata`. Rename failures log + report but don't propagate
   *      — the worst case is the corrupt file stays at its original name,
   *      still better than continuing as if the write succeeded.
   *   2. Clear in-memory state so a retry starts clean (no stale family key,
   *      no stale envelope, no pending file).
   *
   * The user-facing surface is the caller's responsibility — they have the
   * failure reason and can pick the right translated message. This keeps the
   * store layer free of UI concerns.
   */
  async function handleCreateFailure(partialFileId: string | null): Promise<void> {
    if (partialFileId && storageProviderType.value === 'google_drive') {
      try {
        const token = await requestAccessToken({ forceConsent: false });
        const { patchFileMetadata } = await import('@/services/google/driveService');
        const originalName = fileName.value ?? 'pod.beanpod';
        const corruptName = `${originalName}.corrupt-${Date.now()}`;
        await patchFileMetadata(token, partialFileId, { name: corruptName });
        console.warn(`[syncStore] Renamed partial pod file to ${corruptName}`);
      } catch (renameErr) {
        console.error('[syncStore] Failed to rename corrupt pod file:', renameErr);
        reportError({
          surface: 'createPod.renameFailed',
          message: 'Could not rename corrupt pod file during cleanup',
          error: renameErr instanceof Error ? renameErr : new Error(String(renameErr)),
          context: { fileId: partialFileId },
        });
      }
    }
    familyKey.value = null;
    envelope.value = null;
    pendingEncryptedFile.value = null;
  }

  /**
   * Map a thrown error from `createNewFile`'s critical section to the
   * `CreatePodFailureReason` tag we surface to the caller. The `step` argument
   * is the last marker the body crossed before throwing — set linearly through
   * the function body so classification is deterministic, not heuristic.
   */
  function classifyCreateFailure(step: CreatePodFailureReason, e: unknown): CreatePodFailureReason {
    // `verify` is also signalled by the typed `CorruptPayloadError` thrown
    // from `decryptBeanpodPayload` — if we see it anywhere, it's a verify
    // failure regardless of the step marker. (Defensive: the marker should
    // already be 'verify' by the time that throw happens.)
    if (e instanceof CorruptPayloadError) return 'verify';
    return step;
  }

  /**
   * Create a new V4 beanpod file.
   *
   * Returns a `CreatePodResult` discriminated union: on success `{ ok: true }`,
   * on failure `{ ok: false, reason, error }` where `reason` is the specific
   * failure mode the caller can branch on. The caller is responsible for
   * surfacing the failure to the user (it has translation context and can
   * pick the right per-reason message); this function does cleanup only.
   *
   * Ordering invariant — `markPodCreated()` is the point of no return and runs
   * ONLY after every preceding step succeeds, so the post-success state-
   * consistency invariant holds (see `docs/plans/`-equivalent or `src/types/sync.ts`):
   *   1. provider.write           (write)
   *   2. verifyJustWritten        (verify)  ← catches Shaun-class corruption
   *   3. await persistDoc         (persist) ← previously fire-and-forget
   *   4. await persistEnvelope    (persist) ← previously fire-and-forget
   *   5. await _registerCurrentFamilySync  (register) ← previously fire-and-forget
   *   6. markPodCreated + slack notify (success)
   */
  async function createNewFile(
    _podFileName: string,
    password: string,
    memberId: string,
    familyId: string,
    familyName: string
  ): Promise<CreatePodResult> {
    // Re-entrancy guard. The UI shouldn't be able to call this twice
    // concurrently (the storage step disables its CTA while in flight), but
    // returning a typed reason instead of throwing makes any misuse loud and
    // testable rather than producing a silent race.
    if (criticalWriteState.value.kind !== 'idle') {
      return {
        ok: false,
        reason: 'concurrent-write',
        error: new Error(
          `createNewFile called while ${criticalWriteState.value.kind} is in flight`
        ),
      };
    }

    // Preconditions — `signUp()` should have left the doc initialized with the
    // owner member; refusing here keeps the failure visible BEFORE we write
    // anything to Drive, instead of producing an empty-doc envelope that the
    // user could land on `/nook` with.
    const familyStoreInst = useFamilyStore();
    const ownerMember = familyStoreInst.members.find((m) => m.id === memberId);
    if (!ownerMember) {
      return {
        ok: false,
        reason: 'precondition',
        error: new Error(
          `createNewFile precondition failed: owner member ${memberId} not in family store`
        ),
      };
    }

    criticalWriteState.value = { kind: 'creating' };
    let step: CreatePodFailureReason = 'write';
    let partialFileId: string | null = null;

    try {
      // 1. Build the encrypted envelope (in-memory, no I/O).
      const fk = await generateFamilyKey();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const memberKey = await deriveMemberKey(password, salt);
      const wrapped = await wrapFamilyKey(fk, memberKey);
      const wrappedKeys: Record<string, WrappedMemberKey> = {
        [memberId]: { salt: bufferToBase64(salt), wrapped },
      };
      // Note: the Automerge doc was initialized by `authStore.signUp()` before
      // this function was called. We deliberately do NOT call `initDoc()` here
      // — that would wipe the owner-member writes already in the doc.
      const envelopeJson = await createBeanpodV4(familyId, familyName, fk, wrappedKeys);

      // 2. Write to provider. `getFileId()` is captured after write so the
      //    cleanup helper can target the correct file for rename on failure.
      const provider = syncService.getProvider();
      if (!provider) {
        // Same shape as the precondition failures above: refuse to advance
        // when a required dependency is missing rather than producing partial
        // state. Classified as 'write' because this is the write step's setup.
        throw new Error('createNewFile: syncService has no provider configured');
      }
      step = 'write';
      await provider.write(envelopeJson);
      partialFileId = provider.getFileId() ?? null;

      // 3. Verify the bytes we just wrote round-trip cleanly. Throws
      //    `CorruptPayloadError` (or generic Error for non-payload issues).
      step = 'verify';
      await verifyJustWritten(provider, fk, familyId);

      // 4. Commit in-memory state — we know the write is good.
      const env = parseBeanpodV4(envelopeJson);
      familyKey.value = fk;
      envelope.value = env;
      syncService.setFamilyKey(fk, env);

      // 5. Persist local cache (was fire-and-forget — now awaited so a cache
      //    failure surfaces as a real error before `markPodCreated`).
      step = 'persist';
      await initPersistenceDB(familyId);
      await persistDoc(fk);
      await persistEnvelope(env);

      // 6. Register with the family registry (was fire-and-forget — now the
      //    recovery anchor for `ResumePodSetup`'s registry-first flow).
      step = 'register';
      await _registerCurrentFamilySync();

      // 7. Cache the family key for auto-decrypt on reload — symmetric with
      //    what `decryptPendingFile` does for the load path. Without this,
      //    a hard reload (or an unexpected back-button interruption that
      //    survives the router guard) would land in a state where the
      //    provider config is persisted but the in-memory key is gone, and
      //    the user'd hit the "spilled beans" overlay with no way to
      //    auto-recover. `{force: true}` bypasses the trusted-device check
      //    — the user JUST entered the password on this device.
      try {
        const exported = await getExportedFamilyKey();
        if (exported) {
          const settingsStoreInst = useSettingsStore();
          await settingsStoreInst.cacheFamilyKey(exported, familyId, { force: true });
        }
      } catch (cacheErr) {
        // Cache failure is non-fatal — the pod itself is fine, the user
        // just won't get the seamless reload. Report so we see if it
        // happens in the wild.
        console.warn('[syncStore] cacheFamilyKey after createNewFile failed:', cacheErr);
        reportError({
          surface: 'createPod.cacheFamilyKey',
          message: `Could not cache family key after pod creation: ${
            cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
          }`,
          error: cacheErr instanceof Error ? cacheErr : new Error(String(cacheErr)),
          severity: 'warning',
        });
      }

      // 8. Point of no return. Auth invariant flips here and nowhere else
      //    in this function. From the caller's perspective, this is "your
      //    pod exists and the app is safe to enter".
      lastSync.value = toISODateString(new Date());
      useAuthStore().markPodCreated();
      const providerType = syncService.getProviderType();
      const storageLabel =
        providerType === 'google_drive'
          ? 'Google Drive'
          : providerType === 'local'
            ? 'Local File'
            : '(unknown)';
      slackNotify(
        `🎉 *Family pod created!*\n*Family:* ${familyName}\n*Owner:* ${ownerMember.name}\n*Storage:* ${storageLabel}`
      );

      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const reason = classifyCreateFailure(step, err);
      console.error(`[syncStore] createNewFile failed at step '${step}':`, err);
      // Cleanup is best-effort and swallows its own errors; we always return
      // the originating reason + error so the caller can show a focused
      // user-facing message.
      await handleCreateFailure(partialFileId);
      // Mirror to legacy error ref so any old callers still reading it see
      // the latest message; canonical signal is the returned discriminated
      // result.
      error.value = err.message;
      return { ok: false, reason, error: err };
    } finally {
      criticalWriteState.value = { kind: 'idle' };
    }
  }

  /**
   * Clear session key material
   */
  function clearSessionPassword(): void {
    familyKey.value = null;
    envelope.value = null;
  }

  /**
   * Export the current family key as base64 string.
   * Used for trusted device caching and passkey registration.
   */
  async function getExportedFamilyKey(): Promise<string | null> {
    if (!familyKey.value) return null;
    const { exportFamilyKey } = await import('@/services/crypto/familyKeyService');
    const { bufferToBase64 } = await import('@/utils/encoding');
    const raw = await exportFamilyKey(familyKey.value);
    return bufferToBase64(raw);
  }

  /**
   * Decrypt a pending file using a pre-obtained family key (skips password derivation).
   * Used by passkey/biometric flows that already have the family key.
   */
  async function decryptPendingFileWithKey(
    fk: CryptoKey
  ): Promise<{ success: boolean; error?: string }> {
    const pending = pendingEncryptedFile.value;
    if (!pending) return { success: false, error: 'No pending file' };

    try {
      // Decrypt the Automerge payload with the family key
      const doc = await decryptBeanpodPayload(pending.envelope, fk);

      // Replace doc with cache recovery to prevent data loss from failed saves
      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      if (famId) {
        await replaceDocWithCacheRecovery(doc, fk, famId);
      } else {
        replaceDoc(doc);
      }

      familyKey.value = fk;
      envelope.value = pending.envelope;
      syncService.setFamilyKey(fk, pending.envelope);
      isConfigured.value = true;

      // Adopt family identity — ensure the file's family is registered and active
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      let activeFamilyId = getActiveFamilyId();
      const familyCtx = useFamilyContextStore();
      const fileFamilyId = pending.envelope.familyId;

      if (fileFamilyId) {
        // Register the family if it's not yet in the local registry
        const isKnown = familyCtx.allFamilies.some((f) => f.id === fileFamilyId);
        if (!isKnown) {
          await familyCtx.createFamilyWithId(
            fileFamilyId,
            pending.envelope.familyName ?? 'My Family'
          );
        } else if (fileFamilyId !== familyCtx.activeFamilyId) {
          await familyCtx.switchFamily(fileFamilyId);
        }
        activeFamilyId = fileFamilyId;
      } else if (activeFamilyId && activeFamilyId !== familyCtx.activeFamilyId) {
        await familyCtx.switchFamily(activeFamilyId);
      }

      // Bind Google Auth to this family and migrate any pending refresh token
      if (activeFamilyId && pending.driveFileId) {
        await initializeAuth(activeFamilyId);
        await migratePendingRefreshToken(activeFamilyId);
      }

      // If loaded from Google Drive, persist the config
      if (pending.driveFileId && pending.driveFileName) {
        const { storeProviderConfig, clearFileHandleForFamily } =
          await import('@/services/sync/fileHandleStore');
        if (activeFamilyId) {
          await clearFileHandleForFamily(activeFamilyId);
          await storeProviderConfig(activeFamilyId, {
            type: 'google_drive',
            driveFileId: pending.driveFileId,
            driveFileName: pending.driveFileName,
            driveAccountEmail: pending.driveAccountEmail,
          });
        }
        const provider = GoogleDriveProvider.fromExisting(
          pending.driveFileId,
          pending.driveFileName,
          pending.driveAccountEmail
        );
        syncService.setProvider(provider);
      }

      // If file was opened with a provider (local file picker), persist it
      if (pending.provider) {
        if (activeFamilyId) {
          await pending.provider.persist(activeFamilyId);
        }
        syncService.setProvider(pending.provider);
      }

      // Clear pending
      pendingEncryptedFile.value = null;
      needsPermission.value = false;
      lastSync.value = toISODateString(new Date());

      // Initialize persistence cache
      if (familyCtx.activeFamilyId) {
        await initPersistenceDB(familyCtx.activeFamilyId);
        persistDoc(fk).catch(console.warn);
        persistEnvelope(pending.envelope).catch(console.warn);
      }

      await settingsRepo.saveSettings(
        {
          syncEnabled: true,
          encryptionEnabled: true,
          syncFilePath: fileName.value ?? undefined,
          lastSyncTimestamp: lastSync.value ?? undefined,
        },
        { preserveTimestamp: true }
      );

      // Cache exported family key so auto-decrypt works after page refresh.
      // Force-cache during join/decrypt flow (driveFileId present) since the user
      // just created a password on this device — it's clearly their personal device.
      const settingsStore = useSettingsStore();
      if (familyCtx.activeFamilyId) {
        const exported = await getExportedFamilyKey();
        if (exported) {
          const forceCache = !!pending.driveFileId || !!pending.provider;
          await settingsStore.cacheFamilyKey(exported, familyCtx.activeFamilyId, {
            force: forceCache,
          });
        }
      }

      await reloadAllStores();
      setupAutoSync();

      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /**
   * Derive a wrapping key from a password and wrap the family key for a member.
   * Adds the wrappedKey entry to the envelope so the member can decrypt from any browser/device.
   */
  async function wrapFamilyKeyForMember(memberId: string, password: string): Promise<void> {
    if (!familyKey.value) throw new Error('No family key loaded');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const memberKey = await deriveMemberKey(password, salt);
    const wrapped = await wrapFamilyKey(familyKey.value, memberKey);
    const { bufferToBase64 } = await import('@/utils/encoding');
    await addMemberWrappedKey(memberId, {
      wrapped,
      salt: bufferToBase64(salt),
    });
  }

  /**
   * Add a wrapped key entry to the envelope for a new member (joinFamily flow).
   */
  async function addMemberWrappedKey(
    memberId: string,
    wrappedKey: { wrapped: string; salt: string }
  ): Promise<void> {
    if (!envelope.value) throw new Error('No envelope loaded');
    const env = { ...envelope.value };
    env.wrappedKeys = {
      ...env.wrappedKeys,
      [memberId]: { wrapped: wrappedKey.wrapped, salt: wrappedKey.salt },
    };
    envelope.value = env;
    syncService.setEnvelope(env);

    // Persist updated envelope
    if (familyKey.value) {
      persistEnvelope(env).catch(console.warn);
    }
  }

  /**
   * Add an invite key package to the envelope and persist.
   * Returns the token hash (storage key) so the caller can verify storage.
   */
  async function addInvitePackage(
    tokenHash: string,
    pkg: { salt: string; wrapped: string; expiresAt: string }
  ): Promise<void> {
    if (!envelope.value) throw new Error('No envelope loaded');
    const env = { ...envelope.value };
    env.inviteKeys = {
      ...env.inviteKeys,
      [tokenHash]: { salt: pkg.salt, wrapped: pkg.wrapped, expiresAt: pkg.expiresAt },
    };
    envelope.value = env;
    syncService.setEnvelope(env);

    console.warn(
      '[syncStore] addInvitePackage: added key',
      tokenHash.slice(0, 8) + '...',
      'inviteKeys count:',
      Object.keys(env.inviteKeys).length
    );

    // Persist updated envelope and sync
    if (familyKey.value) {
      persistEnvelope(env).catch(console.warn);
    }
    const saved = await syncNow(true);
    if (!saved) {
      console.error(
        '[syncStore] addInvitePackage: syncNow failed — invite key may not be on Drive'
      );
    }
  }

  /**
   * Disconnect from sync file
   */
  async function disconnect(): Promise<void> {
    stopFilePolling();

    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) {
      registry.removeFamily(ctx.activeFamilyId).catch((e: unknown) => {
        // Non-critical: registry is optional smoothness; disconnect proceeds
        // regardless. Logged so the failure isn't silent.
        console.warn('[syncStore] registry.removeFamily failed (non-critical)', e);
      });
    }

    if (storageProviderType.value === 'google_drive') {
      clearQueue();
      clearFolderCache();
    }

    await syncService.disconnect();
    needsPermission.value = false;
    lastSync.value = null;
    familyKey.value = null;
    envelope.value = null;
    storageProviderType.value = null;
    providerAccountEmail.value = null;
    showGoogleReconnect.value = false;
    driveFileNotFound.value = false;

    const settingsStore = useSettingsStore();
    await settingsStore.clearCachedFamilyKey(ctx.activeFamilyId ?? undefined);
    await settingsRepo.saveSettings({
      syncEnabled: false,
      syncFilePath: undefined,
      lastSyncTimestamp: undefined,
    });
  }

  /**
   * Manual export (fallback for browsers without File System Access API)
   */
  async function manualExport(): Promise<void> {
    if (!familyKey.value || !envelope.value) {
      error.value = 'No family key — cannot export';
      return;
    }
    const envelopeJson = await reEncryptEnvelope(envelope.value, familyKey.value);
    downloadAsFile(envelopeJson);
    lastSync.value = toISODateString(new Date());
  }

  /**
   * Manual import — opens picker, validates V4, prompts for password
   */
  async function manualImport(): Promise<{ success: boolean; error?: string }> {
    const result = await loadFromNewFile();
    if (result.needsPassword) {
      return { success: false, error: 'Encrypted file requires password' };
    }
    return { success: result.success };
  }

  // Guard: suppress auto-sync during store reloads
  let isReloading = false;

  /**
   * Reload all stores from the in-memory Automerge document.
   */
  async function reloadAllStores(): Promise<void> {
    isReloading = true;
    syncService.cancelPendingSave();

    const highlightStore = useSyncHighlightStore();
    if (isCrossDeviceReload) {
      highlightStore.snapshotBeforeReload();
    }

    try {
      const familyStoreInst = useFamilyStore();
      const accountsStore = useAccountsStore();
      const transactionsStore = useTransactionsStore();
      const assetsStore = useAssetsStore();
      const goalsStore = useGoalsStore();
      const settingsStore = useSettingsStore();
      const recurringStore = useRecurringStore();
      const todoStore = useTodoStore();
      const activityStore = useActivityStore();
      const vacationStore = useVacationStore();
      const budgetStore = useBudgetStore();
      const favoritesStoreInst = useFavoritesStore();
      const sayingsStoreInst = useSayingsStore();
      const memberNotesStoreInst = useMemberNotesStore();
      const allergiesStoreInst = useAllergiesStore();
      const medicationsStoreInst = useMedicationsStore();
      const milestonesStoreInst = useMilestonesStore();
      const recipesStoreInst = useRecipesStore();
      const emergencyContactsStoreInst = useEmergencyContactsStore();

      // Snapshot permission state before reload for diagnostics
      const prevMember = familyStoreInst.currentMember;
      const prevMemberId = familyStoreInst.currentMemberId;

      await Promise.all([
        familyStoreInst.loadMembers(),
        accountsStore.loadAccounts(),
        transactionsStore.loadTransactions(),
        assetsStore.loadAssets(),
        goalsStore.loadGoals(),
        settingsStore.loadSettings(),
        recurringStore.loadRecurringItems(),
        todoStore.loadTodos(),
        activityStore.loadActivities(),
        vacationStore.loadVacations(),
        budgetStore.loadBudgets(),
        favoritesStoreInst.loadFavorites(),
        sayingsStoreInst.loadSayings(),
        memberNotesStoreInst.loadMemberNotes(),
        allergiesStoreInst.loadAllergies(),
        medicationsStoreInst.loadMedications(),
        milestonesStoreInst.loadMilestones(),
        recipesStoreInst.loadRecipes(),
        emergencyContactsStoreInst.loadEmergencyContacts(),
      ]);

      // Diagnostic: detect permission changes after reload
      const newMember = familyStoreInst.currentMember;
      if (prevMember && prevMemberId === familyStoreInst.currentMemberId) {
        if (prevMember.canViewFinances !== newMember?.canViewFinances) {
          console.warn(
            '[reloadAllStores] canViewFinances changed during reload:',
            prevMember.canViewFinances,
            '→',
            newMember?.canViewFinances,
            'member:',
            prevMemberId,
            'crossDevice:',
            isCrossDeviceReload
          );
        }
      } else if (prevMemberId !== familyStoreInst.currentMemberId) {
        console.warn(
          '[reloadAllStores] currentMemberId changed during reload:',
          prevMemberId,
          '→',
          familyStoreInst.currentMemberId
        );
      }
    } finally {
      await nextTick();
      isReloading = false;
    }

    if (isCrossDeviceReload) {
      useSyncHighlightStore().detectChanges();
    }
  }

  /**
   * Try to decrypt a pending encrypted file using the cached family key.
   * Shared helper for loadFamilyData, reloadIfFileChanged, and backgroundSyncFromFile.
   * Returns true if decryption succeeded.
   */
  async function tryDecryptWithCachedKey(): Promise<boolean> {
    const familyCtx = useFamilyContextStore();
    const settingsStore = useSettingsStore();
    const famId = familyCtx.activeFamilyId;
    const cachedKeyB64 = famId ? settingsStore.getCachedFamilyKey(famId) : null;
    if (!cachedKeyB64) return false;

    try {
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(cachedKeyB64)));
      const result = await decryptPendingFileWithKey(fk);
      return result.success;
    } catch {
      // Cached key invalid — caller handles fallback
      if (famId) await settingsStore.clearCachedFamilyKey(famId);
      return false;
    }
  }

  /**
   * Surface the reconnect banner if the boot-time data load is stuck on a
   * silent-refresh-failed `TokenExpiredError`. Deferred ~4s so wake events
   * (focus, pageshow, online) have a chance to land first; the
   * `onTokenAcquired` self-heal handler cancels the timer on any
   * successful acquisition.
   *
   * Boundary: only fires for Google Drive (the only provider with token
   * expiry semantics) and only when the banner isn't already up.
   */
  function scheduleColdStartReconnectEscalation(lastErr: string | null): void {
    if (storageProviderType.value !== 'google_drive') return;
    if (showGoogleReconnect.value) return;
    coldStartReconnectDefer.schedule(() => {
      if (isTokenValid()) return; // recovered via wake event; nothing to do
      if (showGoogleReconnect.value) return; // raced with the auth-layer escalation
      showGoogleReconnect.value = true;

      // Diagnostic context for the silent-refresh failure mode. Added
      // 2026-05-14 to disambiguate iOS PWA wake-race vs Lambda cold start vs
      // token revocation vs other transient causes. Defensive: tracker /
      // diagnostics may be null if document isn't available (tests) or no
      // refresh attempt has actually run yet.
      const diag = getLastSilentRefreshDiagnostics();
      const hiddenForMs = getHiddenDurationMs();
      const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;

      reportError({
        surface: 'cold-start-reconnect-escalation',
        message:
          'Cold-start data load stuck on auth-transient (silent refresh failed); ' +
          `banner surfaced after ${COLD_START_RECONNECT_DEFER_MS}ms defer window. ` +
          `lastError: ${lastErr ?? 'unknown'}`,
        context: {
          // Array; the Slack renderer JSON-stringifies non-primitive context
          // values at display time. redactContext passes through unchanged
          // (it only truncates string values, not arrays).
          silent_refresh_attempts: diag?.attempts ?? null,
          silent_refresh_had_refresh_token: diag?.hadRefreshToken ?? null,
          silent_refresh_consecutive_failures: diag?.consecutiveFailures ?? null,
          page_hidden_for_ms: hiddenForMs,
          visibility_state: visibilityState,
        },
      });
    });
  }

  /**
   * Background sync from file after cache-first load.
   * Fetches fresh data from Drive, CRDT-merges into the live doc.
   * Non-blocking — UI remains interactive throughout.
   */
  async function backgroundSyncFromFile(): Promise<void> {
    if (isBackgroundSyncing.value) return;

    isBackgroundSyncing.value = true;
    backgroundSyncError.value = null;
    backgroundSyncErrorKind.value = null;

    try {
      const loadResult = await loadFromFile({ merge: true });

      if (loadResult.success) {
        setupAutoSync();
        return;
      }

      if (loadResult.needsPassword) {
        // Try existing family key first (loadFromFile already tried, but pending may need it)
        if (familyKey.value && pendingEncryptedFile.value) {
          try {
            const doc = await decryptBeanpodPayload(
              pendingEncryptedFile.value.envelope,
              familyKey.value
            );
            mergeDoc(doc);
            envelope.value = pendingEncryptedFile.value.envelope;
            syncService.setFamilyKey(familyKey.value!, pendingEncryptedFile.value.envelope);
            pendingEncryptedFile.value = null;
            await reloadAllStores();
            // Clean up duplicate recurring transactions from CRDT merge
            const dupsRemoved = await deduplicateRecurringTransactions();
            if (dupsRemoved > 0) await reloadAllStores();
            syncService.triggerDebouncedSave();
            setupAutoSync();
            return;
          } catch {
            // Family key doesn't work — try cached key
          }
        }

        const success = await tryDecryptWithCachedKey();
        if (success) {
          setupAutoSync();
          return;
        }

        // Can't decrypt — stale cached data is still usable
        backgroundSyncError.value = 'Could not refresh data — password may have changed';
        backgroundSyncErrorKind.value = 'decrypt';
        pendingEncryptedFile.value = null;
        return;
      }

      // Non-password failure (network, 404, auth-transient, etc.)
      const lastErr = syncService.getState().lastError;
      if (isAuthTransientSyncError(lastErr)) {
        backgroundSyncError.value = lastErr ?? 'Token expired';
        backgroundSyncErrorKind.value = 'auth-transient';
        scheduleColdStartReconnectEscalation(lastErr);
      } else {
        backgroundSyncError.value = 'Could not refresh data from cloud';
        backgroundSyncErrorKind.value = 'network';
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not refresh data from cloud';
      backgroundSyncError.value = msg;
      const isAuth = isAuthTransientSyncError(msg);
      backgroundSyncErrorKind.value = isAuth ? 'auth-transient' : 'network';
      if (isAuth) scheduleColdStartReconnectEscalation(msg);
    } finally {
      isBackgroundSyncing.value = false;
      // Always start polling — even on error, next poll may succeed
      if (!filePollingTimer) {
        startDeferredPolling();
      }
    }
  }

  // Track the stop handle so we never register duplicate watchers
  let autoSyncStopHandle: (() => void) | null = null;

  // File polling for cross-device sync detection
  const FILE_POLL_INTERVAL = 10_000;
  let filePollingTimer: ReturnType<typeof setInterval> | null = null;
  let isCheckingFile = false;
  let isCrossDeviceReload = false;

  /**
   * Check if the sync file has been modified externally and reload if so.
   */
  async function reloadIfFileChanged(): Promise<boolean> {
    if (!isConfigured.value || needsPermission.value || isReloading || isCheckingFile) return false;

    isCheckingFile = true;
    try {
      const { hasConflict } = await checkForConflicts();
      if (!hasConflict) return false;

      syncService.cancelPendingSave();

      isCrossDeviceReload = true;
      try {
        const loadResult = await loadFromFile({ merge: true });
        if (loadResult.success) return true;

        if (loadResult.needsPassword) {
          // Try existing family key first (should work unless key was rotated)
          if (familyKey.value && pendingEncryptedFile.value) {
            try {
              const doc = await decryptBeanpodPayload(
                pendingEncryptedFile.value.envelope,
                familyKey.value
              );
              mergeDoc(doc);
              envelope.value = pendingEncryptedFile.value.envelope;
              syncService.setFamilyKey(familyKey.value!, pendingEncryptedFile.value.envelope);
              pendingEncryptedFile.value = null;
              await reloadAllStores();
              // Clean up duplicate recurring transactions from CRDT merge
              const dupsRemoved = await deduplicateRecurringTransactions();
              if (dupsRemoved > 0) await reloadAllStores();
              syncService.triggerDebouncedSave();
              return true;
            } catch {
              // Family key doesn't work — try cached key
            }
          }

          // Try cached family key
          const success = await tryDecryptWithCachedKey();
          if (success) return true;

          pendingEncryptedFile.value = null;
        }

        return false;
      } finally {
        isCrossDeviceReload = false;
      }
    } catch (e) {
      if (e instanceof DriveApiError && e.status === 404) {
        driveFileNotFound.value = true;
        showSaveFailureBanner.value = true;
        stopFilePolling();
        return false;
      }
      console.warn('[syncStore] reloadIfFileChanged failed:', e);
      return false;
    } finally {
      isCheckingFile = false;
    }
  }

  /**
   * Start polling the sync file for external changes.
   */
  function startFilePolling(): void {
    if (filePollingTimer) return;
    filePollingTimer = setInterval(() => {
      reloadIfFileChanged().catch(console.warn);
    }, FILE_POLL_INTERVAL);
  }

  function stopFilePolling(): void {
    if (filePollingTimer) {
      clearInterval(filePollingTimer);
      filePollingTimer = null;
    }
  }

  function pauseFilePolling(): void {
    stopFilePolling();
  }

  function resumeFilePolling(): void {
    if (isConfigured.value && !needsPermission.value && autoSyncStopHandle && !pollingDeferred) {
      startFilePolling();
    }
  }

  // When true, setupAutoSync marks itself ready but defers file polling
  // until startDeferredPolling() is called. Prevents the reload cascade
  // during init (processRecurringItems creates mutations → file polling
  // detects "change" → triggers reload → more mutations → loop).
  let pollingDeferred = false;

  function deferPolling(): void {
    pollingDeferred = true;
  }

  function startDeferredPolling(): void {
    pollingDeferred = false;
    if (autoSyncStopHandle && !filePollingTimer) {
      startFilePolling();
    }
  }

  /**
   * Setup auto-sync.
   * In V4, the docService persist callback drives saves automatically.
   * We only need file polling for cross-device sync detection.
   */
  function setupAutoSync(): void {
    if (!supportsAutoSync.value) return;
    if (autoSyncStopHandle) return;

    // Mark as set up (the actual save triggering comes from docService's persist callback)
    autoSyncStopHandle = () => {};

    // If polling is deferred (during init), skip starting it now —
    // startDeferredPolling() will start it once init is complete.
    if (!pollingDeferred) {
      startFilePolling();
    }
  }

  /**
   * Reset all sync state (used on sign-out)
   */
  function resetState() {
    if (autoSyncStopHandle) {
      autoSyncStopHandle();
      autoSyncStopHandle = null;
    }
    stopFilePolling();
    saveFailureBannerDefer.cancel();
    coldStartReconnectDefer.cancel();
    syncService.reset();
    useSyncHighlightStore().clearHighlights();
    isInitialized.value = false;
    isConfigured.value = false;
    fileName.value = null;
    isSyncing.value = false;
    error.value = null;
    lastSync.value = null;
    needsPermission.value = false;
    familyKey.value = null;
    envelope.value = null;
    storageProviderType.value = null;
    providerAccountEmail.value = null;
    showGoogleReconnect.value = false;
    driveFileNotFound.value = false;
    saveFailureLevel.value = 'none';
    lastSaveError.value = null;
    showSaveFailureBanner.value = false;
    pendingEncryptedFile.value = null;
    clearQueue();
  }

  function clearError(): void {
    error.value = null;
  }

  /**
   * Handle successful Google Drive reconnection.
   */
  async function handleGoogleReconnected(): Promise<void> {
    if (driveFileNotFound.value) return;

    showGoogleReconnect.value = false;
    showSaveFailureBanner.value = false;
    syncService.resetSaveFailures();
    saveFailureLevel.value = 'none';
    lastSaveError.value = null;

    await reloadIfFileChanged();
    setupAutoSync();
    syncService.triggerDebouncedSave();
  }

  // --- Google Drive actions ---

  async function configureSyncFileGoogleDrive(podFileName: string): Promise<boolean> {
    try {
      const provider = await GoogleDriveProvider.createNew(podFileName);
      await installProvider(provider, 'google_drive');
      return true;
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    }
  }

  // --- Storage migration: move the active pod between local file and Google Drive ---

  /**
   * Build the destination provider for a migration. Returns `null` when the
   * user backs out of the picker / Google account chooser (a quiet
   * "never mind", not an error). Throws on a genuine failure.
   *
   * For Drive we pass `forceConsent: false` so a cached token is reused — on a
   * standalone PWA with no cached token this triggers redirect-auth from
   * inside `createNew` (the page navigates away; the user retries on return),
   * which avoids the redirect loop that `prompt=consent` would cause.
   */
  async function buildProviderForTarget(
    target: StorageProviderType
  ): Promise<StorageProvider | null> {
    if (target === 'local') {
      return LocalStorageProvider.fromSavePicker('my-family.beanpod');
    }
    try {
      return await GoogleDriveProvider.createNew(fileName.value ?? 'my-family.beanpod', {
        forceConsent: false,
      });
    } catch (e) {
      if (isUserCancellation(e)) return null;
      throw e;
    }
  }

  /**
   * Re-install the previous provider after a failed migration. Returns `true`
   * if recovery succeeded, `false` if the rollback itself failed (the caller
   * surfaces a "sign out and back in" message in that case). Telemetry for
   * the failure is left to the caller, which has the full from/to context.
   */
  async function restorePreviousProvider(
    provider: StorageProvider,
    type: StorageProviderType
  ): Promise<boolean> {
    try {
      await installProvider(provider, type);
      return true;
    } catch (e) {
      console.error('[syncStore.migrateStorage] rollback failed', e);
      return false;
    }
  }

  /**
   * Move the active pod's storage from local file to Google Drive (or vice
   * versa). The encrypted bytes are unchanged — same family key, same
   * envelope, no password prompt; only the storage location moves. The
   * source file is left intact as a backup.
   *
   * Owner-gating lives in the UI (the action row is owner-only); the guard
   * rails here just assert sane state. On any failure after the provider
   * swap begins, the previous provider is re-installed (`restorePreviousProvider`).
   * Returns a discriminated result; the caller renders the user-facing toast.
   */
  async function migrateStorage(target: StorageProviderType): Promise<MigrateStorageResult> {
    if (isMigratingStorage.value) return { outcome: 'cancelled' };
    isMigratingStorage.value = true;

    const from = storageProviderType.value;
    let needsRollback = false;
    let previous: StorageProvider | null = null;

    try {
      if (!isConfigured.value) throw new Error('No pod is configured to move');
      if (!from) throw new Error('No active storage provider to move from');
      if (target === from) {
        throw new Error(
          `Pod is already saved to ${target === 'google_drive' ? 'Google Drive' : 'a local file'}`
        );
      }

      // Flush the source one last time so the file you're leaving stays a
      // valid, up-to-date backup. Non-forced: a real cross-device conflict
      // here means "don't migrate mid-write" — surface it and let the user retry.
      const flushed = await syncNow();
      if (!flushed) {
        throw new Error(
          'Could not save your pod to its current location before moving. If another device is syncing, wait a moment and try again.'
        );
      }

      // Build the destination. null = the user cancelled a picker/chooser.
      const newProvider = await buildProviderForTarget(target);
      if (!newProvider) return { outcome: 'cancelled' };

      // Swap. Capture the previous provider first so we can put it back.
      previous = syncService.getProvider();
      needsRollback = true;
      await installProvider(newProvider, target);
      needsRollback = false;

      reportError({
        surface: 'storage-migration-ok',
        severity: 'warning',
        message: `moved ${from} -> ${target}`,
        context: { from, to: target },
      });
      return { outcome: 'success', dest: newProvider.getDisplayName() };
    } catch (e) {
      let restored = true;
      if (needsRollback && previous && from) {
        restored = await restorePreviousProvider(previous, from);
      }
      const step = !needsRollback ? 'pre-swap' : restored ? 'install' : 'rollback';
      const reason = e instanceof Error ? e.message : String(e);
      reportError({
        surface: 'storage-migration-failed',
        severity: 'error',
        message: reason,
        error: e,
        context: { from, to: target, step },
      });
      console.error('[syncStore.migrateStorage] failed', { from, to: target, step, error: e });
      return restored ? { outcome: 'failed', reason } : { outcome: 'recovery-needed', reason };
    } finally {
      isMigratingStorage.value = false;
    }
  }

  async function loadFromGoogleDrive(
    fileId: string,
    driveFileName: string
  ): Promise<{ success: boolean; needsPassword?: boolean }> {
    // Defensive: clear any banner state left over from a prior session.
    // Sign-out should have done this via resetState(), but if we're here we
    // know the user has a fresh interactive token in hand — there's no
    // legitimate "session expired" state to display until something else
    // sets it again.
    showGoogleReconnect.value = false;
    showSaveFailureBanner.value = false;
    saveFailureLevel.value = 'none';
    lastSaveError.value = null;
    error.value = null;

    // Mark this as a critical load so the router beforeEach guard, the
    // beforeunload handler, and the SetupProgressModal can react. Setting
    // here covers every load entry point (Picker, /open, join flow,
    // resume-from-registry) without each one needing to remember.
    //
    // Re-entrancy: we don't refuse a second call (load is read-only and
    // idempotent — Drive returns the same bytes) but we do preserve a
    // pre-existing 'creating' state so we don't overwrite it. The finally
    // restores it. In practice the only realistic overlap is a sign-in
    // racing with a never-fired createNewFile, which isn't a real concern.
    const previousState = criticalWriteState.value;
    if (previousState.kind === 'idle') {
      criticalWriteState.value = { kind: 'loading' };
    }

    try {
      const token = await requestAccessToken();
      await fetchGoogleUserEmail(token);

      const provider = GoogleDriveProvider.fromExisting(fileId, driveFileName);
      const text = await provider.read();
      if (!text) {
        error.value = 'File is empty';
        return { success: false };
      }

      const version = detectFileVersion(text);
      if (version !== '4.0') {
        error.value = `Unsupported file version: ${version ?? 'unknown'}`;
        return { success: false };
      }

      const env = parseBeanpodV4(text);

      const loadedInviteKeyCount = env.inviteKeys ? Object.keys(env.inviteKeys).length : 0;
      console.warn(
        '[syncStore] loadFromGoogleDrive: parsed envelope, inviteKeys:',
        loadedInviteKeyCount,
        loadedInviteKeyCount > 0
          ? 'hashes: ' +
              Object.keys(env.inviteKeys!)
                .map((h) => h.slice(0, 8) + '...')
                .join(', ')
          : '(none)'
      );

      // Store as pending — needs password
      pendingEncryptedFile.value = {
        envelope: env,
        driveFileId: fileId,
        driveFileName,
        driveAccountEmail: provider.getAccountEmail() ?? undefined,
      };
      storageProviderType.value = 'google_drive';
      return { success: false, needsPassword: true };
    } catch (e) {
      error.value = (e as Error).message;
      return { success: false };
    } finally {
      // Only restore to idle if WE set it — otherwise a caller that wrapped
      // us in their own critical section (e.g. a future orchestrator) keeps
      // their context. Defensive against future composition mistakes.
      if (previousState.kind === 'idle') {
        criticalWriteState.value = { kind: 'idle' };
      }
    }
  }

  /**
   * Resume-from-registry recovery — the orchestrator that makes
   * `ResumePodSetup` non-destructive.
   *
   * The DynamoDB family registry stores `fileId` per family (written by
   * `_registerCurrentFamilySync` inside every successful `createNewFile`).
   * On a fresh device — or after iOS Safari evicts the IndexedDB provider
   * config — `authStore.currentUser.familyId` is still set by the OAuth
   * identity, so we can look up the registry entry, find the user's existing
   * `.beanpod`, and fetch its encrypted envelope into `pendingEncryptedFile`.
   * The user then enters their password and `completeAutoLoad` finishes.
   *
   * Critically: this does NOT call `createNewFile`. The previous recovery
   * path did, generating a fresh family key and overwriting/duplicating the
   * user's real `.beanpod` with an empty envelope (the Shaun-class data loss
   * on 2026-05-15).
   *
   * Never throws — every failure mode is a typed result kind so the UI
   * (`ResumePodSetup`) can render a flat switch.
   */
  async function attemptResumeFromRegistry(): Promise<ResumeFromRegistryResult> {
    const ctx = useFamilyContextStore();
    const authStoreInst = useAuthStore();
    const familyId = ctx.activeFamilyId ?? authStoreInst.currentUser?.familyId ?? null;
    if (!familyId) {
      return { kind: 'no-registry-entry' };
    }

    let entry: RegistryEntry | null;
    try {
      entry = await registry.lookupFamily(familyId);
    } catch (e) {
      // `lookupFamily` is defensively coded to return null on any error, so
      // this catch is a belt-and-braces guard for future contract drift.
      return {
        kind: 'registry-error',
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }

    if (!entry || !entry.fileId || entry.provider !== 'google_drive') {
      // Registry knows nothing about this family, or knows it as a local-file
      // pod (which we can't auto-load — the file picker is user-driven).
      // Either way the user picks storage manually in the fallback flow.
      return { kind: 'no-registry-entry' };
    }

    // Fetch the encrypted envelope into `pendingEncryptedFile`. The inner
    // `loadFromGoogleDrive` already sets `criticalWriteState = 'loading'`
    // for its duration; we clear after so the user can interact with the
    // password form. `completeAutoLoad` re-sets it for the decrypt step.
    const loadResult = await loadFromGoogleDrive(
      entry.fileId,
      entry.displayPath ?? `${entry.familyName ?? 'pod'}.beanpod`
    );

    if (!loadResult.needsPassword) {
      // Either succeeded outright (impossible — V4 envelopes always need a
      // password) or hard-failed (network, token, 404, version). The
      // `error` ref carries the message set by loadFromGoogleDrive.
      return {
        kind: 'load-failed',
        error: new Error(error.value ?? 'Could not load pod file from Google Drive'),
      };
    }

    return {
      kind: 'auto-loadable',
      familyName: entry.familyName ?? 'your family',
      lastSaved: entry.updatedAt ?? null,
      fileId: entry.fileId,
    };
  }

  /**
   * Second half of resume-from-registry: the user submitted the password.
   * Unwrap → decrypt → materialize-check → replace state → markPodCreated.
   *
   * Returns a discriminated result so the UI can pick the right surface:
   * - `success` → route to `/nook`
   * - `wrong-password` → re-show the password form with an error
   * - `corrupted` → render the canonical fatal-error modal (`App.initError`)
   *   with diagnostics and a contact-support message; do NOT recreate.
   * - `network-error` → recoverable, show a retry button.
   */
  async function completeAutoLoad(password: string): Promise<CompleteAutoLoadResult> {
    const pending = pendingEncryptedFile.value;
    if (!pending) {
      return {
        kind: 'network-error',
        error: new Error('No pending pod envelope — fetch step did not run'),
      };
    }

    const previousState = criticalWriteState.value;
    if (previousState.kind === 'idle') {
      criticalWriteState.value = { kind: 'loading' };
    }

    try {
      const decryptResult = await decryptPendingFile(password);

      if (decryptResult.corrupted) {
        return {
          kind: 'corrupted',
          fileId: pending.driveFileId ?? '',
          familyId: pending.envelope.familyId ?? '',
          error: decryptResult.corrupted,
        };
      }

      if (!decryptResult.success) {
        if (decryptResult.error === 'Incorrect password') {
          return { kind: 'wrong-password' };
        }
        return {
          kind: 'network-error',
          error: new Error(decryptResult.error ?? 'Could not decrypt pod file'),
        };
      }

      // Decrypt + state replacement + cache write all succeeded. Flip the
      // auth invariant — the user has a working pod again.
      useAuthStore().markPodCreated();
      return { kind: 'success' };
    } catch (e) {
      // `decryptPendingFile` catches its own errors and returns a result,
      // but defensively handle a future contract drift.
      const err = e instanceof Error ? e : new Error(String(e));
      if (err instanceof CorruptPayloadError) {
        return {
          kind: 'corrupted',
          fileId: pending.driveFileId ?? '',
          familyId: pending.envelope.familyId ?? '',
          error: err,
        };
      }
      return { kind: 'network-error', error: err };
    } finally {
      if (previousState.kind === 'idle') {
        criticalWriteState.value = { kind: 'idle' };
      }
    }
  }

  /**
   * Recover from a "file not found" state by re-binding the active session
   * to a freshly-picked .beanpod fileId. The expected scenario: the user
   * revoked and re-granted the app's OAuth grant in their Google account,
   * which wiped the per-file drive.file scope association. The file is
   * still in their Drive, but the running app's token can no longer read
   * it by ID. Picking the file via Google Picker re-grants drive.file
   * scope, and this method verifies the picked file decrypts with the
   * already-loaded family key and swaps the provider in-place.
   *
   * Requires an active session — `familyKey` and `envelope` must be in
   * memory. Returns `{ success: true }` on success; otherwise an error
   * string suitable for showing to the user. Never throws.
   */
  async function recoverFromMissingFile(
    fileId: string,
    fileName_param: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!familyKey.value || !envelope.value) {
        return {
          success: false,
          error: 'No active session — sign out and sign in fresh to load this file.',
        };
      }

      const provider = GoogleDriveProvider.fromExisting(fileId, fileName_param);
      const text = await provider.read();
      if (!text) {
        return { success: false, error: 'Picked file is empty.' };
      }

      const env = parseBeanpodV4(text);
      if (env.familyId !== envelope.value.familyId) {
        return {
          success: false,
          error:
            'That file belongs to a different family. Pick your own .beanpod, or sign out and sign in fresh to switch families.',
        };
      }

      // Verify the in-memory family key still decrypts the file.
      await decryptBeanpodPayload(env, familyKey.value);

      // Swap the provider so subsequent saves/polls use the new fileId.
      syncService.setProvider(provider);
      syncService.setFamilyKey(familyKey.value, env);
      envelope.value = env;
      fileName.value = fileName_param;
      driveFileId.value = fileId;

      // Clear the file-not-found banner state and resume normal sync.
      driveFileNotFound.value = false;
      showSaveFailureBanner.value = false;
      error.value = null;
      syncService.resetSaveFailures();
      saveFailureLevel.value = 'none';
      lastSaveError.value = null;
      startFilePolling();

      console.warn(
        '[syncStore] recoverFromMissingFile succeeded — swapped to',
        fileId,
        fileName_param
      );
      return { success: true };
    } catch (e) {
      const message = (e as Error).message || 'Recovery failed';
      console.warn('[syncStore] recoverFromMissingFile failed:', message);
      return { success: false, error: message };
    }
  }

  async function listGoogleDriveFiles(options?: {
    forceNewAccount?: boolean;
  }): Promise<Array<{ fileId: string; name: string; modifiedTime: string }>> {
    const token = await requestAccessToken({
      forceConsent: options?.forceNewAccount,
    });
    // Drive-wide search so we don't resolve (and potentially create) the
    // `beanies.family` folder at listing time. For joiners who will load
    // a shared `.beanpod` from someone else's Drive, this avoids eagerly
    // creating an empty folder on their own Drive. When the user actually
    // needs the folder — creating a new pod, uploading a photo —
    // getOrCreateAppFolder is called on-demand at the write site
    // (`GoogleDriveProvider.createNew` + photoStore upload paths).
    return searchBeanpodFilesGlobal(token);
  }

  let tokenExpiryUnsub: (() => void) | null = null;
  let tokenAcquiredUnsub: (() => void) | null = null;

  function updateProviderEmailAfterLoad(): void {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const provider = syncService.getProvider();
      if (provider instanceof GoogleDriveProvider && provider.updateAccountEmailIfAvailable()) {
        providerAccountEmail.value = provider.getAccountEmail();
        const ctx = useFamilyContextStore();
        if (ctx.activeFamilyId) {
          await provider.persist(ctx.activeFamilyId);
        }
        clearInterval(interval);
      } else if (attempts >= 10) {
        clearInterval(interval);
      }
    }, 500);
  }

  /**
   * Wires up the reconnect-banner state.
   *
   * - **Show on permanent failure only.** The banner appears when Google
   *   has revoked our refresh token (`invalid_grant`) — the only state
   *   the user can fix by re-authenticating. Transient failures (network
   *   blips, brief 5xx, mid-SW activation) do NOT surface the banner;
   *   the visibility-change wake listener and the next caller's
   *   `attemptSilentRefresh` will retry silently.
   *
   * - **Self-heal on any successful acquisition.** Whether the user
   *   manually reconnected, a silent refresh succeeded in the background,
   *   or a redirect-auth round-trip completed — if the banner is up,
   *   clear it. This makes the banner robust to any transient race we
   *   didn't catch upstream: the next time auth is healthy, the UI
   *   reflects that without user action.
   */
  function setupTokenExpiryHandler(): void {
    if (!tokenExpiryUnsub) {
      tokenExpiryUnsub = onTokenPermanentlyExpired(() => {
        if (storageProviderType.value === 'google_drive') {
          showGoogleReconnect.value = true;
        }
      });
    }
    if (!tokenAcquiredUnsub) {
      tokenAcquiredUnsub = onTokenAcquired(() => {
        // Recovery via any path (wake event, popup, redirect) — cancel any
        // in-flight cold-start escalation before the banner ever appears.
        coldStartReconnectDefer.cancel();

        if (showGoogleReconnect.value) {
          handleGoogleReconnected().catch((e) => {
            console.warn('[syncStore] auto-clear of reconnect banner failed', e);
            reportError({
              surface: 'syncStore-reconnect-clear',
              message: 'auto-clear of reconnect banner failed',
              error: e instanceof Error ? e : new Error(String(e)),
            });
          });
          return;
        }
        // Token healthy. If the save-failure banner is up because saves failed
        // during a wake-time auth race, kick a save now: success → banner
        // auto-clears via recordSaveSuccess; failure → banner stays accurately
        // up. saveNow doesn't normally throw (internal try/catch routes
        // failures through recordSaveFailure); the catch here is defensive.
        if (saveFailureLevel.value === 'critical' && !driveFileNotFound.value) {
          syncService.saveNow().catch((e) => {
            console.error('[syncStore] post-token-acquired saveNow rejected unexpectedly', e);
            reportError({
              surface: 'syncStore',
              message: 'post-token-acquired saveNow rejected',
              error: e,
            });
          });
        }
      });
    }
  }

  // --- Passkey secret management (V4: stored in envelope's passkeyWrappedKeys) ---

  const passkeySecrets = ref<import('@/types/models').PasskeySecret[]>([]);

  /**
   * Effective passkey secrets: merge in-memory secrets with those from the
   * pending/loaded envelope. This ensures PRF unwrap works on login even
   * after a fresh session (when the in-memory ref is empty).
   */
  const effectivePasskeySecrets = computed<import('@/types/models').PasskeySecret[]>(() => {
    const fromRef = passkeySecrets.value;
    const env = pendingEncryptedFile.value?.envelope ?? envelope.value;
    if (!env?.passkeyWrappedKeys) return fromRef;

    const fromEnvelope: import('@/types/models').PasskeySecret[] = Object.entries(
      env.passkeyWrappedKeys
    ).map(([credentialId, wpk]) => ({
      credentialId,
      memberId: wpk.memberId ?? '', // Older envelopes may not have memberId
      wrappedFamilyKey: wpk.wrapped,
      hkdfSalt: wpk.hkdfSalt,
      createdAt: '' as import('@/types/models').ISODateString,
    }));

    // Merge: in-memory secrets take precedence (they have full metadata)
    const seen = new Set(fromRef.map((s) => s.credentialId));
    return [...fromRef, ...fromEnvelope.filter((s) => !seen.has(s.credentialId))];
  });

  function addPasskeySecret(secret: import('@/types/models').PasskeySecret): void {
    passkeySecrets.value = [
      ...passkeySecrets.value.filter((s) => s.credentialId !== secret.credentialId),
      secret,
    ];

    // Persist to envelope's passkeyWrappedKeys so it survives re-encryption
    if (envelope.value) {
      const env: import('@/types/syncFileV4').BeanpodFileV4 = {
        ...envelope.value,
        passkeyWrappedKeys: {
          ...envelope.value.passkeyWrappedKeys,
          [secret.credentialId]: {
            wrapped: secret.wrappedFamilyKey,
            hkdfSalt: secret.hkdfSalt,
            memberId: secret.memberId,
          },
        },
      };
      envelope.value = env;
      syncService.setEnvelope(env);
    }
  }

  function removePasskeySecretsForCredential(credentialId: string): void {
    passkeySecrets.value = passkeySecrets.value.filter((s) => s.credentialId !== credentialId);
  }

  function clearAllPasskeySecrets(): void {
    passkeySecrets.value = [];
  }

  /**
   * Register (or re-register) the current family in the cloud registry.
   * Fire-and-forget: always a single PUT with the current sync + owner state.
   * Write-once fields (createdAt, ownerEmail, subscribeNewsletter) are
   * preserved server-side, so all three call sites (file configure, Drive
   * connect, ensureRegistered) can share one payload.
   */
  function registerCurrentFamily(
    overrides: Partial<Pick<RegistryEntry, 'provider' | 'fileId' | 'displayPath'>> = {}
  ): void {
    const ctx = useFamilyContextStore();
    if (!ctx.activeFamilyId) return;
    const authStore = useAuthStore();
    const provider = syncService.getProvider();
    registry
      .registerFamily(ctx.activeFamilyId, {
        provider: overrides.provider ?? storageProviderType.value ?? 'local',
        fileId: overrides.fileId ?? provider?.getFileId() ?? null,
        displayPath: overrides.displayPath ?? provider?.getDisplayName() ?? fileName.value ?? null,
        familyName: ctx.activeFamilyName,
        ownerEmail: authStore.currentUser?.email ?? null,
        subscribeNewsletter: authStore.newsletterOptIn ?? null,
        country: useSettingsStore().country ?? null,
      })
      .catch((e: unknown) => {
        // Non-critical: registry is optional smoothness; saves proceed
        // regardless. Logged so the failure isn't silent.
        console.warn('[syncStore] registry.registerFamily failed (non-critical)', e);
      });
  }

  function ensureRegistered(): void {
    registerCurrentFamily();
  }

  // Keep the registry's `country` field in sync with the family doc. Fires on
  // every Settings.country change (own edits + Automerge-synced changes from
  // other members). Fire-and-forget via the same non-critical path as every
  // other registry write — the `activeFamilyId` guard inside registerCurrentFamily
  // makes pre-pod-create firings a no-op.
  const settingsStoreForCountry = useSettingsStore();
  watch(
    () => settingsStoreForCountry.country,
    (next, prev) => {
      if (next !== prev) ensureRegistered();
    }
  );

  return {
    // State
    isInitialized,
    isConfigured,
    fileName,
    isSyncing,
    isMigratingStorage,
    error,
    lastSync,
    needsPermission,
    pendingEncryptedFile,
    familyKey,
    envelope,
    // Computed
    capabilities,
    supportsAutoSync,
    syncStatus,
    hasSessionPassword,
    hasPendingEncryptedFile,
    storageProviderType,
    providerAccountEmail,
    isGoogleDriveConnected,
    driveFileId,
    driveFolderId,
    isGoogleDriveAvailable,
    showGoogleReconnect,
    driveFileNotFound,
    criticalWriteState,
    saveFailureLevel,
    lastSaveError,
    showSaveFailureBanner,
    shouldShowSaveFailureBanner,
    cachePersistFailed,
    isBackgroundSyncing,
    backgroundSyncError,
    backgroundSyncErrorKind,
    // Actions
    initialize,
    requestPermission,
    configureSyncFile,
    configureSyncFileGoogleDrive,
    migrateStorage,
    syncNow,
    forceSyncNow,
    checkForConflicts,
    loadFromFile,
    loadFromNewFile,
    loadFromDroppedFile,
    loadFromGoogleDrive,
    attemptResumeFromRegistry,
    completeAutoLoad,
    listGoogleDriveFiles,
    recoverFromMissingFile,
    decryptPendingFile,
    loadFromPersistenceCache,
    clearPendingEncryptedFile,
    createNewFile,
    clearSessionPassword,
    getExportedFamilyKey,
    decryptPendingFileWithKey,
    wrapFamilyKeyForMember,
    addMemberWrappedKey,
    addInvitePackage,
    disconnect,
    manualExport,
    manualImport,
    reloadAllStores,
    setupAutoSync,
    deferPolling,
    startDeferredPolling,
    backgroundSyncFromFile,
    tryDecryptWithCachedKey,
    reloadIfFileChanged,
    handleGoogleReconnected,
    pauseFilePolling,
    resumeFilePolling,
    resetState,
    clearError,
    ensureRegistered,
    // Passkey secrets
    passkeySecrets,
    effectivePasskeySecrets,
    addPasskeySecret,
    removePasskeySecretsForCredential,
    clearAllPasskeySecrets,
  };
});
