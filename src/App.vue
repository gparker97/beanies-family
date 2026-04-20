<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/common/AppHeader.vue';
import AppSidebar from '@/components/common/AppSidebar.vue';
import MobileBottomNav from '@/components/common/MobileBottomNav.vue';
import MobileHamburgerMenu from '@/components/common/MobileHamburgerMenu.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import InstallPrompt from '@/components/common/InstallPrompt.vue';
import UpdatePrompt from '@/components/common/UpdatePrompt.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CelebrationOverlay from '@/components/ui/CelebrationOverlay.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import RecurringEditScopeModal from '@/components/ui/RecurringEditScopeModal.vue';
import TrustDeviceModal from '@/components/common/TrustDeviceModal.vue';
import PasskeyPromptModal from '@/components/common/PasskeyPromptModal.vue';
import WhatsNewModal from '@/components/common/WhatsNewModal.vue';
import PwaReinstallModal from '@/components/common/PwaReinstallModal.vue';
import GoogleReconnectToast from '@/components/google/GoogleReconnectToast.vue';
import SaveFailureBanner from '@/components/google/SaveFailureBanner.vue';
import PhotoAccessRecoveryBanner from '@/components/common/PhotoAccessRecoveryBanner.vue';
import ToastContainer from '@/components/ui/ToastContainer.vue';
import ContentSkeleton from '@/components/ui/ContentSkeleton.vue';
import BackgroundSyncBar from '@/components/common/BackgroundSyncBar.vue';
import { isPlatformAuthenticatorAvailable } from '@/services/auth/passkeyService';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { updateRatesIfStale, forceUpdateRates } from '@/services/exchangeRate';
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
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useAuthStore } from '@/stores/authStore';
import { setSoundEnabled } from '@/composables/useSounds';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { saveNow, hasFamilyKey, setFamilyKey } from '@/services/sync/syncService';
import { __internals as photoStoreInternals } from '@/stores/photoStore';

/**
 * Register every collection that owns photo references so the photoStore
 * GC sweep finds orphans across all of them. Lives at the app-init
 * boundary (rather than inside each store) to avoid the top-level import
 * cycle family/medications → photoStore → syncStore → family/medications
 * that broke test loading in P3 dev. Safe to call multiple times —
 * registerPhotoCollection is idempotent (backed by a Set).
 */
photoStoreInternals.registerPhotoCollection('familyMembers');
photoStoreInternals.registerPhotoCollection('medications');
photoStoreInternals.registerPhotoCollection('recipes');
photoStoreInternals.registerPhotoCollection('cookLogs');

const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const assetsStore = useAssetsStore();
const goalsStore = useGoalsStore();
const todoStore = useTodoStore();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const budgetStore = useBudgetStore();
const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const memberNotesStore = useMemberNotesStore();
const allergiesStore = useAllergiesStore();
const medicationsStore = useMedicationsStore();
const recipesStore = useRecipesStore();
const emergencyContactsStore = useEmergencyContactsStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const recurringStore = useRecurringStore();
const translationStore = useTranslationStore();
const memberFilterStore = useMemberFilterStore();
const authStore = useAuthStore();
const { t } = useTranslation();
const { isMobile, isDesktop } = useBreakpoint();

const isInitializing = ref(true);
const isLoadingData = ref(true);
const initError = ref<string | null>(null);
const initErrorDetail = ref<string | null>(null);
const showClearConfirm = ref(false);
const initBreadcrumbs: string[] = [];
const isMenuOpen = ref(false);
const showTrustPrompt = ref(false);
const showPasskeyPrompt = ref(false);
const passkeyPromptDismissed = ref(false);

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
  showTrustPrompt.value = false;
}

function handleDeclineTrust() {
  settingsStore.setTrustedDevicePromptShown();
  showTrustPrompt.value = false;
}

async function handleEnablePasskey() {
  showPasskeyPrompt.value = false;
  passkeyPromptDismissed.value = true;

  try {
    const result = await authStore.registerPasskeyForCurrentUser();
    if (result.success) {
      if (result.passkeySecret) {
        // Store PRF-wrapped family key in the .beanpod envelope for cross-device access
        syncStore.addPasskeySecret(result.passkeySecret);
        await syncStore.syncNow(true);
      }
      showToast('success', t('passkey.registerSuccess'));
    } else {
      showToast('error', result.error ?? t('passkey.registerError'));
    }
  } catch (e) {
    console.warn('[passkey] Unexpected error during passkey registration:', e);
    showToast('error', t('passkey.registerError'));
  }
}

function handleDeclinePasskey() {
  passkeyPromptDismissed.value = true;
  showPasskeyPrompt.value = false;
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
const showLayout = computed(() => {
  // Don't show sidebar/header unless signed in and on an app page
  if (!authStore.isAuthenticated) return false;
  const noLayoutPages = [
    'NotFound',
    'Welcome',
    'Login',
    'JoinFamily',
    'BeanstalkBlog',
    'BeanstalkPost',
  ];
  return !noLayoutPages.includes(route.name as string);
});

/**
 * Load all family data. The data file (.beanpod V4) is the source of truth.
 *
 * Priority:
 * 1. File handle exists + permission → load from file (V4 envelope + family key decrypt)
 * 2. File handle exists + needs permission → try Automerge persistence cache
 * 3. No file handle → initialize empty Automerge doc
 */

/* eslint-disable no-console -- debug logging for sync diagnostics */
async function loadFamilyData() {
  const { getActiveFamilyId: getActiveIdInner } = await import('@/services/indexeddb/database');
  const activeFamilyIdStr = getActiveIdInner();
  initBreadcrumbs.push(`loadFamilyData: activeFamily=${activeFamilyIdStr ?? 'null'}`);
  console.log('[loadFamilyData] activeFamily:', activeFamilyIdStr);

  // Initialize sync service (restores file handle if configured)
  await syncStore.initialize();
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
    const cachedKeyB64 = activeFamilyId ? settingsStore.getCachedFamilyKey(activeFamilyId) : null;

    if (activeFamilyId && cachedKeyB64) {
      initBreadcrumbs.push('path1a: trying persistence cache for fast start');
      console.log('[loadFamilyData] path1a: trying cache-first load...');
      try {
        const cacheResult = await syncStore.loadFromPersistenceCache(cachedKeyB64, activeFamilyId, {
          preservePermissionState: true,
        });
        if (cacheResult.success) {
          initBreadcrumbs.push('path1a: cache loaded — showing data, background sync starting');
          console.log('[loadFamilyData] path1a: cache hit — instant data');
          memberFilterStore.initialize();
          isLoadingData.value = false; // Show real data immediately
          const result = await processRecurringItems();
          if (result.processed > 0) {
            await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
          }
          // Fire-and-forget: fetch fresh data from Drive in background
          syncStore.backgroundSyncFromFile();
          return;
        }
        initBreadcrumbs.push('path1a: cache miss or failed — falling through to Drive fetch');
        console.log('[loadFamilyData] path1a: cache miss — falling back to Drive');
      } catch {
        initBreadcrumbs.push('path1a: cache error — falling through to Drive fetch');
      }
    }

    // Step 1b: No cache available — fall back to blocking Drive fetch (skeleton shows in UI)
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
        if (success) {
          memberFilterStore.initialize();
          const result = await processRecurringItems();
          if (result.processed > 0) {
            await Promise.all([transactionsStore.loadTransactions(), goalsStore.loadGoals()]);
          }
          return;
        }

        // Can't auto-decrypt — redirect to login page for password/biometric entry
        initBreadcrumbs.push('path1b: needsPassword but no cached key — redirecting to login');
        console.warn('[loadFamilyData] Cannot auto-decrypt — redirecting to login');
        router.replace('/welcome');
        return;
      }

      // File load failed for non-password reasons (network error, 404, etc.)
      initBreadcrumbs.push('path1b: loadFromFile failed — redirecting to login');
      console.warn('[loadFamilyData] File load failed — redirecting to login');
      router.replace('/welcome');
      return;
    } catch (err) {
      throw new Error(
        `Failed to load data from sync file: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Path 2: File configured but needs permission → try Automerge persistence cache
  if (syncStore.isConfigured && syncStore.needsPermission) {
    initBreadcrumbs.push('path2: file needs permission, trying cache');
    console.log('[loadFamilyData] File needs permission — trying persistence cache');
    const activeFamilyId = familyContextStore.activeFamilyId;
    const cachedKeyB64 = activeFamilyId ? settingsStore.getCachedFamilyKey(activeFamilyId) : null;
    initBreadcrumbs.push(
      `path2: familyId=${activeFamilyId ?? 'null'}, hasCachedKey=${!!cachedKeyB64}`
    );
    if (activeFamilyId && cachedKeyB64) {
      try {
        const cacheResult = await syncStore.loadFromPersistenceCache(cachedKeyB64, activeFamilyId);
        initBreadcrumbs.push(`path2: cacheResult=${cacheResult.success}`);
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
  initBreadcrumbs.push('path3: no file configured, initializing empty doc');
  try {
    // Check if a doc is already loaded (e.g. from signup flow that just completed)
    const { getDoc, initDoc } = await import('@/services/automerge/docService');
    let hasExistingDoc = false;
    try {
      getDoc();
      hasExistingDoc = true;
    } catch {
      // No doc loaded — need to initialize one
    }

    if (!hasExistingDoc) {
      // E2E seed: if the data bridge saved a binary to sessionStorage, load it
      if (import.meta.env.DEV && sessionStorage.getItem('__e2eSeedDoc')) {
        const { loadDoc } = await import('@/services/automerge/docService');
        const { base64ToBuffer } = await import('@/utils/encoding');
        const b64 = sessionStorage.getItem('__e2eSeedDoc')!;
        sessionStorage.removeItem('__e2eSeedDoc');
        loadDoc(new Uint8Array(base64ToBuffer(b64)));
      } else {
        initDoc();
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
        activityStore.loadActivities(),
        vacationStore.loadVacations(),
        budgetStore.loadBudgets(),
        favoritesStore.loadFavorites(),
        sayingsStore.loadSayings(),
        memberNotesStore.loadMemberNotes(),
        allergiesStore.loadAllergies(),
        medicationsStore.loadMedications(),
        recipesStore.loadRecipes(),
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

onMounted(async () => {
  try {
    // Ensure initial route is resolved before checking route names
    await router.isReady();

    // Resume navigation after a PWA hard-reload. UpdatePrompt's route guard
    // saves the user's intended destination before triggering the reload —
    // restore it now so the click that triggered the update isn't lost.
    // Done before auth checks so existing redirects (e.g. unauth → /welcome)
    // still apply naturally to the resumed route.
    const postUpdatePath = sessionStorage.getItem('pwa-post-update-route');
    if (postUpdatePath) {
      sessionStorage.removeItem('pwa-post-update-route');
      if (postUpdatePath !== route.fullPath) {
        initBreadcrumbs.push(`pwa-resume: navigating to ${postUpdatePath}`);
        await router.replace(postUpdatePath);
      }
    }

    initBreadcrumbs.push(`route: ${String(route.name ?? route.path)}`);

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
    // (tokens, file handles). Installed PWAs are almost always granted.
    if (navigator.storage?.persist) {
      navigator.storage.persist().then((granted) => {
        if (granted) console.warn('[storage] Persistent storage granted');
      });
    }

    // Step 2: Initialize auth (checks registry for existing families)
    initBreadcrumbs.push('auth: initializing');
    await authStore.initializeAuth();
    initBreadcrumbs.push(
      `auth: needsAuth=${authStore.needsAuth}, user=${authStore.currentUser?.email ?? 'none'}`
    );

    // If not authenticated, redirect to the welcome/login gate (unless already on an auth page).
    // The marketing homepage lives at beanies.family; app.beanies.family is always the app surface,
    // so unauthenticated users land on /welcome and can sign in or create a pod from there.
    if (authStore.needsAuth) {
      // E2E auto-auth: restore from sessionStorage (dev mode only)
      if (!authStore.restoreE2EAuth()) {
        const authPages: Array<string | undefined> = ['Welcome', 'Login', 'JoinFamily'];
        if (!authPages.includes(route.name as string)) {
          initBreadcrumbs.push('auth: redirecting to /welcome (not authenticated)');
          router.replace('/welcome');
        }
        return;
      }
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
    const INIT_TIMEOUT_MS = 30_000;
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
    try {
      const { getDoc } = await import('@/services/automerge/docService');
      getDoc(); // throws if currentDoc is null
      initBreadcrumbs.push('health: automerge doc OK');
    } catch {
      // Doc not loaded — initialization completed but data is missing
      initBreadcrumbs.push('health: NO automerge doc loaded');
      const breadcrumbLog = initBreadcrumbs.join('\n');
      initError.value = 'Initialization completed but no data was loaded';
      initErrorDetail.value = breadcrumbLog;
      console.error('[App] Post-init health check failed — no Automerge doc\n' + breadcrumbLog);
    }

    // Always fetch exchange rates on init when none are loaded (first-time users,
    // join flow, cross-browser). If rates exist, only refresh if auto-update is
    // enabled and rates are stale (>24h).
    // After updating, reload the store so Vue reactive state reflects the new rates.
    const hasNoRates = !settingsStore.exchangeRates || settingsStore.exchangeRates.length === 0;
    if (hasNoRates) {
      forceUpdateRates()
        .then((r) => {
          if (r.ratesUpdated > 0) {
            settingsStore.loadSettings();
            settingsStore.loadGlobalSettings();
          }
        })
        .catch(console.error);
    } else if (settingsStore.exchangeRateAutoUpdate) {
      updateRatesIfStale()
        .then((r) => {
          if (r.ratesUpdated > 0) {
            settingsStore.loadSettings();
            settingsStore.loadGlobalSettings();
          }
        })
        .catch(console.error);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    initError.value = message;
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    const breadcrumbLog = initBreadcrumbs.join('\n');
    initErrorDetail.value = `${stack}\n\n--- Breadcrumbs ---\n${breadcrumbLog}`;
    console.error('[App] Initialization failed:', err, '\nBreadcrumbs:', breadcrumbLog);
  } finally {
    // Always dismiss loading states, even on early return or error
    isInitializing.value = false;
    isLoadingData.value = false;
  }
});

function getDeviceDiagnostics(): string {
  return [
    `UA: ${navigator.userAgent}`,
    `WASM: ${typeof WebAssembly !== 'undefined'}`,
    `Crypto: ${typeof crypto?.subtle !== 'undefined'}`,
    `IDB: ${typeof indexedDB !== 'undefined'}`,
    `SW: ${'serviceWorker' in navigator}`,
  ].join('\n');
}

function handleReload() {
  window.location.reload();
}

async function handleClearDataAndSignOut() {
  showClearConfirm.value = false;
  try {
    // Use the full sign-out flow: clears family DB, auth session, trust flag, cached keys
    await authStore.signOutAndClearData();
  } catch {
    // Best effort — continue with reload
  }
  window.location.reload();
}

// Attempt silent reconnect to Google Drive when tab becomes visible or network comes back.
// Uses a guard to prevent concurrent reconnect attempts.
let isReconnecting = false;
async function attemptSilentReconnect() {
  if (isReconnecting || !syncStore.isGoogleDriveConnected) return;
  isReconnecting = true;
  try {
    const { attemptSilentRefresh } = await import('@/services/google/googleAuth');
    const refreshed = await attemptSilentRefresh();
    if (refreshed) {
      const hadVisibleError =
        syncStore.showGoogleReconnect || syncStore.saveFailureLevel !== 'none';
      if (hadVisibleError) {
        await syncStore.handleGoogleReconnected();
        showToast('success', t('googleDrive.reconnected'));
      }
    }
  } catch {
    /* Silent — non-critical */
  } finally {
    isReconnecting = false;
  }
}

// Save data when going hidden; check for external file changes when becoming visible.
// visibilitychange → hidden is the primary save point (fires reliably on tab close,
// app switch, etc.). beforeunload is best-effort only — browsers may terminate
// the async save before it completes.

/** Restore syncService key from store if out of sync, then save. */
function saveWithKeyRecovery() {
  if (!syncStore.hasSessionPassword) return;
  if (!hasFamilyKey()) {
    setFamilyKey(syncStore.familyKey!, syncStore.envelope!);
  }
  saveNow().catch(console.warn);
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    syncStore.pauseFilePolling();
    saveWithKeyRecovery();
  } else if (document.visibilityState === 'visible') {
    syncStore.resumeFilePolling();
    attemptSilentReconnect().catch(console.warn);
    syncStore.reloadIfFileChanged().catch(console.warn);
  }
}

function handleBeforeUnload() {
  saveWithKeyRecovery();
}

function handleOnline() {
  showToast('success', t('pwa.backOnline'));
  attemptSilentReconnect().catch(console.warn);
}

document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('beforeunload', handleBeforeUnload);
window.addEventListener('online', handleOnline);

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
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
  () => [authStore.freshSignIn, route.path, syncStore.isConfigured] as const,
  async ([isFresh, path], oldVal) => {
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

    // Reset dismiss flag on new sign-in (freshSignIn transitioned from false to true)
    if (oldVal && !oldVal[0] && isFresh) {
      passkeyPromptDismissed.value = false;
    }

    // Don't re-prompt if already showing or dismissed
    if (showPasskeyPrompt.value || showTrustPrompt.value) {
      return;
    }

    // Try passkey prompt first (per-family check)
    if (!passkeyPromptDismissed.value && syncStore.isConfigured) {
      const familyId = authStore.currentUser?.familyId;
      if (familyId) {
        const hasPasskeys = await authStore.checkHasRegisteredPasskeys(familyId);
        if (!hasPasskeys) {
          const hasPlatform = await isPlatformAuthenticatorAvailable();
          if (hasPlatform) {
            showPasskeyPrompt.value = true;
            return;
          }
        }
      }
    }

    // Fall back to trust device prompt
    if (!settingsStore.trustedDevicePromptShown) {
      showTrustPrompt.value = true;
    }
  }
);
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-slate-900">
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
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800">
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
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {{ t('app.initError.description') }}
          </p>
        </div>

        <!-- Error message -->
        <div class="mb-4 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
          <p class="text-sm font-medium text-red-800 dark:text-red-300">{{ initError }}</p>
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
            class="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-[#2C3E50] transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-slate-700"
            @click="showClearConfirm = true"
          >
            {{ t('app.initError.clearData') }}
          </button>
        </div>

        <!-- Clear data confirmation -->
        <div
          v-if="showClearConfirm"
          class="mb-4 rounded-lg border border-orange-300 bg-orange-50 p-3 dark:border-orange-700 dark:bg-orange-900/20"
        >
          <p class="mb-2 text-sm text-orange-800 dark:text-orange-200">
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
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-slate-700"
              @click="showClearConfirm = false"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>

        <!-- Expandable technical details -->
        <details class="group">
          <summary
            class="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {{ t('app.initError.details') }}
          </summary>
          <pre
            v-if="initErrorDetail"
            class="mt-2 max-h-32 overflow-auto rounded-lg bg-gray-100 p-2 text-xs text-gray-700 dark:bg-slate-900 dark:text-gray-300"
            >{{ initErrorDetail }}</pre
          >
          <div class="mt-2">
            <p class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              {{ t('app.initError.diagnostics') }}
            </p>
            <pre
              class="max-h-24 overflow-auto rounded-lg bg-gray-100 p-2 text-xs text-gray-700 dark:bg-slate-900 dark:text-gray-300"
              >{{ getDeviceDiagnostics() }}</pre
            >
          </div>
        </details>
      </div>
    </div>

    <!-- PWA banners -->
    <OfflineBanner />

    <!-- Save failure banner (non-dismissable, shows when 3+ saves fail) -->
    <SaveFailureBanner
      :show="syncStore.showSaveFailureBanner && !authStore.needsAuth"
      :file-not-found="syncStore.driveFileNotFound"
      @reconnected="handleGoogleReconnected"
    />

    <!-- Photo-access recovery banner — fires when photoStore has any unresolved
         photos (typically the drive.file scope-mismatch case from ADR-021). -->
    <PhotoAccessRecoveryBanner />

    <!-- Bottom-right toast stack -->
    <div
      class="fixed right-4 bottom-4 z-[200] flex flex-col items-end gap-3 md:right-6 md:bottom-6"
    >
      <GoogleReconnectToast
        v-if="syncStore.showGoogleReconnect && !authStore.needsAuth"
        @reconnected="handleGoogleReconnected"
      />
      <UpdatePrompt />
      <InstallPrompt />
    </div>

    <!-- Background sync progress bar (cache-first loading) -->
    <BackgroundSyncBar />

    <!-- General toast notifications (errors, success, info) -->
    <ToastContainer />

    <!-- Celebration toasts and modals -->
    <CelebrationOverlay />
    <ConfirmModal />
    <RecurringEditScopeModal />
    <TrustDeviceModal
      :open="showTrustPrompt"
      @trust="handleTrustDevice"
      @decline="handleDeclineTrust"
    />
    <PasskeyPromptModal
      :open="showPasskeyPrompt"
      @enable="handleEnablePasskey"
      @decline="handleDeclinePasskey"
    />
    <WhatsNewModal />
    <PwaReinstallModal />

    <div v-if="showLayout" class="flex h-screen overflow-hidden">
      <!-- Desktop sidebar -->
      <AppSidebar v-if="isDesktop" />

      <div class="flex min-w-0 flex-1 flex-col">
        <AppHeader @toggle-menu="isMenuOpen = !isMenuOpen" />

        <main
          class="flex-1 overflow-auto overscroll-y-contain p-4 md:p-6"
          :class="{ 'pb-24': isMobile }"
        >
          <ContentSkeleton v-if="isLoadingData" />
          <router-view v-show="!isLoadingData" data-testid="app-content" />
        </main>
      </div>

      <!-- Mobile bottom nav -->
      <MobileBottomNav v-if="isMobile" />

      <!-- Mobile hamburger menu -->
      <MobileHamburgerMenu :open="isMenuOpen" @close="isMenuOpen = false" />
    </div>

    <div v-else>
      <router-view />
    </div>
  </div>
</template>
