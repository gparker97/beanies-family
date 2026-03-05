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
import GoogleReconnectToast from '@/components/google/GoogleReconnectToast.vue';
import SaveFailureBanner from '@/components/google/SaveFailureBanner.vue';
import ToastContainer from '@/components/ui/ToastContainer.vue';
import { isPlatformAuthenticatorAvailable } from '@/services/auth/passkeyService';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { updateRatesIfStale } from '@/services/exchangeRate';
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
import { useBudgetStore } from '@/stores/budgetStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useAuthStore } from '@/stores/authStore';
import { setSoundEnabled } from '@/composables/useSounds';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { saveNow } from '@/services/sync/syncService';

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
const budgetStore = useBudgetStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const recurringStore = useRecurringStore();
const translationStore = useTranslationStore();
const memberFilterStore = useMemberFilterStore();
const authStore = useAuthStore();
const { t } = useTranslation();
const { isMobile, isDesktop } = useBreakpoint();

const isInitializing = ref(true);
const initError = ref<string | null>(null);
const initErrorDetail = ref<string | null>(null);
const showClearConfirm = ref(false);
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
  await syncStore.handleGoogleReconnected();
}

/**
 * Read the current encrypted file to get the raw blob for passkey registration.
 * Works with any storage provider (local file or Google Drive).
 */
const showLayout = computed(() => {
  // Don't show sidebar/header on login, welcome, or 404 pages
  return (
    route.name !== 'NotFound' &&
    route.name !== 'Welcome' &&
    route.name !== 'Login' &&
    route.name !== 'JoinFamily'
  );
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
  console.log('[loadFamilyData] activeFamily:', getActiveIdInner());

  // Initialize sync service (restores file handle if configured)
  await syncStore.initialize();
  console.log(
    '[loadFamilyData] sync configured:',
    syncStore.isConfigured,
    'needsPermission:',
    syncStore.needsPermission
  );

  // Path 1: File configured + we have permission → load from file (source of truth)
  if (syncStore.isConfigured && !syncStore.needsPermission) {
    try {
      const loadResult = await syncStore.loadFromFile();
      if (loadResult.success) {
        memberFilterStore.initialize();
        const result = await processRecurringItems();
        if (result.processed > 0) {
          await transactionsStore.loadTransactions();
        }
        syncStore.setupAutoSync();
        return;
      }

      // File needs password — try cached family key from trusted device
      if (loadResult.needsPassword) {
        const activeFamilyId = familyContextStore.activeFamilyId;
        const cachedKeyB64 = activeFamilyId
          ? settingsStore.getCachedFamilyKey(activeFamilyId)
          : null;
        if (cachedKeyB64) {
          try {
            const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
            const { base64ToBuffer } = await import('@/utils/encoding');
            const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(cachedKeyB64)));
            const decryptResult = await syncStore.decryptPendingFileWithKey(fk);
            if (decryptResult.success) {
              memberFilterStore.initialize();
              const result = await processRecurringItems();
              if (result.processed > 0) {
                await transactionsStore.loadTransactions();
              }
              return;
            }
          } catch {
            // Cached key was invalid — clear it
          }
          if (activeFamilyId) {
            await settingsStore.clearCachedFamilyKey(activeFamilyId);
          }
        }
      }
    } catch (err) {
      throw new Error(
        `Failed to load data from sync file: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Path 2: File configured but needs permission → try Automerge persistence cache
  if (syncStore.isConfigured && syncStore.needsPermission) {
    console.log('[loadFamilyData] File needs permission — trying persistence cache');
    const activeFamilyId = familyContextStore.activeFamilyId;
    const cachedKeyB64 = activeFamilyId ? settingsStore.getCachedFamilyKey(activeFamilyId) : null;
    if (activeFamilyId && cachedKeyB64) {
      try {
        const cacheResult = await syncStore.loadFromPersistenceCache(cachedKeyB64, activeFamilyId);
        if (cacheResult.success) {
          console.log('[loadFamilyData] Loaded from persistence cache');
          memberFilterStore.initialize();
          const result = await processRecurringItems();
          if (result.processed > 0) {
            await transactionsStore.loadTransactions();
          }
          return;
        }
      } catch (err) {
        console.warn('[loadFamilyData] Failed to load from persistence cache:', err);
      }
    }
    // Fall through — user needs to grant permission
    console.log('[loadFamilyData] User needs to grant file permission — returning early');
    return;
  }

  // Path 3: No file configured → initialize Automerge doc
  // This path is for first-time users or users without a sync file
  try {
    // E2E seed: if the data bridge saved a binary to sessionStorage, load it
    if (import.meta.env.DEV && sessionStorage.getItem('__e2eSeedDoc')) {
      const { loadDoc } = await import('@/services/automerge/docService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const b64 = sessionStorage.getItem('__e2eSeedDoc')!;
      sessionStorage.removeItem('__e2eSeedDoc');
      loadDoc(new Uint8Array(base64ToBuffer(b64)));
    } else {
      const { initDoc } = await import('@/services/automerge/docService');
      initDoc();
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
        budgetStore.loadBudgets(),
      ]);

      const result = await processRecurringItems();
      if (result.processed > 0) {
        await transactionsStore.loadTransactions();
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

    // Step 1: Load global settings (theme, language) — works before any family is active
    await settingsStore.loadGlobalSettings();

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

    // Request persistent storage so the browser won't evict IndexedDB
    // (tokens, file handles). Installed PWAs are almost always granted.
    if (navigator.storage?.persist) {
      navigator.storage.persist().then((granted) => {
        if (granted) console.warn('[storage] Persistent storage granted');
      });
    }

    // Step 2: Initialize auth (checks registry for existing families)
    await authStore.initializeAuth();

    // If not authenticated, redirect to login (unless already on login page)
    if (authStore.needsAuth) {
      // E2E auto-auth: restore from sessionStorage (dev mode only)
      if (!authStore.restoreE2EAuth()) {
        if (route.name !== 'Welcome' && route.name !== 'Login' && route.name !== 'JoinFamily') {
          router.replace('/welcome');
        }
        return;
      }
    }

    // Step 3: Resolve active family
    const authFamilyId = authStore.currentUser?.familyId;

    if (authFamilyId) {
      // Auth resolved a family — switch to it
      const { closeDatabase } = await import('@/services/indexeddb/database');
      await closeDatabase();
      const switched = await familyContextStore.switchFamily(authFamilyId);
      await familyContextStore.reload();

      if (!switched) {
        const family = await familyContextStore.createFamilyWithId(authFamilyId, 'My Family');
        if (!family) {
          console.error('Failed to create family');
          return;
        }
      }
    } else {
      // No auth family — use lastActiveFamilyId or create new
      const activeFamily = await familyContextStore.initialize();

      if (!activeFamily) {
        const family = await familyContextStore.createFamily('My Family');
        if (!family) {
          console.error('Failed to create default family');
          return;
        }
      }
    }

    // Step 5: Load family data from the active per-family DB
    const { closeDatabase: closeDb } = await import('@/services/indexeddb/database');
    await closeDb();
    await loadFamilyData();

    // Auto-update exchange rates if enabled (non-blocking)
    if (settingsStore.exchangeRateAutoUpdate) {
      updateRatesIfStale().catch(console.error);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    initError.value = message;
    initErrorDetail.value = err instanceof Error ? (err.stack ?? null) : null;
    console.error('[App] Initialization failed:', err);
  } finally {
    // Always dismiss the loading overlay, even on early return or error
    isInitializing.value = false;
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
    // Clear all IndexedDB databases for the active family
    const { closeDatabase, deleteFamilyDatabase, getActiveFamilyId } =
      await import('@/services/indexeddb/database');
    await closeDatabase();
    const familyId = getActiveFamilyId();
    if (familyId) {
      await deleteFamilyDatabase(familyId);
    }
  } catch {
    // Best effort — continue with reload
  }
  window.location.reload();
}

// Save data when going hidden; check for external file changes when becoming visible.
// visibilitychange → hidden is the primary save point (fires reliably on tab close,
// app switch, etc.). beforeunload is best-effort only — browsers may terminate
// the async save before it completes.
function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    syncStore.pauseFilePolling();
    // Single immediate save — replaces the old flush + syncNow double-save
    saveNow().catch(console.warn);
  } else if (document.visibilityState === 'visible') {
    syncStore.resumeFilePolling();
    // Check for external file changes (cross-device sync)
    syncStore.reloadIfFileChanged().catch(console.warn);
  }
}

function handleBeforeUnload() {
  // Best-effort save — browser may terminate the async save
  saveNow().catch(console.warn);
}

document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('beforeunload', handleBeforeUnload);

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('beforeunload', handleBeforeUnload);
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
        class="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[#FDFBF9] dark:bg-[#1a252f]"
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

    <div v-if="showLayout" class="flex h-screen overflow-hidden">
      <!-- Desktop sidebar -->
      <AppSidebar v-if="isDesktop" />

      <div class="flex min-w-0 flex-1 flex-col">
        <AppHeader @toggle-menu="isMenuOpen = !isMenuOpen" />

        <main class="flex-1 overflow-auto p-4 md:p-6" :class="{ 'pb-24': isMobile }">
          <router-view />
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
