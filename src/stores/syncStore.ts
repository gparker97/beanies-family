import { defineStore } from 'pinia';
import { PodLineageError } from '@/services/sync/podLineage';
import type { LineageBasis } from '@/services/automerge/worker/protocol';
import { decodeBaselinePayload, decodeHeadsFingerprint } from '@/services/sync/remoteBaseline';
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
import { useMealPlanStore } from './mealPlanStore';
import { useEmergencyContactsStore } from './emergencyContactsStore';
import { useSettingsStore } from './settingsStore';
import { useFamilyContextStore } from './familyContextStore';
import { useAuthStore } from './authStore';
import { useTransactionsStore } from './transactionsStore';
import { useSyncHighlightStore } from './syncHighlightStore';
import { isLoaded as isProjectionLoaded } from '@/services/automerge/projection';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import { getSyncCapabilities, canAutoSync, getPlatform } from '@/services/sync/capabilities';
import { beginDriveAuthRedirectIfNeeded, RESUME_SETUP_PATH } from '@/services/sync/connectStorage';
import type { RedirectMode } from '@/services/google/redirectState';
import { markFamilyJustCreated } from '@/utils/newFamilyFlag';
import { features } from '@/config/features';
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
  tryGetSilentToken,
  getGoogleAccountEmail,
  getVerifiedGoogleAccountEmail,
} from '@/services/google/googleAuth';
import {
  registerDriveTokenMirror,
  reconcileDriveTokenWithDoc,
  tryReconnectSilently,
} from '@/services/google/driveTokenRecovery';
import { logTokenLifecycle } from '@/services/google/googleRevoke';
import { buildSilentRefreshAlertContext } from '@/services/google/silentRefreshAlertContext';
import { reportError } from '@/utils/errorReporter';
import { useTranslationStore } from '@/stores/translationStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { createSampler } from '@/services/telemetry/emitPolicy';
import { isDemoSession } from '@/utils/reviewDemo';
import {
  bump as bumpOpenCycle,
  noteSnapshot as noteOpenCycleSnapshot,
  endOpen,
} from '@/services/telemetry/openCycle';
import type { OpenToken, OpenOutcome } from '@/services/telemetry/openCycle';
import { slackNotify } from '@/utils/slackNotify';
import { getPlatformLabel, getDeviceLabel } from '@/utils/platformLabel';
import type { SaveFailureLevel } from '@/services/sync/syncService';
import { isSafetyCopyName } from '@/constants/compaction';
import {
  searchBeanpodFilesGlobal,
  clearFolderCache,
  getAppFolderId,
  getFileMetadata,
  DriveApiError,
} from '@/services/google/driveService';
import {
  POD_ACCESS_SEVERITY,
  classifyDriveFailure,
  evaluatePodMetadata,
  type PodAccessErrorCode,
  type PodAccessFailure,
  type PodAccessResult,
  type PodFileMetadata,
} from '@/utils/podAccess';
import { clearQueue } from '@/services/sync/offlineQueue';
import { tail } from '@/utils/diagnostics';
import {
  createBeanpodV4,
  parseBeanpodV4,
  tryUnwrapFamilyKey,
  envelopeNeedsRecovery,
  reEncryptEnvelope,
} from '@/services/sync/fileSync';
import { preserveLocalKeyDicts, keyDictSize, withoutPayload } from '@/services/sync/envelopeMerge';
import {
  generateFamilyKey,
  deriveMemberKey,
  wrapFamilyKey,
} from '@/services/crypto/familyKeyService';
import * as docClient from '@/services/automerge/worker/docClient';
import type { BeanpodFileV4, WrappedMemberKey } from '@/types/syncFileV4';
import type { StorageProvider, StorageProviderType } from '@/services/sync/storageProvider';
import { toISODateString } from '@/utils/date';
import { raceTimeout } from '@/utils/timing';
import { measureAsync, record as recordPerf } from '@/utils/perfTiming';
import { deduplicateRecurringTransactions } from '@/services/recurring/recurringProcessor';
import {
  type CreatePodResult,
  type CreatePodFailureReason,
  type CriticalWriteState,
  type ResumeFromRegistryResult,
  type CompleteAutoLoadResult,
  PayloadLoadError,
  isRemoteBlocker,
  PayloadTooLargeError,
  payloadErrorMessageKey,
  type RemoteBlocker,
  type PodBlockMessageKey,
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

/**
 * Presentation status for the sidebar SaveStatusIndicator. Distinct from the
 * store's `syncStatus` (see the `saveStatus` computed for the rationale).
 */
export type SaveStatus = 'saving' | 'critical' | 'degraded' | 'saved' | 'hidden';

/** Classified cause of a failed background/manual Drive read. */
export type BackgroundSyncErrorKind =
  | 'auth-transient'
  | 'decrypt'
  /** The remote must not be MERGED with this device's document. See `podLineage`. */
  | 'lineage'
  | 'network'
  | null;

/**
 * The result of a `backgroundSyncFromFile` call — returned so a caller (the
 * manual "Refresh All") can present the outcome, and logged by the store itself
 * for manual calls (MVO: the store owns classification + telemetry; the view
 * only maps this to a toast / reconnect surface).
 *   refreshed         — a read completed (or the #61 skip confirmed unchanged)
 *   auth-failed       — token expired/revoked, needs reconnect
 *   network-failed    — offline / transient network error
 *   decrypt-failed    — reached Drive but couldn't decrypt (password changed)
 *   skipped-in-flight — a sync was already running; this call did nothing
 */
export type RefreshOutcome =
  | 'refreshed'
  | 'auth-failed'
  | 'network-failed'
  | 'decrypt-failed'
  /** This device already established it cannot open the pod. See `podUnopenable`. */
  | 'skipped-unopenable'
  | 'skipped-in-flight';

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
    // Stripped: this is the long-lived copy, and nothing reads the payload back
    // off it (verified — the only readers are worker-side, fed a freshly-parsed
    // envelope, plus `reEncryptEnvelope`, which overwrites the field).
    const merged = withoutPayload(preserveLocalKeyDicts(incoming, envelope.value));
    envelope.value = merged;
    syncService.setEnvelope(merged);
    return merged;
  }

  /** Null the envelope on sign-out / disconnect. */
  function clearEnvelope(): void {
    envelope.value = null;
    syncService.setEnvelope(null);
    // A new session must not inherit the previous family's "snapshot painted" state.
    snapshotPaintedThisSession.value = false;
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
  // The LIVE, OAuth-verified session account — distinct from the provider's
  // bound account (`providerAccountEmail`), which can be stale in a multi-account
  // setup. Settings shows THIS as "Signed in with" so the display is truthful.
  // Mirrored from the non-reactive `getVerifiedGoogleAccountEmail()` via
  // `refreshSessionAccountEmail()` at every seam where the verified email changes.
  const sessionAccountEmail = ref<string | null>(null);
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
  // Consecutive save-failure count mirrored from syncService's per-attempt
  // channel (see the onSaveAttempt subscription below). Drives the sidebar
  // save-status indicator's one-retry debounce (amber only at >= 2).
  const consecutiveSaveFailures = ref(syncService.getConsecutiveSaveFailures());

  /**
   * The one piece of pod-access state. Set by `verifyPodAccess` /
   * `checkCanonicalPod`, cleared by `rebindPodFile` and `resetState`, rendered by
   * exactly one component (`PodAccessBanner`). `LoadPodView` sets it and renders
   * nothing — two renderers for one condition drift, can appear simultaneously,
   * and double every future copy change.
   */
  const podAccessError = ref<PodAccessFailure | null>(null);

  // ─── Banner precedence, declared once ────────────────────────────────────
  //
  //   GoogleReconnectToast > PodAccessBanner > SaveFailureBanner > DurabilityBanner
  //
  // A pod-access failure is the ROOT CAUSE of any save failure it coexists with
  // (you cannot save to a file you can't reach), so it outranks the save banner —
  // showing both would report one problem twice and bury the actionable one.
  // The reconnect toast still wins: it owns the permanent-expiry recovery.
  const shouldShowPodAccessBanner = computed(
    () => podAccessError.value !== null && !showGoogleReconnect.value
  );

  // Banner is mutually exclusive with the GoogleReconnectToast (the canonical
  // surface for permanent expiry). When the toast is up, the toast handles
  // recovery — no need to also alarm with a top banner.
  const shouldShowSaveFailureBanner = computed(
    () =>
      showSaveFailureBanner.value && !showGoogleReconnect.value && !shouldShowPodAccessBanner.value
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
  // Guards `verifyPodAccess` against overlapping runs (repeated `retry` taps).
  let verifyInFlight = false;
  // The canonical check runs at most once per family per session — `verifyPodAccess`
  // runs on every load path including `retry`, so an unguarded check would turn a
  // retry loop into a registry request loop.
  let checkedCanonicalFor: string | null = null;
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

  // Presentation status for the sidebar SaveStatusIndicator (row + popover +
  // hamburger dot). DISTINCT from `syncStatus` above: that answers "what sync
  // lifecycle state are we in?" for other consumers; this answers "what should
  // the quiet save indicator show?". Do not merge them — they drive different UI.
  //
  // Total function — always returns a SaveStatus, never undefined. The final
  // `'hidden'` covers both "no data file" AND the transient first-launch window
  // where the pod is configured but the first save hasn't completed (lastSync
  // still null, no failures) — so the presentation map is never indexed by a
  // missing key. `needsPermission` is intentionally NOT a distinct state: a
  // stale Drive permission surfaces through the ordinary failure escalation.
  const saveStatus = computed<SaveStatus>(() => {
    if (isSyncing.value) return 'saving';
    if (saveFailureLevel.value === 'critical') return 'critical';
    if (consecutiveSaveFailures.value >= 2) return 'degraded';
    if (isConfigured.value && lastSync.value) return 'saved';
    return 'hidden';
  });

  // Subscribe to sync service state changes
  syncService.onStateChange((state) => {
    isInitialized.value = state.isInitialized;
    isConfigured.value = state.isConfigured;
    fileName.value = state.fileName;
    isSyncing.value = state.isSyncing;
    storageProviderType.value = syncService.getProviderType();
    providerAccountEmail.value = syncService.getProvider()?.getAccountEmail() ?? null;
    refreshSessionAccountEmail();
    driveFileId.value = syncService.getProvider()?.getFileId() ?? null;
    error.value = state.lastError;
  });

  // Subscribe to save-complete
  syncService.onSaveComplete((timestamp) => {
    lastSync.value = timestamp;
    // A save just SUCCEEDED — proven access. Heal a stale account binding if the
    // live verified session differs from the provider/member binding (#62). The
    // returned "settled" flag is unused here (no poll to stop). Best-effort.
    void healAccountBindingIfNeeded('save');
  });

  // Subscribe to save failure level changes — see handleSaveFailureChange above.
  syncService.onSaveFailureChange(handleSaveFailureChange);

  // Mirror the per-attempt consecutive-failure count (drives `saveStatus`).
  syncService.onSaveAttempt((count) => {
    consecutiveSaveFailures.value = count;
  });

  // Single owner of save-status transition telemetry. Lives in the store — NOT
  // in SaveStatusIndicator.vue, which mounts twice (desktop sidebar + mobile
  // drawer) — so each transition is logged exactly once. Emits on the success
  // path too so degraded/recovery rates are measurable. `provider_type` and
  // `save_failure_level` are auto-injected by diagnosticContext.
  // A healthy save is two transitions (saving -> saved) and families save
  // constantly, so the routine pair was ~27% of the entire telemetry firehose
  // while carrying no diagnostic information — the interesting transitions are
  // the ones INTO and OUT OF trouble. Those are always emitted; the routine pair
  // is sampled, and since the sampler is deterministic 1-in-N the true rate is
  // still recoverable (multiply by N).
  const ROUTINE_SAVE_SAMPLE = 20;
  const sampleRoutineSave = createSampler(ROUTINE_SAVE_SAMPLE);
  watch(saveStatus, (next, prev) => {
    if (next === prev) return;
    const routine =
      (next === 'saving' || next === 'saved') &&
      consecutiveSaveFailures.value === 0 &&
      prev !== 'degraded' &&
      prev !== 'critical';
    if (routine && !sampleRoutineSave()) return;
    logEvent({
      level: 'info',
      surface: 'save-status',
      message: 'save status transition',
      context: {
        save_status: next,
        consecutive_failures: consecutiveSaveFailures.value,
        // Marks a sampled routine event so a rate can be scaled correctly
        // rather than read as the raw count.
        detail: routine ? `sampled-1-in-${ROUTINE_SAVE_SAMPLE}` : 'full',
      },
    });
  });

  // Background sync state (cache-first loading)
  const isBackgroundSyncing = ref(false);
  const backgroundSyncError = ref<string | null>(null);
  // True once the instant-open snapshot has painted cached data into the stores
  // this session (the user is looking at their data), regardless of whether the
  // authoritative Automerge doc rebuild then succeeded. App.vue's post-init health
  // check reads this to tell "blank screen, no doc = data unreachable (page it)"
  // apart from "data on screen from the snapshot, doc rebuild lagged/failed = a
  // degraded read-only state, not data loss (don't page)". Reset on sign-out /
  // disconnect via clearEnvelope.
  const snapshotPaintedThisSession = ref(false);
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
  const backgroundSyncErrorKind = ref<BackgroundSyncErrorKind>(null);
  /**
   * Reactive MIRROR of `syncService.isRemoteBlocked()`, for the UI only.
   *
   * The authoritative latch lives in `syncService`, the layer that owns the
   * download: the store cannot see the local-file poll tick, and a second
   * source of truth here needed clearing from five different places and got it
   * wrong in three of them (`reloadAllStores` proves nothing about the remote,
   * and it runs on every tab wake). Every GUARD reads the service directly;
   * this ref exists so the sync bar can pick the right toast.
   */
  const podUnopenable = ref(false);
  /** The guards' authoritative read. Never the mirror. */
  const remoteUnreadable = () => syncService.isRemoteBlocked();

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
  /**
   * Ask for file permission and, if granted, load.
   *
   * Returns a RESULT, not a bare boolean. A bare `true` meant "granted", and
   * two of the three callers read it as "granted AND loaded" — driving the
   * login flow into a signed-in state with no document, and retrying an
   * allocation that had just failed. And the store must NOT raise the fatal
   * overlay itself: one caller is the warm Settings button, where a
   * `fixed inset-0 z-[300]` panel would cover an app that is painting fine.
   */
  async function requestPermission(): Promise<{
    granted: boolean;
    loaded: boolean;
    payloadError?: PayloadLoadError;
  }> {
    const granted = await syncService.requestPermission();
    needsPermission.value = !granted;
    if (!granted) return { granted: false, loaded: false };
    // An explicit user action — give the breaker its one half-open attempt.
    syncService.retryAfterRemoteBlock();

    try {
      const loadResult = await loadFromFile();
      if (loadResult.success) {
        setupAutoSync();
        return { granted: true, loaded: true };
      }
      return { granted: true, loaded: false };
    } catch (e) {
      // `loadFromFile` rethrows a payload failure so the caller can classify it.
      if (e instanceof PayloadLoadError) return { granted: true, loaded: false, payloadError: e };
      throw e;
    }
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
   * Shared by `migrateStorage` and the create flow — keeps
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
      // FORCE: this is a deliberate write to a destination we just created/selected
      // (createNewFile / migrateStorage), so there is no peer data to conflict with.
      // A non-force syncNow would run the #61 change-check against the fresh file's
      // first-sight revision (no matching baseline yet) and false-block with "File
      // has newer data", reliably failing every migration (and it depended on a
      // clock quirk even pre-#61). We own this file; write our data to it.
      const ok = await syncNow(true);
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

    // Deliberate re-point (reached from createNewFile and migrateStorage).
    registerCurrentFamily(
      {
        provider: type,
        fileId: provider.getFileId(),
        displayPath: provider.getDisplayName(),
      },
      { pointerIntent: true }
    );

    if (type === 'google_drive') {
      setupTokenExpiryHandler();
    } else {
      setupAutoSync();
    }
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

  /**
   * Three-state bounded save — the SINGLE implementation of the
   * `raceTimeout(syncNow(true), …)` pattern. Distinguishes the three outcomes the
   * transactional password-rotation path needs (`syncNowBounded` collapses them):
   *   - `'saved'`   — the Drive write confirmed.
   *   - `'failed'`  — a clean failure; the write did NOT complete (nothing reached Drive).
   *   - `'timeout'` — the bound elapsed; the non-cancellable write MAY still be in flight.
   *
   * `syncNow(true)` only ever rejects AFTER a successful Drive write (the post-write
   * `settingsRepo.saveSettings` metadata write throws — `save()`/`doSave` themselves
   * catch all and return `false`). So a rejection means the credential IS durable: we
   * surface the metadata failure as a `warning` and report `'saved'`, never failing a
   * genuinely-durable rotation or firing a false page.
   */
  async function syncNowDurable(timeoutMs: number): Promise<'saved' | 'failed' | 'timeout'> {
    try {
      const r = await raceTimeout(syncNow(true), timeoutMs);
      if (r === undefined) return 'timeout';
      return r ? 'saved' : 'failed';
    } catch (e) {
      reportError({
        surface: 'sync-now-durable',
        severity: 'warning',
        message:
          'syncNow rejected after a successful Drive write (settings metadata write failed) — credential is durable',
        error: e,
      });
      return 'saved';
    }
  }

  /** Bounded best-effort save → boolean. Thin wrapper over `syncNowDurable` so there
   * is exactly ONE implementation of the timeout + reject-means-saved core. (A
   * post-write reject now maps to `true` instead of throwing — strictly safer for
   * both callers: login-completion + signin-heal.) */
  async function syncNowBounded(timeoutMs = POST_AUTH_SAVE_TIMEOUT_MS): Promise<boolean> {
    return (await syncNowDurable(timeoutMs)) === 'saved';
  }

  /**
   * Whether a durable save (Drive OR local file) is possible RIGHT NOW — the
   * pre-mutation gate for password rotation. Returns false only when durability is
   * CONFIDENTLY impossible: no write provider configured (cache-only family), or a
   * cloud provider while the browser reports offline. A local-file provider is
   * durable without network. An online cloud provider that then fails mid-write is
   * NOT pre-blocked here — it falls through to the durable-or-rollback path.
   */
  function canDurablySaveNow(): boolean {
    const providerType = syncService.getProviderType(); // 'google_drive' | 'local' | null
    if (!providerType) return false; // cache-only family: no durable target
    if (providerType === 'google_drive' && typeof navigator !== 'undefined' && !navigator.onLine) {
      return false; // cloud provider needs the network
    }
    return true;
  }

  /**
   * Sync now - save current data to file
   */
  async function syncNow(force = false): Promise<boolean> {
    if (!force) {
      // One change-comparator for the whole app (#61 C14): the file has newer data
      // only when it actually CHANGED relative to our baseline. `unknown` (a
      // transient provider error) does NOT block the save — matches today's
      // wall-clock check returning hasConflict:false on a null timestamp.
      const change = await syncService.remoteChanged();
      if (change.status === 'changed') {
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
   *
   * Returns the heads of the bytes DRIVE HOLDS (#65) so the caller can commit the
   * open-guard baseline. It is the merge's `remoteHeads` — captured in the worker
   * from the UNMIGRATED decrypted remote — which the worker documents as the only
   * value a caller may record as the Drive baseline. It is sound here for exactly
   * the reason it is sound on the merging branch: it describes the REMOTE, not our
   * doc, so the cache changes this function may re-apply cannot taint it. Returning
   * `null` would not be "conservative" — it would clobber the durable fingerprint
   * (the commit is last-write-wins, C10b) and permanently disable #61's skip.
   */
  async function replaceDocWithCacheRecovery(
    remoteEnvelope: BeanpodFileV4,
    familyId: string,
    /** The live family key. Threaded, never read off the ref — see the helper. */
    key: CryptoKey,
    /** The human pressed "Use the family file" and confirmed. See the basis below. */
    chosenByUser = false
  ): Promise<readonly string[] | null | typeof KEPT_LOCAL> {
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
    /**
     * The heads DRIVE HELD at our last durable baseline — the one fact the
     * worker cannot see, and all it needs from us.
     *
     * ⚠️ HEADS, not the fingerprint. `remoteBaseline.ts` is type-imported by
     * worker code and must stay value-free so those imports are erased; sending
     * a fingerprint would drag it into the worker bundle at runtime. Main
     * decodes, the worker compares. `null` means "we cannot prove what Drive
     * held", which the worker reads as `dirty` — the fail-safe direction.
     */
    let baselineHeads: string[] | null = null;
    try {
      const cacheResult = await docClient.initAndLoadCache(familyId);
      loadedFromCache = cacheResult?.loaded === true; // only a genuine HIT authorises a merge
      // Zero extra I/O: the baseline row came back in the SAME round-trip.
      if (loadedFromCache && cacheResult?.remoteBaseline) {
        baselineHeads = decodeHeadsFingerprint(
          decodeBaselinePayload(cacheResult.remoteBaseline.payload)?.headsFp ?? null
        );
      }
    } catch (e) {
      // An out-of-memory failure must NOT fall through to the adopt-remote path
      // below. `initAndLoadCache` deliberately KEPT the cache in that case; the
      // fall-through then sends `mergeRemoteEnvelope` a `no-local-document`
      // basis, whose full-adopt branch leaves `lastPersistedHeads` null (it used
      // to be a separate `dropDoc()` RPC; the intent now travels IN the request
      // so a respawn cannot lose it), so the next persist
      // writes a fresh BASE — which clears every increment the preserve branch
      // just protected. Any mutation not yet on Drive would be gone, silently,
      // on the one device that change exists to protect. Re-downloading the
      // (usually larger) remote to inflate it on a device that just ran out of
      // room is futile anyway, so surface it and let the caller show the honest
      // message.
      if (e instanceof PayloadLoadError && e.deviceCannotOpen) throw e;
      console.warn('[syncStore] Cache recovery failed — proceeding with remote only:', e);
    }

    // ⚠️ THE LINEAGE GUARD NOW LIVES IN THE WORKER — see
    // `applyAndProject.mergeRemoteEnvelope`. It has to, because it is the only
    // place BOTH documents exist: comparing the two ENVELOPES (which is what
    // this call site used to do) compares metadata maintained on three tracks
    // independent of the document, so it read `same` while the documents
    // differed and permitted the merge it exists to prevent.
    //
    // All this site owes the worker is the one fact only IT knows: what Drive
    // held at our last durable baseline. `loadedFromCache` false means we have
    // no document of THIS family, which is a different question entirely.
    // ⚠️ AN ARGUMENT, NOT MODULE STATE. `user-file` never blocks and makes
    // `adopt` — wholesale replacement of this device's document — unconditional,
    // so it must travel with the ONE call a human authorised and expire with it.
    // It was briefly a module-level one-shot: a recovery that failed before
    // reaching a terminus (offline, a 404, an OOM rethrow — all of which return
    // above the consume) left the flag armed, and the next ordinary debounced
    // save spent it and discarded the document with no banner, no confirmation
    // and no toast. A parameter cannot go stale and cannot be stolen by a
    // concurrent read.
    const basis: LineageBasis = !loadedFromCache
      ? { kind: 'no-local-document' }
      : chosenByUser
        ? // The SAME heads the baseline arm would carry. `user-file` changes
          // what the guard is allowed to do, not what this device knows.
          { kind: 'user-file', heads: baselineHeads }
        : { kind: 'baseline', heads: baselineHeads };
    const merged = await docClient.mergeRemoteEnvelope(remoteEnvelope, familyId, basis);
    if (merged.action === 'kept-local') {
      keepLocalDocumentAndAdoptEnvelopeKeys(remoteEnvelope, key);
      // ⚠️ A DISTINCT SENTINEL, not `null`. `null` means "we merged but cannot
      // prove what Drive holds", and the caller reacts to it by committing a
      // baseline, learning the marker and reloading the stores — all three of
      // which are wrong here, and the reload CANCELS the publish this helper
      // just armed. The caller must be able to tell the two apart.
      return KEPT_LOCAL;
    }
    // Shared with the poll terminus: same level rule, same `replayed`/
    // `conflicts`. This is the path an offline peer takes when it comes back,
    // so it is the one a rebase soak reads.
    docClient.logMergeTerminus('open terminus', merged, familyId);
    // Clean up duplicate recurring transactions from the CRDT merge.
    await deduplicateRecurringTransactions();
    // Re-upload the converged doc only if local carried unsynced changes.
    if (merged.dirty) syncService.triggerDebouncedSave();
    // `?? null` — same fail-safe every other `remoteHeads` reader applies: a partial
    // worker double degrades to "unknown => read", never to a false skip.
    return merged.remoteHeads ?? null;
  }

  /**
   * Terminus 1 kept OUR document — distinct from "merged, heads unknown".
   *
   * A sentinel rather than a boolean out-param because the function's return is
   * already `readonly string[] | null` and `null` is load-bearing (it means
   * "cannot prove what Drive holds"). Conflating the two made the caller commit
   * a baseline for bytes it deliberately did not take.
   */
  const KEPT_LOCAL = Symbol('kept-local');

  /**
   * `kept-local`: our document is the NEWER lineage, so the worker touched
   * nothing and we keep ours.
   *
   * ⚠️ ADOPT THE ENVELOPE ANYWAY. Declining the remote's PAYLOAD is a different
   * decision from declining its KEY DICTS, and `replaceEnvelope` →
   * `preserveLocalKeyDicts` is the ONLY path by which a remote-only
   * `wrappedKeys` / `passkeyWrappedKeys` / `inviteKeys` entry reaches us.
   * Returning without it means the save we arm below writes the LOCAL envelope
   * over the remote and ERASES a member, passkey or invite another device
   * added — locking that person out.
   *
   * ⚠️ THE CALLER MUST RETURN IMMEDIATELY AFTER THIS, committing no Drive
   * baseline and learning no marker. Recording Drive's heads as a baseline our
   * document provably does not contain is a false skip — the class #65 exists
   * to prevent.
   */
  function keepLocalDocumentAndAdoptEnvelopeKeys(
    remoteEnvelope: BeanpodFileV4,
    // ⚠️ A PARAMETER, NOT `familyKey.value!`. Two of the three callers are
    // COLD-BOOT decrypt paths (`decryptPendingFile`,
    // `decryptPendingFileWithKey`) that post the just-unwrapped key to the
    // WORKER and only assign the store ref afterwards — so the ref was
    // provably null exactly where this helper runs, and the `!` handed
    // `syncService.setFamilyKey` an undefined key. The publish it arms then
    // cannot encrypt, and the one document holding the newer lineage never
    // reaches Drive. Every caller has the real key in hand; make it say so.
    key: CryptoKey
  ): void {
    const keptEnv = replaceEnvelope(remoteEnvelope);
    syncService.setFamilyKey(key, keptEnv);
    // Observability: `kept-local` is the rarest terminus in the whole guard and
    // the only one that publishes ACROSS a lineage boundary, so a silent one is
    // indistinguishable from a merge that quietly went the other way.
    logEvent({
      level: 'info',
      surface: 'pod-lineage',
      message: 'kept local document, adopted remote envelope keys',
      context: { action: 'kept-local', family_id: remoteEnvelope.familyId },
    });
    syncService.triggerDebouncedSave();
  }

  /**
   * Shared background-recovery hydrate (both background-sync paths use it so they
   * can't drift): post the existing key, worker-decrypt + CRDT-merge the pending
   * envelope, adopt the envelope, refresh stores, dedup, and re-upload only if the
   * merge left local unsynced changes (heads-derived `dirty`). Clears the pending
   * file. The caller does its own setupAutoSync/return.
   */
  async function hydrateFromEnvelope(env: BeanpodFileV4): Promise<void> {
    // Captured once, before the first await, and CHECKED — the three `!`s that
    // stood here asserted a ref that two callers reach without it. Failing with
    // a named error beats posting `undefined` as a CryptoKey, which surfaces
    // later as an unrelated decrypt failure on a path the user cannot act on.
    const key = familyKey.value;
    if (!key) {
      // ⚠️ REPORT BEFORE THROWING. Both callers gate on `familyKey.value`, so
      // this is unreachable today — but a plain `Error` is not a `RemoteBlocker`,
      // so if it ever did fire it would fall past their `isRemoteBlocker` arms
      // into the "family key doesn't work, try the cached one" fallback and route
      // the user to a credential re-prompt for a state no credential fixes, with
      // nothing in the firehose. Unreachable is not the same as silent.
      reportError({
        surface: 'pod-lineage',
        severity: 'error',
        message: 'hydrateFromEnvelope reached without a family key',
        context: { action: 'hydrate-no-key', family_id: env.familyId },
      });
      throw new Error('hydrateFromEnvelope: no family key');
    }
    await docClient.setFamilyKey(key, env.familyId);
    // ⚠️ THE GUARD RUNS IN THE WORKER (see terminus 1). This path has a LIVE
    // document and no baseline it can prove, so the honest basis is `baseline`
    // with unknown heads — which the worker reads as `dirty`. A newer remote
    // lineage therefore blocks here and the adopt happens at the next open,
    // through terminus 1, which does have a baseline. One adopt implementation,
    // one instruction to the user.
    const merged = await docClient.mergeRemoteEnvelope(env, env.familyId, {
      kind: 'baseline',
      heads: null,
    });
    if (merged.action === 'kept-local') {
      keepLocalDocumentAndAdoptEnvelopeKeys(env, key);
      pendingEncryptedFile.value = null;
      return;
    }
    const adopted = replaceEnvelope(env);
    syncService.setFamilyKey(key, adopted);
    pendingEncryptedFile.value = null;
    await reloadAllStores();
    const dupsRemoved = await deduplicateRecurringTransactions();
    if (dupsRemoved > 0) await reloadAllStores();
    if (merged.dirty) syncService.triggerDebouncedSave();
  }

  /**
   * The Drive-side housekeeping run at EVERY successful open terminus — the
   * authoritative load path AND the #61 open-guard SKIP path — so the two can
   * never drift (Requirement 12). The `google_drive` gate lives INSIDE, not at
   * the call sites, so a new line here cannot be forgotten on one path.
   * `markPodCreated` is included per its own contract (authStore): call it at
   * every terminus that reads a pod, or the user is stranded on the
   * create-recovery screen and `app.onboardingZombieState` false-fires.
   */
  async function runPostLoadDriveHousekeeping(): Promise<void> {
    if (syncService.getProviderType() === 'google_drive') {
      setupTokenExpiryHandler();
      updateProviderEmailAfterLoad();
      await reconcileDriveTokenForMember();
    }
    setupAutoSync();
    useAuthStore().markPodCreated();
  }

  /**
   * Load data from the currently configured sync file.
   * For V4 files: parses envelope, tries to unlock with cached FK or password.
   * @param options.merge - If true, CRDT merge remote doc with local doc.
   */
  async function loadFromFile(
    options: {
      merge?: boolean;
      /**
       * The human chose THESE bytes over this device's document, having been
       * shown what is discarded. Two effects, both scoped to this one call:
       * the remote-blocked latch is bypassed (it is the thing being resolved),
       * and the lineage basis becomes `user-file`, which never blocks.
       */
      userChoseThisFile?: boolean;
    } = {}
  ): Promise<{
    success: boolean;
    needsPassword?: boolean;
    reason?: 'auth' | 'not-found' | 'error';
  }> {
    const merging = !!options.merge;
    const chosenByUser = !!options.userChoseThisFile;

    // Latched: this device has already established it cannot read the remote,
    // and every retry re-downloads megabytes to fail identically. This is the
    // door the login flow's "Try again" and `ensureStaged` use, so without it
    // that button was an unbounded re-download loop with a critical report per
    // press. Reported as a plain failure; the honest message is already on
    // screen from the attempt that latched.
    // THROW, never a bare `{success:false}`. A plain failure strips the payload
    // class from every consumer downstream: `requestPermission` returns
    // `{granted:true, loaded:false}` with no `payloadError` (so Settings' Reload
    // becomes a silent no-op), `LoadPodView` falls back to "check you picked the
    // right file", and App.vue's path 1b never reaches its `PayloadLoadError`
    // branch — landing instead on the generic overlay whose CTA is Clear Data,
    // which deletes the one copy of the edits this latch exists to protect.
    const blocked = remoteUnreadable();
    // ⚠️ The user's explicit choice is what RESOLVES this latch, so it must not
    // be refused by it. Scoped to this call: nothing else bypasses the breaker.
    if (blocked && !chosenByUser) throw blocked;

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

    // ⚠️ CAPTURE BEFORE `load()`, WHICH DESTROYS IT. `load()` nulls
    // `remoteBaseline` and then `learnRemoteMarker` re-seeds it with
    // `headsFp: null`, so asking for the fingerprint AFTER the download always
    // answered null → `docPushedAgainst(null)` → 'dirty' → the terminus-4 guard
    // could only ever BLOCK. The moment any device published a compaction,
    // every peer's poll threw, latched and stopped, and a manual Refresh looped
    // (the retry clears the latch, the next poll re-blocks) — the "no peer ever
    // adopts, so a compaction can never propagate" outcome `podLineage.ts`
    // warns about. The honest question is "as of the last thing we KNEW Drive
    // held, is our document ahead?", and that is this value, read here.
    const baselineFpBeforeLoad = syncService.getRemoteBaselineHeadsFp();

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

      // `parseBeanpodV4` validates the version itself and throws a BETTER
      // message ("Unsupported beanpod version: X. Expected 4.0."), so the old
      // `detectFileVersion` pre-call was a second full JSON.parse of the whole
      // multi-megabyte file purely to read one field, then thrown away.
      const remoteEnvelope = parseBeanpodV4(text);

      // If we already have a family key, the worker decrypts + merges/adopts.
      // Captured ONCE, here, where the ref is provably non-null: everything
      // below is `await`-separated, and a ref read after an await narrows to
      // nothing and can genuinely have changed (a family switch, a sign-out).
      const liveKey = familyKey.value;
      if (liveKey) {
        try {
          // FAIL-SAFE DEFAULTS. This block is shared by the merge AND replace
          // branches, and the replace branch goes through
          // `replaceDocWithCacheRecovery`, which returns nothing — so `changed`
          // is genuinely unknown there. Defaulting both to `true` means an
          // unknown outcome re-projects and re-uploads exactly as it does today;
          // only the merging branch, which has real heads-derived answers, is
          // allowed to narrow them to `false`.
          let changed = true;
          let dirty = true;
          // #65: the heads of the bytes DRIVE HOLDS, for the open-guard baseline.
          // Same fail-safe default as above but inverted in form: `null` means "we
          // cannot prove what Drive holds", which makes the next open decline to
          // skip.
          //
          // BOTH branches below now supply it. The replace branch used to leave it
          // null, reasoning that `replaceDocWithCacheRecovery` re-applies unsynced
          // cache changes so "our doc is knowably AHEAD of Drive and no fingerprint
          // may be claimed". That conflated two different facts and was a bug (see
          // PERFORMANCE.md §10): this fingerprint records what DRIVE holds, not what
          // our doc holds, and being ahead of Drive is precisely what #65's own
          // `unpushedLocalChangesCheck` already reports as `unpushed-local-changes`.
          // Because the commit at terminus 1 is last-write-wins (C10b) and EVERY
          // cold open takes the replace branch (every `loadFromFile()` call site
          // outside the poll paths passes no `merge`), the null also overwrote the
          // good fingerprint `doSave` had recorded — so the skip could never fire on
          // the open path at all. Measured in prod on R10: zero skips in 44h.
          let driveHeads: readonly string[] | null = null;
          if (merging) {
            // ⚠️ THE GUARD RUNS IN THE WORKER (see terminus 1). This branch
            // merged foreign bytes into the live document with NO guard at all
            // until 2026-09-05, and the poll paths reach it — so a compacted
            // pod arriving here was CRDT-merged across lineages. That is not a
            // coin flip: `Automerge.from` renumbers opIds, so for every
            // collection added by a later `migrateDoc` the OLD lineage wins
            // DETERMINISTICALLY (measured 60/60), silently reverting every
            // post-compaction edit and republishing the hybrid fleet-wide.
            //
            // `baselineFpBeforeLoad` is captured BEFORE `syncService.load()`,
            // which nulls the baseline and re-seeds it with a null fingerprint —
            // reading it after the download could only ever answer "unknown",
            // which is `dirty`, which BLOCKS. That made the guard unable to ever
            // adopt, so no peer could take a compaction and none could
            // propagate.
            const mergeResult = await docClient.mergeRemoteEnvelope(
              remoteEnvelope,
              remoteEnvelope.familyId,
              { kind: 'baseline', heads: decodeHeadsFingerprint(baselineFpBeforeLoad) }
            );
            if (mergeResult.action === 'kept-local') {
              // Our unpublished compaction stands; the next save carries it up.
              keepLocalDocumentAndAdoptEnvelopeKeys(remoteEnvelope, liveKey);
              return { success: true }; // commit NO baseline — see the helper
            }
            // `?? true` is deliberate, not defensive noise: an absent field means
            // we do not KNOW the outcome, and both unknowns must resolve to the
            // safe direction — re-project rather than show stale data, re-upload
            // rather than drop a local change. (It also keeps older/partial test
            // doubles honest instead of silently disabling the reload.)
            changed = mergeResult.changed ?? true;
            dirty = mergeResult.dirty ?? true;
            // NOT `dirty ? null : mergeResult.heads`: `mergeRemoteEnvelope`'s adopt
            // branch hardcodes `dirty: false` while `migrateDoc` may have moved the
            // doc, so `heads` can be strictly ahead of Drive. `remoteHeads` is
            // captured from the unmigrated decrypted remote and is sound on both
            // branches.
            driveHeads = mergeResult.remoteHeads ?? null;
          } else {
            // Replace: adopt remote (+ recover any unsynced cache) to prevent loss.
            const famId = useFamilyContextStore().activeFamilyId;
            if (famId) {
              const recovered = await replaceDocWithCacheRecovery(
                remoteEnvelope,
                famId,
                liveKey,
                chosenByUser
              );
              if (recovered === KEPT_LOCAL) {
                // We hold the newer lineage. The helper adopted the remote's key
                // dicts and armed the publish; everything below would undo that —
                // `commitRemoteBaseline` nulls a good fingerprint (so
                // `isFullySynced` can never be true again), `reloadAllStores`
                // calls `cancelPendingSave`, and `confirmRemoteMerged` certifies
                // a baseline this document provably does not contain.
                return { success: true };
              }
              driveHeads = recovered;
            } else {
              // No cache to recover — adopt the remote wholesale.
              // This branch adopts Drive's document verbatim (nothing local survived
              // the drop), so `remoteHeads` is exactly as sound here as on the merging
              // branch. Discarding it would forfeit the next skip and log a WARN-level
              // fail-open on an open that converged perfectly.
              // ⚠️ `no-local-document`, NOT `user-file`. This is a
              // cross-family safety install: the worker may be holding a
              // DIFFERENT family's document, and there is nothing of THIS
              // family to preserve. Saying `user-file` would let a `same`
              // verdict return `merge`, CRDT-merging the remote into a foreign
              // family's document — durable cross-family corruption. Two
              // orthogonal questions, two arms.
              const adopted = await docClient.mergeRemoteEnvelope(
                remoteEnvelope,
                remoteEnvelope.familyId,
                { kind: 'no-local-document' }
              );
              driveHeads = adopted.remoteHeads ?? null;
            }
          }

          // Update envelope and ensure syncService has the family key.
          // `replaceEnvelope` merges in local-only key entries (rotate-key
          // writes that may not be on the fetched envelope yet) — see the
          // envelope-replacement invariant near the top of this file.
          const merged = replaceEnvelope(remoteEnvelope);
          // `liveKey`, not `familyKey.value!` — this is the terminus of the
          // NORMAL branch, reached after a multi-megabyte network read, and the
          // ref can genuinely have gone null in that window (a sign-out nulls it
          // AFTER `syncService.reset()`, so the assertion handed `setFamilyKey`
          // an undefined key, posted it to the worker, and re-seeded the
          // departed family's envelope over the one `reset()` had just cleared).
          // The other two branches were converted; this one was missed.
          syncService.setFamilyKey(liveKey, merged);

          // Terminus 1 (#61 C10): the worker's doc now provably contains the remote
          // state `syncService.load()` sampled BEFORE the download, so commit that
          // revision as the durable open-guard baseline. Zero-network (a worker RPC).
          // This replaces the old getFileTimestamp round-trip that used to sit here.
          syncService.commitRemoteBaseline(driveHeads);

          // `dirty` is derived purely from Automerge doc heads, so it can NEVER be
          // true for an envelope-only change. But a save publishes the envelope key
          // dicts too, and `replaceEnvelope` has just merged in any local-only
          // entries (a passkey enrolled while Drive was unreachable, a rotate-key
          // write). Those are documented as "riding the next successful save"
          // (PasskeySettings.vue, LoadPodView.vue), so the save trigger must
          // consider them or the passkey never reaches Drive and the member cannot
          // unlock the pod from another device.
          const envelopeGainedLocalKeys = keyDictSize(merged) > keyDictSize(remoteEnvelope);

          lastSync.value = toISODateString(new Date());

          if (changed) await reloadAllStores();

          if (merging) {
            // Runs unconditionally, NOT gated on `changed`. It is a read-mostly scan
            // that mutates only when it finds something, and it is the self-heal for
            // duplicates that already exist — including a dedup interrupted midway
            // (it deletes one row at a time). A warm-cache single-device user takes
            // this path with `changed === false` on every open, so gating it here
            // would mean those duplicates are never swept at all.
            const dupsRemoved = await deduplicateRecurringTransactions();
            if (dupsRemoved > 0) {
              await reloadAllStores();
            }

            // Re-upload when the converged doc still carries local changes the remote
            // lacks. This is a CONSISTENCY fix, not the write-coalescing the ADR-032
            // addendum forbids: `dirty === false` means local and remote already
            // agree, so the write would publish nothing. The other three save call
            // sites have always gated on `dirty`; this one was the outlier.
            //
            // `dupsRemoved` is NOT redundant with `dirty`, and this is subtle: the
            // dedup's own mutations DO arm a save via `localChangeHandler`, but
            // `reloadAllStores()` calls `syncService.cancelPendingSave()` — so the
            // reload two lines above silently discards it. Without this term the
            // deletions live only in the local doc + cache, Drive keeps the
            // duplicates, and every other device keeps showing them.
            if (dirty || dupsRemoved > 0 || envelopeGainedLocalKeys) {
              syncService.triggerDebouncedSave();
            }
          } else if (dirty || envelopeGainedLocalKeys) {
            // ⚠️ THE REPLACE BRANCH NEEDS THIS TOO — the third instance of one
            // bug. `replaceDocWithCacheRecovery` arms a publish when the merge
            // left us ahead of Drive (an adopt whose `migrateDoc` emitted a real
            // change is the common case), and `reloadAllStores()` twenty lines
            // above calls `cancelPendingSave()` and drops it. The re-arm below
            // it was written inside `if (merging)`, which is false on EVERY
            // cold open, so the delta never reached Drive and #65 reported
            // `unpushed-local-changes` on every open forever with nothing ever
            // repairing it. The same shape was fixed at the two cold-boot
            // decrypt paths; this is the one that was left.
            syncService.triggerDebouncedSave();
          }

          // The text `syncService.load()` handed us has now been MERGED, so the
          // revision marker it stamped provisionally is earned. Without this the
          // baseline would be dropped on the next check and every open would do
          // a full read.
          syncService.confirmRemoteMerged();
          await runPostLoadDriveHousekeeping();
          return { success: true };
        } catch (e) {
          // A payload failure is NOT a credential problem, and swallowing it
          // here is what made the honest message unreachable on the path a
          // memory-limited tablet actually takes: this catch turned it into a
          // console.warn, then returned `needsPassword: true` — a lie, the key
          // was in hand — which routed the user to a password prompt for a
          // failure no password can fix, and pinned the multi-megabyte envelope
          // in `pendingEncryptedFile` on the way. Let it out; App.vue and the
          // resume flow both classify it.
          if (isRemoteBlocker(e)) {
            // ⚠️ THE OTHER HALF, and it is the one that loses other people's
            // data. `syncService.load()` already stamped this revision as the
            // baseline; leaving it there makes the next change check answer
            // 'unchanged', so `fetchAndMergeRemote` returns without throwing and
            // the following save writes a full base over a revision this
            // document never contained. Roll it back, and latch — this is the
            // Drive cohort's read path, which never goes through
            // `fetchAndMergeRemote` and so never armed the breaker.
            syncService.rollbackRemoteMarker();
            syncService.noteRemoteBlocked(e);
            throw e;
          }
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
      // ⚠️ TOTAL, not per-branch. `syncService.load()` stamps the remote's
      // revision BEFORE the download, and only two of this function's exits
      // called confirm or rollback. A transient read failure, an `auth` return,
      // a `not-found` return or the `needsPassword` return all left a baseline
      // claiming a revision nothing merged — after which the next change check
      // answers 'unchanged', `fetchAndMergeRemote` returns without throwing, and
      // the following save writes over it. Rolling back anything still pending
      // at exit makes every path safe by construction; `confirmRemoteMerged`
      // has already cleared it on the one path that earned it.
      syncService.rollbackRemoteMarker();
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
  async function decryptPendingFile(
    password: string,
    /**
     * ⚠️ CONSENT TRAVELS WITH THE CALL, FROM THE SITE THAT OBTAINED IT.
     *
     * `true` only from Settings → Family Data Options, whose confirmation reads
     * "This will replace all local data with the contents of the selected file
     * and set it as your data file." That sentence IS the `user-file` lineage
     * context, which never blocks and turns `ours-newer` into a wholesale adopt.
     *
     * It was briefly a `userChose` marker stored on `pendingEncryptedFile`, and
     * that was wrong twice over. `loadFromNewFile` has FOUR callers — Settings,
     * `LoadPodView`, `JoinPodView` and `manualImport` — and only the first
     * confirms anything, so the login-screen file picker armed a destructive
     * adopt with no dialog ever rendered. And a marker on the ref OUTLIVES the
     * flow that set it: `clearPendingEncryptedFile` has one call site in the
     * whole app, so a cancelled decrypt left it armed for the silent
     * trusted-device probe, the biometric unlock and the PIN path to spend — a
     * person answering "prove it's you", not "replace all my data". Same failure
     * as the module-level one-shot before it; storing it on a ref merely made
     * the lifetime longer.
     */
    opts: { userChoseThisFile?: boolean } = {}
  ): Promise<{
    success: boolean;
    error?: string;
    memberIds?: string[];
    /** True when the FAMILY RECOVERY PASSPHRASE (not a member password) unlocked the
     *  file — identity is NOT established; callers must route to a person pick/prove. */
    viaRecoveryPassphrase?: boolean;
    /**
     * Set when the envelope decrypted but the payload could not be loaded as a
     * usable Automerge doc. Lets the caller distinguish that from a wrong
     * password / network failure when picking the user-facing message.
     *
     * Carries the ERROR, not a flag per class: consumers branch on
     * `instanceof` (`CorruptPayloadError` = bad bytes, `PayloadTooLargeError` =
     * this device ran out of memory), so a future sibling needs no new field.
     *
     * ⚠️ `RemoteBlocker`, not `PayloadLoadError`. The lineage guard now throws
     * in the worker, so a `PodLineageError` reaches this path too — and when
     * this field was payload-only, a lineage block arrived with it UNSET, which
     * `LoadPodView` reads as a stale credential and answers by deleting the
     * device's cached family key. Every blocker answers `inlineMessageKey`;
     * only the payload family answers `keyMayBeWrong`, so that question stays
     * behind an `instanceof`.
     */
    payloadError?: RemoteBlocker;
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
      const {
        familyKey: fk,
        memberIds,
        viaRecoveryPassphrase,
      } = await tryUnwrapFamilyKey(pending.envelope, password);

      // Hoisted above the post so the actor can be derived for the RIGHT family
      // — a pure move, no behaviour change.
      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      // Post the just-unwrapped key + the stable actor so it can decrypt + merge.
      await docClient.setFamilyKey(fk, famId ?? '');

      // Adopt the payload (+ recover any unsynced cache) to prevent data loss.
      if (famId) {
        // The helper may arm a publish (kept-local, an adopt whose migration
        // emitted a change, or a rebase that replayed offline work). The
        // `reloadAllStores()` below cancels it and puts it back — see the
        // comment on that cancel. Nothing to track here.
        await replaceDocWithCacheRecovery(pending.envelope, famId, fk, !!opts.userChoseThisFile);
      } else {
        // ⚠️ `no-local-document`: no `familyId`, so nothing of this family is
        // installed and the lineage question is moot. Never `user-file` — that
        // would permit a merge into whatever document the worker holds.
        await docClient.mergeRemoteEnvelope(pending.envelope, pending.envelope.familyId, {
          kind: 'no-local-document',
        });
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
      // NON-FATAL (review R2-F1): the decrypt already succeeded and the pending file is
      // consumed — a cache failure (registry IDB blocked, v6-upgrade race, private
      // mode) must never fail the open, or LoadPodView's success:false handling would
      // destroy the still-valid trusted key. Same treatment as createNewFile step 7.
      try {
        const settingsStore = useSettingsStore();
        if (familyCtx.activeFamilyId && fk) {
          const exported = await getExportedFamilyKey();
          if (exported) {
            await settingsStore.cacheFamilyKey(exported, familyCtx.activeFamilyId, {
              force: true,
            });
          }
        }
      } catch (cacheErr) {
        reportError({
          surface: 'login-flow',
          message: 'cacheFamilyKey after decryptPendingFile failed (non-fatal)',
          error: cacheErr,
          severity: 'warning',
          context: { action: 'cache_after_decrypt_failed' },
        });
      }

      // Reload all stores. It restores any publish the merge armed, so a
      // document this device alone holds still reaches Drive.
      await reloadAllStores();

      // Arm auto-sync
      setupAutoSync();

      return { success: true, memberIds, viaRecoveryPassphrase };
    } catch (e) {
      const errorMessage = (e as Error).message;
      // ⚠️ ANY BLOCKER. The lineage guard throws in the WORKER now, so a
      // `PodLineageError` reaches this password path too; without this arm it
      // latched nothing, surfaced nothing, and reported nothing.
      if (isRemoteBlocker(e)) {
        // ⚠️ DO NOT null `pendingEncryptedFile` here to release the payload.
        // It looks like an easy memory win and it breaks the UI that is on
        // screen at that exact moment: `LoadPodView` keeps its decrypt modal
        // open (it only closes on success) and every computed it binds reads
        // through this ref, so the family name, the member count and — the one
        // that matters — the recovery-kit escape hatch all vanish just as the
        // user needs them, and a retry renders the untranslated
        // 'No pending encrypted file'. The envelope is released normally when
        // the flow ends.
        notePodUnopenable(e);
        return { success: false, error: errorMessage, payloadError: e };
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

  // ⚠️ Deliberately PAYLOAD-ONLY, unlike the remote paths. This decrypts THIS
  // device's local cache; there is no remote document to compare a lineage
  // against, so a `PodLineageError` cannot arise here and widening the type
  // would push a case its callers (App.vue's cache-corrupt self-heal) cannot
  // meaningfully answer.
  async function loadFromPersistenceCache(
    keyB64: string,
    activeFamilyId: string,
    options?: { preservePermissionState?: boolean; onEarlyPaint?: () => void }
  ): Promise<{ success: boolean; payloadError?: PayloadLoadError }> {
    let paintedFromSnapshot = false;
    try {
      // Import family key directly from base64 (not password-derived), post it to
      // the worker, then open the cache DB + load the cached doc + envelope.
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(keyB64)));
      await docClient.setFamilyKey(fk, activeFamilyId);

      // ADR-032 FAST FIRST PAINT: post the projection-snapshot RPC FIRST (it decrypts
      // + streams the last projection in <1s, NO Automerge rebuild) and the
      // authoritative rebuild SECOND — both BEFORE any paint. The serial worker FIFO
      // then runs snapshot → rebuild, so a user mutation issued after the snapshot
      // paints necessarily enqueues THIRD (after the rebuild installs the doc), and
      // `requireDoc('mutate')` succeeds. The snapshot installs NO doc; the rebuild is
      // the sole source of truth. See docs/plans/2026-08-12-app-open-instant-projection-snapshot.md.
      const paintStart = performance.now();
      const snapPromise = docClient.loadProjectionSnapshot(activeFamilyId);
      const loadedPromise = docClient.initAndLoadCache(activeFamilyId);

      try {
        const snap = await snapPromise;
        noteOpenCycleSnapshot(snap.hit); // no-op outside an open window
        if (snap.hit) {
          if (!options?.preservePermissionState) {
            isConfigured.value = true; // show the data UI now, from the snapshot
            needsPermission.value = true;
          }
          await reloadAllStores();
          paintedFromSnapshot = true;
          snapshotPaintedThisSession.value = true; // user is now looking at cached data
          isBackgroundSyncing.value = true; // reuse the existing orange bar until authoritative
          recordPerf('snapshot.hydrate', performance.now() - paintStart);
          logEvent({ level: 'info', surface: 'open-snapshot', message: 'painted from snapshot' });
          // Release the caller's loading gate NOW — the stores hold the snapshot data.
          // Without this the view stays on the placeholder until the (slow) authoritative
          // rebuild below resolves, which is exactly the wait the snapshot exists to avoid.
          options?.onEarlyPaint?.();
        } else {
          logEvent({
            level: 'info',
            surface: 'open-snapshot',
            message: `snapshot miss (${snap.reason ?? 'unknown'}) — using rebuild`,
          });
        }
      } catch (e) {
        // The worker returns {hit:false} on any failure, so reaching here is unexpected.
        console.warn('[syncStore] snapshot fast-paint skipped:', e);
      }

      // AUTHORITATIVE rebuild result — the existing state-setup flow, unchanged.
      // Also carries the open-guard baseline row (#61 C-5), read in the SAME
      // round-trip as the cache so the two can never be out of step.
      const { loaded, remoteBaseline: baselineRow } = await loadedPromise;
      const { envelope: cachedEnvelope } = await docClient.readEnvelope();
      if (!cachedEnvelope || !loaded) {
        if (paintedFromSnapshot) isBackgroundSyncing.value = false;
        return { success: false };
      }

      // Set up state. `replaceEnvelope` is the uniform entry point even
      // for cache loads where `envelope.value` is typically null and the
      // merge is a no-op.
      familyKey.value = fk;
      const cachedMerged = replaceEnvelope(cachedEnvelope);
      syncService.setFamilyKey(fk, cachedMerged);
      // Seed (NOT commit) the in-memory baseline from the row (#61 C-5): the
      // subsequent open-guard read decides skip vs read from this. Committing it
      // would re-write the row and refresh `checkedAt`, defeating the 1h bound.
      syncService.seedRemoteBaseline(baselineRow);
      if (!options?.preservePermissionState) {
        isConfigured.value = true; // Data is loaded — show configured UI
        needsPermission.value = true; // Still need file permission for future saves
      }
      lastSync.value = toISODateString(new Date());

      // Authoritative re-hydrate: the Pinia stores are a COPY of the projection taken
      // here, not a reactive binding, so this MUST run after the rebuild's overwrite —
      // and the bar clears only after it (never on the raw projection overwrite).
      await reloadAllStores();
      if (paintedFromSnapshot) {
        isBackgroundSyncing.value = false;
        logEvent({
          level: 'info',
          surface: 'open-snapshot',
          message: 'authoritative landed, snapshot superseded',
        });
      }
      await reconcileDriveTokenForMember();
      // A real pod was loaded from cache — establish the podCreated invariant
      // (covers both the normal and preservePermissionState branches above).
      useAuthStore().markPodCreated();
      return { success: true };
    } catch (e) {
      if (paintedFromSnapshot) isBackgroundSyncing.value = false;
      console.warn('[syncStore] loadFromPersistenceCache failed:', e);
      if (e instanceof PayloadLoadError) {
        // Carry the class out. Flattened to a bare `{success:false}`, App.vue's
        // path 2 falls through to path 3, which calls `initDoc()` — a FRESH
        // EMPTY doc — while the cache DB is still open on this family because
        // the too-large branch deliberately did not clear it. The next mutation
        // then writes that empty doc as the BASE and deletes every preserved
        // increment. Flattening it is also a silent failure: the step, the byte
        // count and the whole telemetry trail die in a console.warn.
        return { success: false, payloadError: e };
      }
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
   * materializes cleanly (the worker's `loadAndVerify` throws `CorruptPayloadError`
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
   * The signup platform for a registry write, or `null` when detection fails.
   *
   * Deliberately NOT defaulting to `'web'` on failure: `null` means "unknown"
   * and is excluded from platform breakdowns, whereas a `'web'` fallback would
   * quietly inflate web signups — the exact distortion #71 exists to remove.
   */
  function registrySignupPlatform(): 'web' | 'ios' | 'android' | null {
    try {
      return getPlatform();
    } catch {
      return null;
    }
  }

  /**
   * Build the registry write payload for the active family.
   *
   * Extracted (#71) because the two call sites below drifted apart field-by-field
   * and a new field added to one silently missed the other. Returns the payload
   * and NOTHING else: the callers also differ in `registerFamilyOrThrow` vs
   * `registerFamily`, and that throw/no-throw choice carries the recovery-anchor
   * invariant documented at `_registerCurrentFamilySync` — folding the call in
   * here would demote that invariant to a boolean parameter.
   */
  function buildRegistryPayload(
    overrides: Partial<Pick<RegistryEntry, 'provider' | 'fileId' | 'displayPath'>> = {},
    opts: { isLoginEvent?: boolean; isSignupEvent?: boolean } = {}
  ): registry.RegistryWritePayload {
    const ctx = useFamilyContextStore();
    const authStore = useAuthStore();
    const provider = syncService.getProvider();
    return {
      provider: overrides.provider ?? storageProviderType.value ?? 'local',
      fileId: overrides.fileId ?? provider?.getFileId() ?? null,
      displayPath: overrides.displayPath ?? provider?.getDisplayName() ?? fileName.value ?? null,
      familyName: ctx.activeFamilyName ?? null,
      ownerEmail: authStore.currentUser?.email ?? null,
      ownerMemberId: authStore.currentUser?.memberId ?? null,
      subscribeNewsletter: authStore.newsletterOptIn ?? null,
      country: useSettingsStore().country ?? null,
      beanpodSizeKb: currentBeanpodSizeKb(),
      // Roster size from the decrypted doc — a bare count, never member data.
      // The envelope's wrappedKeys would undercount (unclaimed beans have none).
      memberCount: useFamilyStore().members.length || null,
      // Sent on every write, but the Lambda stamps it ONLY alongside
      // `isSignupEvent` and only when the field is still unset — so neither a
      // later login from another platform nor a disconnect/reconnect (which
      // DELETES and recreates the row) can move it.
      signupPlatform: registrySignupPlatform(),
      isLoginEvent: opts.isLoginEvent === true,
      isSignupEvent: opts.isSignupEvent === true,
    };
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
    // `registerFamilyOrThrow` (not `registerFamily`) — the latter swallows
    // network failures by design (fire-and-forget for background syncs).
    // Pod creation NEEDS this write to surface as a failure so the recovery
    // anchor invariant holds: post-`markPodCreated`, the registry has fileId.
    await registry.registerFamilyOrThrow(
      ctx.activeFamilyId,
      // Pod creation is the family's first login — and the ONLY write allowed to
      // stamp `signupPlatform`.
      buildRegistryPayload({}, { isLoginEvent: true, isSignupEvent: true })
    );
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
    // from the worker's `loadAndVerify` — if we see it anywhere, it's a verify
    // failure regardless of the step marker. (Defensive: the marker should
    // already be 'verify' by the time that throw happens.)
    // Either payload failure means the verify step failed. An OOM on a
    // just-created empty doc is effectively impossible, so a dedicated
    // CreatePodFailureReason would be unused surface area — the defensive
    // catch-all is the right answer here.
    if (e instanceof PayloadLoadError) return 'verify';
    return step;
  }

  /**
   * Create a new V4 beanpod file.
   *
   * Returns a `CreatePodResult` discriminated union: on success
   * `{ ok: true, kit }` — Phase 4: the pod is born PASSWORD-FREE, its only
   * envelope wrap is a freshly generated recovery kit's (generated internally
   * because the wrap needs the FK, which this function creates); the kit's
   * one-time code is returned for the wizard's mandatory display step and never
   * persisted. On failure `{ ok: false, reason, error }` where `reason` is the specific
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
    memberId: string,
    familyId: string,
    familyName: string,
    /** Optional "how did you hear about us?" answer (stable English label or free
     *  text) — appended to the pod-created Slack notification only. Never persisted. */
    heardVia?: string | null,
    /**
     * REVIEW-DEMO: demo/review seeding ONLY — skip every REMOTE interaction of
     * this create: the existing-pod registry LOOKUP (pre-write), the registry
     * REGISTRATION (step 6), and the pod-created Slack ping (step 8).
     *
     * Skipping the lookup is safe HERE AND ONLY HERE: `signUp` minted this
     * familyId seconds earlier, so it cannot already have a pod.
     *
     * LOCAL writes (cache, envelope, cached family key, session) are deliberately
     * UNAFFECTED — the demo session should behave exactly like a real local one
     * on-device, and `signOutAndClearData` cleans all of it up.
     *
     * Set ONLY by `seedDemoFamily`. A real pod must ALWAYS register: the registry
     * entry is the recovery anchor for `ResumePodSetup`. Delete this parameter
     * when demo mode is retired.
     */
    opts?: { suppressRemoteSideEffects?: boolean }
  ): Promise<CreatePodResult> {
    // REVIEW-DEMO: read once so the three call sites below can't diverge.
    const suppressRemote = opts?.suppressRemoteSideEffects === true;
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

    // Fail-closed: the unified create flow builds the owner credential-less at
    // step 1 (`passwordHash` = the DEFERRED_PASSWORD_HASH sentinel, permanently —
    // kit-born families are password-free) and applies the real PIN hash via
    // `rehydrateOwnerDoc` on the finish surface BEFORE this runs. If the owner
    // still has no `pinHash`, the PIN step was skipped — writing the pod would
    // mint a family whose owner can never authenticate. Refuse the write
    // (structurally impossible to ship a credential-less pod) and report it
    // loudly. Subsumes the old password-sentinel check: sentinel + no pinHash is
    // exactly this refused state.
    if (!ownerMember.pinHash) {
      const err = new Error(
        `createNewFile refused: owner member ${memberId} has no pinHash (rehydrateOwnerDoc was not called before the write)`
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
    let existingLookup: registry.RegistryLookup | null = null;
    // REVIEW-DEMO: skip this ENTIRE block for demo seeding — it is a live network
    // call and demo mode guarantees none. Safe here and only here: `signUp`
    // minted this familyId seconds ago, so it cannot already have a pod.
    if (!suppressRemote) {
      try {
        existingLookup = await registry.lookupFamilyResult(familyId);
        const existing = existingLookup.status === 'found' ? existingLookup.entry : null;
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
    }
    // DELIBERATE FAIL-OPEN, recorded so nobody "hardens" it without seeing the
    // trade: when the registry is unreachable we proceed with the create. Blocking
    // new-family creation during a registry outage would break onboarding for every
    // new user — far more common and more damaging than the narrow duplicate risk —
    // and `createNewFile` is one of the two creation paths that are explicitly
    // allowed. What changed is that the residual risk is now COUNTABLE.
    if (existingLookup?.status === 'unavailable') {
      logEvent({
        level: 'warn',
        surface: 'syncStore.createNewFile',
        message: 'existing-pod check unavailable — proceeding with create',
        context: { action: 'existing-pod-check-unavailable' },
      });
    }

    criticalWriteState.value = { kind: 'creating' };
    let step: CreatePodFailureReason = 'write';
    let partialFileId: string | null = null;

    try {
      // 1. Build the encrypted envelope (in-memory, no I/O). Phase 4: the
      // envelope's ONLY wrap at birth is the recovery kit's — full entropy,
      // offline-attack-proof; the owner's PIN is identity + device unlock,
      // never an envelope wrap. A kit-generation throw aborts here, BEFORE any
      // write, and surfaces through the mapped-error + cleanup path below.
      const fk = await generateFamilyKey();
      const { generateRecoveryKit } = await import('@/services/auth/recoveryKit');
      const kit = await generateRecoveryKit(fk);
      const wrappedKeys: Record<string, WrappedMemberKey> = {};
      // Note: the Automerge doc was initialized by `authStore.signUp()` (now in
      // the worker) before this function was called. We deliberately do NOT
      // re-init here — that would wipe the owner-member writes already in the doc.
      // Post the key to the worker, then have it encrypt the doc → payload; main
      // assembles the envelope (keys never leave main).
      await docClient.setFamilyKey(fk, familyId);
      const { payload } = await docClient.exportEncryptedPayload();
      const envelopeJson = createBeanpodV4(
        familyId,
        familyName,
        payload,
        wrappedKeys,
        {},
        {},
        {
          [kit.kitId]: kit.pkg,
        }
      );

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
      // REVIEW-DEMO: never plant a synthetic family in the real registry.
      if (!suppressRemote) await _registerCurrentFamilySync();

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
      // REVIEW-DEMO: a reviewer tapping the demo button must not ping #beanies.
      if (!suppressRemote) {
        slackNotify(
          `🎉 *Family pod created!*\n*Family:* ${familyName}\n*Owner:* ${ownerMember.name}\n*Storage:* ${storageLabel}` +
            (heardVia ? `\n*Heard via:* ${heardVia}` : '') +
            `\n*Platform:* ${getPlatformLabel()}\n*Device:* ${getDeviceLabel()}`
        );
      }

      return { ok: true, kit: { kitId: kit.kitId, code: kit.code } };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const reason = classifyCreateFailure(step, err);
      console.error(`[syncStore] createNewFile failed at step '${step}':`, err);
      // Cleanup is best-effort and swallows its own errors; we always return
      // the originating reason + error so the caller can show a focused
      // user-facing message.
      await handleCreateFailure(partialFileId);
      // Drop any offline-queued save left by the failed write. `provider.write`
      // enqueues its envelope on a 401 / TokenExpired / 5xx / network error, and
      // that envelope is encrypted with the family key we are about to discard.
      // If it survives (the queue persists to sessionStorage and a NON-auth-gated
      // 'token-acquired'/'online' flush, or a post-reload 'startup', can fire it)
      // it would later overwrite a subsequently-created good pod with bytes no
      // cached key can decrypt — bricking the pod. During a create the only queued
      // content is this doomed create-write, so clearing on failure is safe and
      // closes the data-loss path for BOTH the auto-retry and the manual re-tap.
      clearQueue();
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
  ): Promise<{ success: boolean; error?: string; payloadError?: RemoteBlocker }> {
    const pending = pendingEncryptedFile.value;
    if (!pending) return { success: false, error: 'No pending file' };

    try {
      // Hoisted above the post so the actor can be derived for the RIGHT family
      // — a pure move, no behaviour change.
      const famId = pending.envelope.familyId || useFamilyContextStore().activeFamilyId;
      // Post the key + the stable actor so it can decrypt + merge/adopt.
      await docClient.setFamilyKey(fk, famId ?? '');
      if (famId) {
        // The helper may arm a publish (kept-local, an adopt whose migration
        // emitted a change, or a rebase that replayed offline work). The
        // `reloadAllStores()` below cancels it and puts it back — see the
        // comment on that cancel. Nothing to track here.
        // ⚠️ NEVER `user-file` HERE, and deliberately no parameter to pass
        // one. This is the passkey / biometric / trusted-device / PIN path:
        // the human proved WHO THEY ARE. Nobody showed them a dialog about
        // replacing their data, so this path may not reach the context that
        // discards it.
        await replaceDocWithCacheRecovery(pending.envelope, famId, fk);
      } else {
        // ⚠️ `no-local-document`: no `familyId`, so nothing of this family is
        // installed and the lineage question is moot. Never `user-file` — that
        // would permit a merge into whatever document the worker holds.
        await docClient.mergeRemoteEnvelope(pending.envelope, pending.envelope.familyId, {
          kind: 'no-local-document',
        });
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
      // just proved a family secret on this device — it's clearly their personal device.
      // NON-FATAL (review R2-F1): see decryptPendingFile — a cache failure must never
      // fail an open that already succeeded.
      try {
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
      } catch (cacheErr) {
        reportError({
          surface: 'login-flow',
          message: 'cacheFamilyKey after decryptPendingFileWithKey failed (non-fatal)',
          error: cacheErr,
          severity: 'warning',
          context: { action: 'cache_after_decrypt_failed' },
        });
      }

      await reloadAllStores();
      setupAutoSync();

      // A real pod was decrypted (the invite/join cached-key path) — establish
      // the podCreated invariant so a joinee is never routed to create recovery.
      useAuthStore().markPodCreated();
      return { success: true };
    } catch (e) {
      // Carry the class out, exactly as `decryptPendingFile` does. This is the
      // BUSIER of the two: it backs the trusted-device auto-open, the PIN cold
      // path (the default sign-in since 0.13R2), kit redeem and the invite
      // join. Without it every one of those reads an out-of-memory failure as a
      // bad credential — and `LoadPodView.tryAutoDecrypt` responds by DELETING
      // the device's cached family key, which was perfectly valid.
      // ⚠️ ANY BLOCKER, not only a payload one. The lineage guard now throws in
      // the WORKER, so a `PodLineageError` arrives here on the PIN /
      // trusted-device / password cold-open path. Without this arm it latched
      // nothing (so the 10s poller kept re-downloading the whole pod), reached
      // no surface (so `LineageBanner` never rendered), reported nothing to
      // CloudWatch, and — worst — returned WITHOUT `payloadError`, which
      // `LoadPodView.tryAutoDecrypt` reads as a stale credential and responds to
      // by DELETING this device's perfectly good cached family key.
      if (isRemoteBlocker(e)) {
        notePodUnopenable(e);
        return { success: false, error: (e as Error).message, payloadError: e };
      }
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
  /**
   * Returns whether the invite key REACHED the durable file (R2-F15): a device link
   * with a 15-minute expiry is useless if the key is local-only — the mint UI needs
   * the truth to warn instead of handing out a dead QR. (In-memory + cache always
   * updated; a false return means "rides the next save".)
   */
  async function addInvitePackage(
    tokenHash: string,
    pkg: { salt: string; wrapped: string; expiresAt: string }
  ): Promise<boolean> {
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
      logEvent({
        level: 'warn',
        surface: 'login-flow',
        message: 'invite key publish deferred — not yet on the durable file',
        context: { action: 'invite_key_publish_deferred' },
      });
    }
    return saved;
  }

  /**
   * Persist a family-name rename to the DURABLE .beanpod envelope.
   *
   * The family name lives in the V4 envelope metadata (`familyName`), NOT in the
   * Automerge document — so an ordinary doc autosave never carries a rename, and
   * `reEncryptEnvelope` preserves the loaded envelope's `familyName` on every
   * save. Left alone, a rename only reaches the LOCAL registry (familyContext),
   * which a fresh load rebuilds from `envelope.familyName` (see syncService's
   * load path), so the new name is silently lost on a new device, a cleared
   * cache, or the in-memory review demo. This updates the in-memory envelope via
   * `replaceEnvelope` (per the write invariant — it also pushes the envelope to
   * the worker/service cache the durable save reads) and forces a save so the
   * file the NEXT load reads carries the new name.
   *
   * Returns whether the durable save succeeded. A `false` is non-fatal: the new
   * name is already staged in the service envelope, so the next successful save
   * (any doc change) will carry it. Never throws.
   */
  async function persistFamilyName(name: string): Promise<boolean> {
    if (!envelope.value) {
      // No durable pod yet (pre-creation) or an in-memory review-demo session —
      // there is no file to persist into; the local registry update is all there is.
      logEvent({
        level: 'info',
        surface: 'family-rename',
        message: 'family rename: no envelope loaded, skipping durable persist',
        context: { action: 'persist-skip-no-envelope' },
      });
      return false;
    }
    if (envelope.value.familyName === name) return true;

    replaceEnvelope({ ...envelope.value, familyName: name });
    const saved = await syncNow(true);
    // Mirror the new name into the remote registry so the account's family list
    // reflects it without waiting for the next login event. Best-effort (the call
    // is fire-and-forget and self-logs its own failures).
    registerCurrentFamily({}, { isLoginEvent: false });

    logEvent({
      level: saved ? 'info' : 'warn',
      surface: 'family-rename',
      message: saved
        ? 'family rename persisted to durable envelope'
        : 'family rename staged but durable save failed; will persist on the next save',
      context: { action: saved ? 'persist-ok' : 'persist-deferred' },
    });
    return saved;
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
    // Clear the read-error classification too: `setProvider` fires the state
    // callback SYNCHRONOUSLY, so a surviving error from the previous family
    // would otherwise leak into the next one before its first read starts.
    backgroundSyncError.value = null;
    backgroundSyncErrorKind.value = null;
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
   * Build the encrypted `.beanpod` envelope for a manual export.
   *
   * Deliberately does NOT deliver the file. Delivery toasts on failure, and a
   * Pinia store that can talk to the user is a boundary that is very hard to
   * re-close — so the store hands back bytes and its page (SettingsPage) calls
   * `deliverFile`, then `markExported()` only if a file actually landed.
   *
   * THROWS when there is no family key rather than setting `error.value` and
   * returning: the old shape was unsurfaced (nothing rendered `error.value` on
   * this path), so the export silently did nothing.
   */
  async function buildExportEnvelope(): Promise<{ json: string; filename: string }> {
    if (!familyKey.value || !envelope.value) {
      throw new Error('No family key — cannot export');
    }
    // The worker encrypts the current doc → payload; main assembles the envelope.
    const { payload } = await docClient.exportEncryptedPayload();
    const date = new Date().toISOString().split('T')[0];
    return {
      json: reEncryptEnvelope(envelope.value, payload),
      filename: `my-family-${date}.beanpod`,
    };
  }

  /** Stamp the export timestamp. Called ONLY once a file genuinely landed. */
  function markExported(): void {
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
    // A doc is live and being projected into Pinia, so whatever latched
    // `podUnopenable` no longer holds. THE chokepoint: every successful open
    // reaches here (cold, cached, dropped, picked, decrypted, joined), and the
    // paths that must NOT clear it do not — `shouldSkipOpenRead()`'s branch
    // returns 'refreshed' having downloaded and materialized nothing, and an
    // earlier attempt to clear from `runPostLoadDriveHousekeeping` disarmed the
    // breaker there and let the poller straight back on.
    bumpOpenCycle('storeReload'); // no-op outside an open window
    isReloading = true;
    // ⚠️ CANCEL, BUT REMEMBER. The cancel buys a quiet window for the
    // projection; it is not a decision that the pending publish was unwanted.
    // Three separate bugs came from conflating those: a kept-local publish, an
    // adopt whose migration emitted a real change, and the dedup's own
    // deletions were each armed by a merge and then silently dropped here, and
    // each was fixed by adding one more re-arm at one more call site — which
    // left the NEXT branch (the rebase, Stage 3) broken in the same way, its
    // rescued offline work sitting on one device with nothing to push it.
    // Restoring the intent here covers every branch, including ones not yet
    // written. A caller that genuinely means to abandon a save cancels BEFORE
    // calling this (`useRemoteFileOverLocalDocument`, `reloadIfFileChanged`),
    // so there is nothing left for this to find.
    const publishWasArmed = syncService.cancelPendingSave();

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
      const mealPlanStoreInst = useMealPlanStore();
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
          mealPlanStoreInst.loadMealPlans(),
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
      // Put back what the cancel above took. After `isReloading` clears, so the
      // save it arms is not itself suppressed by the guard.
      if (publishWasArmed) syncService.triggerDebouncedSave();
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
  async function tryDecryptWithCachedKey(): Promise<
    boolean | { success: false; payloadError: RemoteBlocker }
  > {
    const familyCtx = useFamilyContextStore();
    const settingsStore = useSettingsStore();
    const famId = familyCtx.activeFamilyId;
    const cachedKeyB64 = famId ? await settingsStore.getCachedFamilyKey(famId) : null;
    if (!cachedKeyB64) return false;

    try {
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(cachedKeyB64)));
      const result = await decryptPendingFileWithKey(fk);
      // Carry the class out. This helper backs the MAIN cold-boot path (App.vue
      // path 1b's `needsPassword` branch), the background refresh and the
      // file-changed reload; returning a bare `false` sent all three to a
      // credential-recovery screen for a failure no credential can fix, and the
      // two refresh callers additionally cleared `pendingEncryptedFile`.
      if (result.payloadError) return { success: false, payloadError: result.payloadError };
      return result.success;
    } catch (e) {
      // Cached key invalid — caller handles fallback. Logged rather than
      // swallowed: this DELETES a credential, so "why did my trusted device
      // stop working?" has to be answerable from the firehose alone.
      logEvent({
        level: 'warn',
        surface: 'pod-load-failure',
        message: 'cached family key discarded after a failed decrypt',
        context: { action: 'cached-key-cleared' },
        error: e instanceof Error ? e : new Error(String(e)),
      });
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
   *
   * NOTE: this is the ONLY writer that raises `showGoogleReconnect` on the read
   * path, and deliberately so — raising the banner from anywhere else (e.g. a
   * manual-refresh handler) trips the guard below and silently suppresses the
   * critical page, trading a real alerting signal for a faster banner.
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
  async function backgroundSyncFromFile(
    openToken?: OpenToken,
    opts?: { manual?: boolean }
  ): Promise<RefreshOutcome> {
    // ⚠️ The latch gates the WORK, not just the timer. `AppHeader`'s Refresh
    // calls this directly and `useStaleTabRefresh` calls `reloadIfFileChanged`
    // directly, so a latch checked only inside `startFilePolling` let every tab
    // wake and every Refresh tap re-download the whole pod, re-hit the same
    // allocation and fire another critical page — one per wake, indefinitely,
    // because wakes are far outside the 60s dedup window.
    // A MANUAL refresh is the user asking again, which is the half-open state a
    // circuit breaker needs: clear the latch so exactly one attempt runs. An
    // automatic tick must never do this — that is the download storm the latch
    // exists to stop — and without it the latch was write-only, since both of
    // its automatic clear sites now sit behind the guards that read it.
    if (opts?.manual) syncService.retryAfterRemoteBlock();
    if (remoteUnreadable()) {
      // Close the open cycle and log the outcome like every other terminal —
      // an early return above the try left the window open (so the cycle shipped
      // as `open-abandoned` with zero reads) and made this the one
      // `RefreshOutcome` with no manual-refresh telemetry at all.
      endOpen('open-complete', openToken);
      if (opts?.manual) logManualRefreshOutcome('skipped-unopenable');
      return 'skipped-unopenable';
    }
    if (isBackgroundSyncing.value) {
      // A sync is already in flight. If an OPEN handed us its window, close it —
      // otherwise it stays open until the next `beginOpen` and is emitted as
      // `open-abandoned`. Callers without a token (header Refresh, deferred
      // config-heal) present none, so `endOpen` ignores them and the real open's
      // window survives. This call did NOT run a read, so it must NOT report
      // success (the false-success #69 targets) — the in-flight sync + progress
      // bar are the user's feedback.
      endOpen('open-complete', openToken, { detailSuffix: 'sync-already-in-flight' });
      if (opts?.manual) logManualRefreshOutcome('skipped-in-flight');
      return 'skipped-in-flight';
    }
    // Classified at each terminal below; `finally` emits it once.
    let openOutcome: OpenOutcome = 'open-complete';
    // #61: the guard's classified reason, ridden to CloudWatch as `error_code`.
    let openFailReason: string | undefined;
    // The per-call refresh result, returned to the caller + logged for manual
    // calls. Defaults to 'refreshed'; failure terminals reassign it.
    let refreshResult: RefreshOutcome = 'refreshed';

    isBackgroundSyncing.value = true;
    backgroundSyncError.value = null;
    backgroundSyncErrorKind.value = null;

    try {
      // #61 OPEN GUARD: if the file's revision has not advanced past the state we
      // durably cached (within the 1h trust window), the whole open-path download +
      // remoteLoad + merge + reloads + ungated upload is waste — skip it. The
      // envelope on this path came from `loadFromPersistenceCache`'s `setFamilyKey`
      // (cachedMerged) and stays correct because an envelope-only change (peer key
      // rotation / member add) rewrites the file and advances `version`, so the
      // guard reads (C21). Every uncertainty falls through to a normal read.
      const { skip, reason } = await syncService.shouldSkipOpenRead();
      openFailReason = reason;
      if (skip) {
        openOutcome = 'open-skip';
        await runPostLoadDriveHousekeeping(); // same terminus as the load path (Req 12)
        return refreshResult; // 'refreshed' — the file is confirmed unchanged
      }
      // The guard fell open on UNCERTAINTY (not a clean `changed`/`no-baseline`) —
      // record it as `open-fail-open` on a successful read (C7), so a rising
      // fail-open rate is visible without a repro.
      // `unpushed-local-changes` (#65) joins these: it is the guard working exactly
      // as designed on a path that then completes successfully, NOT a fail-open on
      // uncertainty. Counting it as one would inflate the very fail-open rate #61
      // added to alert on, and emit a warn per crash-window recovery. Its sibling
      // reasons `baseline-heads-unknown` and `heads-probe-failed` stay OUT — those
      // are genuine uncertainty. All three still reach CloudWatch as `error_code`.
      const CLEAN_READ_REASONS = new Set([
        'changed',
        'no-baseline',
        'unpushed-local-changes',
        // The upgrade cohort: every device shipped before #65 decodes a legacy
        // bare-`ver:` row to an unknown fingerprint on its FIRST open after this
        // release. Benign, one-shot, and self-clearing at the next terminus — but
        // it fires simultaneously fleet-wide, and counting it as uncertainty would
        // desensitise the fail-open alert exactly when it is most needed. Still
        // reaches CloudWatch as `error_code`, so it stays countable.
        'baseline-heads-unknown',
      ]);
      const fellOpen = !CLEAN_READ_REASONS.has(reason);

      const loadResult = await loadFromFile({ merge: true });

      if (loadResult.success) {
        clearPodUnopenable(); // a read really succeeded
        setupAutoSync();
        if (fellOpen) openOutcome = 'open-fail-open';
        return refreshResult;
      }

      if (loadResult.needsPassword) {
        // Try existing family key first (loadFromFile already tried, but pending may need it)
        if (familyKey.value && pendingEncryptedFile.value) {
          try {
            await hydrateFromEnvelope(pendingEncryptedFile.value.envelope);
            // A pod WAS decrypted+loaded on this branch, but it did NOT go through
            // loadFromFile's success terminus — so run the SAME housekeeping (incl.
            // markPodCreated + token-expiry wiring), not a bare setupAutoSync.
            await runPostLoadDriveHousekeeping();
            return refreshResult;
          } catch (e) {
            // ⚠️ `keyMayBeWrong` gates this. `hydrateFromEnvelope` decrypts the
            // REMOTE envelope with the in-memory family key, which is the
            // canonical key-mismatch site (a peer removed a member, or
            // re-encrypted). Latching on that would kill sync for the session
            // and tell the user their data is damaged, when falling through to
            // the cached key and "password may have changed" is the recoverable
            // path the code below already provides.
            // ANY blocker (payload, lineage, merge) — see `isRemoteBlocker`.
            // The `keyMayBeWrong` exemption below is payload-specific and stays
            // an `instanceof`; a lineage or merge block has no such recovery.
            if (isRemoteBlocker(e) && !(e instanceof PayloadLoadError && e.keyMayBeWrong)) {
              notePodUnopenable(e);
              // Classify the terminal too. Returning the initial 'refreshed'
              // with `openOutcome` still 'open-complete' reported a pod that
              // just failed to open as a SUCCESSFUL refresh: a green toast, an
              // info-level manual-refresh log, and a clean open cycle.
              openOutcome = 'open-failed';
              refreshResult = 'decrypt-failed';
              return refreshResult;
            }
            // Family key doesn't work — try cached key
          }
        }

        const success = await tryDecryptWithCachedKey();
        if (success === true) {
          await runPostLoadDriveHousekeeping();
          return refreshResult;
        }
        if (success !== false) {
          // A payload failure, not a credential one. "Password may have changed"
          // below would be a lie, and `pendingEncryptedFile.value = null` would
          // throw away the envelope.
          notePodUnopenable(success.payloadError);
          openOutcome = 'open-failed';
          refreshResult = 'decrypt-failed';
          return refreshResult;
        }

        // Can't decrypt — stale cached data is still usable. We reached Drive but
        // the shown data is behind (newer bytes we can't read) → 'stale'.
        backgroundSyncError.value = 'Could not refresh data — password may have changed';
        backgroundSyncErrorKind.value = 'decrypt';
        pendingEncryptedFile.value = null;
        openOutcome = 'open-failed';
        refreshResult = 'decrypt-failed';
        return refreshResult;
      }

      // Non-password failure (network, 404, auth-transient, etc.)
      const lastErr = syncService.getState().lastError;
      openOutcome = 'open-failed';
      // Trust `loadFromFile`'s own classification FIRST: an auth-masked 404 (an
      // expired token yields the same 404 as a missing file) carries
      // `reason: 'auth'` but a `DriveApiError:404:…` message, which the
      // `/silent refresh failed/i` string test cannot see. Without this the user
      // gets no reconnect and BackgroundSyncBar fires the generic toast it exists
      // to suppress on auth.
      if (loadResult.reason === 'auth' || isAuthTransientSyncError(lastErr)) {
        backgroundSyncError.value = lastErr ?? 'Token expired';
        backgroundSyncErrorKind.value = 'auth-transient';
        refreshResult = 'auth-failed';
        scheduleColdStartReconnectEscalation(lastErr);
      } else {
        backgroundSyncError.value = 'Could not refresh data from cloud';
        backgroundSyncErrorKind.value = 'network';
        refreshResult = 'network-failed';
      }
      return refreshResult;
    } catch (e) {
      openOutcome = 'open-failed';
      // A payload failure is NOT a network failure, and polling cannot fix it.
      // Left to the branches below it was filed as `network`, and the `finally`
      // then armed the 10s poller — which re-downloads the multi-megabyte file
      // and re-attempts the identical allocation every tick, swallowing each
      // failure in a console.warn. `payloadFailed` suppresses the poller.
      // ANY blocker, not just a payload one. A `PodLineageError` (terminus 4
      // now throws one) missed `notePodUnopenable` entirely, so `podUnopenable`
      // stayed false, the failure was filed as `network`, and the RAW English
      // "Pod lineage blocked: …" landed in the UI — untranslated, against the
      // CI-enforced i18n rule — while the honest recovery copy was unreachable.
      if (isRemoteBlocker(e)) {
        notePodUnopenable(e);
        refreshResult = 'network-failed';
        return refreshResult;
      }
      const msg = e instanceof Error ? e.message : 'Could not refresh data from cloud';
      backgroundSyncError.value = msg;
      const isAuth = isAuthTransientSyncError(msg);
      backgroundSyncErrorKind.value = isAuth ? 'auth-transient' : 'network';
      refreshResult = isAuth ? 'auth-failed' : 'network-failed';
      if (isAuth) scheduleColdStartReconnectEscalation(msg);
    } finally {
      isBackgroundSyncing.value = false;
      // Always start polling — even on error, next poll may succeed. A payload
      // failure is filtered inside `startFilePolling` by the `podUnopenable`
      // latch, which is the only place that cannot be walked around.
      if (!filePollingTimer) {
        startDeferredPolling();
      }
      // Path 1a handed us the open-cycle terminal (see App.vue's loadFamilyData
      // wrapper). This `finally` is the single close point for EVERY outcome —
      // success, needs-password, network/auth failure, or a throw — with the
      // outcome classified at each terminal rather than reported as success.
      // Callers with no token (Refresh, config-heal) close nothing. The #61 guard
      // reason rides along as `error_code` (skip / fail-open / why it read).
      endOpen(openOutcome, openToken, { failOpenReason: openFailReason });
      // MVO: the store owns manual-refresh telemetry (not the view). `refreshResult`
      // is set before every return/at the catch, so it is accurate here.
      if (opts?.manual) logManualRefreshOutcome(refreshResult);
    }
    // Reached only when the try body fell through without returning (the
    // non-password/auth/network failure path) or after the catch.
    return refreshResult;
  }

  /** Emit the single manual-refresh outcome event (MVO: store-owned telemetry). */
  function logManualRefreshOutcome(outcome: RefreshOutcome): void {
    logEvent({
      level: outcome === 'refreshed' || outcome === 'skipped-in-flight' ? 'info' : 'warn',
      surface: 'manual-refresh',
      message: 'refresh-outcome',
      context: { action: outcome, provider_type: storageProviderType.value ?? undefined },
    });
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
    if (remoteUnreadable()) return false; // see backgroundSyncFromFile
    if (!isConfigured.value || needsPermission.value || isReloading || isCheckingFile) return false;

    isCheckingFile = true;
    try {
      // #61 C14: reload only when the file actually CHANGED. `unknown` (transient
      // provider error) does NOT reload — a persistent error must not turn this
      // 10s poll into a read storm (matches today's null-timestamp → no reload).
      const change = await syncService.remoteChanged();
      // A genuine 404 (file deleted/moved) is classified `file-not-found`.
      // `remoteChanged` catches it, so it no longer reaches the catch below — surface
      // the "file missing" banner + stop polling HERE, mirroring the pre-#61 path
      // (only when the token is genuinely valid; an auth-masked 404 is the reconnect
      // path's job, and `remoteChanged` classifies that as `auth`, not this).
      if (change.status === 'unknown' && change.reason === 'file-not-found' && isTokenValid()) {
        driveFileNotFound.value = true;
        showSaveFailureBanner.value = true;
        stopFilePolling();
        return false;
      }
      if (change.status !== 'changed') return false;

      syncService.cancelPendingSave();

      isCrossDeviceReload = true;
      try {
        const loadResult = await loadFromFile({ merge: true });
        if (loadResult.success) {
          clearPodUnopenable(); // a read really succeeded
          return true;
        }

        if (loadResult.needsPassword) {
          // Try existing family key first (should work unless key was rotated)
          if (familyKey.value && pendingEncryptedFile.value) {
            try {
              await hydrateFromEnvelope(pendingEncryptedFile.value.envelope);
              return true;
            } catch (e) {
              // ⚠️ `keyMayBeWrong` gates this, exactly as in the twin in
              // `backgroundSyncFromFile`. `hydrateFromEnvelope` decrypts the
              // REMOTE envelope with the in-memory family key, so it is the
              // canonical key-rotation site, and the recoverable fallback
              // (`tryDecryptWithCachedKey` → re-prompt) is eight lines below.
              if (isRemoteBlocker(e)) {
                if (!(e instanceof PayloadLoadError && e.keyMayBeWrong)) {
                  notePodUnopenable(e);
                  return false;
                }
                // Recoverable (a rotated key). Never a comment-only handler:
                // falling through silently discarded the envelope below,
                // surfaced nothing, and left the 10s timer that called this
                // running — so the app re-downloaded and threw away the whole
                // pod every tick with nothing on screen. Stop the poll, keep the
                // envelope, and say it once.
                stopFilePolling();
                backgroundSyncError.value = useTranslationStore().t(payloadErrorMessageKey(e));
                backgroundSyncErrorKind.value = 'decrypt';
                return false;
              }
              // Family key doesn't work — try cached key
            }
          }

          // Try cached family key
          const success = await tryDecryptWithCachedKey();
          if (success === true) return true;
          if (success !== false) {
            // A payload failure. Keep the envelope (nulling it breaks the
            // decrypt modal's computeds) and latch the poller off.
            notePodUnopenable(success.payloadError);
            return false;
          }

          pendingEncryptedFile.value = null;
        }

        return false;
      } finally {
        isCrossDeviceReload = false;
      }
    } catch (e) {
      if (isRemoteBlocker(e)) {
        // `loadFromFile({merge:true})` rethrows it. Same reasoning as above:
        // never silently re-poll a failure a poll cannot fix. `isRemoteBlocker`
        // rather than `instanceof PayloadLoadError`: a lineage block reduced to
        // a `console.warn` here left the user with a stopped poller and no
        // message at all.
        notePodUnopenable(e);
        return false;
      }
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
  /**
   * A background refresh could not open the pod.
   *
   * Deliberately NOT the fatal overlay. These paths run over a session that
   * already painted real data from the local cache, so a `fixed inset-0
   * z-[300]` panel whose only button re-runs the same failing cycle would cover
   * a working app seconds after it opened. The user keeps their data; the sync
   * bar says the copy on Drive could not be read.
   *
   * Latches `podUnopenable` so the 10s poller stops re-downloading megabytes to
   * fail identically, and reports once (the too-large half is already reported
   * by `docClient.surface()`; `reportPayloadFailure` knows that).
   */
  /**
   * Which inline message the current block chose — the banner's only sound way
   * to distinguish the two lineage verdicts. Null whenever nothing is blocked.
   */
  const podBlockMessageKey = ref<PodBlockMessageKey | null>(null);

  /**
   * Leave a mark on this member's own row saying this device could not open the
   * family file for want of memory, so whoever CAN compact it sees the file read
   * as due.
   *
   * ⚠️ IT LIVES HERE, NOT ON THE FATAL OVERLAY PATH, and the difference is the
   * whole feature. `surfacePayloadFatal` runs where the app has NO document —
   * that is its stated invariant — so a write from there hits `requireDoc` and
   * throws, `mutate` is a USER_ACTION method so `docClient` toasts, and
   * `wrapAsync` toasts again with the raw engine string. The "silently
   * swallowed" version put two error toasts and two firehose events on top of a
   * fatal overlay, on the one device already having the worst day. Here a
   * session is live and the document exists, so the write can actually land.
   *
   * ⚠️ A COLD-BOOT OUT-OF-MEMORY STILL CANNOT SELF-REPORT. There is no document
   * to write to and nothing to publish it with; that is a real limit of the
   * mechanism, not an oversight, and the size heuristic is what covers it.
   */
  function noteDeviceCannotOpen(): void {
    const me = useFamilyStore().currentMember;
    if (!me) return;
    const today = toISODateString(new Date()).slice(0, 10);
    if (me.podTooLargeSeenAt === today) return; // already said so today
    void useFamilyStore()
      .updateMember(me.id, { podTooLargeSeenAt: today })
      .catch(() => {
        // Best effort. The message on screen is what matters; a missed mark
        // costs a heuristic, and the byte threshold still covers this family.
      });
  }

  function notePodUnopenable(err: RemoteBlocker): void {
    if (err instanceof PayloadLoadError && err.deviceCannotOpen) noteDeviceCannotOpen();
    // ⚠️ ARM THE SERVICE LATCH. Every guard reads `syncService`, and none of
    // these callers reach `fetchAndMergeRemote` — they call
    // `docClient.mergeRemoteEnvelope` directly — so without this the breaker was
    // dead code: `stopFilePolling()` below ran and the caller's own `finally`
    // re-armed the 10s timer straight through a guard that saw null.
    //
    // `noteRemoteUnreadable` also owns the report (once per class) and refuses
    // to latch a `keyMayBeWrong` failure, which is why this is a call rather
    // than a second copy of that logic.
    syncService.noteRemoteBlocked(err);
    // MIRROR the service's actual answer — do not assert it. `noteRemoteUnreadable`
    // declines to latch a `keyMayBeWrong` failure (a routine key rotation), so
    // asserting `true` here set the UI mirror and stopped the poller while the
    // authoritative latch stayed null — and the background refresh's own
    // `finally` then re-armed the 10s timer straight through a guard that saw
    // null, which is the download loop this whole mechanism exists to stop.
    podUnopenable.value = !!syncService.isRemoteBlocked();
    if (!podUnopenable.value) return; // recoverable: leave polling and the bar alone
    stopFilePolling();
    // `.inlineMessageKey` is the `RemoteBlocker` member, so a new blocker class
    // has to answer this rather than inherit someone else's copy.
    backgroundSyncError.value = useTranslationStore().t(err.inlineMessageKey);
    backgroundSyncErrorKind.value = err instanceof PodLineageError ? 'lineage' : 'decrypt';
    // The KEY, not the rendered string. The banner has to tell an `adopt-remote`
    // block (recoverable by the user) from a `conflict` (not recoverable, and the
    // copy says so), and string-comparing translated prose would break the moment
    // anyone edits a word or switches language.
    podBlockMessageKey.value = err.inlineMessageKey;
    // NOTE on repeats: the message is constant per class, so a second failure
    // assigns an identical string and `BackgroundSyncBar`'s watcher does not
    // re-fire. That is acceptable ONLY because a repeat cannot happen while the
    // latch holds — and `clearPodUnopenable` nulls this ref, so the next genuine
    // failure after a recovery does re-fire. Do not import `showToast` here to
    // force it: `@/composables/useToast` closes an import cycle with this store
    // and collapses its inferred type to `any` at every consumer.
  }

  /**
   * A read really succeeded, so drop the UI mirror. `syncService` clears the
   * authoritative latch itself (on a successful merge, on a provider swap —
   * which is what makes `rebindPodFile` a genuine repair — and on reset).
   */
  /**
   * Reconcile the UI mirror with `syncService`'s authoritative latch.
   *
   * Deliberately one-way and additive: it only ever turns the mirror ON.
   * Clearing stays with `clearPodUnopenable`, which also nulls the message so
   * the bar's watcher re-fires — reconciling a clear here would skip that.
   */
  function mirrorServiceLatch(): void {
    const blocker = syncService.isRemoteBlocked();
    if (!blocker) return;
    // ⚠️ THE CLASSIFICATION IS REFRESHED EVEN WHEN ALREADY LATCHED. Returning
    // early on `podUnopenable` left the kind and the message key describing
    // whichever blocker latched FIRST — so a decrypt failure followed by a
    // lineage block kept `'decrypt'`, and the lineage banner (which is the one
    // that asks the user to act) never rendered at all. Still one-way: nothing
    // here clears anything, so `clearPodUnopenable` remains the only exit.
    podUnopenable.value = true;
    backgroundSyncError.value = useTranslationStore().t(blocker.inlineMessageKey);
    backgroundSyncErrorKind.value = blocker instanceof PodLineageError ? 'lineage' : 'decrypt';
    podBlockMessageKey.value = blocker.inlineMessageKey;
    stopFilePolling();
  }

  /**
   * The lineage banner's second action: "use the family file".
   *
   * ⚠️ THIS EXISTS BECAUSE THE BANNER'S ADVICE WAS UNACTIONABLE. It told the
   * user to export their changes and reload — but a reload re-opens the SAME
   * cached document against the SAME baseline, so the guard blocks again,
   * forever. Saving cannot resolve it either: `doSave` refuses on any remote
   * blocker, by design. Discarding this device's unsynced document was the only
   * exit and there was no way to ask for it.
   *
   * Destructive, so the CALLER confirms (the banner does). Everything this
   * device holds that never reached the family file is dropped in favour of the
   * reorganised copy — which is precisely what the user is choosing when they
   * press it, after exporting.
   */
  async function useRemoteFileOverLocalDocument(): Promise<boolean> {
    logEvent({
      level: 'warn',
      surface: 'pod-lineage',
      message: 'user chose the remote pod file over the local document',
      context: { action: 'user-file-recovery' },
    });
    // ⚠️ CANCEL THE PENDING SAVE FIRST. A save armed while the block was up
    // would otherwise run its own `fetchAndMergeRemote` concurrently with this
    // read — two merges racing over one document. Nothing needs that save: the
    // whole point of this action is that we are giving up the local document.
    syncService.cancelPendingSave();
    // ⚠️ AND `isReloading`, so the OTHER readers stand off. `reloadIfFileChanged`
    // (the 10s poll and the stale-tab wake) and `backgroundSyncFromFile` both
    // gate on it; a plain `loadFromFile()` does not set it, so a poll landing
    // inside this multi-megabyte read used to proceed in parallel.
    isReloading = true;
    // ⚠️ THE LATCH IS NOT CLEARED UP FRONT. It used to be, so that
    // `loadFromFile` would not refuse — and every failure path then returned
    // with the banner already gone. The bypass now travels as an argument on
    // this one call, so the latch stays armed until something actually
    // succeeds, and a failure leaves the user exactly where they were.
    try {
      const result = await loadFromFile({ userChoseThisFile: true });
      if (!result.success) {
        recoveryFailed(result.reason ?? 'unknown');
        return false;
      }
      // Only now: the read landed, so the state it described is gone.
      syncService.retryAfterRemoteBlock();
      clearPodUnopenable();
      return true;
    } catch (e) {
      // ⚠️ CATCH, not just `finally`. `loadFromFile` THROWS by design on a
      // remote blocker and rethrows an out-of-memory failure — on the very
      // device cohort this tier exists for, where this adopt is the largest
      // allocation in the app. Without this the failure reaches nobody.
      recoveryFailed(e instanceof Error ? e.name : 'unknown', e);
      return false;
    } finally {
      isReloading = false;
      // ⚠️ RESTART THE POLLER ON EVERY EXIT, not just the happy one.
      // `notePodUnopenable` stopped it when the block latched, and nothing else
      // starts it again: `clearPodUnopenable` only clears flags and
      // `setupAutoSync` early-returns on an established session. Restoring it
      // only on success left a failed recovery with the poller dead for the rest
      // of the session — the same half-apply this function already fixed once.
      resumeFilePolling();
      // And reconcile the banner with the authoritative latch. On failure the
      // latch never moved, so this simply puts the warning back on screen.
      mirrorServiceLatch();
    }
  }

  /**
   * One report for both failure shapes, so they can never diverge.
   *
   * ⚠️ SEVERITY BY CODE. `critical` pages `#beanies-errors`, and a plain
   * offline failure — whose own toast says "check your connection and try
   * again" — must not. Only a failure that leaves the family unable to act
   * earns the page.
   */
  function recoveryFailed(code: string, error?: unknown): void {
    const transient = code === 'auth' || code === 'error' || code === 'not-found';
    reportError({
      surface: 'pod-lineage',
      severity: transient ? 'warning' : 'critical',
      message: 'adopting the remote pod file after a lineage block failed',
      error,
      context: { action: 'user-file-recovery-failed', error_code: code },
    });
  }

  function clearPodUnopenable(): void {
    podUnopenable.value = false;
    // Null the message too, so the NEXT failure re-fires the bar's watcher
    // instead of assigning an identical string to itself.
    // 'lineage' as well as 'decrypt': without it the bar's message never clears
    // after a lineage block resolves, and the next genuine failure assigns an
    // identical string so the watcher does not re-fire.
    if (
      backgroundSyncErrorKind.value === 'decrypt' ||
      backgroundSyncErrorKind.value === 'lineage'
    ) {
      backgroundSyncError.value = null;
      backgroundSyncErrorKind.value = null;
    }
    podBlockMessageKey.value = null;
  }

  function startFilePolling(): void {
    if (filePollingTimer) return;
    // ⚠️ THE circuit breaker, and it has to live HERE.
    //
    // A per-call `payloadFailed` flag only gates STARTING a poller, so it was a
    // no-op whenever the timer was already running, and three external callers
    // (`useStaleTabRefresh`'s tab-wake `resumeFilePolling`, App.vue's
    // `startDeferredPolling`, the header Refresh) re-armed the one that
    // `stopFilePolling()` had just cleared. Every restart re-downloads the
    // multi-megabyte file, re-hits the same allocation and fires another
    // critical report — the "forever" loop this was supposed to kill.
    //
    // This is the single site that creates the interval, so the latch cannot be
    // walked around — and `backgroundSyncFromFile` / `reloadIfFileChanged`
    // check it on entry too, because `AppHeader`'s Refresh and
    // `useStaleTabRefresh` call those directly rather than through the timer.
    // The latch itself is `syncService`'s; see `remoteUnreadable()`.
    if (remoteUnreadable()) return;
    filePollingTimer = setInterval(() => {
      reloadIfFileChanged()
        // ⚠️ MIRROR WHAT THE SERVICE DECIDED. `syncService` arms the breaker on
        // paths this store never sees — its own local-file poll and the pre-save
        // merge — and `podUnopenable` (the only thing `BackgroundSyncBar` reads)
        // was written in exactly ONE place, inside `notePodUnopenable`. So a
        // latch armed down there stopped polling SILENTLY: no bar, no message,
        // and a read-only session never learned the pod could not be read.
        .finally(() => {
          // ⚠️ INSIDE the try, and AFTER the catch. Chained as
          // `.catch(console.warn).finally(...)` a throw out of the mirror (an
          // unavailable Pinia, say) escaped as an unhandled rejection every
          // 10 seconds, past the handler meant to contain it.
          try {
            mirrorServiceLatch();
          } catch (e) {
            console.warn('[syncStore] mirrorServiceLatch threw', e);
          }
        })
        .catch(console.warn);
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
    // The service clears its own latch in `reset()`; the mirror has to follow or
    // it outlives a sign-out and a family switch.
    clearPodUnopenable();
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
    verifyInFlight = false;
    checkedCanonicalFor = null;
    podAccessError.value = null;
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
    // Clear the read-error classification too: `setProvider` fires the state
    // callback SYNCHRONOUSLY, so a surviving error from the previous family
    // would otherwise leak into the next one before its first read starts.
    backgroundSyncError.value = null;
    backgroundSyncErrorKind.value = null;
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

  /**
   * Verify that the just-loaded family has a durable, writable home — and report
   * when it doesn't. Called ONCE by `LoadPodView` after every successful load.
   *
   * ## This function MUTATES NOTHING
   *
   * It replaces `establishDurableHomeAfterLoad`, which "established" a home by
   * minting a fresh `.beanpod` on the signed-in account's Drive whenever the
   * loaded file wasn't `ownedByMe`. For every non-owner family member that is the
   * normal state — the family's file is owned by the inviter and shared with edit
   * access — so the old guard silently forked exactly the people it was meant to
   * protect, seeding the copy with the live document so it looked identical. See
   * `docs/plans/2026-08-10-never-fork-a-family-pod.md`.
   *
   * The rule now: a family's pod binding is established once, by an explicit user
   * action, and is never changed by the app. This function may REPORT a problem;
   * it may never RESOLVE one by creating or switching files. Recovery is always a
   * user's choice, and every offered recovery restores access to the ORIGINAL
   * file (see `POD_ACCESS_ERRORS`).
   *
   * Writability is `capabilities/canEdit`. Ownership is never consulted.
   */
  async function verifyPodAccess(): Promise<PodAccessResult> {
    // Repeated `retry` taps must not race conflicting state onto the banner.
    // Report what we currently believe rather than a bare `{ ok: true }` — a
    // concurrent call learning "fine" while a check is still running would be a
    // small lie of exactly the kind this whole change exists to remove.
    if (verifyInFlight) return podAccessError.value ?? { ok: true };
    verifyInFlight = true;
    try {
      const result = await runPodAccessCheck();
      podAccessError.value = result.ok ? null : result;
      logPodAccessResult(result);
      // Fire-and-forget: a network round-trip the user must never wait on, and
      // which must never throw into the load path.
      if (result.ok) void checkCanonicalPod();
      return result;
    } catch (e) {
      // A throw here must never block the user reaching already-decrypted data.
      console.error('[syncStore.verifyPodAccess] unexpected failure:', e);
      const result: PodAccessResult = { ok: false, code: 'VERIFY_UNAVAILABLE' };
      podAccessError.value = result;
      logPodAccessResult(result, e);
      return result;
    } finally {
      verifyInFlight = false;
    }
  }

  /** The decision itself, split out so `verifyPodAccess` owns only state + logging. */
  async function runPodAccessCheck(): Promise<PodAccessResult> {
    const ctx = useFamilyContextStore();
    const activeFamilyId = ctx.activeFamilyId;

    const provider = syncService.getProvider();
    // Family-scoped, not a bare non-null: a stale provider from a previously
    // active family must not read as this family's home.
    if (!provider || syncService.getProviderFamilyId() !== activeFamilyId) {
      return { ok: false, code: 'NO_HOME' };
    }

    const providerType = syncService.getProviderType();
    if (providerType !== 'google_drive') {
      // A local FSA / native provider WE installed for this family is a genuine
      // own home; there is no remote permission model to check.
      return { ok: true };
    }

    const fileId = provider.getFileId();
    if (!fileId) return { ok: false, code: 'NO_HOME' };

    // `tryGetSilentToken` — NEVER `requestAccessToken`. A background durability
    // check must not be able to pop a consent dialog in the middle of a load.
    const token = await tryGetSilentToken();
    if (!token) return { ok: false, code: 'CONSENT_EXPIRED' };

    try {
      // `capabilities/canEdit` is NESTED in the response — see `evaluatePodMetadata`.
      const meta = await getFileMetadata(token, fileId, 'capabilities/canEdit,trashed');
      const failure = evaluatePodMetadata(meta as PodFileMetadata);
      return failure ? { ok: false, code: failure } : { ok: true };
    } catch (e) {
      return { ok: false, code: classifyDriveFailure(e), error: e };
    }
  }

  /**
   * Is the file we're writing to actually the one the family shares?
   *
   * Fail-open in every uncertain case. `lookupFamilyResult` distinguishes "no such
   * row" from "couldn't ask" precisely so a registry hiccup can't accuse a user of
   * working on a copy. Runs at most once per family per session — `verifyPodAccess`
   * runs on every load path including `retry`, so an unguarded check would turn a
   * retry loop into a registry request loop.
   */
  async function checkCanonicalPod(): Promise<void> {
    try {
      const ctx = useFamilyContextStore();
      const familyId = ctx.activeFamilyId;
      if (!familyId || checkedCanonicalFor === familyId) return;
      const provider = syncService.getProvider();
      if (!provider || syncService.getProviderType() !== 'google_drive') return;
      checkedCanonicalFor = familyId;

      const lookup = await registry.lookupFamilyResult(familyId);
      if (lookup.status !== 'found') return; // absent or unavailable → raise nothing
      const entry = lookup.entry;
      if (entry.provider !== 'google_drive' || !entry.fileId) return;
      if (entry.fileId === provider.getFileId()) return;

      const result: PodAccessResult = {
        ok: false,
        code: 'CANONICAL_MISMATCH',
        // View state, NOT telemetry — `switchToCanonical` needs the full fileId to
        // call `rebindPodFile`. `logPodAccessResult` never spreads `data` into a
        // report; it derives `file_id_tail` explicitly. `file_id` is not in
        // ALLOWED_CONTEXT_KEYS, but relying on the stripper is not a policy.
        data: {
          canonicalFileId: entry.fileId,
          canonicalName: entry.displayPath ?? `${entry.familyName ?? 'pod'}.beanpod`,
        },
      };
      podAccessError.value = result;
      logPodAccessResult(result);
    } catch (e) {
      // The one intentional swallow in this path — and it still logs.
      console.warn('[syncStore.checkCanonicalPod] canonical check failed:', e);
      logEvent({
        level: 'warn',
        surface: 'pod-access',
        message: 'canonical pod check failed',
        context: { action: 'canonical-check-failed' },
        error: e,
      });
    }
  }

  /**
   * The ONE logging call site for pod access. Level/severity comes from
   * `POD_ACCESS_SEVERITY`, so "which codes page Slack" is data in one table
   * rather than a policy scattered across fifteen `reportError` calls.
   *
   * The success path logs too — deliberately. A failure-only event cannot tell you
   * a failure RATE, and not being able to measure the rate is why this bug went a
   * month without anyone knowing how many families it had reached.
   */
  function logPodAccessResult(result: PodAccessResult, thrown?: unknown): void {
    const provider_type = storageProviderType.value ?? undefined;
    if (result.ok) {
      logEvent({
        level: 'info',
        surface: 'pod-access',
        message: 'kept existing pod home',
        context: { action: 'kept-home', provider_type },
      });
      return;
    }
    const context = {
      action: result.code,
      provider_type,
      file_id_tail: tail(syncService.getProvider()?.getFileId() ?? null),
    };
    if (POD_ACCESS_SEVERITY[result.code] === 'critical') {
      reportError({
        surface: 'pod-access',
        severity: 'critical',
        message: `pod access failed: ${result.code}`,
        error: thrown ?? result.error,
        context,
      });
      return;
    }
    logEvent({
      level: 'warn',
      surface: 'pod-access',
      message: `pod access degraded: ${result.code}`,
      context,
      error: thrown ?? result.error,
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
    // A review-demo session runs entirely in memory: it never installs a durable
    // storage provider and never registers, so the config-heal has nothing to
    // rebuild and there is genuinely NOTHING to reconnect. Paging critical (and
    // raising the Layer-3 reconnect affordance) here is a false alarm — a reviewer
    // reload was repeatedly spamming #beanies-errors with a null-provider
    // "user must reconnect". No-op it for demo sessions; the demo keeps running on
    // its in-memory/cached state.
    if (isDemoSession.value) {
      logEvent({
        level: 'info',
        surface: 'sync-config-total-failure',
        message:
          'config-heal total failure suppressed for review-demo session (no durable storage)',
        context: { action: 'demo-suppressed' },
      });
      return;
    }
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
      // `lookupFamilyResult`, not `lookupFamily`: the retry below is only correct
      // for a genuinely transient failure. The old code wrapped `lookupFamily` in
      // a try/catch, but that function never throws — it swallows everything to
      // `null` — so the retry path was unreachable and a registry outage became a
      // non-retryable dead end. The typed result restores the author's intent.
      const lookup = await registry.lookupFamilyResult(familyId);
      if (lookup.status === 'unavailable') {
        // Transient (offline / registry 5xx) → retry on a wake event.
        console.warn('[syncStore.attemptSilentConfigHeal] registry lookup unavailable');
        scheduleConfigHealRetry(familyId, 'registry-error');
        return false;
      }
      const entry: RegistryEntry | null = lookup.status === 'found' ? lookup.entry : null;

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

      // Same as `fetchAndMergeRemote`: one parse, not two. See the note there.
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

    // Phase 4: a kit-born envelope has NO password wraps — a password can never
    // succeed and `tryUnwrapFamilyKey` would throw "No wrapped keys" (which the
    // old mapping surfaced as a retrying network-error). Route to recovery.
    if (envelopeNeedsRecovery(pending.envelope)) {
      return { kind: 'needs-recovery' };
    }

    const previousState = criticalWriteState.value;
    if (previousState.kind === 'idle') {
      criticalWriteState.value = { kind: 'loading' };
    }

    /**
     * Split a payload failure into its result kind. A memory limit is NOT
     * corruption: telling the user their file is damaged when it is fine is
     * the lie this whole change exists to remove.
     */
    const payloadFailureResult = (err: PayloadLoadError): CompleteAutoLoadResult =>
      err instanceof PayloadTooLargeError
        ? {
            kind: 'too-large',
            fileId: pending.driveFileId ?? '',
            familyId: pending.envelope.familyId ?? '',
            error: err,
          }
        : {
            kind: 'corrupted',
            fileId: pending.driveFileId ?? '',
            familyId: pending.envelope.familyId ?? '',
            error: err,
          };

    try {
      const decryptResult = await decryptPendingFile(password);

      // THE live payload-failure path — `decryptPendingFile` catches and
      // RETURNS, so the catch below is only a contract-drift backstop.
      if (decryptResult.payloadError instanceof PayloadLoadError) {
        return payloadFailureResult(decryptResult.payloadError);
      }
      if (decryptResult.payloadError) {
        // A lineage or merge block: NOT a payload failure, so it must not be
        // shaped as `too-large`/`corrupt` (which would tell the user their data
        // may be damaged). It is already latched and surfaced by the store; here
        // it is simply a failed auto-load.
        return { kind: 'lineage-blocked', error: decryptResult.payloadError };
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
      if (err instanceof PayloadLoadError) {
        return payloadFailureResult(err);
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
  async function rebindPodFile(
    fileId: string,
    fileName_param: string
  ): Promise<{ ok: true } | { ok: false; code: PodAccessErrorCode }> {
    // ⚠️ REFUSE OUR OWN BACKUP. This is the shared repair behind four
    // `POD_ACCESS_ERRORS` codes and the save-failure banner, and its only
    // content gate is the family-id check below — which a safety copy passes
    // BY CONSTRUCTION, because it IS this family. Accepting one would persist
    // it as the provider and then move the REGISTRY POINTER to it
    // (`registerCurrentFamily`, below), so every other member would be healed
    // onto the backup. That is the ADR-033 fork this file exists to prevent,
    // reached by tapping the row above the right one in a picker.
    //
    // Restoring a backup deliberately is a different flow with a different
    // question: Settings → Family Data Options → Load another family data
    // file, which confirms "this will replace all local data" first.
    if (isSafetyCopyName(fileName_param)) {
      logEvent({
        level: 'warn',
        surface: 'pod-access',
        message: 'refused to rebind onto a compaction safety copy',
        context: { action: 'rebind-refused-safety-copy', file_id_tail: tail(fileId) },
      });
      return { ok: false, code: 'FILE_NOT_FOUND' };
    }
    // The supported repair for a latched pod — it must be allowed one attempt.
    syncService.retryAfterRemoteBlock();
    try {
      if (!familyKey.value || !envelope.value) {
        return { ok: false, code: 'NO_HOME' };
      }

      const provider = GoogleDriveProvider.fromExisting(fileId, fileName_param);
      const text = await provider.read();
      if (!text) {
        return { ok: false, code: 'FILE_NOT_FOUND' };
      }

      const env = parseBeanpodV4(text);
      if (env.familyId !== envelope.value.familyId) {
        // The property that makes this primitive safe to expose as the recovery
        // for five different error codes: it can bind ONLY a file that already
        // belongs to this family. It cannot create, and it cannot adopt a
        // stranger's pod.
        return { ok: false, code: 'FILE_NOT_FOUND' };
      }

      // Verify the family key still decrypts the file (worker; current key).
      await docClient.verifyEnvelope(env, { quiet: true });

      // Persist BEFORE setProvider, matching installProvider's ordering. Without
      // this the rebind survived only until the tab closed, and the next boot with
      // an evicted config re-entered the exact loop that caused the 2026-08-10
      // fork. `setProvider` alone is an in-memory swap.
      const ctx = useFamilyContextStore();
      if (ctx.activeFamilyId) {
        await provider.persist(ctx.activeFamilyId);
      }

      // Swap the provider so subsequent saves/polls use the new fileId.
      // `replaceEnvelope` is the uniform entry point even though this is a
      // recovery rebind where local-only entries from `envelope.value`
      // typically don't differ from `env`.
      syncService.setProvider(provider);
      const rebindMerged = replaceEnvelope(env);
      syncService.setFamilyKey(familyKey.value, rebindMerged);
      fileName.value = fileName_param;
      driveFileId.value = fileId;

      // ONE clearing site for every recovery banner's state, so the banners
      // can never disagree about whether recovery succeeded. This sits AFTER
      // `setProvider` on purpose: clearing at the top of the function erased the
      // honest "this pod could not be opened" banner on the four failure exits
      // above, which never reach `setProvider` and so leave the service latch
      // armed — the app looked repaired while every read and save still refused.
      clearPodUnopenable();
      driveFileNotFound.value = false;
      showSaveFailureBanner.value = false;
      podAccessError.value = null;
      error.value = null;
      syncService.resetSaveFailures();
      saveFailureLevel.value = 'none';
      lastSaveError.value = null;
      // Deliberate re-point: the owner repairs the registry here, and a member's
      // attempt is refused server-side and reported rather than silently dropped.
      registerCurrentFamily(
        { provider: 'google_drive', fileId, displayPath: fileName_param },
        { pointerIntent: true }
      );

      // NOTE: deliberately NO syncNow() here. A blind post-install upload is
      // exactly the mechanism that made the forked copy indistinguishable from
      // the original. The normal poll/merge/debounced-save cycle reconciles, so
      // this device's changes are carried across rather than discarded.
      startFilePolling();

      console.warn('[syncStore] rebindPodFile succeeded — swapped to', fileId, fileName_param);
      return { ok: true };
    } catch (e) {
      const code = classifyDriveFailure(e);
      console.warn('[syncStore] rebindPodFile failed:', (e as Error).message);
      // A failed rebind is a user action that failed with data at risk — the
      // family is loaded and visible but still not saving anywhere it should.
      reportError({
        surface: 'pod-access',
        severity: 'critical',
        message: 'rebind to the family pod file failed',
        error: e,
        context: {
          action: 'rebind-failed',
          error_code: code,
          file_id_tail: tail(fileId),
        },
      });
      return { ok: false, code };
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

  /** Mirror the non-reactive verified session email into the reactive ref. */
  function refreshSessionAccountEmail(): void {
    sessionAccountEmail.value = getVerifiedGoogleAccountEmail();
  }

  /**
   * Reconcile stale provider AND member account bindings after a PROVEN Drive
   * access (a load/save just succeeded — proof the live session account can reach
   * the file). The provider binding (per-device IndexedDB) and the member binding
   * (shared Automerge doc) can be stale independently, so each is reconciled on
   * its own, both under the same gate: a Drive op succeeded AND a VERIFIED live
   * email exists. Each write is inequality-guarded, so a steady-state access
   * performs no IndexedDB or Automerge write.
   *
   * This is the ONE safe exception to finding 9's "never rebind A→B" (see
   * `GoogleDriveProvider.rebindProvenAccount`): success is proof the new account
   * is a legitimate accessor.
   *
   * Returns `true` when SETTLED (bindings already correct, just reconciled, or no
   * verified identity to act on). Returns `false` ONLY when there is no verified
   * email yet AND a retry could still converge — the load poll uses this to decide
   * whether to keep polling (the verified email often arrives late on a cached
   * resume). Best-effort: never throws.
   */
  async function healAccountBindingIfNeeded(trigger: 'load' | 'save'): Promise<boolean> {
    try {
      const provider = syncService.getProvider();
      if (!(provider instanceof GoogleDriveProvider)) return true;

      const verifiedEmail = getVerifiedGoogleAccountEmail();
      if (!verifiedEmail) {
        logEvent({
          level: 'info',
          surface: 'account-binding-heal',
          message: 'proven access but no verified session email yet — deferring',
          context: { action: 'noop-no-verified-email' },
        });
        return false; // keep polling on the load path; a later tick may converge
      }

      let providerChanged = false;
      let memberChanged = false;

      // Provider binding (per-device IndexedDB provider config).
      if (
        verifiedEmail !== provider.getAccountEmail() &&
        provider.rebindProvenAccount(verifiedEmail)
      ) {
        providerAccountEmail.value = verifiedEmail;
        refreshSessionAccountEmail();
        const ctx = useFamilyContextStore();
        if (ctx.activeFamilyId) await provider.persist(ctx.activeFamilyId);
        providerChanged = true;
      }

      // Member binding (shared Automerge doc) — reconciled independently: it can
      // be stale even when the provider binding is already correct.
      const memberId = useAuthStore().currentUser?.memberId;
      if (memberId) {
        const fam = useFamilyStore();
        const member = fam.members.find((m) => m.id === memberId);
        if (member && member.googleAccountEmail !== verifiedEmail) {
          await fam.updateMember(memberId, { googleAccountEmail: verifiedEmail });
          memberChanged = true;
        }
      }

      logEvent({
        level: 'info',
        surface: 'account-binding-heal',
        message:
          providerChanged || memberChanged
            ? 'rebound stale account binding after proven access'
            : 'account binding already correct',
        context: { action: providerChanged || memberChanged ? 'changed' : 'noop-steady-state' },
      });
      return true;
    } catch (e) {
      reportError({
        surface: 'account-binding-heal',
        severity: 'warning',
        message: `account-binding heal failed (non-blocking, trigger=${trigger})`,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      return true; // never spin the poll on a persistent failure
    }
  }

  /**
   * Post-load reconciliation poll. Runs after a successful Drive load because the
   * OAuth-verified session email frequently arrives LATE on a cached-token resume
   * — a single synchronous check would miss it. Each tick runs the proven-access
   * heal (learn/rebind the provider AND member bindings); clears once the heal
   * reports SETTLED or the attempts cap is hit. A re-entrancy guard prevents
   * overlapping ticks now that a tick can do async persist + updateMember work.
   */
  function updateProviderEmailAfterLoad(): void {
    let attempts = 0;
    let ticking = false;
    const interval = setInterval(() => {
      if (ticking) return; // don't overlap; the heal does async persist/updateMember
      ticking = true;
      void (async () => {
        try {
          attempts++;
          const settled = await healAccountBindingIfNeeded('load');
          if (settled || attempts >= 10) clearInterval(interval);
        } finally {
          ticking = false;
        }
      })();
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
  // One-at-a-time guard for the silent self-recovery below.
  let selfRecoveryInFlight = false;
  // Longer than tryReconnectSilently's own retry budget (~22.5s) so a legitimate
  // recovery is never cut short, but bounded so the latch always releases.
  const SELF_RECOVERY_TIMEOUT_MS = 30_000;

  /**
   * Attempt a SILENT recovery from a permanent Google auth failure before the
   * reconnect banner is shown (#62). Adopts a fresh Drive refresh token another
   * device already mirrored into the .beanpod (`tryReconnectSilently`) — no
   * popup, no redirect, no interactive Google UI.
   *
   * Deferred to a macrotask on purpose: `onTokenPermanentlyExpired` fires
   * SYNCHRONOUSLY from inside the failing `performSilentRefresh`, while its
   * `attemptSilentRefresh` dedup (`pendingSilentRefresh`) is still set —
   * `tryReconnectSilently` re-enters `attemptSilentRefresh`, so running it inline
   * would await the very refresh that just failed (deadlock). The `setTimeout`
   * lets that unwind first. On success the existing `onTokenAcquired` handler
   * auto-clears everything; only on failure do we raise the banner.
   */
  function attemptSilentSelfRecovery(): void {
    if (selfRecoveryInFlight) return;
    selfRecoveryInFlight = true;
    setTimeout(() => {
      void (async () => {
        try {
          // Bounded so a hung `tryReconnectSilently` can never wedge the latch (and
          // thus disable recovery + the fallback banner) for the rest of the
          // session. `undefined` (timeout) is treated as "not recovered" → banner.
          const recovered = await raceTimeout(
            tryReconnectSilently(getGoogleAccountEmail()),
            SELF_RECOVERY_TIMEOUT_MS
          );
          logTokenLifecycle({
            grant: 'drive',
            op: 'recovery',
            outcome: recovered ? 'ok' : 'failed',
            trigger: 'recovery',
          });
          // recovered === true → `tryReconnectSilently` fired notifyTokenAcquired,
          // which already cleared any banner + refreshed state. Nothing to do.
          if (!recovered && storageProviderType.value === 'google_drive') {
            showGoogleReconnect.value = true;
          }
        } catch (e) {
          // Never leave the user stuck silently — surface the prompt on any error.
          if (storageProviderType.value === 'google_drive') showGoogleReconnect.value = true;
          reportError({
            surface: 'google-self-recovery',
            severity: 'warning',
            message: 'silent self-recovery threw; showing reconnect banner',
            error: e instanceof Error ? e : new Error(String(e)),
          });
        } finally {
          selfRecoveryInFlight = false;
        }
      })();
    }, 0);
  }

  function setupTokenExpiryHandler(): void {
    // Drive is active here — register the best-effort refresh-token → beanpod
    // mirror (idempotent; only ever fires on an interactive token acquisition).
    registerDriveTokenMirror();
    if (!tokenExpiryUnsub) {
      tokenExpiryUnsub = onTokenPermanentlyExpired(() => {
        if (storageProviderType.value !== 'google_drive') return;
        // Self-recovery (#62): before surfacing the reconnect banner, try to heal
        // silently — adopt a fresh Drive token another device already mirrored into
        // the .beanpod. The banner shows ONLY if that yields nothing, so a healthy
        // multi-device user never sees a prompt they didn't need. See
        // attemptSilentSelfRecovery for why it is deferred.
        attemptSilentSelfRecovery();
      });
    }
    if (!tokenAcquiredUnsub) {
      tokenAcquiredUnsub = onTokenAcquired(() => {
        // A token was just acquired → the verified session email may have changed.
        // Keep the "Signed in with" display truthful.
        refreshSessionAccountEmail();
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

  /**
   * Store a recovery-kit wrap in the envelope (Phase 3). Mirrors addPasskeySecret's
   * write shape; the entry rides the next save (keyDictSize counts it, so an
   * offline-generated kit still triggers a publish).
   */
  function addRecoveryKey(
    kitId: string,
    pkg: import('@/types/syncFileV4').RecoveryKeyPackage
  ): void {
    if (!envelope.value) return;
    const env: import('@/types/syncFileV4').BeanpodFileV4 = {
      ...envelope.value,
      recoveryKeys: { ...envelope.value.recoveryKeys, [kitId]: pkg },
    };
    envelope.value = env;
    syncService.setEnvelope(env);
  }

  /** Store (or replace) the family recovery-passphrase wrap in the envelope (Phase 3). */
  function setRecoveryPassphraseWrap(
    pkg: import('@/types/syncFileV4').BeanpodFileV4['recoveryPassphrase'] & object
  ): void {
    if (!envelope.value) return;
    const env: import('@/types/syncFileV4').BeanpodFileV4 = {
      ...envelope.value,
      recoveryPassphrase: pkg,
    };
    envelope.value = env;
    syncService.setEnvelope(env);
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
    opts: { isLoginEvent?: boolean; pointerIntent?: boolean } = {}
  ): void {
    const ctx = useFamilyContextStore();
    if (!ctx.activeFamilyId) return;
    const payload = buildRegistryPayload(overrides, opts);
    registry
      .registerFamily(ctx.activeFamilyId, payload)
      .then((result) => {
        // The server refuses to move the canonical pointer for anyone but the
        // family's registered owner (see the guard in the registry Lambda). Two
        // very different populations hit that refusal, and conflating them is
        // how the original bug stayed invisible for a month:
        //
        //  - No intent (`ensureRegistered` on every login, the country watcher):
        //    they send pointer fields only because the payload is uniform. A
        //    refusal is the expected, boring case for every member device.
        //  - Intent (`installProvider` via migrateStorage, `rebindPodFile`): the
        //    caller deliberately meant to re-point. A refusal means the registry
        //    now disagrees with where the pod actually is, and
        //    `attemptSilentConfigHeal` will heal other members onto the stale
        //    pointer. That is data at risk.
        //
        // `result === null` means registerFamily swallowed a transport failure —
        // we learned nothing about the pointer, so we say nothing about it.
        if (!result || result.pointerAccepted) return;
        if (opts.pointerIntent) {
          reportError({
            surface: 'pod-access',
            severity: 'critical',
            message: 'registry refused a deliberate pointer write',
            context: {
              action: 'registry-pointer-write-refused',
              provider_type: storageProviderType.value ?? undefined,
              file_id_tail: tail(payload.fileId ?? null),
            },
          });
          return;
        }
        // Population counter for devices sitting on a forked pod — including
        // stale clients that will never ship the client-side fix.
        logEvent({
          level: 'info',
          surface: 'pod-access',
          message: 'registry ignored an ambient pointer write',
          context: {
            action: 'registry-pointer-write-ignored',
            provider_type: storageProviderType.value ?? undefined,
          },
        });
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
    saveStatus,
    consecutiveSaveFailures,
    hasSessionPassword,
    hasPendingEncryptedFile,
    storageProviderType,
    providerAccountEmail,
    sessionAccountEmail,
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
    snapshotPaintedThisSession,
    backgroundSyncErrorKind,
    // Actions
    initialize,
    requestPermission,
    verifyPodAccess,
    podAccessError,
    shouldShowPodAccessBanner,
    migrateStorage,
    syncNow,
    syncNowBounded,
    syncNowDurable,
    canDurablySaveNow,
    DURABLE_ROTATION_SAVE_TIMEOUT_MS,
    forceSyncNow,
    loadFromFile,
    loadFromNewFile,
    loadFromDroppedFile,
    loadFromGoogleDrive,
    attemptResumeFromRegistry,
    completeAutoLoad,
    listGoogleDriveFiles,
    beginDriveAuthRedirect,
    rebindPodFile,
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
    persistFamilyName,
    disconnect,
    buildExportEnvelope,
    markExported,
    manualImport,
    reloadAllStores,
    setupAutoSync,
    deferPolling,
    startDeferredPolling,
    backgroundSyncFromFile,
    tryDecryptWithCachedKey,
    // Exported for `usePodCompaction`, which stamps the new lineage. Deliberately
    // the SAME mandated write path every other envelope change uses, so the
    // payload strip and the cache re-seed cannot be applied on one and missed
    // on the other.
    replaceEnvelope,
    podUnopenable,
    clearPodUnopenable,
    podBlockMessageKey,
    useRemoteFileOverLocalDocument,
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
    addRecoveryKey,
    setRecoveryPassphraseWrap,
    removePasskeySecretsForCredential,
    clearAllPasskeySecrets,
  };
});
