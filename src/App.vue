<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/common/AppHeader.vue';
import AppSidebar from '@/components/common/AppSidebar.vue';
import MobileBottomNav from '@/components/common/MobileBottomNav.vue';
import MobileHamburgerMenu from '@/components/common/MobileHamburgerMenu.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import InstallPrompt from '@/components/common/InstallPrompt.vue';
import { usePwaUpdater, PWA_POST_UPDATE_ROUTE_KEY } from '@/composables/usePwaUpdater';
import { installNativeAuthListener } from '@/services/google/googleAuth';
import { isNative } from '@/services/sync/capabilities';
import { useLocalNotifications } from '@/composables/useLocalNotifications';
import { useHelpfulHints } from '@/composables/useHelpfulHints';
import { useNotifications } from '@/composables/useNotifications';
import { useCalendarRedirectResume } from '@/composables/useCalendarRedirectResume';
import { useUnifiedRedirectResume } from '@/composables/useUnifiedRedirectResume';
import { useReminderTapResume } from '@/composables/useReminderTapResume';
import { useNativeShell } from '@/composables/useNativeShell';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CelebrationOverlay from '@/components/ui/CelebrationOverlay.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import ReauthGateModal from '@/components/auth/ReauthGateModal.vue';
import AiProcessingOverlay from '@/components/ai/AiProcessingOverlay.vue';
import DocumentExtractConsentModal from '@/components/ai/DocumentExtractConsentModal.vue';
import { isReadingSharedDocument } from '@/composables/useSharedDocumentIngest';
import { useShareTargets } from '@/composables/useShareTargets';
import DoseLogConfirmModal from '@/components/pod/DoseLogConfirmModal.vue';
import QuickAddFab from '@/components/common/QuickAddFab.vue';
import QuickAddSheet from '@/components/common/QuickAddSheet.vue';
import RecurringEditScopeModal from '@/components/ui/RecurringEditScopeModal.vue';
import TrustDeviceModal from '@/components/common/TrustDeviceModal.vue';
import PasskeyPromptModal from '@/components/common/PasskeyPromptModal.vue';
import NotificationsDrawer from '@/components/notifications/NotificationsDrawer.vue';
import PwaReinstallModal from '@/components/common/PwaReinstallModal.vue';
import FeedbackModal from '@/components/feedback/FeedbackModal.vue';
import { claimInterruption } from '@/composables/useSessionInterruption';
import UnifiedReconnectToast from '@/components/common/UnifiedReconnectToast.vue';
import SaveFailureBanner from '@/components/google/SaveFailureBanner.vue';
import DurabilityBanner from '@/components/common/DurabilityBanner.vue';
// REVIEW-DEMO: sample-data banner for store-review demo sessions.
import ReviewDemoBanner from '@/components/common/ReviewDemoBanner.vue';
import PodAccessBanner from '@/components/common/PodAccessBanner.vue';
import { useEnsurePhotosPublic } from '@/composables/useEnsurePhotosPublic';
import { formatDeviceInfo } from '@/utils/diagnostics';
import { reportError } from '@/utils/errorReporter';
import { beginOpen, setOpenPath, endOpen } from '@/services/telemetry/openCycle';
import type { OpenToken } from '@/services/telemetry/openCycle';
import {
  shouldShowAppLayout,
  isPodlessExpectedRoute,
  isNavigationCancelled,
} from '@/utils/appChrome';
import { isPodlessRecoveryQuery, RESUME_SETUP_PATH } from '@/components/login/resumePaths';
import {
  hardReload,
  isChunkLoadError,
  readChunkAttempts,
  writeChunkAttempts,
  resetChunkAttempts,
} from '@/utils/hardReload';
import { breadcrumbsForReport } from '@/utils/diagnosticContext';
import ToastContainer from '@/components/ui/ToastContainer.vue';
import ContentSkeleton from '@/components/ui/ContentSkeleton.vue';
import BackgroundSyncBar from '@/components/common/BackgroundSyncBar.vue';
import { resolveAuthPrompt, type AuthPromptId } from '@/services/auth/authPrompts';
import PinPromptModal from '@/components/auth/PinPromptModal.vue';
import RecoveryKitPromptModal from '@/components/auth/RecoveryKitPromptModal.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useMobileMenu, useHeaderReclaimed } from '@/composables/useMobileMenu';
import {
  updateRatesIfStale,
  forceUpdateRates,
  pickRateRefreshAction,
} from '@/services/exchangeRate';
import { isLoaded as isDocLoaded } from '@/services/automerge/projection';
import { processRecurringItems } from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';
import { useListStore } from '@/stores/listStore';
import { track } from '@/services/analytics/plausible';
import { useActivityStore } from '@/stores/activityStore';
import { usePermissions } from '@/composables/usePermissions';
import { useVacationStore } from '@/stores/vacationStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { isFlagEnabled } from '@/config/flags';
import { useTranslationStore } from '@/stores/translationStore';
import { useAuthStore } from '@/stores/authStore';
import { useFatalErrorStore } from '@/stores/fatalErrorStore';
import { PayloadLoadError, PayloadTooLargeError } from '@/types/sync';
import { surfacePayloadFatal } from '@/utils/payloadFailureSurface';
import { logEvent } from '@/services/telemetry/logEvent';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { setSoundEnabled } from '@/composables/useSounds';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { getLatestReleaseNote, isWhatChangedRelease } from '@/content/release-notes';
import { whatsNewId } from '@/utils/notifications';
import { useToday } from '@/composables/useToday';
import { useStaleTabRefresh } from '@/composables/useStaleTabRefresh';
import { attemptSilentReconnect } from '@/utils/silentReconnect';
import { saveNow, hasFamilyKey, setFamilyKey } from '@/services/sync/syncService';
// ADR-032: photo collections are now statically registered at module load in
// `worker/photoOps.ts` (the pure, worker-shared registry) — no App.vue runtime
// registration needed.

const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const assetsStore = useAssetsStore();
const goalsStore = useGoalsStore();
const todoStore = useTodoStore();
const listStore = useListStore();
const activityStore = useActivityStore();
// Read in setup, not inside the async post-init closure: usePermissions()
// registers a `watch` on every call, and one created outside a component's
// effect scope is never disposed.
const { canEditActivities } = usePermissions();
const vacationStore = useVacationStore();
const budgetStore = useBudgetStore();
const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const memberNotesStore = useMemberNotesStore();
const allergiesStore = useAllergiesStore();
const medicationsStore = useMedicationsStore();
const recipesStore = useRecipesStore();
const mealPlanStore = useMealPlanStore();
const emergencyContactsStore = useEmergencyContactsStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const recurringStore = useRecurringStore();
const translationStore = useTranslationStore();
const memberFilterStore = useMemberFilterStore();
const authStore = useAuthStore();
const notificationsStore = useNotificationsStore();
const { t } = useTranslation();
const { isMobile, isDesktop } = useBreakpoint();

// Watch for the active .beanpod file ID — once it resolves, fire a
// one-time sweep to set anyone-with-link read permission on every
// photo this user owns. Makes family-member photo rendering work
// without requiring drive.file scope coverage (ADR-021).
useEnsurePhotosPublic();

const isInitializing = ref(true);
// Set true (in onMounted) when this load is the result of an applied PWA
// update; the watcher below fires the confirmation toast once the init loader
// has cleared. Declared here so the onMounted closure can reference it.
let pendingUpdateToast = false;

// The latest release version the post-update toast last pointed at (per device).
// Lets the "what changed?" link appear ONLY when a new spotlight note shipped in
// this update (vs a minor note or a note-less deploy). Read/write are guarded —
// a blocked localStorage just means the link may show once more, never a crash.
const LAST_TOASTED_RELEASE_KEY = 'beanies-lastToastedRelease';
function readLastToastedRelease(): string {
  try {
    return localStorage.getItem(LAST_TOASTED_RELEASE_KEY) ?? '';
  } catch (e) {
    console.warn('[pwa] could not read last-toasted release', e);
    return '';
  }
}
function writeLastToastedRelease(version: string): void {
  try {
    localStorage.setItem(LAST_TOASTED_RELEASE_KEY, version);
  } catch (e) {
    console.warn('[pwa] could not persist last-toasted release', e);
  }
}
const isLoadingData = ref(true);
const initError = ref<string | null>(null);
const initErrorDetail = ref<string | null>(null);
const showClearConfirm = ref(false);
const initBreadcrumbs: string[] = [];

// Mirror the fatalErrorStore into the local refs that drive the recovery
// overlay. Any non-App.vue caller (e.g. ResumePodSetup's corrupted-pod path)
// uses the store; init-time failures still write `initError` directly. Both
// paths land on the same overlay UI.
const fatalErrorStore = useFatalErrorStore();
/**
 * False when clearing local data cannot possibly help (a payload failure). The
 * overlay then drops its "or clear your data and start fresh" advice and the
 * button that acts on it, because for an out-of-memory open that button is the
 * one action that destroys the local copy.
 */
const initErrorClearHelps = ref(true);
watch(
  () => [fatalErrorStore.message, fatalErrorStore.detail, fatalErrorStore.clearDataHelps] as const,
  ([msg, detail, clearHelps]) => {
    if (msg) {
      initError.value = msg;
      initErrorDetail.value = detail;
      initErrorClearHelps.value = clearHelps;
      showClearConfirm.value = false; // never leave the destructive panel open
    }
  }
);

/**
 * Raise the overlay for a NON-payload init failure.
 *
 * The two direct `initError.value = …` writers left below this (the init
 * watchdog and the outer onMounted catch) used to overwrite a payload message
 * — and its copyable diagnostic — while `initErrorClearHelps` stayed false,
 * leaving an unrelated error with no Clear-data button on exactly the failures
 * where clearing IS the recovery. Both go through here now, which restores the
 * flag and refuses to clobber a more specific message.
 */
function setGenericInitError(message: string, detail: string | null): void {
  // The guard is what does the work: the ONLY writer of
  // `initErrorClearHelps = false` is the store watcher, which requires
  // `fatalErrorStore.message`, so reaching past this line means the flag is
  // still true. Restoring it here would be dead code pretending to repair
  // something.
  if (fatalErrorStore.message) return; // a payload failure already said something true
  initError.value = message;
  initErrorDetail.value = detail;
}
// Mobile hamburger menu state is a shared singleton so the planner's reclaimed
// command bar can toggle the same menu (see useMobileMenu). `headerReclaimed`
// hides the global AppHeader on the mobile/tablet Activities route.
const { isOpen: isMenuOpen, close: closeMenu } = useMobileMenu();
const headerReclaimed = useHeaderReclaimed();

// On the planner, the calendar's sticky command bar must sit at the very top of
// the scroll container with nothing scrolling above it. `<main>`'s top padding
// would otherwise leave a band where events scroll visibly above the pinned bar
// (sticky `top:0` rests at the padding edge), so we drop ONLY the top padding on
// that route — both breakpoints. The command bar supplies its own top spacing.
const isPlannerRoute = computed(() => route.name === 'Activities');
// Phase 4: ONE active auth prompt at a time, resolved by the data-driven sequencer
// in `authPrompts.ts` (pin → kit → native-biometric → trust). null = nothing shown.
const activeAuthPrompt = ref<AuthPromptId | null>(null);
const authPromptDeclinedThisSignIn = ref(false);

async function handleTrustDevice() {
  await settingsStore.setTrustedDevice(true);
  // If there's a family key in memory, cache it for the newly trusted device
  const familyId = familyContextStore.activeFamilyId;
  if (familyId) {
    const exportedKey = await syncStore.getExportedFamilyKey();
    if (exportedKey) {
      await settingsStore.cacheFamilyKey(exportedKey, familyId);
    }
  }
  activeAuthPrompt.value = null;
}

function handleDeclineTrust() {
  settingsStore.setTrustedDevicePromptShown();
  activeAuthPrompt.value = null;
}

// ── Phase 4 nag handlers ────────────────────────────────────────────────────
function handlePinPromptDone() {
  activeAuthPrompt.value = null;
}

async function handlePinPromptDecline() {
  activeAuthPrompt.value = null;
  authPromptDeclinedThisSignIn.value = true;
  const familyId = authStore.currentUser?.familyId;
  const memberId = authStore.currentUser?.memberId;
  if (familyId && memberId) await settingsStore.dismissPinPrompt(familyId, memberId);
}

function handleKitPromptDone() {
  activeAuthPrompt.value = null;
}

async function handleKitPromptDecline() {
  activeAuthPrompt.value = null;
  authPromptDeclinedThisSignIn.value = true;
  await settingsStore.dismissKitPrompt();
}

async function handleEnablePasskey() {
  activeAuthPrompt.value = null;
  authPromptDeclinedThisSignIn.value = true;

  try {
    const result = await authStore.registerPasskeyForCurrentUser();
    if (result.success) {
      // The registration IS the outcome — report success before the push, and push
      // best-effort via the bounded, rejection-swallowing helper. The old unbounded
      // `await syncNow(true)` here could straddle a sign-out: the reset doc worker
      // failed the save, the rejection landed in the catch below, and a SUCCESSFUL
      // enrolment was toasted as "failed to register" over the welcome gate.
      showToast('success', t('passkey.registerSuccess'));
      if (result.passkeySecret) {
        // Store PRF-wrapped family key in the .beanpod envelope for cross-device access
        syncStore.addPasskeySecret(result.passkeySecret);
        await syncStore.syncNowBounded();
      }
    } else if (result.cancelled) {
      // User dismissed the platform-authenticator prompt — a deliberate
      // gesture, not an error. Stay silent (no toast, no Slack alert).
      // They can enable passkey later from Settings.
      console.warn('[passkey] registration cancelled by user');
    } else {
      showToast('error', result.error ?? t('passkey.registerError'));
    }
  } catch (e) {
    console.warn('[passkey] Unexpected error during passkey registration:', e);
    showToast('error', t('passkey.registerError'));
  }
}

function handleDeclinePasskey() {
  authPromptDeclinedThisSignIn.value = true;
  activeAuthPrompt.value = null;
}

/**
 * After Google Drive token re-acquisition via the reconnect toast or save failure banner,
 * reset failure state, reload data from Drive, and re-arm auto-sync.
 */
async function handleGoogleReconnected() {
  try {
    await syncStore.handleGoogleReconnected();
    showToast('success', t('googleDrive.reconnected'));
  } catch {
    showToast('warning', t('googleDrive.reconnectFailed'));
  }
}

/**
 * Read the current encrypted file to get the raw blob for passkey registration.
 * Works with any storage provider (local file or Google Drive).
 */
// Show the app shell (sidebar/header) only when signed in, with a pod, on a
// route that opts into chrome (`meta.noChrome` !== true). The `needsPodSetup`
// guard is the root-cause fix for the create-pod remount race — see
// `shouldShowAppLayout` + `docs/plans/2026-06-15-onboarding-remount-race.md`.
const showLayout = computed(() =>
  shouldShowAppLayout(route, {
    isAuthenticated: authStore.isAuthenticated,
    needsPodSetup: authStore.needsPodSetup,
  })
);

/**
 * Awaited `router.replace` with structured failure handling.
 *
 * Awaited is the load-bearing part: the post-init health check at the bottom
 * of init() reads `route.path` to decide whether to show the recovery overlay.
 * If we don't await, the route hasn't updated yet and the check sees the old
 * path — producing the `app.postInitNoData` false-fires that prompted this
 * fix.
 *
 * **Navigation cancellation** is also handled here. Vue Router's
 * `beforeEach` guards can return `false` to block a navigation; the promise
 * then RESOLVES (not rejects) with a `NavigationFailure` object. A plain
 * `await router.replace(...)` will silently succeed in that case, leaving
 * `route.path` unchanged — and the health check would then see the wrong
 * path. The check below treats a `NavigationFailure` like a thrown error
 * and reports + falls back to `window.location.replace` for the genuinely-
 * stuck cases (e.g. a critical-write guard blocking the redirect).
 */
/** Max times we'll fall back to `window.location.replace` for the same target
 *  before assuming a redirect loop and surfacing the recovery overlay instead.
 *  3 is enough for legitimate two-step redirects (e.g. SW lifecycle quirks
 *  needing one retry) without being so high that a true loop wastes 40+
 *  reloads before stopping. */
const SAFE_REPLACE_MAX_ATTEMPTS = 3;
const SAFE_REPLACE_STORAGE_PREFIX = 'safeRouterReplace:attempt:';

async function safeRouterReplace(target: string, callerTag: string): Promise<void> {
  try {
    const result = await router.replace(target);
    // Vue Router returns `undefined` on success, `NavigationFailure` when a
    // guard blocked the nav (incl. our critical-write guard). If the navigation
    // was aborted, fall back to `location.replace` so the user lands at the
    // correct path on init. (Shared `isNavigationCancelled` — see appChrome.ts.)
    if (isNavigationCancelled(result)) {
      const type = result.type;
      console.warn(
        `[App] router.replace('${target}') from ${callerTag} was cancelled by a guard (type=${type}); falling back to location.replace`
      );
      reportError({
        surface: 'app.loadFamilyData.replaceCancelled',
        message: `router.replace('${target}') was cancelled by a guard (caller=${callerTag}, type=${type})`,
        severity: 'warning',
      });

      // Loop-resistance backstop: track attempts to redirect to this target
      // in this tab session. If we've fallen through to location.replace
      // SAFE_REPLACE_MAX_ATTEMPTS times in a row and keep getting bounced
      // back here, that's an infinite reload loop — stop trying and surface
      // the recovery overlay instead. Caught 2026-05-18 from a user hitting
      // an init → fail-load → safeRouterReplace → guard cancels →
      // location.replace → reload → init → loop, generating ~40 error
      // alerts/30s. The primary fix (skip redirect on path1b-load-failed)
      // prevents the specific case; this is defence-in-depth for any
      // future caller that hits the same shape.
      const flagKey = `${SAFE_REPLACE_STORAGE_PREFIX}${target}`;
      let attempts = 0;
      try {
        attempts = parseInt(sessionStorage.getItem(flagKey) ?? '0', 10) || 0;
      } catch {
        // sessionStorage unavailable (private mode, etc.) — backstop
        // degrades to a no-op. Original behaviour applies.
      }
      attempts++;
      try {
        sessionStorage.setItem(flagKey, String(attempts));
      } catch {
        // ignore
      }

      if (attempts >= SAFE_REPLACE_MAX_ATTEMPTS) {
        console.error(
          `[App] safeRouterReplace('${target}') from ${callerTag} cancelled ${attempts}× in a row — aborting fallback to break loop`
        );
        reportError({
          surface: 'app.loadFamilyData.replaceLoopDetected',
          message: `router.replace('${target}') cancelled ${attempts}× in a row (caller=${callerTag}, type=${type}); aborting fallback to break reload loop`,
          // Terminal: the fallback is aborted and the recovery overlay shown —
          // the user is stranded in a boot loop. Page it.
          severity: 'critical',
          context: { route_path: route.path },
        });
        // Set initError so the recovery overlay shows on this load.
        // The post-init health check would also set it, but doing it here
        // means we always have a message even if some race re-runs init
        // before the health check.
        if (!initError.value) {
          setGenericInitError(t('app.initError.description'), initBreadcrumbs.join('\n'));
        }
        return;
      }

      window.location.replace(target);
    } else {
      // Successful navigation — reset the attempt counter for this target so
      // a future legitimate redirect to the same path starts fresh.
      try {
        sessionStorage.removeItem(`${SAFE_REPLACE_STORAGE_PREFIX}${target}`);
      } catch {
        // ignore
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn(`[App] router.replace('${target}') from ${callerTag} failed:`, err);
    reportError({
      surface: 'app.loadFamilyData.replaceFailed',
      message: `router.replace('${target}') threw during init (caller=${callerTag}): ${err.message}`,
      error: err,
      severity: 'warning',
    });
  }
}

/**
 * Load all family data. The data file (.beanpod V4) is the source of truth.
 *
 * Priority:
 * 1. File handle exists + permission → load from file (V4 envelope + family key decrypt)
 * 2. File handle exists + needs permission → try Automerge persistence cache
 * 3. No file handle → initialize empty Automerge doc
 */

/* eslint-disable no-console -- debug logging for sync diagnostics */

/**
 * Open-cycle telemetry window owner.
 *
 * `loadFamilyData` is the SOLE open orchestrator, so it is the only correct place
 * to open the counting window — `backgroundSyncFromFile` is not, because the
 * header Refresh button and the deferred config-heal also call it and would
 * otherwise be counted as app opens.
 *
 * The window is closed here at every terminal EXCEPT path1a's, which hands the
 * terminal to `backgroundSyncFromFile` (fire-and-forget, so this `finally` would
 * otherwise close the window before the background sync had done its work). The
 * inner function signals that by returning `'handed-off'`.
 */
/**
 * Fetch exchange rates when the family has none, or refresh them when they are
 * stale and auto-update is on. Fire-and-forget; every failure is logged.
 *
 * Extracted from the init path so it can ALSO run when a family arrives after
 * mount. `loadFamilyData()` is called exactly once, from init — so a pod CREATED
 * or JOINED during this session (the whole onboarding flow) never reached the
 * init-time fetch, and its rates stayed empty until a full page reload or a
 * manual Settings → update. Reported by greg after setting up a new family:
 * accounts added in several currencies all rendered in the base currency,
 * because `getRate` returns `undefined` with no rates and both converters then
 * hand back the raw amount for the UI to label with the base currency.
 *
 * Safe to call repeatedly: with rates present and fresh, `updateRatesIfStale`
 * short-circuits on `areRatesStale()` without touching the network.
 */
function refreshExchangeRatesIfNeeded() {
  // `docLoaded` guards the race that produced the "couldn't update your beans"
  // toast: on a hard refresh the `activeFamilyId` watcher below fires during
  // `familyContextStore.initialize()`, BEFORE `loadFamilyData()` loads the
  // document into the worker — a rate write then throws `docWorker: no document
  // loaded for 'mutate'`. The post-load init call covers the first family once
  // its doc is in; a family arriving mid-session already has its doc loaded.
  const hasRates = !!settingsStore.exchangeRates && settingsStore.exchangeRates.length > 0;
  const action = pickRateRefreshAction({
    docLoaded: isDocLoaded(),
    hasRates,
    autoUpdate: settingsStore.exchangeRateAutoUpdate,
  });
  const run =
    action === 'force' ? forceUpdateRates() : action === 'stale' ? updateRatesIfStale() : null;
  if (!run) return;
  run
    .then((r) => {
      if (r.ratesUpdated > 0) {
        settingsStore.loadSettings();
        settingsStore.loadGlobalSettings();
      }
    })
    .catch(console.error);
}

/**
 * A family arriving AFTER mount (pod created or joined this session) gets the
 * same rate bootstrap the init path gives a family that was already there.
 * `flush: 'post'` so the family's settings have landed before we read them, and
 * no `immediate` — init already covers the first family.
 */
watch(
  () => familyContextStore.activeFamilyId,
  (familyId, previous) => {
    if (!familyId || familyId === previous) return;
    refreshExchangeRatesIfNeeded();
  },
  { flush: 'post' }
);

/**
 * A corrupt local cache that has already been cleared and will re-seed from
 * Drive.
 *
 * The user notices nothing and the post-init health check never runs, so
 * without this event the fleet-wide rate of cache corruption — i.e. how often
 * devices are forced into a full multi-megabyte re-download at boot — is
 * unmeasurable. Non-paging: it self-heals.
 */
function noteCacheCorruptRecovered(err: PayloadLoadError): void {
  logEvent({
    level: 'warn',
    surface: 'pod-load-failure',
    message: 'local cache was unreadable and has been cleared; re-seeding from Drive',
    context: {
      action: 'cache-corrupt-recovered',
      error_code: err.step,
      perf_doc_bytes: err.payloadBytes ?? undefined,
    },
  });
}

/** The boot path's context for the shared payload-failure surface. */
function surfaceFatal(err: PayloadLoadError): void {
  surfacePayloadFatal(err, {
    fileId: syncStore.driveFileId ?? null,
    familyId: familyContextStore.activeFamilyId,
    source: 'boot',
  });
}

async function loadFamilyData() {
  const openToken = beginOpen();
  let handedOff = false;
  let outcome: 'open-complete' | 'open-failed' = 'open-complete';
  try {
    // `'failed'` is the non-throwing failure: a payload error that has already
    // surfaced its own honest overlay and must NOT be rethrown into the generic
    // one. It still has to be counted, or an out-of-memory open would be
    // recorded as a success and the failure rate would read 0%.
    const inner = await loadFamilyDataInner(openToken);
    handedOff = inner === 'handed-off';
    if (inner === 'failed') outcome = 'open-failed';
  } catch (e) {
    // Both of `loadFamilyDataInner`'s failure paths rethrow, and `syncStore.initialize()`
    // can throw before any path is set. Recording those as `open-complete` would make
    // the open-failure rate 0% by construction — the opposite of what the counters are
    // for. Classify, then rethrow so the recovery overlay still runs.
    outcome = 'open-failed';
    throw e;
  } finally {
    if (!handedOff) endOpen(outcome, openToken);
  }
}

async function loadFamilyDataInner(openToken: OpenToken): Promise<'handed-off' | 'failed' | void> {
  const { getActiveFamilyId: getActiveIdInner } = await import('@/services/indexeddb/database');
  const activeFamilyIdStr = getActiveIdInner();
  initBreadcrumbs.push(`loadFamilyData: activeFamily=${activeFamilyIdStr ?? 'null'}`);
  console.log('[loadFamilyData] activeFamily:', activeFamilyIdStr);

  // Initialize sync service (restores file handle if configured)
  await syncStore.initialize();

  // #32 Google Calendar sync — start the background reconcile engine ONLY when the
  // flag is on (when off, the store is never instantiated → zero pollers/watchers).
  // Idempotent + tolerant: it reads connections live, so calling before the doc
  // finishes loading is safe. Prod-off until launch.
  if (isFlagEnabled('googleCalendarSync')) {
    useCalendarSyncStore().start();
  }
  initBreadcrumbs.push(
    `syncInit: configured=${syncStore.isConfigured}, needsPermission=${syncStore.needsPermission}`
  );
  console.log(
    '[loadFamilyData] sync configured:',
    syncStore.isConfigured,
    'needsPermission:',
    syncStore.needsPermission
  );

  // Path 1: File configured + we have permission → cache-first, then background sync
  if (syncStore.isConfigured && !syncStore.needsPermission) {
    // Step 1a: Try loading from IndexedDB persistence cache for instant display
    const activeFamilyId = familyContextStore.activeFamilyId;
    const cachedKeyB64 = activeFamilyId
      ? await settingsStore.getCachedFamilyKey(activeFamilyId)
      : null;

    if (activeFamilyId && cachedKeyB64) {
      setOpenPath('path1a');
      initBreadcrumbs.push('path1a: trying persistence cache for fast start');
      console.log('[loadFamilyData] path1a: trying cache-first load...');
      try {
        // The snapshot fast-paint fires `onEarlyPaint` the instant the stores hold the
        // snapshot data (well under 1s), so the placeholder lifts THEN — not after the
        // slow authoritative rebuild that `loadFromPersistenceCache` awaits internally.
        let earlyPainted = false;
        const cacheResult = await syncStore.loadFromPersistenceCache(cachedKeyB64, activeFamilyId, {
          preservePermissionState: true,
          onEarlyPaint: () => {
            earlyPainted = true;
            memberFilterStore.initialize();
            isLoadingData.value = false; // Show snapshot data immediately
          },
        });
        if (cacheResult.success) {
          initBreadcrumbs.push('path1a: cache loaded — showing data, background sync starting');
          console.log('[loadFamilyData] path1a: cache hit — instant data');
          if (!earlyPainted) {
            memberFilterStore.initialize();
            isLoadingData.value = false; // Show real data immediately (no snapshot → after rebuild)
          }
          const result = await processRecurringItems();
          if (result.processed > 0) {
            await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
          }
          // Fire-and-forget: fetch fresh data from Drive in background.
          // It owns the open-cycle terminal from here (success, skip, or failure)
          // — see the wrapper's doc-comment.
          // The token travels with the hand-off: `backgroundSyncFromFile` is also
          // reachable from the header Refresh button and the config-heal, and only
          // the holder of this token may close this open's window.
          syncStore.backgroundSyncFromFile(openToken);
          return 'handed-off';
        }
        // ⚠️ ONLY the too-large half dead-ends here. Falling through to 1b would
        // re-download the (usually LARGER) Drive copy and try to inflate it on
        // the device that has just proved it has no room: the same failure
        // again, after a long stall.
        //
        // A CORRUPT cache must still fall through, and this is the distinction
        // an earlier cut got wrong. `initAndLoadCache` CLEARS the cache before
        // rethrowing precisely so a fresh Drive load can re-seed it, so dead-
        // ending turns a self-healing hiccup into a permanent "your data may be
        // damaged" overlay plus a critical page on every boot, forever — while
        // the pod on Drive is fine.
        if (cacheResult.payloadError instanceof PayloadTooLargeError) {
          initBreadcrumbs.push(`path1a: payload ${cacheResult.payloadError.step} too-large`);
          surfaceFatal(cacheResult.payloadError);
          return 'failed';
        }
        if (cacheResult.payloadError) {
          initBreadcrumbs.push(`path1a: cache ${cacheResult.payloadError.step} corrupt — cleared`);
          noteCacheCorruptRecovered(cacheResult.payloadError);
        }
        initBreadcrumbs.push('path1a: cache miss or failed — falling through to Drive fetch');
        console.log('[loadFamilyData] path1a: cache miss — falling back to Drive');
      } catch {
        initBreadcrumbs.push('path1a: cache error — falling through to Drive fetch');
      }
    }

    // Step 1b: No cache available — fall back to blocking Drive fetch (skeleton shows in UI)
    // Relabel rather than restart: reaching path1b after a path1a cache miss is
    // ONE open that did both pieces of work, not two opens.
    setOpenPath('path1b');
    initBreadcrumbs.push('path1b: loading from sync file (Drive fetch)');
    console.log('[loadFamilyData] path1b: calling loadFromFile...');
    try {
      const loadResult = await syncStore.loadFromFile();
      initBreadcrumbs.push(`path1b: loadFromFile result=${loadResult.success}`);
      console.log('[loadFamilyData] path1b: loadFromFile returned', loadResult);
      if (loadResult.success) {
        memberFilterStore.initialize();
        const result = await processRecurringItems();
        if (result.processed > 0) {
          await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
        }
        syncStore.setupAutoSync();
        return;
      }

      // File needs password — try cached family key via shared helper
      if (loadResult.needsPassword) {
        console.log('[loadFamilyData] needsPassword — trying cached key');
        const success = await syncStore.tryDecryptWithCachedKey();
        // A payload failure here is the MAIN cold-boot route on a memory-limited
        // device: `familyKey` is null on a cold start, so `loadFromFile` never
        // reaches its cached-key branch and returns `needsPassword`. A bare
        // `false` sent the user to `/welcome?resume=setup` — a password screen
        // for a failure no password can fix.
        if (success !== true && success !== false) {
          initBreadcrumbs.push(`path1b: cached-key payload ${success.payloadError.step} failure`);
          surfaceFatal(success.payloadError);
          return 'failed';
        }
        if (success) {
          memberFilterStore.initialize();
          const result = await processRecurringItems();
          if (result.processed > 0) {
            await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
          }
          return;
        }

        // Can't auto-decrypt — route to the resume-setup recovery screen for
        // password/biometric entry. Use `?resume=setup` (not bare `/welcome`):
        // this branch only fires when the cached key is gone (the happy path
        // decrypts + returns above), which for a `podCreated` owner is the
        // provider-config-lost recovery case — and bare `/welcome` bounces a
        // podCreated owner to `/nook` (the reload-loop hazard below). The
        // resume-setup route is let through by the already-auth guard.
        // Awaited so `route.path` updates before the post-init health check at the
        // bottom of init() reads it — otherwise the check sees the pre-replace
        // path and false-fires `app.postInitNoData` with the recovery overlay.
        initBreadcrumbs.push('path1b: needsPassword but no cached key — routing to resume-setup');
        console.warn('[loadFamilyData] Cannot auto-decrypt — routing to resume-setup');
        await safeRouterReplace('/welcome?resume=setup', 'path1b-needs-password');
        return;
      }

      // Auth-masked failure: an expired/absent Google token surfaces as a Drive
      // 404 (permission masked as not-found). syncStore.loadFromFile has already
      // surfaced the reconnect banner. This is a reconnect situation, NOT data
      // loss — do not fall through to the "your data is missing" recovery
      // overlay. The post-init health check below also defers to
      // `showGoogleReconnect`. (Root-caused 2026-07-15 from a long-idle iPhone
      // whose lost refresh token turned a cold-load 404 into a false data-loss
      // overlay.)
      if (loadResult.reason === 'auth') {
        initBreadcrumbs.push(
          'path1b: loadFromFile auth-transient — reconnect banner, skipping overlay'
        );
        console.warn(
          '[loadFamilyData] Token expired (Drive 404 masked as not-found) — surfacing reconnect, no overlay'
        );
        return;
      }

      // File load failed for non-password reasons (file unreadable, missing,
      // permission revoked, etc.). DO NOT redirect to /welcome — the router's
      // `ALREADY_AUTH_REDIRECT_FROM` guard at `src/router/index.ts:309-319`
      // bounces /welcome → /nook for signed-in users with `podCreated: true`,
      // creating an infinite reload loop (caught 2026-05-18 from one family
      // hitting 40+ error alerts in 30s as init → safeRouterReplace('/welcome')
      // → guard cancels → window.location.replace fallback → reload → repeat).
      //
      // Instead, fall through to the post-init health check below. It sees
      // no doc loaded + route still /nook (not a login-flow route), sets
      // `initError`, and surfaces the recovery overlay where the user can
      // Reload or Clear Data. No redirect, no guard fight, no loop.
      initBreadcrumbs.push('path1b: loadFromFile failed — falling through to recovery overlay');
      console.warn('[loadFamilyData] File load failed — falling through to recovery overlay');
      return;
    } catch (err) {
      // A payload failure must keep its CLASS. Rewrapping it in a bare Error
      // turns "this pod needs more memory than this device has" into a generic
      // init failure, and the generic recovery overlay's advice is "reload, or
      // clear your data and start fresh" — useless for an out-of-memory open,
      // and the one action that destroys the local copy. This is the exact path
      // the 3GB tablet takes, so it is the path that has to tell the truth.
      if (err instanceof PayloadLoadError) {
        initBreadcrumbs.push(`path1b: payload ${err.step} failure (${err.name})`);
        console.warn('[loadFamilyData] path1b: payload load failed', err);
        surfaceFatal(err);
        return 'failed';
      }
      throw new Error(
        `Failed to load data from sync file: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Path 2: File configured but needs permission → try Automerge persistence cache
  if (syncStore.isConfigured && syncStore.needsPermission) {
    setOpenPath('path2');
    initBreadcrumbs.push('path2: file needs permission, trying cache');
    console.log('[loadFamilyData] File needs permission — trying persistence cache');
    const activeFamilyId = familyContextStore.activeFamilyId;
    const cachedKeyB64 = activeFamilyId
      ? await settingsStore.getCachedFamilyKey(activeFamilyId)
      : null;
    initBreadcrumbs.push(
      `path2: familyId=${activeFamilyId ?? 'null'}, hasCachedKey=${!!cachedKeyB64}`
    );
    if (activeFamilyId && cachedKeyB64) {
      try {
        const cacheResult = await syncStore.loadFromPersistenceCache(cachedKeyB64, activeFamilyId);
        initBreadcrumbs.push(`path2: cacheResult=${cacheResult.success}`);
        // ⚠️ TOO-LARGE MUST NOT fall through. Path 3 calls `initDoc()` — a fresh
        // EMPTY doc — while the cache DB is still open on this family, because
        // the too-large branch deliberately did not clear it. The user's next
        // mutation would then persist that empty doc as the BASE, deleting every
        // increment the preserve branch just protected.
        //
        // A CORRUPT cache is the opposite case: it has already been cleared, so
        // there is nothing left to overwrite and falling through to an empty doc
        // is the existing (and correct) degraded behaviour.
        if (cacheResult.payloadError instanceof PayloadTooLargeError) {
          initBreadcrumbs.push(`path2: payload ${cacheResult.payloadError.step} too-large`);
          surfaceFatal(cacheResult.payloadError);
          return 'failed';
        }
        if (cacheResult.payloadError) {
          initBreadcrumbs.push(`path2: cache ${cacheResult.payloadError.step} corrupt — cleared`);
          noteCacheCorruptRecovered(cacheResult.payloadError);
        }
        if (cacheResult.success) {
          console.log('[loadFamilyData] Loaded from persistence cache');
          memberFilterStore.initialize();
          const result = await processRecurringItems();
          if (result.processed > 0) {
            await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
          }
          return;
        }
      } catch (err) {
        initBreadcrumbs.push(
          `path2: cache threw: ${err instanceof Error ? err.message : String(err)}`
        );
        console.warn('[loadFamilyData] Failed to load from persistence cache:', err);
      }
    }
    // Cache failed or unavailable — fall through to Path 3 so the app
    // at least renders with an empty doc. User can grant file permission
    // from Settings to reload their data.
    initBreadcrumbs.push('path2: cache unavailable, falling through to path3');
    console.log('[loadFamilyData] Cache unavailable — falling through to init empty doc');
  }

  // Path 3: No file configured → initialize Automerge doc
  // This path is for first-time users or users without a sync file
  setOpenPath('path3');
  initBreadcrumbs.push('path3: no file configured, initializing empty doc');
  try {
    // Check if a doc is already loaded (e.g. from the signup flow that just
    // completed) via the projection loaded-flag (no throwing getDoc probe).
    const docClient = await import('@/services/automerge/worker/docClient');
    const { isLoaded } = await import('@/services/automerge/projection');

    if (!isLoaded()) {
      // E2E seed: if the data bridge saved a binary to sessionStorage, load it
      // into the worker; otherwise create a fresh empty doc.
      if (import.meta.env.DEV && sessionStorage.getItem('__e2eSeedDoc')) {
        const { base64ToBuffer } = await import('@/utils/encoding');
        const b64 = sessionStorage.getItem('__e2eSeedDoc')!;
        sessionStorage.removeItem('__e2eSeedDoc');
        await docClient.loadSnapshot(new Uint8Array(base64ToBuffer(b64)));
      } else {
        await docClient.initDoc();
      }
    }

    // Load stores from the (empty) Automerge doc
    await settingsStore.loadSettings();
    await familyStore.loadMembers();

    if (familyStore.isSetupComplete) {
      memberFilterStore.initialize();

      await Promise.all([
        accountsStore.loadAccounts(),
        transactionsStore.loadTransactions(),
        assetsStore.loadAssets(),
        goalsStore.loadGoals(),
        recurringStore.loadRecurringItems(),
        todoStore.loadTodos(),
        listStore.loadLists(),
        activityStore.loadActivities(),
        vacationStore.loadVacations(),
        budgetStore.loadBudgets(),
        favoritesStore.loadFavorites(),
        sayingsStore.loadSayings(),
        memberNotesStore.loadMemberNotes(),
        allergiesStore.loadAllergies(),
        medicationsStore.loadMedications(),
        recipesStore.loadRecipes(),
        mealPlanStore.loadMealPlans(),
        emergencyContactsStore.loadEmergencyContacts(),
      ]);

      const result = await processRecurringItems();
      if (result.processed > 0) {
        await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
      }
    }
  } catch (err) {
    throw new Error(
      `Failed to initialize document: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
/* eslint-enable no-console */

// Sentinel for the init catch's chunk-recovery branch. Module-scoped (not
// a ref) because it gates the finally block's loading-state dismissal,
// not anything reactive. Reset only by full-page reload — which is the
// next thing `hardReload()` does.
let chunkReloadInProgress = false;

// Init timeouts — STRICTLY INCREASING; each layer is the safety net for the one
// above it. Do NOT reorder or collapse (a unit test pins the ordering). The
// innermost bound is the 15s OAuth-proxy fetch abort in `oauthProxy.ts`; these
// are the App.vue init layers above it. The watchdog is the last resort against
// a silent "counting beans" wedge (init stuck with `isInitializing` true and no
// inner timeout to escape it) — the iOS onboarding freeze, 2026-06-20.
const INIT_TIMEOUTS = {
  // (redirect-auth completion is now bounded inside googleAuth.ensureRedirectAuthSettled)
  dataLoad: 30_000, // dismiss the data skeleton; loading continues in the background
  watchdog: 35_000, // last resort: flip isInitializing false + show the recovery overlay
} as const;

onMounted(async () => {
  // Watchdog: if init never settles (a downstream await hangs before the
  // data-load timeout can fire), flip out of "counting beans" into the EXISTING
  // recovery overlay rather than freezing forever. Cleared in the finally on any
  // resolution; only fires when the body genuinely never completes.
  const initWatchdog = setTimeout(() => {
    if (chunkReloadInProgress) return; // a hardReload is already swapping the page
    if (!isInitializing.value && !isLoadingData.value) return; // already settled
    console.error('[App] init watchdog fired — setup stalled; surfacing recovery overlay');
    setGenericInitError(t('app.initError.stalled'), initBreadcrumbs.join('\n'));
    isInitializing.value = false;
    isLoadingData.value = false;
    reportError({
      surface: 'app.onboardingStallTimeout',
      message: `App init stalled — watchdog fired after ${INIT_TIMEOUTS.watchdog}ms`,
      severity: 'critical',
      context: { route_path: route.path },
    });
  }, INIT_TIMEOUTS.watchdog);
  try {
    // Ensure initial route is resolved before checking route names
    await router.isReady();

    // Resume navigation after a PWA auto-update reload. `usePwaUpdater` saves
    // the user's route before the reload (PWA_POST_UPDATE_ROUTE_KEY) — restore
    // it now so the update doesn't strand them on a different page. Done before
    // auth checks so existing redirects (e.g. unauth → /welcome) still apply.
    // NOTE: this key carries TWO meanings — the resume route AND "this reload
    // was an applied update" (the post-update toast trigger). Never write it
    // for a non-update reason, or the "updated!" toast would fire falsely.
    const postUpdatePath = sessionStorage.getItem(PWA_POST_UPDATE_ROUTE_KEY);
    if (postUpdatePath) {
      sessionStorage.removeItem(PWA_POST_UPDATE_ROUTE_KEY);
      pendingUpdateToast = true; // fire once the init loader clears (see watcher)
      if (postUpdatePath !== route.fullPath) {
        initBreadcrumbs.push(`pwa-resume: navigating to ${postUpdatePath}`);
        await router.replace(postUpdatePath);
      }
    }

    initBreadcrumbs.push(`route: ${String(route.name ?? route.path)}`);

    // OAuth callback is a pure BOUNCE route: OAuthCallbackPage.vue reads the
    // auth code and immediately `window.location`-redirects to the returnPath,
    // where App.vue init re-runs and `completeRedirectAuth()` consumes the code.
    // Running heavy init here (settings → auth → dynamic imports) is not just
    // wasted work — the page is unloading, so an in-flight `await import()` can
    // resolve to `null` and throw (the registerGoogleAccountAssertion
    // destructure crash seen on iPhone, 2026-06-20). Skip everything; the
    // `finally` dismisses the spinner until the redirect lands.
    // OAuthNativeBridge rides the same bail for a different reason: it is the
    // /oauth/native backstop, reached mid-sign-in by a BY-DEFINITION
    // unauthenticated user. Without this it would fall through to the
    // `needsAuth` block below and be replaced by /welcome — re-creating the very
    // bug it exists to diagnose, with the auth code discarded. It must stay on
    // screen, keep the code in the URL, and explain itself.
    if (route.name === 'OAuthCallback' || route.name === 'OAuthNativeBridge') {
      initBreadcrumbs.push(`${String(route.name)}: terminal oauth surface — skipping heavy init`);
      return;
    }

    // Fast path: skip heavy initialization for public-only pages
    const publicOnlyPages = [
      'BeanstalkBlog',
      'BeanstalkPost',
      'HelpCenter',
      'HelpCategory',
      'HelpArticle',
    ];
    const isPublicPage = publicOnlyPages.includes(route.name as string);

    // Step 1: Load global settings (theme, language) — works before any family is active
    await settingsStore.loadGlobalSettings();
    initBreadcrumbs.push('settings: global settings loaded');

    // Sync beanie mode from settings to translation store
    watch(
      () => settingsStore.beanieMode,
      (val) => translationStore.setBeanieMode(val),
      { immediate: true }
    );

    // Sync sound enabled from settings to useSounds composable
    watch(
      () => settingsStore.soundEnabled,
      (val) => setSoundEnabled(val),
      { immediate: true }
    );

    // Load translations if language is not English (non-blocking)
    if (settingsStore.language !== 'en') {
      translationStore.loadTranslations(settingsStore.language).catch(console.error);
    }

    // Public pages: skip auth, IndexedDB, and data loading entirely
    if (isPublicPage) {
      initBreadcrumbs.push('public: skipping auth and data init for public page');
      return;
    }

    // Request persistent storage so the browser won't evict IndexedDB
    // (tokens, file handles). Installed PWAs are almost always granted; a denial
    // is the normal state on non-installed browsers (esp. iOS Safari, where ITP
    // then evicts storage after ~7 days — the Drive-reconnect cause). We surface
    // denials to telemetry (Plausible only — NOT reportError; denial is expected,
    // not an error) so we can see how often eviction protection is missing.
    if (navigator.storage?.persist) {
      navigator.storage
        .persist()
        .then((granted) => {
          if (granted) {
            console.warn('[storage] Persistent storage granted');
          } else {
            console.warn('[storage] Persistent storage denied (eviction possible)');
            // Fires on boot, not on a user action — registered `'passive'` in
            // ANALYTICS_EVENTS, which is what sends it `interactive: false`.
            track('storage_persist_denied');
          }
        })
        .catch((e) => {
          console.warn('[storage] Persistent storage request failed', e);
        });
    }

    // Step 2: Initialize auth (checks registry for existing families)
    initBreadcrumbs.push('auth: initializing');
    await authStore.initializeAuth();
    initBreadcrumbs.push(
      `auth: needsAuth=${authStore.needsAuth}, user=${authStore.currentUser?.email ?? 'none'}`
    );

    // Register the Google account assertion subscriber. Validates every
    // newly-acquired access token against the current member's bound
    // Google account; backfills the binding on first sign-in; silently
    // self-corrects on mismatch. One-time registration for the app's
    // lifetime — `registerGoogleAccountAssertion` is idempotent.
    const { registerGoogleAccountAssertion } =
      await import('@/services/auth/googleAccountAssertion');
    registerGoogleAccountAssertion();

    // Step 2b: Consume any pending OAuth redirect-auth code. If the user
    // just returned from a Google sign-in redirect (Settings → Reconnect,
    // Join Pod, etc.), this exchanges the code for an access token and
    // caches it in memory, so the in-flight Drive operation that triggered
    // the redirect can resume on the next attempt. No-op if there's no
    // pending redirect. Wrapped in catch so a failed exchange never
    // blocks app boot.
    //
    // SKIP on native (Capacitor): there the deep-link `appUrlOpen` listener
    // (installNativeAuthListener) owns OAuth completion. Running this at boot
    // too would race the listener to consume the one-time code (whichever
    // removes the sessionStorage key first wins) and could complete the auth
    // without the listener's navigation, stranding the user. See ADR-029.
    if (!isNative())
      try {
        // Redeem a pending redirect `code` through the shared, memoized settlement
        // (bounded + native-safe internally). Routing every redemption through this
        // one memo is what lets the resume/family-list consumers await the SAME
        // in-flight exchange instead of racing it and misreading `isTokenValid()`.
        // See docs/plans/2026-07-07-ios-redirect-auth-race.md.
        const { ensureRedirectAuthSettled } = await import('@/services/google/googleAuth');
        const redirectToken = await ensureRedirectAuthSettled();
        if (redirectToken) {
          initBreadcrumbs.push('auth: consumed pending redirect-auth token');
        } else {
          // No pending redirect to consume — clear any lingering pending-
          // account-switch flag from sessionStorage. If the user started a
          // switch on PWA / iOS, then hit the back button instead of
          // completing the chooser, the flag would otherwise contaminate
          // the next legitimate token acquisition. Successful redirects
          // already consume the flag inside the assertion subscriber.
          const { disarmAccountSwitch } = await import('@/services/auth/googleAccountAssertion');
          disarmAccountSwitch();
        }
      } catch (e) {
        // A pending redirect-auth code that fails to exchange is a real
        // onboarding/reconnect failure — surface it (not just a console.warn).
        // App boot still continues; the user lands on the welcome/recovery
        // surface and can retry.
        const msg = (e as Error).message;
        console.warn('[App] redirect-auth completion failed during init:', msg);
        initBreadcrumbs.push(`auth: redirect-auth completion failed: ${msg}`);
        // Granular-consent denial (drive.file unchecked) is a SPECIFIC,
        // user-fixable failure (2026-06-19, finding 3) — stash a reason so the
        // resume-setup screen explains "you must allow file access" instead of
        // a silent route the user retries blindly. Reported at warning (not
        // critical): it's user action, not a code fault.
        const { DriveConsentDeniedError } = await import('@/types/sync');
        const isConsentDenied = e instanceof DriveConsentDeniedError;
        if (isConsentDenied) {
          const { setResumeReason } = await import('@/components/login/resumePaths');
          setResumeReason('drive-consent');
        }
        reportError({
          surface: 'app.redirectAuthCompletion',
          message: `Redirect-auth code exchange failed during app init: ${msg}`,
          error: e,
          severity: isConsentDenied ? 'warning' : 'critical',
          context: { route_path: route.path, consent_denied: isConsentDenied },
        });
      }

    // If not authenticated, redirect to the welcome/login gate (unless already on an auth page).
    // The marketing homepage lives at beanies.family; app.beanies.family is always the app surface,
    // so unauthenticated users land on /welcome and can sign in or create a pod from there.
    //
    // OpenFromDrive (/open) is a legitimate unauthenticated entry point — Drive's "Open with"
    // gesture sends users here directly with a file ID; the page handles its own auth flow.
    // CreateFamily (/create) is a direct deep-link into the create-pod flow, also unauthenticated.
    if (authStore.needsAuth) {
      // E2E auto-auth: restore from sessionStorage (dev mode only)
      if (!authStore.restoreE2EAuth()) {
        const authPages: Array<string | undefined> = [
          'Welcome',
          'Login',
          'JoinFamily',
          'CreateFamily',
          'OpenFromDrive',
          // Dev-only ADR-032 worker spike — a standalone measurement page with no
          // auth/pod; exempt from the onboarding redirect (dev builds only).
          'DevWorkerSpike',
        ];
        if (!authPages.includes(route.name as string)) {
          initBreadcrumbs.push('auth: redirecting to /welcome (not authenticated)');
          router.replace('/welcome');
        }
        return;
      }
    }

    // Authenticated, but the `.beanpod` file doesn't exist yet — a
    // half-finished onboarding (signup done, storage not chosen / failed; or
    // an iOS Drive redirect mid-flight). Route to the resume-setup recovery
    // screen rather than letting an empty `/nook` render. (The router-level
    // guard handles this for SPA navigations; this is the fresh-page-load
    // path, after async auth hydration completes.)
    if (authStore.needsPodSetup && !route.path.startsWith('/dev')) {
      initBreadcrumbs.push('auth: authenticated but no pod file — routing to resume-setup');
      // Only alert when this is a genuinely UNEXPECTED zombie. A podless
      // session is the NORMAL mid-flow state on the onboarding routes
      // (`/create`, `/open` — `meta.noChrome`) and on the recovery screen
      // (`?resume=setup`/`?resume=load-drive`), so suppress the page there.
      // The router-guard alert in src/router/index.ts still fires when a user
      // navigates TO a protected route in zombie state — that's the signal we
      // genuinely want. (2026-05-18: HK pilot's recovery boot tripped this on a
      // correctly-rendering page; 2026-06-15: the create wizard tripped it on
      // every signup, masking a remount race.)
      // Suppress on routes where a podless session is EXPECTED (the onboarding
      // entry points, incl. the `Welcome` recovery screen) — keyed on route name
      // via `isPodlessExpectedRoute`, NOT `meta.noChrome` (which also covers
      // NotFound/PlausibleExclude, where a podless session IS anomalous and
      // should still alert).
      const onRecoveryQuery = isPodlessRecoveryQuery(route.query.resume);
      if (!isPodlessExpectedRoute(route)) {
        reportError({
          surface: 'app.onboardingZombieState',
          message:
            'App boot found an authenticated session with no pod file — routing to resume-setup',
          severity: 'critical',
          // fullPath preserves the query — useful for diagnosing how the
          // user reached a non-recovery route in zombie state.
          context: { route_path: route.fullPath },
        });
      }
      // Steer non-recovery surfaces to resume-setup (keep the recovery path),
      // via the hardened wrapper so a guard-cancelled nav surfaces rather than
      // silently resolving. Already on a recovery query → no redundant replace.
      if (!onRecoveryQuery) {
        await safeRouterReplace(RESUME_SETUP_PATH, 'app.boot.onboardingZombie');
      }
      isInitializing.value = false;
      return;
    }

    // If the user is authenticated but landed on a pre-auth page (/welcome
    // or /login) — e.g., a returning user clicking the marketing-site "sign
    // in" link with an active session, or pasting app.beanies.family/welcome
    // into the URL bar — send them straight to /nook. The router-level
    // beforeEach guard only fires on SPA navigations; this handles the
    // fresh-page-load case after async auth hydration completes.
    if (!authStore.needsAuth) {
      const preAuthPages: Array<string | undefined> = ['Welcome', 'Login'];
      if (preAuthPages.includes(route.name as string)) {
        initBreadcrumbs.push('auth: already signed in, redirecting from pre-auth page → /nook');
        await router.replace('/nook');
      }
    }

    // Step 3: Resolve active family
    const authFamilyId = authStore.currentUser?.familyId;
    initBreadcrumbs.push(`family: authFamilyId=${authFamilyId ?? 'none'}`);

    if (authFamilyId) {
      // Auth resolved a family — switch to it
      const { closeDatabase } = await import('@/services/indexeddb/database');
      await closeDatabase();
      const switched = await familyContextStore.switchFamily(authFamilyId);
      await familyContextStore.reload();
      initBreadcrumbs.push(`family: switchFamily=${switched}`);

      if (!switched) {
        const family = await familyContextStore.createFamilyWithId(authFamilyId, 'My Family');
        if (!family) {
          initBreadcrumbs.push('family: createFamilyWithId FAILED');
          throw new Error('Failed to create family context for id: ' + authFamilyId);
        }
        initBreadcrumbs.push('family: created new family entry');
      }
    } else {
      // No auth family — use lastActiveFamilyId or create new
      const activeFamily = await familyContextStore.initialize();
      initBreadcrumbs.push(`family: initialize=${!!activeFamily}`);

      if (!activeFamily) {
        const family = await familyContextStore.createFamily('My Family');
        if (!family) {
          initBreadcrumbs.push('family: createFamily FAILED');
          throw new Error('Failed to create default family context');
        }
        initBreadcrumbs.push('family: created default family');
      }
    }

    // Step 4: Dismiss full-screen spinner — app shell can now render.
    // Data loading continues with skeleton/progress bar in the content area.
    isInitializing.value = false;
    initBreadcrumbs.push('shell: app shell visible, loading data...');

    // Step 5: Load family data from the active per-family DB
    // Defer file polling until after processRecurringItems to prevent the
    // reload cascade (init mutations → file poll detects "change" → reload → loop).
    syncStore.deferPolling();
    initBreadcrumbs.push('data: loading family data');
    const { closeDatabase: closeDb } = await import('@/services/indexeddb/database');
    await closeDb();

    // Timeout guard: if loading takes too long (Google Drive 5xx, network issues),
    // dismiss the skeleton so the app is usable. Data continues loading in background.
    const INIT_TIMEOUT_MS = INIT_TIMEOUTS.dataLoad;
    let initTimedOut = false;
    const timeoutId = setTimeout(() => {
      initTimedOut = true;
      initBreadcrumbs.push('data: loadFamilyData TIMED OUT after 30s');
      console.warn('[App] loadFamilyData timed out — dismissing skeleton');
      isLoadingData.value = false;
    }, INIT_TIMEOUT_MS);

    try {
      await loadFamilyData();
      initBreadcrumbs.push('data: loadFamilyData completed');
    } finally {
      clearTimeout(timeoutId);
      isLoadingData.value = false;
      // Init complete — start deferred file polling for cross-device sync
      syncStore.startDeferredPolling();
      if (initTimedOut) {
        initBreadcrumbs.push('data: loadFamilyData finished after timeout (background)');
        console.warn('[App] loadFamilyData completed after timeout — data is now available');
      }
    }

    // Post-init health check: verify the Automerge doc is loaded
    let docLoaded = false;
    try {
      const { isLoaded } = await import('@/services/automerge/projection');
      if (!isLoaded()) throw new Error('no document loaded');
      docLoaded = true;
      initBreadcrumbs.push('health: automerge doc OK');
      // App booted successfully — reset the chunk-load retry counter so
      // the next deploy gap gets its own full budget. (This used to live
      // in router.afterEach, but firing-on-every-nav defeated the
      // counter — the initial nav resolves before App.vue's onMounted
      // error throws, so every load got a fresh "first attempt" budget
      // and the loop never escalated. Gated on actual boot success now.)
      // Clears both the persisted flag AND the in-memory mirror — on a device
      // where storage throws, the mirror would otherwise strand a stale count
      // that the next unrelated chunk error inherits.
      resetChunkAttempts();
    } catch {
      // Doc not loaded — initialization completed but data is missing.
      // Two reasons this can happen: (a) genuine init failure (network, file
      // missing, etc.) — surface the recovery UI; (b) loadFamilyData
      // intentionally redirected us to /welcome or /login because the user
      // needs to authenticate before the doc can be decrypted — surfacing
      // the recovery UI on top of the login page is confusing and wrong.
      // The route check distinguishes the two cases.
      initBreadcrumbs.push('health: NO automerge doc loaded');
      const breadcrumbLog = initBreadcrumbs.join('\n');
      const onLoginFlowRoute = route.path === '/welcome' || route.path === '/login';
      // A surfaced Google-reconnect banner means the user must re-authenticate
      // before the doc can load (e.g. an expired token returned a Drive 404
      // masked as not-found). Showing the "data missing" recovery overlay on
      // top of that misrepresents an expired session as data loss — suppress it,
      // exactly as we do on the login-flow routes. `reconnecting` covers the
      // silent-config-heal retry window (a lost provider config being re-derived
      // from the registry) — same reasoning: don't flash the data-loss overlay
      // while a background heal is still in flight.
      // `reconnectEscalationPending` covers the ~4s window between scheduling the
      // reconnect banner (on an auth-masked cold-start 404) and it actually showing —
      // set synchronously so this check doesn't false-fire the data-loss overlay +
      // critical page before the deferred banner lands.
      const awaitingReconnect =
        syncStore.showGoogleReconnect ||
        syncStore.reconnecting ||
        syncStore.reconnectEscalationPending;
      // A fatal message is already on screen (a payload failure classified by
      // path 1b, or ResumePodSetup) and it says something TRUE and specific.
      // The branch below would overwrite both it and its support diagnostic
      // with 'Initialization completed but no data was loaded' + a breadcrumb
      // dump, and fire a second `critical` report calling an out-of-memory open
      // "data unreachable". Note the guard has to be here, not at the
      // assignment: line 418's `if (!initError.value)` has no counterpart in
      // that branch.
      const alreadyExplained = !!fatalErrorStore.message;
      // The instant-open snapshot may have painted cached data into the stores even
      // though the authoritative Automerge doc rebuild produced no doc (a cache
      // hiccup, or no provider yet to re-fetch from — the `provider_type: null`
      // firing on 2026-08-20). The user is looking at their data, so this is a
      // DEGRADED READ-ONLY state, not the blank-screen "data unreachable" case the
      // critical page exists for. Downgrade to non-paging telemetry and do NOT raise
      // the (wrong) "data missing" recovery overlay on top of visible data.
      const snapshotDataVisible = syncStore.snapshotPaintedThisSession;
      if (onLoginFlowRoute || awaitingReconnect || alreadyExplained) {
        console.warn(
          '[App] Post-init health check: no doc, but on a login-flow route, awaiting ' +
            `Google reconnect (reconnect=${awaitingReconnect}), or already explained ` +
            `(fatal=${alreadyExplained}) — suppressing recovery UI\n` +
            breadcrumbLog
        );
      } else if (snapshotDataVisible) {
        console.warn(
          '[App] Post-init health check: no doc, but the open-snapshot painted cached ' +
            'data — degraded read-only, not data loss; not paging.\n' +
            breadcrumbLog
        );
        reportError({
          surface: 'app.postInitNoData',
          message:
            'App init completed with snapshot data shown but no Automerge doc rebuilt — degraded read-only, not data loss',
          // Firehose + console only (NOT critical): data is on screen from the
          // snapshot, so this is not a user-facing data-loss event. A truly failed
          // rebuild with no snapshot still pages via the critical branch below.
          severity: 'error',
          context: {
            route_path: route.path,
            breadcrumbs: breadcrumbsForReport(initBreadcrumbs),
          },
        });
      } else {
        setGenericInitError(t('app.initError.noData'), breadcrumbLog);
        console.error('[App] Post-init health check failed — no Automerge doc\n' + breadcrumbLog);
        // Surface it — a `podCreated` user reaching `/nook` with no decrypted
        // doc AND no snapshot data on screen is a real init failure (a half-finished
        // onboarding would have been routed to resume-setup above). The full
        // breadcrumb trail is in the console and the recovery overlay; Slack just
        // needs the signal.
        reportError({
          surface: 'app.postInitNoData',
          message: 'App init completed but no Automerge doc loaded — recovery overlay shown',
          // Recovery overlay shown to a podCreated user with a blank screen = data
          // unreachable. The onLoginFlowRoute / reconnect / snapshot guards above
          // filter the false-fires.
          severity: 'critical',
          context: {
            route_path: route.path,
            breadcrumbs: breadcrumbsForReport(initBreadcrumbs),
          },
        });
      }
    }

    // Skip exchange-rate refresh entirely when the doc isn't loaded. Its
    // callees (forceUpdateRates / updateRatesIfStale → getSettings →
    // getDoc) would throw synchronously and the .catch(console.error) below
    // would only surface noise. Rates are refreshed cleanly post-sign-in
    // when the doc actually loads.
    if (!docLoaded) {
      return;
    }

    // Always fetch exchange rates on init when none are loaded (first-time users,
    // join flow, cross-browser). If rates exist, only refresh if auto-update is
    // enabled and rates are stale (>24h).
    // After updating, reload the store so Vue reactive state reflects the new rates.
    // ONE-SHOT #55 activity-reminder back-fill. Fire-and-forget — it must never
    // block or break boot. Deliberately here, NOT in activityStore's load path
    // (where the other two migrations live): this one needs `canEditActivities`,
    // which resolves from `familyStore.currentMember`, and `loadActivities()` can
    // complete before that lands — a load-path trigger would take the
    // !canEdit early return on its only run and silently never retry.
    // The permission is read in setup (a `watch` created inside this async
    // closure would be outside the component's effect scope) and passed IN, so
    // the store action stays free of usePermissions' per-call watcher.
    void activityStore
      .backfillReminderMinutes({ canEdit: canEditActivities.value })
      .catch((e) => console.warn('[App] activity reminder back-fill failed', e));

    refreshExchangeRatesIfNeeded();
  } catch (err) {
    // Stale-chunk symptom — a dynamic `await import()` during init either
    // rejected with one of the standard chunk-load shapes OR resolved to
    // `null`, which then made the destructure throw a TypeError. Both are
    // covered by `isChunkLoadError`. Route through `hardReload()` instead
    // of rendering the scary error overlay; the once-guard prevents an
    // infinite recovery loop when the new HTML is also still broken.
    //
    // Suppresses the "modal flashed several times during PWA update"
    // experience reported by greg on 2026-05-10 (iPhone, mid-update).
    if (isChunkLoadError(err)) {
      // Bounded retries via the throw-safe counter (hardReload.ts). It used to
      // read sessionStorage inline inside a try/catch whose empty `catch`
      // SWALLOWED a storage throw — silently skipping both `hardReload()` and
      // the Slack page (the iPhone onboarding blocker, 2026-06-20). The
      // accessors now fall back to an in-memory mirror, so a throwing
      // `sessionStorage` no longer abandons recovery, and the `critical` report
      // below is always reached when exhausted. Up to 3 silent hardReloads —
      // iOS Safari's SW lifecycle legitimately needs 2 sometimes — then we stop,
      // page Slack, and show the overlay. Counter cleared by a successful boot.
      const attempts = readChunkAttempts();
      const MAX_ATTEMPTS = 3;
      if (attempts < MAX_ATTEMPTS) {
        writeChunkAttempts(attempts + 1);
        console.warn(
          `[App] chunk-load symptom — hardReload attempt ${attempts + 1}/${MAX_ATTEMPTS}:`,
          err
        );
        chunkReloadInProgress = true;
        void hardReload();
        return;
      }
      console.error(
        `[App] chunk-load recovery exhausted after ${attempts} attempts — surfacing overlay:`,
        err
      );
      reportError({
        surface: 'app.chunkRecoveryFailed',
        message: `Chunk-load recovery exhausted after ${attempts} attempts: ${err instanceof Error ? err.message : String(err)}`,
        error: err,
        // Recovery exhausted (overlay shown, user stuck on a broken bundle) —
        // the comment above says to page; under the gate that means critical.
        severity: 'critical',
        context: {
          route_path: route.fullPath,
          breadcrumbs: breadcrumbsForReport(initBreadcrumbs),
        },
      });
    } else {
      // Non-chunk init failure — previously emitted NO telemetry, so onboarding
      // crashes for OTHER users were invisible server-side. Capture it in the
      // firehose (90-day retention, queryable) at `error` severity (no Slack
      // page — init failures vary; we want the record, not a pager storm). The
      // breadcrumb trail is email-redacted + tail-trimmed for the PII-free
      // firehose; the full trail still renders in the on-device overlay below.
      reportError({
        surface: 'app.initFailed',
        message: `App init failed: ${err instanceof Error ? err.message : String(err)}`,
        error: err,
        severity: 'error',
        context: {
          route_path: route.fullPath,
          breadcrumbs: breadcrumbsForReport(initBreadcrumbs),
        },
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    // A blocked registry upgrade has ONE user-fixable cause: an old beanies tab/window
    // still open. Render the actionable instruction, not the raw error (2026-08-28
    // 0.13-deploy incident: users saw a 35s stall + mystery fatal screen).
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    const breadcrumbLog = initBreadcrumbs.join('\n');
    setGenericInitError(
      err instanceof Error && err.name === 'RegistryBlockedError'
        ? t('app.initError.registryBlocked')
        : message,
      `${stack}\n\n--- Breadcrumbs ---\n${breadcrumbLog}`
    );
    console.error('[App] Initialization failed:', err, '\nBreadcrumbs:', breadcrumbLog);
  } finally {
    // Init resolved (success, early return, or error) — the watchdog is no
    // longer needed. (If the body instead WEDGED forever, this finally never
    // runs and the watchdog fires — exactly the freeze it exists to break.)
    clearTimeout(initWatchdog);
    // Always dismiss loading states, even on early return or error —
    // EXCEPT when a chunk-load `hardReload()` is in flight. Keep the
    // initial spinner visible until `location.replace()` swaps the page,
    // so the user sees a steady "counting beans..." instead of a brief
    // blank screen between init failure and the reload landing.
    if (!chunkReloadInProgress) {
      isInitializing.value = false;
      isLoadingData.value = false;
    }
  }
});

// Re-export for the template binding. Logic lives in `src/utils/diagnostics.ts`.
const getDeviceDiagnostics = formatDeviceInfo;

function handleReload() {
  // `hardReload()` evicts the SW precache + unregisters the SW before
  // navigating — without it, a soft `location.reload()` just hits the same
  // cached `index.html` that referenced the dead chunk in the first place,
  // putting the user right back on the error overlay.
  //
  // Also clear the retry counter: the auto-recovery increments it to prevent an
  // infinite reload loop, but a user-driven click is an explicit "try the
  // recovery path again" signal — it shouldn't fall through to the overlay
  // a second time because the gentle attempts were already counted.
  // `resetChunkAttempts()` clears both the persisted flag and the in-memory
  // mirror, and is itself throw-safe.
  resetChunkAttempts();
  void hardReload();
}

async function handleClearDataAndSignOut() {
  showClearConfirm.value = false;
  try {
    // Use the full sign-out flow: clears family DB, auth session, trust flag, cached keys
    await authStore.signOutAndClearData();
  } catch {
    // Best effort — continue with reload
  }
  void hardReload();
}

// Save data when going hidden; check for external file changes when becoming visible.
// visibilitychange → hidden is the primary save point (fires reliably on tab close,
// app switch, etc.). beforeunload is best-effort only — browsers may terminate
// the async save before it completes.
//
// The visibilitychange listener itself lives in `useToday` (single sink for the
// app's wake-detection events). Save-on-hide watches that composable's
// reactive `isVisible` ref. `useStaleTabRefresh` (wired below) handles the
// heavy refresh on wake / day-change.

/** Restore syncService key from store if out of sync, then save. */
function saveWithKeyRecovery() {
  if (!syncStore.hasSessionPassword) return;
  if (!hasFamilyKey()) {
    setFamilyKey(syncStore.familyKey!, syncStore.envelope!);
  }
  saveNow().catch(console.warn);
}

const { isVisible: isTabVisible } = useToday();
watch(isTabVisible, (visible) => {
  if (!visible) saveWithKeyRecovery();
});

useStaleTabRefresh();

// A DEFERRED config-heal (post-init retry / Settings reconnect) recovered the pod,
// but the family key was evicted too (needsPassword, no doc). The syncStore raised
// `needsResumeSetupNav` instead of navigating itself (MVO — the store never imports
// the router, which would create a build-breaking cycle with the router's lazy pages).
// Route to the resume-setup password recovery here, then clear the flag.
watch(
  () => syncStore.needsResumeSetupNav,
  (needs) => {
    if (!needs) return;
    syncStore.needsResumeSetupNav = false;
    void safeRouterReplace('/welcome?resume=setup', 'deferred-heal-needs-password');
  }
);

// Auto-apply PWA updates (no prompt) and, after the reload, show a one-time
// confirmation toast. usePwaUpdater drives the update on a quiet moment and
// sets PWA_POST_UPDATE_ROUTE_KEY; onMounted reads it into `pendingUpdateToast`.
usePwaUpdater();

// Native (Capacitor) OAuth deep-link completion. On native, Google sign-in
// returns via a verified App Link `appUrlOpen` event; the listener completes
// the exchange and asks us to navigate to the stored returnPath (the same
// resume-setup continuation the web full-page redirect produces). No-op on web.
// See ADR-029. Router navigation is injected here to keep googleAuth router-free.
installNativeAuthListener((returnPath) => {
  void router.replace(returnPath);
});

// On-device reminders for today's briefing (native only). Schedules a local
// notification for each timed pickup/dropoff/activity/due-to-do at its time —
// generated on-device from already-decrypted data (no server sees the schedule).
// No-op on web. See ADR-029.
useLocalNotifications();

// Helpful Hints (#40): auto-generate gentle prep to-dos before upcoming
// birthdays, parties, and trips (each carrying a #55 notification). Gated behind
// the `helpfulHints` dev flag; no-op when off. Runs on all platforms.
useHelpfulHints();

// In-app notifications: poll tick, app-badge sync, What's-New migration,
// auto-open on login. Owns no business state — see useNotifications.
useNotifications();

// Calendar redirect-auth resume (P2): completes a PWA/iOS/native calendar
// connect/reconnect after the redirect round-trip returns with a `calResume`
// intent. Reactive + SPA-safe; instantiates the calendar store only when a
// resume is actually pending (zero-cost when the feature is off). See ADR-032.
useCalendarRedirectResume();
useShareTargets();
useUnifiedRedirectResume();

// Reminder-notification tap → open the item. The tap listener (registered by
// useLocalNotifications above) only stashes the target; this resolves it to a
// router navigation once the pod + family doc are ready — which is what makes a
// COLD-START tap (app killed) land on the item instead of the last screen.
useReminderTapResume();

// Native shell: hide the splash, set the status-bar style, and wire the Android
// hardware back button (cooperates with the existing overlay-close mechanism).
// No-op on web. See ADR-029.
useNativeShell();

// Fire the post-update toast only once the init loader has cleared — info
// toasts auto-dismiss after 5s, so firing during a cold-load loader would
// vanish unseen.
watch(
  isInitializing,
  (initializing) => {
    if (initializing || !pendingUpdateToast) return;
    pendingUpdateToast = false;
    try {
      // Offer a "what changed?" link ONLY when this update shipped a new
      // non-trivial (spotlight) release note — not a minor "fixes" note, and
      // not a note-less deploy (version unchanged since the last toast). The
      // per-device marker is what makes "since this update" work.
      const latest = getLatestReleaseNote();
      const showWhatChanged = isWhatChangedRelease(latest, readLastToastedRelease());
      const options =
        showWhatChanged && latest
          ? {
              actionLabel: t('pwa.whatChanged'),
              actionFn: () => notificationsStore.openTo(whatsNewId(latest.version)),
              durationMs: 8000, // longer than the 5s default so the link can be tapped
            }
          : undefined;
      showToast('info', t('pwa.updated'), t('pwa.updatedMessage'), options);
      if (latest) writeLastToastedRelease(latest.version);
    } catch (e) {
      console.warn('[pwa] post-update toast failed', e);
    }
  },
  { flush: 'post' }
);

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  // Block the unload if a non-interruptible write is in flight (pod creation,
  // recovery load). The native browser confirm dialog gives the user one last
  // chance to stay; if they bail anyway the partial-write cleanup paths in
  // syncStore.createNewFile will already have run on the catch side.
  if (syncStore.criticalWriteState?.kind && syncStore.criticalWriteState.kind !== 'idle') {
    event.preventDefault();
    event.returnValue = ''; // legacy spec — required for Chrome/Edge
  }
  // Best-effort save regardless of write-in-flight; harmless if there's
  // nothing to save.
  saveWithKeyRecovery();
}

function handleOnline() {
  showToast('success', t('pwa.backOnline'));
  attemptSilentReconnect().catch((e) =>
    console.warn('[App] silent reconnect on online event failed', e)
  );
}

window.addEventListener('beforeunload', handleBeforeUnload);
window.addEventListener('online', handleOnline);

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload);
  window.removeEventListener('online', handleOnline);
});

// Show passkey or trust device prompt after fresh sign-in.
// Passkey prompt takes priority when platform authenticator is available.
// Not triggered on session restore (page refresh) since freshSignIn stays false.
// Watches freshSignIn, route.path, and isConfigured so the prompt
// re-evaluates when any of these reactive values change (avoids race conditions where
// config state settles after the route change).
watch(
  () =>
    [
      authStore.freshSignIn,
      route.path,
      syncStore.isConfigured,
      authStore.currentUser?.memberId,
    ] as const,
  async ([isFresh, path, , memberId], oldVal) => {
    if (
      !isFresh ||
      !familyStore.isSetupComplete ||
      sessionStorage.getItem('e2e_auto_auth') === 'true'
    ) {
      return;
    }

    // Don't show modal over the login/welcome UI
    if (path === '/welcome' || path === '/login' || path === '/join') {
      return;
    }

    // Reset the per-sign-in decline latch on a new sign-in — keyed on the MEMBER
    // changing, not a freshSignIn transition (review R2-F11: freshSignIn is only
    // ever set true, so a switch-person re-sign-in never transitions it and one
    // member's decline would suppress every sibling's per-member PIN nag for the
    // whole session).
    if (oldVal && oldVal[3] !== memberId) {
      authPromptDeclinedThisSignIn.value = false;
    }

    // Don't re-prompt if already showing, or if the user already declined one this
    // sign-in (one interruption per sign-in — the rest re-fire on the next one).
    if (activeAuthPrompt.value || authPromptDeclinedThisSignIn.value) {
      return;
    }
    if (!syncStore.isConfigured) return;

    const familyId = authStore.currentUser?.familyId;
    if (!familyId || !memberId) return;

    // Phase 4: the ordered prompt chain lives in `authPrompts.ts` (pin → kit →
    // native-biometric → trust) — data-driven and unit-tested there; this watcher
    // only assembles the context and claims the interruption slot at the true
    // show-site (#45: a no-show never wastes the slot).
    const winner = await resolveAuthPrompt({
      familyId,
      memberId,
      member: familyStore.members.find((m) => m.id === memberId),
      owner: familyStore.owner,
      envelope: syncStore.envelope,
      settings: settingsStore.settings,
      flags: {
        isPinPromptDismissed: settingsStore.isPinPromptDismissed,
        kitPromptDismissed: settingsStore.kitPromptDismissed,
        trustedDevicePromptShown: settingsStore.trustedDevicePromptShown,
      },
    });
    if (winner && claimInterruption('auth-prompt')) {
      activeAuthPrompt.value = winner;
    }
  }
);
</script>

<template>
  <!-- #53: this root background paints edge-to-edge behind the native Android
       status bar. Keep bg-gray-50 / dark:bg-surface-ground in sync with the native
       @color/windowBackground (android/app/src/main/res/values{,-night}/colors.xml)
       so the pre-paint strip and the WebView show one colour (no seam). -->
  <div class="dark:bg-surface-ground min-h-screen bg-gray-50">
    <!-- Loading overlay with pod spinner -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isInitializing"
        class="pointer-events-none fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[#FDFBF9] dark:bg-[#1a252f]"
      >
        <BeanieSpinner size="xl" label />
      </div>
    </Transition>

    <!-- Initialization error recovery screen -->
    <div
      v-if="initError"
      class="fixed inset-0 z-[300] flex items-center justify-center bg-[#2C3E50] p-4"
    >
      <div class="dark:bg-surface-raised w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div class="mb-4 text-center">
          <div
            class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30"
          >
            <svg
              class="h-6 w-6 text-[#F15D22]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5Z"
              />
            </svg>
          </div>
          <h2 class="font-outfit text-xl font-semibold text-[#2C3E50] dark:text-white">
            {{ t('app.initError.title') }}
          </h2>
          <p v-if="initErrorClearHelps" class="dark:text-ink-soft mt-2 text-sm text-gray-600">
            {{ t('app.initError.description') }}
          </p>
        </div>

        <!-- Error message -->
        <div class="mb-4 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
          <p class="dark:text-danger-lift text-sm font-medium text-red-800">{{ initError }}</p>
        </div>

        <!-- Action buttons -->
        <div class="mb-4 flex gap-3">
          <button
            class="flex-1 rounded-xl bg-[#F15D22] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#d9521e]"
            @click="handleReload"
          >
            {{ t('app.initError.reload') }}
          </button>
          <button
            v-if="initErrorClearHelps"
            class="dark:border-line-strong dark:text-ink dark:hover:bg-surface-hover flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-[#2C3E50] transition-colors hover:bg-gray-50"
            @click="showClearConfirm = true"
          >
            {{ t('app.initError.clearData') }}
          </button>
        </div>

        <!-- Clear data confirmation -->
        <div
          v-if="showClearConfirm && initErrorClearHelps"
          class="mb-4 rounded-lg border border-orange-300 bg-orange-50 p-3 dark:border-orange-700 dark:bg-orange-900/20"
        >
          <p class="dark:text-accent-lift mb-2 text-sm text-orange-800">
            {{ t('app.initError.clearConfirm') }}
          </p>
          <div class="flex gap-2">
            <button
              class="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              @click="handleClearDataAndSignOut"
            >
              {{ t('app.initError.clearData') }}
            </button>
            <button
              class="dark:border-line-strong dark:text-ink-soft dark:hover:bg-surface-hover rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
              @click="showClearConfirm = false"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>

        <!-- Expandable technical details -->
        <details class="group">
          <summary
            class="dark:text-ink-soft dark:hover:text-ink cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            {{ t('app.initError.details') }}
          </summary>
          <pre
            v-if="initErrorDetail"
            class="dark:bg-surface-ground dark:text-ink-soft mt-2 max-h-32 overflow-auto rounded-lg bg-gray-100 p-2 text-xs text-gray-700"
            >{{ initErrorDetail }}</pre>
          <div class="mt-2">
            <p class="dark:text-ink-soft mb-1 text-xs font-medium text-gray-500">
              {{ t('app.initError.diagnostics') }}
            </p>
            <pre
              class="dark:bg-surface-ground dark:text-ink-soft max-h-24 overflow-auto rounded-lg bg-gray-100 p-2 text-xs text-gray-700"
              >{{ getDeviceDiagnostics() }}</pre>
          </div>
        </details>
      </div>
    </div>

    <!-- PWA banners -->
    <OfflineBanner />

    <!-- Bottom-right toast stack -->
    <div
      class="fixed right-4 bottom-4 z-[200] flex flex-col items-end gap-3 md:right-6 md:bottom-6"
    >
      <!-- Unified reconnect toast (tracker #62, commit 5): ONE prompt for Drive
           and/or Calendar. Names what's down and reconnects both in one consent
           when they share an account. Self-gates on the coordinator's
           activeReconnectPrompt; the !needsAuth gate matches the old Drive toast. -->
      <UnifiedReconnectToast v-if="!authStore.needsAuth" />
      <InstallPrompt />
    </div>

    <!-- Background sync progress bar (cache-first loading) -->
    <BackgroundSyncBar />

    <!-- General toast notifications (errors, success, info) -->
    <ToastContainer />

    <!-- Celebration toasts and modals -->
    <CelebrationOverlay />
    <ConfirmModal />
    <ReauthGateModal />
    <DocumentExtractConsentModal />
    <AiProcessingOverlay :open="isReadingSharedDocument" />
    <DoseLogConfirmModal />
    <RecurringEditScopeModal />

    <!--
      Quick-add FAB — global floating button + bottom sheet.
      Visibility is driven by route.meta.hideQuickAdd; see
      docs/plans/2026-04-23-quick-add-fab-and-sheet.md.

      The inline <symbol> below is the single SVG source for every
      <use href="#beanie-plus-fab"> reference. Gradient IDs are
      prefixed with `bfab-` to avoid document-level collisions with
      other SVGs that might use short IDs like "bg". The background
      circle's fill pulls from --fab-bg (default: url(#bfab-bg)), so
      dark mode swaps only the gradient reference — the character
      colors stay warm across themes.
    -->
    <svg width="0" height="0" aria-hidden="true" focusable="false" style="position: absolute">
      <symbol id="beanie-plus-fab" viewBox="0 0 120 120">
        <defs>
          <radialGradient id="bfab-bg" cx="50%" cy="38%" r="68%">
            <stop offset="0%" stop-color="#FF824A" />
            <stop offset="100%" stop-color="#DD4D14" />
          </radialGradient>
          <radialGradient id="bfab-bg-dark" cx="50%" cy="38%" r="68%">
            <stop offset="0%" stop-color="#3B506A" />
            <stop offset="100%" stop-color="#1C2A3B" />
          </radialGradient>
          <linearGradient id="bfab-bean" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stop-color="#F57A3A" />
            <stop offset="100%" stop-color="#D44810" />
          </linearGradient>
          <linearGradient id="bfab-hat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#CDE5F5" />
            <stop offset="100%" stop-color="#8FBFDA" />
          </linearGradient>
          <linearGradient id="bfab-cuff" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#A4CCE1" />
            <stop offset="100%" stop-color="#7DAEC8" />
          </linearGradient>
          <linearGradient id="bfab-plus" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#FFFFFF" />
            <stop offset="100%" stop-color="#EEF2F5" />
          </linearGradient>
        </defs>

        <circle cx="60" cy="60" r="58" fill="var(--fab-bg, url(#bfab-bg))" />
        <circle
          cx="60"
          cy="60"
          r="56.5"
          fill="none"
          stroke="#FFFFFF"
          stroke-opacity="0.10"
          stroke-width="0.7"
        />
        <ellipse cx="42" cy="26" rx="30" ry="14" fill="#FFFFFF" opacity="0.14" />

        <!-- PLUS VERTICAL BAR — drawn first; upper portion hidden by character -->
        <g>
          <rect
            x="50"
            y="44"
            width="20"
            height="56"
            rx="6"
            fill="#1A252F"
            opacity="0.22"
            transform="translate(0 2)"
          />
          <rect x="50" y="44" width="20" height="56" rx="6" fill="url(#bfab-plus)" />
        </g>

        <!-- CHARACTER HEAD — upper half peeks above crossbar, lower half hidden -->
        <g>
          <path
            d="M60 32 C75 32, 84 42, 84 54 C84 65, 76 75, 65 77 C49 79, 37 70, 36 56 C35 43, 46 32, 60 32 Z"
            fill="url(#bfab-bean)"
          />
          <path
            d="M40 60 C38 54, 38 46, 42 40 C41 47, 42 56, 47 64 C44 64, 41 62, 40 60 Z"
            fill="#B8420F"
            opacity="0.22"
          />
          <ellipse
            cx="74"
            cy="44"
            rx="3.3"
            ry="5"
            fill="#FFFFFF"
            opacity="0.22"
            transform="rotate(-22 74 44)"
          />
        </g>

        <!-- BEANIE HAT — sits low on forehead; big pom-pom -->
        <g>
          <path
            d="M40 32 C40 24, 48 18, 60 18 C72 18, 80 24, 80 32 L80 34 C80 34.8, 79.2 35.2, 78.4 35.2 L41.6 35.2 C40.8 35.2, 40 34.8, 40 34 Z"
            fill="url(#bfab-hat)"
          />
          <path
            d="M38 34 C38 33.3, 38.8 32.8, 39.7 32.8 L80.3 32.8 C81.2 32.8, 82 33.3, 82 34 L82 42.8 C82 43.6, 81.2 44, 80.3 44 L39.7 44 C38.8 44, 38 43.6, 38 42.8 Z"
            fill="url(#bfab-cuff)"
          />
          <g stroke="#6895B0" stroke-width="1" stroke-linecap="round" opacity="0.75">
            <line x1="44" y1="34" x2="44" y2="41.5" />
            <line x1="49" y1="34" x2="49" y2="41.5" />
            <line x1="55" y1="34" x2="55" y2="41.5" />
            <line x1="60" y1="34" x2="60" y2="41.5" />
            <line x1="65" y1="34" x2="65" y2="41.5" />
            <line x1="71" y1="34" x2="71" y2="41.5" />
            <line x1="76" y1="34" x2="76" y2="41.5" />
          </g>
          <path
            d="M41 34 L79 34"
            stroke="#FFFFFF"
            stroke-width="0.8"
            stroke-linecap="round"
            opacity="0.4"
          />
          <circle cx="60" cy="13" r="6.5" fill="#C96519" />
          <circle cx="60" cy="13" r="6" fill="#E67E22" />
          <circle cx="57.6" cy="10.6" r="2.2" fill="#FFFFFF" opacity="0.6" />
          <circle cx="59.5" cy="12.2" r="1" fill="#FFFFFF" opacity="0.4" />
        </g>

        <!-- FACE — wide-open eyes; lower face hidden -->
        <g>
          <ellipse cx="51" cy="50" rx="3.8" ry="4.9" fill="#1F2E3D" />
          <ellipse cx="69" cy="50" rx="3.8" ry="4.9" fill="#1F2E3D" />
          <circle cx="52.5" cy="48.2" r="1.7" fill="#FFFFFF" />
          <circle cx="70.5" cy="48.2" r="1.7" fill="#FFFFFF" />
          <circle cx="50" cy="51.7" r="0.9" fill="#FFFFFF" />
          <circle cx="68" cy="51.7" r="0.9" fill="#FFFFFF" />
          <ellipse cx="42" cy="58.5" rx="3" ry="1.8" fill="#EC9AAB" opacity="0.55" />
          <ellipse cx="78" cy="58.5" rx="3" ry="1.8" fill="#EC9AAB" opacity="0.55" />
        </g>

        <!-- PLUS CROSSBAR — covers lower half of character -->
        <g>
          <rect
            x="32"
            y="62"
            width="56"
            height="20"
            rx="6"
            fill="#1A252F"
            opacity="0.22"
            transform="translate(0 2)"
          />
          <rect x="32" y="62" width="56" height="20" rx="6" fill="url(#bfab-plus)" />
          <rect x="34" y="63.4" width="52" height="1.6" rx="0.8" fill="#FFFFFF" opacity="0.65" />
        </g>

        <!-- HANDS gripping the crossbar -->
        <g>
          <g transform="rotate(-8 44 63)">
            <ellipse
              cx="44"
              cy="63"
              rx="7.5"
              ry="4.8"
              fill="#C94510"
              stroke="#5A1D04"
              stroke-width="1.1"
              stroke-opacity="0.55"
            />
            <ellipse cx="42" cy="59.8" rx="3.6" ry="1.5" fill="#FF9B5F" opacity="0.55" />
            <path
              d="M39 64 Q44 62, 49 64"
              stroke="#5A1D04"
              stroke-width="0.9"
              fill="none"
              stroke-linecap="round"
              opacity="0.6"
            />
            <circle
              cx="49.5"
              cy="62.4"
              r="1.5"
              fill="#C94510"
              stroke="#5A1D04"
              stroke-width="0.9"
              stroke-opacity="0.55"
            />
          </g>
          <g transform="rotate(8 76 63)">
            <ellipse
              cx="76"
              cy="63"
              rx="7.5"
              ry="4.8"
              fill="#C94510"
              stroke="#5A1D04"
              stroke-width="1.1"
              stroke-opacity="0.55"
            />
            <ellipse cx="78" cy="59.8" rx="3.6" ry="1.5" fill="#FF9B5F" opacity="0.55" />
            <path
              d="M71 64 Q76 62, 81 64"
              stroke="#5A1D04"
              stroke-width="0.9"
              fill="none"
              stroke-linecap="round"
              opacity="0.6"
            />
            <circle
              cx="70.5"
              cy="62.4"
              r="1.5"
              fill="#C94510"
              stroke="#5A1D04"
              stroke-width="0.9"
              stroke-opacity="0.55"
            />
          </g>
        </g>
      </symbol>
    </svg>

    <QuickAddFab />
    <QuickAddSheet />
    <TrustDeviceModal
      :open="activeAuthPrompt === 'trust'"
      @trust="handleTrustDevice"
      @decline="handleDeclineTrust"
    />
    <PasskeyPromptModal
      :open="activeAuthPrompt === 'native-biometric'"
      @enable="handleEnablePasskey"
      @decline="handleDeclinePasskey"
    />
    <PinPromptModal
      v-if="authStore.currentUser?.memberId"
      :open="activeAuthPrompt === 'pin'"
      :member-id="authStore.currentUser.memberId"
      @done="handlePinPromptDone"
      @decline="handlePinPromptDecline"
    />
    <RecoveryKitPromptModal
      :open="activeAuthPrompt === 'kit'"
      @done="handleKitPromptDone"
      @decline="handleKitPromptDecline"
    />
    <NotificationsDrawer />
    <PwaReinstallModal />
    <FeedbackModal />

    <div v-if="showLayout" class="flex h-screen overflow-hidden">
      <!-- Desktop sidebar -->
      <AppSidebar v-if="isDesktop" />

      <!-- padding-top clears the status bar in the native edge-to-edge layout.
           env() is non-zero because viewport-fit=cover is set STATICALLY in
           index.html (iOS WKWebView only computes safe-area insets at load — a
           runtime injection left them 0; see index.html + useNativeShell.ts). 0 on
           web/non-notched — no effect. The root bg paints behind the transparent
           bar and blends. -->
      <div class="flex min-w-0 flex-1 flex-col" style="padding-top: env(safe-area-inset-top)">
        <!--
          Inline-flow banner at the top of the column. Renders above
          AppHeader so it pushes the header down rather than overlapping
          it (matters for standalone PWAs where there's no browser
          chrome refresh button to fall back on). Suppressed when the
          GoogleReconnectToast is up — the toast is the canonical
          surface for permanent expiry; rolled up via
          `shouldShowSaveFailureBanner` in syncStore.
        -->
        <!-- Pod access — "we can't reach your family's data file", incl. the
             "you're working on a copy" case. Outranks SaveFailureBanner (it is
             the root cause of any save failure it coexists with); precedence is
             declared once in syncStore's `shouldShowPodAccessBanner`. -->
        <PodAccessBanner v-if="!authStore.needsAuth" />

        <SaveFailureBanner
          :show="syncStore.shouldShowSaveFailureBanner && !authStore.needsAuth"
          :file-not-found="syncStore.driveFileNotFound"
          @reconnected="handleGoogleReconnected"
        />

        <!-- Local-durability-cache failure — inline (pushes the header down), bound to
             syncStore.cachePersistFailed. See #50. -->
        <DurabilityBanner />
        <!-- REVIEW-DEMO: marks a seeded demo session. Both banners are in-flow, so
             they stack predictably rather than overlapping. -->
        <ReviewDemoBanner />

        <AppHeader v-if="!headerReclaimed" />

        <main
          class="flex-1 overflow-auto overscroll-y-contain"
          :class="[
            isPlannerRoute ? 'px-4 pb-4 md:px-6 md:pb-6' : 'p-4 md:p-6',
            { 'pb-24': isMobile },
          ]"
        >
          <ContentSkeleton v-if="isLoadingData" />
          <router-view v-show="!isLoadingData" data-testid="app-content" />
        </main>
      </div>

      <!-- Mobile bottom nav -->
      <MobileBottomNav v-if="isMobile" />

      <!-- Mobile hamburger menu -->
      <MobileHamburgerMenu :open="isMenuOpen" @close="closeMenu" />
    </div>

    <div v-else>
      <router-view />
    </div>
  </div>
</template>
