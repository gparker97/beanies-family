import { defineStore } from 'pinia';
import { ref, computed, shallowRef, nextTick, watch } from 'vue';

// Import stores for auto-sync and reload
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useFamilyStore } from './familyStore';
import { useGoalsStore } from './goalsStore';
import { useRecurringStore } from './recurringStore';
import { useTodoStore } from './todoStore';
import { useListStore } from './listStore';
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
import { useAuthStore, DEFERRED_PASSWORD_HASH } from './authStore';
import { useTransactionsStore } from './transactionsStore';
import { useSyncHighlightStore } from './syncHighlightStore';
import { isLoaded as isProjectionLoaded } from '@/services/automerge/projection';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import { getSyncCapabilities, canAutoSync, isNative } from '@/services/sync/capabilities';
import {
  beginDriveAuthRedirectIfNeeded,
  RESUME_SETUP_PATH,
  resolveExistingBeanpod,
} from '@/services/sync/connectStorage';
import type { RedirectMode } from '@/services/google/redirectState';
import { markFamilyJustCreated } from '@/utils/newFamilyFlag';
import { features } from '@/config/features';
import { downloadAsFile } from '@/services/sync/fileSync';
import * as registry from '@/services/registry/registryService';
import type { RegistryEntry } from '@/types/models';
import * as syncService from '@/services/sync/syncService';
import { GoogleDriveProvider } from '@/services/sync/providers/googleDriveProvider';
import { LocalStorageProvider } from '@/services/sync/providers/localProvider';
import {
  initializeAuth,
  requestAccessToken,
  onTokenPermanentlyExpired,
  onTokenAcquired,
  fetchGoogleUserEmail,
  isSilentRefreshPending,
  isTokenValid,
  isUserCancellation,
  whenRedirectAuthSettled,
} from '@/services/google/googleAuth';
import {
  registerDriveTokenMirror,
  reconcileDriveTokenWithDoc,
} from '@/services/google/driveTokenRecovery';
import { buildSilentRefreshAlertContext } from '@/services/google/silentRefreshAlertContext';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { slackNotify } from '@/utils/slackNotify';
import type { SaveFailureLevel } from '@/services/sync/syncService';
import {
  searchBeanpodFilesGlobal,
  clearFolderCache,
  getAppFolderId,
  getFileMetadata,
  DriveApiError,
} from '@/services/google/driveService';
import { clearQueue } from '@/services/sync/offlineQueue';
import {
  createBeanpodV4,
  parseBeanpodV4,
  tryUnwrapFamilyKey,
  reEncryptEnvelope,
  detectFileVersion,
} from '@/services/sync/fileSync';
import { preserveLocalKeyDicts } from '@/services/sync/envelopeMerge';
import {
  generateFamilyKey,
  deriveMemberKey,
  wrapFamilyKey,
} from '@/services/crypto/familyKeyService';
import * as docClient from '@/services/automerge/worker/docClient';
import { bufferToBase64 } from '@/utils/encoding';
import type { BeanpodFileV4, WrappedMemberKey } from '@/types/syncFileV4';
import type { StorageProvider, StorageProviderType } from '@/services/sync/storageProvider';
import { toISODateString } from '@/utils/date';
import { raceTimeout } from '@/utils/timing';
import { measureAsync } from '@/utils/perfTiming';
import { deduplicateRecurringTransactions } from '@/services/recurring/recurringProcessor';
import {
  type CreatePodResult,
  type CreatePodFailureReason,
  type CriticalWriteState,
  type ResumeFromRegistryResult,
  type CompleteAutoLoadResult,
  CorruptPayloadError,
  FileNameCollisionError,
  CollisionCheckUnavailableError,
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

export const useSyncStore = defineStore('sync', () => {
  // State
  const isInitialized = ref(false);
  const isConfigured = ref(false);
  // Silent-config-heal state (self-healing provider restore after IDB eviction).
  // `reconnecting` drives the Settings "reconnecting…" card + suppresses the
  // recovery overlay while a background heal is in flight; `configHealFailed`
  // flips true only on TOTAL failure (retries exhausted / no Drive home in the
  // registry), which surfaces the reconnect affordance. Both are reset in
  // `resetState`. See docs/plans/2026-07-15-native-data-connection-resilience.md.
  const reconnecting = ref(false);
  const configHealFailed = ref(false);
  const fileName = ref<string | null>(null);
  const isSyncing = ref(false);
  const error = ref<string | null>(null);
  const lastSync = ref<string | null>(null);
  const needsPermission = ref(false);
  const isMigratingStorage = ref(false);

  // Family key state — the unwrapped AES-GCM key for the active .beanpod envelope
  const familyKey = shallowRef<CryptoKey | null>(null);
  const envelope = shallowRef<BeanpodFileV4 | null>(null);

  // ─── Envelope replacement invariant ───────────────────────────────────
  // ALL non-additive writes to `envelope.value` MUST go through
  // `replaceEnvelope` or `clearEnvelope`. Direct `envelope.value = X`
  // assignments are an anti-pattern: they bypass the local-wins merge
  // in `preserveLocalKeyDicts` and silently drop any wrappedKeys /
  // inviteKeys / passkeyWrappedKeys the user just rotated locally —
  // the root cause of the welcome-gate sign-in divergence bug.
  //
  // Additive writes (envelope.wrappedKeys[id] = X done via spread inside
  // addMemberWrappedKey / addInvitePackage / addPasskeySecret) are safe
  // because they preserve all existing entries by construction.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Install a fetched envelope as the in-memory envelope, preserving any
   * local-only key entries (wrappedKeys / inviteKeys / passkeyWrappedKeys)
   * the fetched envelope doesn't have yet — e.g. a wrappedKey added in this
   * session but not yet pushed to Drive. Returns the merged envelope so
   * callers can pass the same reference onward.
   */
  function replaceEnvelope(incoming: BeanpodFileV4): BeanpodFileV4 {
    const merged = preserveLocalKeyDicts(incoming, envelope.value);
    envelope.value = merged;
    syncService.setEnvelope(merged);
    return merged;
  }

  /** Null the envelope on sign-out / disconnect. */
  function clearEnvelope(): void {
    envelope.value = null;
    syncService.setEnvelope(null);
  }

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

  // True while the create flow's terminal add-members step is on screen. The
  // pod is already written (podCreated=true) at this point, so the router's
  // ALREADY_AUTH guard would otherwise redirect /welcome?resume=setup → /nook
  // and skip add-members on iOS. A dedicated flag (NOT a criticalWriteState
  // variant — that would block ALL navigation) checked only in that guard. Set
  // when finalizePod advances to the members phase; cleared on completion and
  // on unmount. See ResumePodSetup + router/index.ts.
  const membersStepActive = ref(false);

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
  // Set SYNCHRONOUSLY the moment a cold-start reconnect escalation is scheduled (the
  // banner itself is on a ~4s defer to let wake events recover first). The post-init
  // health check reads this immediately, so an auth-masked cold-start 404 doesn't
  // false-fire the "your data is missing" recovery overlay + a critical page during
  // the defer window. Cleared when the banner shows, the token recovers, or on reset.
  const reconnectEscalationPending = ref(false);
  // Raised by a DEFERRED config-heal (post-init retry / Settings reconnect) when the
  // pod was re-homed but the family key was evicted too (needsPassword, no doc). App.vue
  // watches this and routes to the resume-setup password recovery — the store never
  // imports the router (MVO + avoids a build-breaking syncStore↔router lazy-page cycle).
  const needsResumeSetupNav = ref(false);
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

  // Silent-config-heal retry (Layer 2). Bounded budget is the terminus — the
  // single-shot `configHealDefer` has no counter of its own. Re-armed on a
  // transient failure and poked by a dedicated `onTokenAcquired` subscriber
  // (`configHealTokenUnsub`) so a token that lands mid-retry unblocks the
  // Drive re-derivation. All of this is torn down in `resetState`.
  const CONFIG_HEAL_RETRY_BUDGET = 4;
  const CONFIG_HEAL_DEFER_MS = 4000;
  const configHealDefer = createDeferredAction(CONFIG_HEAL_DEFER_MS);
  let configHealAttempts = 0;
  let configHealInFlight = false;
  let configHealTotalFailureReported = false;
  let configHealTokenUnsub: (() => void) | null = null;

  function showBannerWithTelemetry(deferred: boolean): void {
    showSaveFailureBanner.value = true;
    reportError({
      surface: 'save-failure-banner',
      // The save-failure banner is surfaced to the user — their data isn't
      // saving (data at risk). Already debounced/escalated, so paging here is signal.
      severity: 'critical',
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
      return;
    }

    // Not restored — `syncService.initialize()` found no provider config in
    // IndexedDB OR the localStorage mirror (getProviderConfig reads both). If this
    // is an ESTABLISHED Drive-backed pod (`podCreated`), self-heal from the durable
    // remote registry instead of dropping the owner onto the unconfigured card.
    // The first attempt is awaited inline so a healthy heal completes before
    // App.vue's load pipeline runs; a transient failure re-arms silently (Layer 2).
    const ctx = useFamilyContextStore();
    const familyId = ctx.activeFamilyId;
    if (familyId && useAuthStore().podCreated) {
      // boot=true: App.vue's path-1b load runs right after this returns and owns the
      // load + resume-setup navigation, so the heal must not also load (double-fetch).
      await attemptSilentConfigHeal(familyId, true);
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
   * Shared by `configureSyncFileGoogleDrive` and `migrateStorage` — keeps
   * the "install this provider" sequence in one place.
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

  /** Bounded post-auth save: `syncNow(true)` raced against a timeout so a slow/offline
   * Drive push can't wedge a login/rotation spinner. Returns true if it synced within
   * the bound; false (deferred) on timeout — the push rides the next auto-sync. The
   * single home for the `raceTimeout(syncNow(true), …)` pattern (was duplicated across
   * the login-completion sites + password rotation). */
  const POST_AUTH_SAVE_TIMEOUT_MS = 5000;
  /** Longer bound for the DURABLE password-rotation save: the user is shown a
   * "saving your new password…" spinner while this blocks, and on not-saved the
   * rotation fully rolls back (see authStore.rotateMemberPassword). Bigger than
   * the best-effort post-auth bound because here we are trading spinner time for
   * a hard durability guarantee, not merely avoiding a wedge. */
  const DURABLE_ROTATION_SAVE_TIMEOUT_MS = 12000;
  async function syncNowBounded(timeoutMs = POST_AUTH_SAVE_TIMEOUT_MS): Promise<boolean> {
    return !!(await raceTimeout(syncNow(true), timeoutMs));
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
    remoteEnvelope: BeanpodFileV4,
    familyId: string
  ): Promise<void> {
    // Load THIS family's cache as the worker's doc, then CRDT-merge the remote in.
    // Merge is commutative, so cache∪remote == the old replace(remote)+merge(cache).
    //
    // CRITICAL (cross-family safety): only merge into a doc that belongs to THIS
    // family. On a cache MISS (or corrupt cache), `initAndLoadCache` returns
    // `{loaded:false}` and leaves whatever `currentDoc` the worker was holding —
    // which, if the previous family wasn't torn down (e.g. a trusted-device
    // sign-out that keeps the cache), is a DIFFERENT family's doc. Merging the
    // remote into it produces an A∪B doc that then gets persisted to B's cache and
    // uploaded to B's file — durable cross-family corruption. So on anything other
    // than a genuine cache hit, drop the doc first → `mergeRemoteEnvelope` takes
    // its `!currentDoc` full-adopt branch and installs a clean B. See the
    // cross-family teardown in `authStore.signOut` (defence-in-depth).
    let loadedFromCache = false;
    try {
      const cacheResult = await docClient.initAndLoadCache(familyId);
      loadedFromCache = cacheResult?.loaded === true; // only a genuine HIT authorises a merge
    } catch (e) {
      console.warn('[syncStore] Cache recovery failed — proceeding with remote only:', e);
    }
    if (!loadedFromCache) await docClient.dropDoc(); // no doc for THIS family → adopt remote fresh, never merge into a foreign doc
    const { dirty } = await docClient.mergeRemoteEnvelope(remoteEnvelope, familyId);
    // Clean up duplicate recurring transactions from the CRDT merge.
    await deduplicateRecurringTransactions();
    // Re-upload the converged doc only if local carried unsynced changes.
    if (dirty) syncService.triggerDebouncedSave();
  }

  /**
   * Shared background-recovery hydrate (both background-sync paths use it so they
   * can't drift): post the existing key, worker-decrypt + CRDT-merge the pending
   * envelope, adopt the envelope, refresh stores, dedup, and re-upload only if the
   * merge left local unsynced changes (heads-derived `dirty`). Clears the pending
   * file. The caller does its own setupAutoSync/return.
   */
  async function hydrateFromEnvelope(env: BeanpodFileV4): Promise<void> {
    await docClient.setFamilyKey(familyKey.value!);
    const { dirty } = await docClient.mergeRemoteEnvelope(env, env.familyId);
    const merged = replaceEnvelope(env);
    syncService.setFamilyKey(familyKey.value!, merged);
    pendingEncryptedFile.value = null;
    await reloadAllStores();
    const dupsRemoved = await deduplicateRecurringTransactions();
    if (dupsRemoved > 0) await reloadAllStores();
    if (dirty) syncService.triggerDebouncedSave();
  }

  /**
   * Load data from the currently configured sync file.
   * For V4 files: parses envelope, tries to unlock with cached FK or password.
   * @param options.merge - If true, CRDT merge remote doc with local doc.
   */
  async function loadFromFile(options: { merge?: boolean } = {}): Promise<{
    success: boolean;
    needsPassword?: boolean;
    reason?: 'auth' | 'not-found' | 'error';
  }> {
    const merging = !!options.merge;

    // The single read chokepoint for the login flow (single-family auto-select +
    // FamilyPicker). On the post-consent redirect return the Google token may still
    // be mid-exchange; settle it (shared, once) before the first Drive read so a
    // "token still settling" transient isn't misread as a hard load failure. No-op
    // once settled / on native. See docs/plans/2026-07-07-ios-redirect-auth-race.md.
    await whenRedirectAuthSettled();

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
            // A Drive 404/403 means "not accessible to THIS caller" — an
            // expired/unauthenticated token yields the SAME 404 as a genuinely
            // missing file (Google masks permission-denied as not-found,
            // driveService.ts). When our token is invalid this is
            // auth-masked-as-404: surface the reconnect banner and return
            // 'auth', never the alarming `driveFileNotFound` "your data is
            // missing" state. Only flag a true missing file when the token IS
            // valid — self-correcting, since after reconnect a genuinely-gone
            // file 404s again WITH a valid token and is then flagged not-found.
            // (Root-caused 2026-07-15: a wife's long-idle iPhone lost its
            // refresh token, so a cold-load 404 showed the data-loss overlay.)
            if (!isTokenValid()) {
              scheduleColdStartReconnectEscalation(lastError);
              return { success: false, reason: 'auth' };
            }
            driveFileNotFound.value = true;
            showSaveFailureBanner.value = true;
            stopFilePolling();
          }
          return { success: false, reason: 'not-found' };
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
        // Classify the failure so the sign-in flow (LoginPage.handleFamilySelected)
        // can offer a focused reconnect for an expired/absent token instead of the
        // generic provider+file picker. `isAuthTransientSyncError` is the single
        // matcher for the TokenExpiredError "silent refresh failed" message shape.
        return {
          success: false,
          reason: isAuthTransientSyncError(lastError) ? 'auth' : 'error',
        };
      }

      const version = detectFileVersion(text);
      if (version !== '4.0') {
        error.value = `Unsupported file version: ${version ?? 'unknown'}`;
        return { success: false };
      }

      const remoteEnvelope = parseBeanpodV4(text);

      // If we already have a family key, the worker decrypts + merges/adopts.
      if (familyKey.value) {
        try {
          if (merging) {
            // CRDT merge remote into the worker's doc.
            await docClient.mergeRemoteEnvelope(remoteEnvelope, remoteEnvelope.familyId);
          } else {
            // Replace: adopt remote (+ recover any unsynced cache) to prevent loss.
            const famId = useFamilyContextStore().activeFamilyId;
            if (famId) {
              await replaceDocWithCacheRecovery(remoteEnvelope, famId);
            } else {
              await docClient.dropDoc(); // no cache to recover — adopt remote fresh
              await docClient.mergeRemoteEnvelope(remoteEnvelope, remoteEnvelope.familyId);
            }
          }

          // Update envelope and ensure syncService has the family key.
          // `replaceEnvelope` merges in local-only key entries (rotate-key
          // writes that may not be on the fetched envelope yet) — see the
          // envelope-replacement invariant near the top of this file.
          const merged = replaceEnvelope(remoteEnvelope);
          syncService.setFamilyKey(familyKey.value!, merged);

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
            await reconcileDriveTokenForMember();
          }

          setupAutoSync();
          // A real pod was decrypted and loaded — establish the podCreated
          // invariant (see markPodCreated's contract doc-comment in authStore).
          useAuthStore().markPodCreated();
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

      // Post the just-unwrapped key to the worker so it can decrypt + merge.
      await docClient.setFamilyKey(fk);

      // Adopt the payload (+ recover any unsynced cache) to prevent data loss.
      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      if (famId) {
        await replaceDocWithCacheRecovery(pending.envelope, famId);
      } else {
        await docClient.dropDoc();
        await docClient.mergeRemoteEnvelope(pending.envelope, pending.envelope.familyId);
      }

      // Set the family key and envelope. `replaceEnvelope` is the safe path
      // (merges any local-only entries); at this point `envelope.value` is
      // typically null (fresh decrypt), so the merge is a no-op — but using
      // the uniform pattern keeps the invariant grep-checkable.
      familyKey.value = fk;
      const mergedEnvelope = replaceEnvelope(pending.envelope);
      syncService.setFamilyKey(fk, mergedEnvelope);

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

      // Bind Google Auth to this family. initializeAuth now performs the
      // guarded pending→family migration itself (single source of truth), so
      // no separate migratePendingRefreshToken call is needed here.
      if (activeFamilyId && pending.driveFileId) {
        await initializeAuth(activeFamilyId);
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

      // The worker owns the cache: replaceDocWithCacheRecovery already opened the
      // cache DB + persisted the merged doc, and setFamilyKey seeded the envelope
      // cache — no main-thread persist needed here.

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
  /**
   * Best-effort (B): reconcile the bound member's Drive refresh token between
   * the local store and the encrypted beanpod, newer-`issuedAt` wins. Called
   * AFTER `reloadAllStores()` so `currentMember.googleAccountEmail` is resolvable.
   * Self-gates (no bound Drive account / no doc / no token → no-op) and never
   * throws into the load path. See `driveTokenRecovery`.
   */
  async function reconcileDriveTokenForMember(): Promise<void> {
    try {
      const email = useFamilyStore().currentMember?.googleAccountEmail;
      await reconcileDriveTokenWithDoc(email);
    } catch (e) {
      console.warn('[syncStore] Drive token reconcile skipped:', e);
    }
  }

  async function loadFromPersistenceCache(
    keyB64: string,
    activeFamilyId: string,
    options?: { preservePermissionState?: boolean }
  ): Promise<{ success: boolean }> {
    try {
      // Import family key directly from base64 (not password-derived), post it to
      // the worker, then open the cache DB + load the cached doc + envelope.
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(keyB64)));
      await docClient.setFamilyKey(fk);

      const { loaded } = await docClient.initAndLoadCache(activeFamilyId);
      const { envelope: cachedEnvelope } = await docClient.readEnvelope();
      if (!cachedEnvelope || !loaded) return { success: false };

      // Set up state. `replaceEnvelope` is the uniform entry point even
      // for cache loads where `envelope.value` is typically null and the
      // merge is a no-op.
      familyKey.value = fk;
      const cachedMerged = replaceEnvelope(cachedEnvelope);
      syncService.setFamilyKey(fk, cachedMerged);
      if (!options?.preservePermissionState) {
        isConfigured.value = true; // Data is loaded — show configured UI
        needsPermission.value = true; // Still need file permission for future saves
      }
      lastSync.value = toISODateString(new Date());

      await reloadAllStores();
      await reconcileDriveTokenForMember();
      // A real pod was loaded from cache — establish the podCreated invariant
      // (covers both the normal and preservePermissionState branches above).
      useAuthStore().markPodCreated();
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
    // Worker decrypts + materialize-checks (current family key == fk, set during
    // create). Throws CorruptPayloadError on bad payload; caller classifies.
    void fk;
    await docClient.verifyEnvelope(env, { quiet: true });
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
      beanpodSizeKb: currentBeanpodSizeKb(),
      isLoginEvent: true, // pod creation is the family's first login
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
    clearEnvelope();
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

    // Fail-closed: the unified create flow builds the owner with the empty
    // `DEFERRED_PASSWORD_HASH` sentinel at step 1 and applies the real hash via
    // `rehydrateOwnerDoc` on the finish surface BEFORE this runs. If the owner
    // still carries the sentinel, the password step was skipped — writing the
    // pod would mint an envelope whose owner can never authenticate. Refuse the
    // write (structurally impossible to ship a deferred-hash pod) and report it
    // loudly. References the SAME constant as `signUp`'s deferred branch.
    if (ownerMember.passwordHash === DEFERRED_PASSWORD_HASH) {
      const err = new Error(
        `createNewFile refused: owner member ${memberId} still carries the deferred-password sentinel (rehydrateOwnerDoc was not called before the write)`
      );
      reportError({
        surface: 'syncStore.deferredHashLeak',
        message: err.message,
        error: err,
        severity: 'critical',
      });
      return { ok: false, reason: 'precondition', error: err };
    }

    // Existing-pod guard (belt-and-braces above the Drive-only name-collision
    // check; also covers the local-file path). If the registry already holds a
    // `fileId` for this family, a real pod exists — creating would orphan it.
    // Scoped to `entry?.fileId` (NOT entry presence) so a genuinely-new family
    // (registered only later, at the `register` step below) is never blocked.
    // `lookupFamily` already returns null on any error / when the registry is
    // off, so this try/catch is defence-in-depth: a lookup failure must NOT
    // block a legitimate create — log and proceed (write/verify/register still
    // guard true collisions).
    try {
      const existing = await registry.lookupFamily(familyId);
      if (existing?.fileId) {
        return {
          ok: false,
          reason: 'existing-pod',
          error: new Error(
            `createNewFile refused: registry already has a pod for family ${familyId} (fileId present)`
          ),
        };
      }
    } catch (e) {
      console.warn('[syncStore] createNewFile existing-pod lookup failed; proceeding:', e);
      reportError({
        surface: 'syncStore.createNewFile.lookupFailed',
        message: `existing-pod lookup failed before create (proceeding): ${(e as Error).message}`,
        error: e,
        severity: 'warning',
      });
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
      // Note: the Automerge doc was initialized by `authStore.signUp()` (now in
      // the worker) before this function was called. We deliberately do NOT
      // re-init here — that would wipe the owner-member writes already in the doc.
      // Post the key to the worker, then have it encrypt the doc → payload; main
      // assembles the envelope (keys never leave main).
      await docClient.setFamilyKey(fk);
      const { payload } = await docClient.exportEncryptedPayload();
      const envelopeJson = createBeanpodV4(familyId, familyName, payload, wrappedKeys);

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
      // Capture size for the registry usage signal. This create write bypasses
      // syncService.doSave, so record it here — before step 'register' below —
      // so the create-path registration carries a real beanpodSizeKb, not null.
      syncService.recordPersistedBytes(envelopeJson);
      partialFileId = provider.getFileId() ?? null;

      // 3. Verify the bytes we just wrote round-trip cleanly. Throws
      //    `CorruptPayloadError` (or generic Error for non-payload issues).
      step = 'verify';
      await verifyJustWritten(provider, fk, familyId);

      // 4. Commit in-memory state — we know the write is good. `replaceEnvelope`
      // is the uniform entry point; at this point `envelope.value` is null
      // (fresh pod creation), so the merge is a no-op.
      const env = parseBeanpodV4(envelopeJson);
      familyKey.value = fk;
      const mergedNew = replaceEnvelope(env);
      syncService.setFamilyKey(fk, mergedNew);

      // 5. Persist local cache (awaited so a cache failure surfaces as a real
      //    error before `markPodCreated`). The worker owns the cache: open the
      //    DB, flush the current doc, and persist the envelope.
      step = 'persist';
      // OPEN the cache DB without loading — the fresh owner doc is already
      // installed + verified. `initAndLoadCache` would LOAD any pre-existing cache
      // row (a prior/interrupted create for this familyId) OVER the owner doc,
      // then `flush()` would persist the stale doc + Drive-upload it over the good
      // file just written → data loss (ADR-032 F1).
      await docClient.openCache(familyId);
      await docClient.flush(); // persist the current doc to cache now
      await docClient.persistEnvelope(env);

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
      // Brand-new family: flag it so the notifications watcher seeds the
      // what's-new read-state and DOESN'T pop a spotlight drawer for a user
      // who never not-had those features (2026-06-19). Decoupled one-shot flag
      // (no notificationsStore import here); consumed once in useNotifications.
      markFamilyJustCreated();
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
    clearEnvelope();
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
      // Post the key to the worker so it can decrypt + merge/adopt.
      await docClient.setFamilyKey(fk);

      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      if (famId) {
        await replaceDocWithCacheRecovery(pending.envelope, famId);
      } else {
        await docClient.dropDoc();
        await docClient.mergeRemoteEnvelope(pending.envelope, pending.envelope.familyId);
      }

      familyKey.value = fk;
      const decryptedMerged = replaceEnvelope(pending.envelope);
      syncService.setFamilyKey(fk, decryptedMerged);
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

      // Bind Google Auth to this family. initializeAuth now performs the
      // guarded pending→family migration itself (single source of truth), so
      // no separate migratePendingRefreshToken call is needed here.
      if (activeFamilyId && pending.driveFileId) {
        await initializeAuth(activeFamilyId);
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

      // The worker owns the cache (opened + persisted by replaceDocWithCacheRecovery;
      // envelope cache seeded by setFamilyKey) — no main-thread persist needed.

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

      // A real pod was decrypted (the invite/join cached-key path) — establish
      // the podCreated invariant so a joinee is never routed to create recovery.
      useAuthStore().markPodCreated();
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
   * Set (or remove) a member's wrapped-key envelope entry, then persist.
   * Passing `entry` assigns it; passing `undefined` DELETES the member's entry
   * — the transactional-rotation rollback (authStore.rotateMemberPassword) uses
   * the delete form to restore a member who had NO prior entry (first-time
   * password set), which must remove the entry rather than leave the new one.
   * The single write path for member wrapped keys (add + remove both persist
   * via the same setEnvelope RPC, keeping the worker cache in sync).
   */
  async function setMemberWrappedKey(
    memberId: string,
    entry: { wrapped: string; salt: string } | undefined
  ): Promise<void> {
    if (!envelope.value) throw new Error('No envelope loaded');
    const env = { ...envelope.value };
    const wrappedKeys = { ...env.wrappedKeys };
    if (entry) {
      wrappedKeys[memberId] = { wrapped: entry.wrapped, salt: entry.salt };
    } else {
      delete wrappedKeys[memberId];
    }
    env.wrappedKeys = wrappedKeys;
    envelope.value = env;
    syncService.setEnvelope(env); // also RPCs the worker to persist the envelope cache
  }

  /**
   * Add a wrapped key entry to the envelope for a new member (joinFamily flow).
   * Delegates to `setMemberWrappedKey` (one write path, DRY).
   */
  async function addMemberWrappedKey(
    memberId: string,
    wrappedKey: { wrapped: string; salt: string }
  ): Promise<void> {
    await setMemberWrappedKey(memberId, wrappedKey);
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
    syncService.setEnvelope(env); // also RPCs the worker to persist the envelope cache

    console.warn(
      '[syncStore] addInvitePackage: added key',
      tokenHash.slice(0, 8) + '...',
      'inviteKeys count:',
      Object.keys(env.inviteKeys).length
    );

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
    clearEnvelope();
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
    // The worker encrypts the current doc → payload; main assembles the envelope.
    const { payload } = await docClient.exportEncryptedPayload();
    const envelopeJson = reEncryptEnvelope(envelope.value, payload);
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
      const listStore = useListStore();
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

      // Timed: the full ~21-store re-projection out of Automerge, re-run after
      // every merge. `Promise.all` gives no real parallelism here (it's all
      // synchronous WASM materialization on one thread), so its wall-clock is
      // effectively main-thread-blocking time.
      await measureAsync('stores.reloadAll', () =>
        Promise.all([
          familyStoreInst.loadMembers(),
          accountsStore.loadAccounts(),
          transactionsStore.loadTransactions(),
          assetsStore.loadAssets(),
          goalsStore.loadGoals(),
          settingsStore.loadSettings(),
          recurringStore.loadRecurringItems(),
          todoStore.loadTodos(),
          listStore.loadLists(),
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
        ])
      );

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
    // Synchronous signal for the post-init health check (suppresses the false
    // data-loss overlay/page during the defer window). Cleared when the defer
    // resolves (below) or the token recovers (onTokenAcquired).
    reconnectEscalationPending.value = true;
    coldStartReconnectDefer.schedule(() => {
      reconnectEscalationPending.value = false;
      if (isTokenValid()) return; // recovered via wake event; nothing to do
      if (showGoogleReconnect.value) return; // raced with the auth-layer escalation
      showGoogleReconnect.value = true;

      // Diagnostic context for the silent-refresh failure mode. Added
      // 2026-05-14 to disambiguate iOS PWA wake-race vs Lambda cold start vs
      // token revocation vs other transient causes. Builder is shared with
      // the `offline-queue-flush` surface (2026-05-20) — DRY single source.
      // Carries `refresh_token_age_ms` on the revocation path: a consistent
      // ~7d age implies an expiry clock, scattered ages imply Google's
      // per-client refresh-token cap evicting oldest-first.
      const ctx = buildSilentRefreshAlertContext();

      // Suppress ONLY the genuinely by-design case: a user who has never
      // connected Drive has no token to refresh, the banner is the designed
      // UX response, and there is nothing to investigate.
      //
      // Do NOT key this on `hadRefreshToken === false`. That flag cannot tell
      // the by-design case apart from a revocation: `performSilentRefresh`'s
      // permanent branch CLEARS the stored token, so every refresh after the
      // first one this session takes the `!currentRefreshToken` early return
      // and also reports `hadRefreshToken: false`. Keying on it suppressed a
      // week of real `invalid_grant` revocations (2026-07-09) — the cold-start
      // surface stayed silent while only `offline-queue-flush` paged, biasing
      // the sample and misdirecting two sessions of investigation.
      //
      // `error_code` carries the disambiguated reason (see SilentRefreshReason).
      if (ctx.error_code === 'silent-refresh:no-token-stored') {
        console.warn(
          '[syncStore] cold-start reconnect: no stored refresh token, banner shown ' +
            '(no auto-recovery possible; user must reconnect). ' +
            `lastError: ${lastErr ?? 'unknown'}, visibility: ${ctx.visibility_state}`
        );
        return;
      }

      reportError({
        surface: 'cold-start-reconnect-escalation',
        // Cold-start data load is stuck and the user must reconnect — they can't
        // reach their data. Already deferred past the recovery window, so fatal.
        severity: 'critical',
        message:
          'Cold-start data load stuck on auth-transient (silent refresh failed); ' +
          `banner surfaced after ${COLD_START_RECONNECT_DEFER_MS}ms defer window. ` +
          `lastError: ${lastErr ?? 'unknown'}`,
        // The Slack renderer JSON-stringifies non-primitive context values at
        // display time. `redactContext` passes them through unchanged.
        context: ctx as unknown as Record<string, unknown>,
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
            await hydrateFromEnvelope(pendingEncryptedFile.value.envelope);
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
              await hydrateFromEnvelope(pendingEncryptedFile.value.envelope);
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
        // Auth-masked-as-404 on the background poll: an expired token yields the
        // same 404 as a missing file. Only flag `driveFileNotFound` when the
        // token is genuinely valid; an auth-transient is owned by the
        // reconnect/expiry path, not the "your file is missing" banner. Mirrors
        // the loadFromFile 404 guard above.
        if (isTokenValid()) {
          driveFileNotFound.value = true;
          showSaveFailureBanner.value = true;
          stopFilePolling();
        }
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
    reconnectEscalationPending.value = false;
    needsResumeSetupNav.value = false;
    // Silent-config-heal teardown — cancel the retry timer, drop its dedicated
    // token subscriber, reset the budget/flags + the once-per-family total-failure
    // guard so a different family can heal (and page) cleanly on next sign-in.
    configHealDefer.cancel();
    if (configHealTokenUnsub) {
      configHealTokenUnsub();
      configHealTokenUnsub = null;
    }
    configHealAttempts = 0;
    configHealInFlight = false;
    configHealTotalFailureReported = false;
    reconnecting.value = false;
    configHealFailed.value = false;
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
    clearEnvelope();
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

  /** Mint a brand-new app-owned `.beanpod` on the signed-in account's Drive and
   * install it as the home. B6: `forceConsent:false` so a valid cached token is
   * REUSED (never a full-page OAuth redirect mid-restore). Throws on failure
   * (createNew's collision/error, or the installProvider write) — callers map the
   * throw to an outcome; `configureSyncFileGoogleDrive` wraps it as a boolean. */
  async function mintFreshOwnDrive(uniqueName: string): Promise<void> {
    const provider = await GoogleDriveProvider.createNew(uniqueName, { forceConsent: false });
    await installProvider(provider, 'google_drive');
  }

  /** Thin boolean wrapper over `mintFreshOwnDrive` — the shared install sequence
   * (persist → setProvider → syncNow → saveSettings → registerFamily). Retained as
   * the seam the migrate test exercises; B6 `forceConsent:false` flows through. */
  async function configureSyncFileGoogleDrive(podFileName: string): Promise<boolean> {
    try {
      await mintFreshOwnDrive(podFileName);
      return true;
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    }
  }

  /** Outcome of `reHomeToOwnDrive` — the caller owns the outcome→telemetry mapping. */
  type ReHomeOutcome =
    | { action: 're-homed' } // minted a fresh own-account file (or a distinct one on foreign collision)
    | { action: 'adopted-existing' } // adopted the caller's OWN same-named file (no split-brain)
    | { action: 'collision-check-unavailable' } // couldn't verify the collision — retryable, do NOT guess
    | { action: 'failed' }; // create/install failed for another reason — fall through to native/critical

  /** B4/B6: re-home the just-loaded doc onto the signed-in account's OWN Drive.
   * Happy path mints a fresh app-owned file; on a same-name collision it ADOPTS the
   * existing OWNED file (never a divergent local split-brain) or mints a distinct
   * familyId-namespaced name when the colliding file is foreign. One try / one typed
   * catch / one flat dispatch. NOT strictly total by design: an `installProvider`
   * write-failure inside an adopt/reject arm PROPAGATES OUT (rather than a tag) to the
   * caller's own try/catch → its loud `critical` no-durable-save-target report. */
  async function reHomeToOwnDrive(name: string): Promise<ReHomeOutcome> {
    try {
      await mintFreshOwnDrive(name);
      return { action: 're-homed' };
    } catch (e) {
      if (e instanceof FileNameCollisionError) {
        const res = await resolveExistingBeanpod({
          fileId: e.existingFileId,
          ownedByCurrentAccount: e.ownedByCurrentAccount,
        });
        if (res.kind === 'adopt-stub' || res.kind === 'adopt-existing') {
          // Our OWN same-named file — adopt it (installProvider re-persists the config,
          // overwriting the foreign one decrypt installed, and flushes the loaded doc).
          await installProvider(GoogleDriveProvider.fromExisting(res.fileId, name), 'google_drive');
          return { action: 'adopted-existing' };
        }
        // reject-different-account: the same-named file is foreign → mint a DISTINCT,
        // familyId-namespaced own file (matches B3). Never write into a file we don't own.
        const ctx = useFamilyContextStore();
        const suffix = ctx.activeFamilyId ? `-${ctx.activeFamilyId}` : '';
        const base = name.replace(/\.beanpod$/, '');
        await mintFreshOwnDrive(`${base}${suffix}.beanpod`);
        return { action: 're-homed' };
      }
      if (e instanceof CollisionCheckUnavailableError) {
        return { action: 'collision-check-unavailable' }; // retryable — never guess a home
      }
      return { action: 'failed' };
    }
  }

  /**
   * Ensure a just-loaded (cross-account / restored-backup) family has a durable,
   * writable save target. Called ONCE by `LoadPodView` after a successful decrypt
   * from the "Load a saved family file" aside (#47).
   *
   * The web-Picker and web-FSA load paths already install a provider inside
   * `decryptPendingFile` (a Drive provider from `driveFileId`, or a writable
   * `LocalStorageProvider` handle). The native `<input type=file>` fallback
   * (`openAndLoadFileFallback`) does NOT — it stages an envelope with no provider
   * and no handle — so without this the adopted family would have no writable home
   * (a read-only dead-end, the exact concern the old `supportsFileSystemAccess()`
   * gate was protecting against).
   *
   * Idempotent: a no-op when a provider is already installed FOR THE JUST-LOADED
   * FAMILY (the common Picker/FSA case). The family-scoped check (not a bare
   * non-null) guards against a stale provider from a previously-active family
   * causing a wrong skip. Otherwise it establishes a durable home in precedence:
   *   1. Drive available + valid token -> re-home to the signed-in account's own
   *      Drive (a fresh app-owned `.beanpod`) via `configureSyncFileGoogleDrive`.
   *   2. Native -> a `CapacitorFileProvider` app-managed file, then a forced write.
   *   3. Neither -> leave the load successful but provider-less and page loudly
   *      (data-at-risk); the existing `SaveFailureBanner` guides recovery. Never
   *      silent.
   *
   * Deliberately NOT reusing `createNewFile` — its brand-new-family preconditions
   * (owner-member presence, deferred-password sentinel refusal, and a refusal when
   * the registry already holds a pod for the familyId) all misfire for an
   * already-adopted, just-loaded family.
   */
  async function establishDurableHomeAfterLoad(): Promise<void> {
    const ctx = useFamilyContextStore();
    const activeFamilyId = ctx.activeFamilyId;
    const podBaseName = (ctx.activeFamilyName ?? 'my-family').trim() || 'my-family';

    // ─── Guard (B5): is the installed provider already OUR OWN durable home for
    // this family, or a foreign/absent one we must re-home? A bare "provider is for
    // this family" check is NOT enough — a Picker-load installs
    // `fromExisting(pickedFileId)` unconditionally (so `providerFamilyId` matches even
    // for a file owned by ANOTHER account). We derive ownership at this one decision
    // point from the authoritative source (Drive), off the installed provider — never
    // captured/threaded (a threaded snapshot re-introduces the stale-cross-family bug
    // this guard exists to kill). `useJoinFlow` never reaches this function, so the
    // inviter's shared file stays installed there. ───
    const provider = syncService.getProvider();
    if (provider && syncService.getProviderFamilyId() === activeFamilyId) {
      const providerType = syncService.getProviderType();
      if (providerType !== 'google_drive') {
        // A local FSA / native provider WE installed for this family → genuine own home.
        logEvent({
          level: 'info',
          surface: 'load-existing-family',
          message: 'kept own local home',
          context: { action: 'kept-own-home', provider_type: providerType ?? undefined },
        });
        return;
      }
      // Drive provider for this family — verify it's OURS before keeping it.
      const fileId = provider.getFileId();
      if (fileId && isTokenValid()) {
        try {
          const token = await requestAccessToken(); // silent (token already valid here)
          const meta = await getFileMetadata(token, fileId, 'ownedByMe');
          if (meta.ownedByMe === true) {
            logEvent({
              level: 'info',
              surface: 'load-existing-family',
              message: 'kept own Drive home',
              context: { action: 'kept-own-home', provider_type: 'google_drive' },
            });
            return;
          }
          // Owned by another account → re-home (never keep writing cross-account).
          logEvent({
            level: 'warn',
            surface: 'load-existing-family',
            message: 'loaded a Drive file owned by another account — re-homing to own Drive',
            context: { action: 'foreign-file-load', provider_type: 'google_drive' },
          });
        } catch (e) {
          // Ownership unknown → conservative re-home (never assume ours). WARNING (not
          // info) so the rare same-account transient-blip residual is countable.
          console.warn(
            '[syncStore.establishDurableHomeAfterLoad] Drive ownership check failed — re-homing conservatively:',
            e
          );
          logEvent({
            level: 'warn',
            surface: 'load-existing-family',
            message: 'could not verify Drive file ownership — re-homing conservatively',
            context: { action: 'ownership-unknown', provider_type: 'google_drive' },
            error: e,
          });
        }
        // fall through to re-home
      } else {
        // No fileId or no valid token to verify → unknown → conservative re-home.
        logEvent({
          level: 'warn',
          surface: 'load-existing-family',
          message: 'no token/fileId to verify Drive ownership — re-homing conservatively',
          context: { action: 'ownership-unknown', provider_type: 'google_drive' },
        });
      }
    }

    // ─── Establish (re-home): no verified own home for this family. ───
    try {
      // (1) Prefer the signed-in account's own Drive. Collision-aware (B4): adopts an
      // existing owned same-named file instead of dropping to a local split-brain.
      if (isGoogleDriveAvailable.value && isTokenValid()) {
        const outcome = await reHomeToOwnDrive(`${podBaseName}.beanpod`);
        if (outcome.action === 're-homed' || outcome.action === 'adopted-existing') {
          logEvent({
            level: 'info',
            surface: 'load-existing-family',
            message: `re-home ${outcome.action}`,
            context: { action: outcome.action, provider_type: 'google_drive' },
          });
          return;
        }
        if (outcome.action === 'collision-check-unavailable') {
          // Couldn't verify a name collision — do NOT guess a home. Retryable: page
          // loudly and let the user retry rather than risk a wrong/foreign target.
          reportError({
            surface: 'load-existing-family',
            severity: 'critical',
            message: 're-home could not verify a Drive name collision (retryable)',
            context: {
              action: 'collision-check-unavailable',
              provider_type: storageProviderType.value ?? undefined,
            },
          });
          return;
        }
        // outcome.action === 'failed' → fall through to native / provider-less.
      }

      // (2) Native app-managed local file (no writable web handle exists here).
      if (isNative()) {
        const selected = await syncService.selectNativeLocalFile(podBaseName);
        if (selected && (await syncNow(true))) {
          logEvent({
            level: 'info',
            surface: 'load-existing-family',
            message: 're-homed to native local file',
            context: {
              action: 're-homed',
              provider_type: syncService.getProviderType() ?? undefined,
            },
          });
          return;
        }
      }
    } catch (e) {
      // Fall through to the critical report below — never let an unexpected throw
      // (incl. an installProvider write-failure from reHomeToOwnDrive) leave a
      // loaded-but-unsaveable family without a loud signal.
      console.error('[syncStore.establishDurableHomeAfterLoad] failed:', e);
    }

    // (3) No durable home could be established. The family is loaded and visible but
    // cannot be saved — data at risk. Page loudly; SaveFailureBanner guides recovery.
    reportError({
      surface: 'load-existing-family',
      severity: 'critical',
      message: 'loaded a family but could not establish a durable save target',
      context: {
        action: 'no-backend',
        provider_type: storageProviderType.value ?? undefined,
      },
    });
  }

  // --- Silent config heal: self-heal a lost provider config (Layer 1/2) ---

  /**
   * Install a provider WITHOUT the blind `syncNow()` upload that `installProvider`
   * does — used by the silent config heal, where the doc may not be loaded yet and
   * an upload would overwrite the real `.beanpod` with an empty envelope. Persist
   * + install + wire token/auto-sync only; the family is ALREADY registered (this
   * is a re-derivation, not a create), so `registerCurrentFamily` is intentionally
   * omitted. Mirrors `installProvider`'s leaf steps but never uploads. Keep in sync
   * with `installProvider` if its persist/setProvider wiring changes.
   */
  async function installProviderPersistOnly(
    provider: StorageProvider,
    type: StorageProviderType
  ): Promise<void> {
    needsPermission.value = false;
    const ctx = useFamilyContextStore();
    if (ctx.activeFamilyId) {
      await provider.persist(ctx.activeFamilyId);
    }
    syncService.setProvider(provider);
    if (type === 'google_drive') {
      setupTokenExpiryHandler();
    } else {
      setupAutoSync();
    }
  }

  /** Success terminal: config re-derived + persisted. On the BOOT path the caller
   *  (App.vue `loadFamilyData` path-1b, which runs right after `initialize()` returns)
   *  owns the load + the needsPassword→resume-setup navigation, so we must NOT also
   *  load here (that double-fetches Drive — path-1b's load is not covered by the
   *  `isBackgroundSyncing` guard). On a DEFERRED heal (a retry/Settings reconnect,
   *  after init) nothing else loads, so we load AND drive the resume-setup nav
   *  ourselves when the key was evicted too (needsPassword, no doc). */
  function configHealSucceeded(source: 'registry' | 'drive-search', boot: boolean): void {
    reconnecting.value = false;
    configHealFailed.value = false;
    configHealAttempts = 0;
    logEvent({
      level: 'warn',
      surface: 'sync-init-config-heal',
      message: 're-derived and re-persisted provider config',
      context: { action: source, provider_type: 'google_drive' },
    });
    if (boot) return; // App.vue path-1b loads + navigates on the boot path.
    void loadAfterDeferredHeal();
  }

  /** Deferred-heal load: decrypt with the cached key if present; if the key was
   *  evicted too (needsPassword, no doc), raise `needsResumeSetupNav` — App.vue
   *  owns the actual `router.replace('/welcome?resume=setup')` (MVO: the store
   *  orchestrates state, the view navigates; syncStore never imports the router,
   *  which would create a build-breaking cycle with the router's lazy pages). The
   *  boot path's App.vue navigation isn't running here, hence the reactive hand-off. */
  async function loadAfterDeferredHeal(): Promise<void> {
    try {
      await backgroundSyncFromFile();
      if (!isProjectionLoaded()) needsResumeSetupNav.value = true;
    } catch (e) {
      console.warn('[syncStore] deferred-heal load failed', e);
    }
  }

  /** Non-retryable / budget-exhausted terminal: surface the reconnect affordance
   *  (Layer 3) and page ONCE (mirrors the `zombieStateReported` once-guard). */
  function configHealTotalFailure(registryProvider: string | null, hadFileId: boolean): void {
    reconnecting.value = false;
    configHealFailed.value = true;
    if (!configHealTotalFailureReported) {
      configHealTotalFailureReported = true;
      reportError({
        surface: 'sync-config-total-failure',
        severity: 'critical',
        message: 'could not re-establish the data connection — user must reconnect',
        context: {
          provider_type: registryProvider ?? undefined,
          registry_had_file_id: hadFileId,
          token_valid: isTokenValid(),
        },
      });
    }
  }

  /** Re-arm the heal while the budget is unspent; otherwise it's a total failure. */
  function scheduleConfigHealRetry(familyId: string, errorCode: string): void {
    if (configHealAttempts >= CONFIG_HEAL_RETRY_BUDGET) {
      configHealTotalFailure('google_drive', true);
      return;
    }
    configHealAttempts += 1;
    reconnecting.value = true;
    logEvent({
      level: 'info',
      surface: 'sync-config-reconnect',
      message: 'config-heal re-arm',
      context: { action: 'rearm', error_code: errorCode },
    });
    // Poke on the next token acquisition (wake event → silent refresh) too.
    ensureConfigHealTokenSubscriber(familyId);
    configHealDefer.schedule(() => {
      void attemptSilentConfigHeal(familyId);
    });
  }

  function ensureConfigHealTokenSubscriber(familyId: string): void {
    if (configHealTokenUnsub) return;
    configHealTokenUnsub = onTokenAcquired(() => {
      if (reconnecting.value && configHealAttempts < CONFIG_HEAL_RETRY_BUDGET) {
        void attemptSilentConfigHeal(familyId);
      }
    });
  }

  /**
   * Self-heal a missing provider config for a Drive-backed family from the durable
   * remote registry — the core of the resilience fix. Returns true when a provider
   * was (re)installed this call. Idempotent, single in-flight, and NEVER calls
   * `createNewFile` (re-derivation is read/adopt only — the Shaun-class data-loss
   * guard). The inline localStorage-mirror tier is handled transparently inside
   * `getProviderConfig`, so reaching here means BOTH the IDB record and the mirror
   * were gone; only the network (registry/Drive) tier remains.
   */
  async function attemptSilentConfigHeal(familyId: string, boot = false): Promise<boolean> {
    // Idempotent: a valid provider for this family is already installed.
    if (syncService.getProviderFamilyId() === familyId && syncService.getProviderType()) {
      reconnecting.value = false;
      return true;
    }
    // Family-switch safety: a deferred retry / token-acquired poke captured `familyId`
    // in its closure, but installProviderPersistOnly binds via the CURRENT active
    // family. If the user switched families since the heal was armed, abort — never
    // bind family A's pod into family B's live session.
    if (useFamilyContextStore().activeFamilyId !== familyId) {
      reconnecting.value = false;
      return false;
    }
    if (configHealInFlight) return false;
    configHealInFlight = true;
    try {
      let entry: RegistryEntry | null;
      try {
        entry = await registry.lookupFamily(familyId);
      } catch (e) {
        // Transient (offline / registry 5xx) → retry on a wake event.
        console.warn('[syncStore.attemptSilentConfigHeal] registry lookup failed', e);
        scheduleConfigHealRetry(familyId, 'registry-error');
        return false;
      }

      if (!entry || entry.provider !== 'google_drive') {
        // Registry has no Drive home for this family (unknown, or a local pod we
        // can't re-derive remotely) → non-retryable. The user reconnects/loads
        // manually via the Layer-3 affordance.
        configHealTotalFailure(entry?.provider ?? null, !!entry?.fileId);
        return false;
      }

      // Drive-backed. The registry fileId IS our registered home (written by
      // registerCurrentFamily) — rebuild + persist WITHOUT an upload. No token
      // needed to install; the subsequent load handles auth via the normal
      // auth-transient path.
      if (entry.fileId) {
        try {
          const name = entry.displayPath ?? `${entry.familyName ?? 'pod'}.beanpod`;
          await installProviderPersistOnly(
            GoogleDriveProvider.fromExisting(entry.fileId, name),
            'google_drive'
          );
          configHealSucceeded('registry', boot);
          return true;
        } catch (e) {
          console.warn(
            '[syncStore.attemptSilentConfigHeal] install from registry fileId failed',
            e
          );
          scheduleConfigHealRetry(familyId, 'install-failed');
          return false;
        }
      }

      // Drive-backed in the registry but NO fileId (anomalous — an established Drive
      // pod always has one via registerCurrentFamily). We must NOT guess a pod: a
      // Drive-wide `.beanpod` search + "first owned file" adopt could bind a DIFFERENT
      // family's pod as this family's storage, and the next save would overwrite it
      // (a multi-family user's other pod). Surface reconnect/total-failure and let the
      // user re-establish it explicitly — never auto-adopt an unverified file.
      configHealTotalFailure('google_drive', false);
      return false;
    } finally {
      configHealInFlight = false;
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
        severity: 'critical',
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
  ): Promise<{
    success: boolean;
    needsPassword?: boolean;
    reason?: 'auth' | 'not-found' | 'error';
    /** Structured HTTP status when the failure was a DriveApiError. Lets callers
     *  branch on 404/403 without substring-matching a localized message
     *  (2026-06-19, finding 7). */
    status?: number;
  }> {
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
        return { success: false, reason: 'error' };
      }

      const version = detectFileVersion(text);
      if (version !== '4.0') {
        error.value = `Unsupported file version: ${version ?? 'unknown'}`;
        return { success: false, reason: 'error' };
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
      // Classify a missing/inaccessible file structurally (not by message text):
      // loadFromGoogleDrive bypasses syncService.load(), so `error.value` holds
      // the RAW Drive message WITHOUT the `DriveApiError:404:` prefix that
      // syncService.load() would add. Mirrors the idiom used in the
      // reload-if-changed catch above. The reconnect flow branches on this
      // `reason` to fall back to the file picker when the known file is gone.
      const status = e instanceof DriveApiError ? e.status : undefined;
      const reason: 'not-found' | 'error' = status === 404 ? 'not-found' : 'error';
      return { success: false, reason, status };
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

    // iOS/PWA gesture-less popup guard (2026-06-19, finding 2): this probe runs
    // from ResumePodSetup.onMounted with NO user gesture. If the token has
    // lapsed, the inner loadFromGoogleDrive → requestAccessToken would open a
    // popup that iOS Safari blocks, dead-ending the resume. On a redirect
    // surface with no valid token, silently reconnect or kick off a full-page
    // redirect (page navigates away; we resume on return) instead.
    if (
      await beginDriveAuthRedirectIfNeeded(
        RESUME_SETUP_PATH,
        authStoreInst.currentUser?.email,
        'create'
      )
    ) {
      return { kind: 'redirecting' };
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

      // Verify the family key still decrypts the file (worker; current key).
      await docClient.verifyEnvelope(env, { quiet: true });

      // Swap the provider so subsequent saves/polls use the new fileId.
      // `replaceEnvelope` is the uniform entry point even though this is a
      // recovery rebind where local-only entries from `envelope.value`
      // typically don't differ from `env`.
      syncService.setProvider(provider);
      const rebindMerged = replaceEnvelope(env);
      syncService.setFamilyKey(familyKey.value, rebindMerged);
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

  /**
   * Begin a redirect/deep-link OAuth flow before a Drive read IFF the surface
   * needs one and no valid token is held. Thin delegate to
   * `connectStorage.beginDriveAuthRedirectIfNeeded` so `LoadPodView`'s whole
   * Drive surface stays store-mediated (MVO) rather than the view importing the
   * service helper directly. Returns `true` when redirecting (caller returns
   * early), `false` when a token is in hand / popup is fine. See ADR-029.
   */
  async function beginDriveAuthRedirect(
    returnPath: string,
    loginHint: string | undefined,
    mode: RedirectMode,
    opts?: { forceReauth?: boolean }
  ): Promise<boolean> {
    return beginDriveAuthRedirectIfNeeded(returnPath, loginHint, mode, opts);
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
    // Drive is active here — register the best-effort refresh-token → beanpod
    // mirror (idempotent; only ever fires on an interactive token acquisition).
    registerDriveTokenMirror();
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
        reconnectEscalationPending.value = false;

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
   * The most recently persisted-or-loaded .beanpod size, rounded to KB, or null
   * if nothing has been persisted/loaded yet this session (in which case the
   * registry omits the field and preserves any stored value). Single converter
   * for all registry payloads. The byte size is owned by syncService.
   */
  function currentBeanpodSizeKb(): number | null {
    const bytes = syncService.getLastPersistedBytes();
    return bytes == null ? null : Math.round(bytes / 1024);
  }

  /**
   * Register (or re-register) the current family in the cloud registry.
   * Fire-and-forget: always a single PUT with the current sync + owner state.
   * Write-once fields (createdAt, ownerEmail, subscribeNewsletter) are
   * preserved server-side, so all call sites can share one payload.
   *
   * `opts.isLoginEvent` marks a genuine login/resume so the server stamps
   * `lastLoginAt`. It MUST stay false for background/config writes (country
   * change, Drive connect) — otherwise `lastLoginAt` degrades into `updatedAt`.
   * Sent as an explicit boolean (not omitted) so the two-state contract is
   * self-documenting and doesn't lean on JSON dropping `undefined`.
   */
  function registerCurrentFamily(
    overrides: Partial<Pick<RegistryEntry, 'provider' | 'fileId' | 'displayPath'>> = {},
    opts: { isLoginEvent?: boolean } = {}
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
        beanpodSizeKb: currentBeanpodSizeKb(),
        isLoginEvent: opts.isLoginEvent === true,
      })
      .catch((e: unknown) => {
        // Non-critical: registry is optional smoothness; saves proceed
        // regardless. Logged so the failure isn't silent.
        console.warn('[syncStore] registry.registerFamily failed (non-critical)', e);
      });
  }

  /**
   * Arm-and-register at a family entry point. `isLogin` distinguishes the
   * canonical login/resume site (LoginPage.handleSignedIn → true) from the
   * country watcher below (→ false), which must not move `lastLoginAt`.
   */
  function ensureRegistered(isLogin = false): void {
    registerCurrentFamily({}, { isLoginEvent: isLogin });
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
    reconnectEscalationPending,
    needsResumeSetupNav,
    driveFileNotFound,
    reconnecting,
    configHealFailed,
    attemptSilentConfigHeal,
    criticalWriteState,
    membersStepActive,
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
    configureSyncFileGoogleDrive,
    establishDurableHomeAfterLoad,
    migrateStorage,
    syncNow,
    syncNowBounded,
    DURABLE_ROTATION_SAVE_TIMEOUT_MS,
    forceSyncNow,
    checkForConflicts,
    loadFromFile,
    loadFromNewFile,
    loadFromDroppedFile,
    loadFromGoogleDrive,
    attemptResumeFromRegistry,
    completeAutoLoad,
    listGoogleDriveFiles,
    beginDriveAuthRedirect,
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
    setMemberWrappedKey,
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
