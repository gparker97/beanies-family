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
import TrustDeviceModal from '@/components/common/TrustDeviceModal.vue';
import PasskeyPromptModal from '@/components/common/PasskeyPromptModal.vue';
import { isPlatformAuthenticatorAvailable } from '@/services/auth/passkeyService';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { updateRatesIfStale } from '@/services/exchangeRate';
import { processRecurringItems } from '@/services/recurring/recurringProcessor';
import { needsLegacyMigration, runLegacyMigration } from '@/services/migration/legacyMigration';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useAuthStore } from '@/stores/authStore';
import { setSoundEnabled } from '@/composables/useSounds';
import { flushPendingSave } from '@/services/sync/syncService';

const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const assetsStore = useAssetsStore();
const goalsStore = useGoalsStore();
const todoStore = useTodoStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const recurringStore = useRecurringStore();
const translationStore = useTranslationStore();
const memberFilterStore = useMemberFilterStore();
const authStore = useAuthStore();
const { isMobile, isDesktop } = useBreakpoint();

const isInitializing = ref(true);
const isMenuOpen = ref(false);
const showTrustPrompt = ref(false);
const showPasskeyPrompt = ref(false);
const passkeyPromptDismissed = ref(false);

async function handleTrustDevice() {
  await settingsStore.setTrustedDevice(true);
  // If there's already a session password, cache it for the newly trusted device
  if (syncStore.currentSessionPassword) {
    await settingsStore.cacheEncryptionPassword(syncStore.currentSessionPassword);
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

  const password = syncStore.currentSessionPassword;
  if (!password) return;

  // Get the encrypted file blob for the registration
  // We need the raw encrypted data to extract the PBKDF2 salt
  const encryptedBlob = await getEncryptedFileBlob();
  if (!encryptedBlob) return;

  await authStore.registerPasskeyForCurrentUser(password, encryptedBlob);
}

function handleDeclinePasskey() {
  passkeyPromptDismissed.value = true;
  showPasskeyPrompt.value = false;
}

/**
 * Read the current encrypted file to get the raw blob for passkey registration.
 */
async function getEncryptedFileBlob(): Promise<string | null> {
  try {
    const { getSessionFileHandle } = await import('@/services/sync/syncService');
    const handle = getSessionFileHandle();
    if (!handle) return null;
    const file = await handle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.encrypted && typeof parsed.data === 'string') {
      return parsed.data;
    }
    return null;
  } catch {
    return null;
  }
}

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
 * Load all family data. The data file is the source of truth.
 *
 * Priority:
 * 1. File handle exists + permission → load from file
 * 2. File handle exists + needs permission → fallback to IndexedDB cache with warning
 * 3. No file handle → load from IndexedDB if available
 */

async function loadFamilyData() {
  const { getActiveFamilyId: getActiveIdInner } = await import('@/services/indexeddb/database');
  console.log('[loadFamilyData] activeFamily:', getActiveIdInner());

  // Load per-family settings (needed for encryption state, etc.)
  await settingsStore.loadSettings();

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
    const loadResult = await syncStore.loadFromFile();
    if (loadResult.success) {
      memberFilterStore.initialize();
      const result = await processRecurringItems();
      if (result.processed > 0) {
        await transactionsStore.loadTransactions();
      }
      // Auto-sync is always on when file is configured + has permission
      syncStore.setupAutoSync();
      return;
    }

    // File needs password — try cached password from trusted device
    if (loadResult.needsPassword) {
      const cachedPw = settingsStore.getCachedEncryptionPassword();
      if (cachedPw) {
        const decryptResult = await syncStore.decryptPendingFile(cachedPw);
        if (decryptResult.success) {
          memberFilterStore.initialize();
          const result = await processRecurringItems();
          if (result.processed > 0) {
            await transactionsStore.loadTransactions();
          }
          return;
        }
        // Cached password was wrong — clear it
        await settingsStore.clearCachedEncryptionPassword();
      }
    }
  }

  // Path 2: File configured but needs permission → IndexedDB cache as read-only fallback
  if (syncStore.isConfigured && syncStore.needsPermission) {
    console.log('[loadFamilyData] File needs permission — using IndexedDB cache as fallback');
    await loadFromIndexedDBCache();
    return;
  }

  // Path 3: No file configured → check if data exists in IndexedDB (existing/migrated user)
  await familyStore.loadMembers();

  // Existing user with IndexedDB data but no file configured — load normally
  if (familyStore.isSetupComplete) {
    memberFilterStore.initialize();

    await Promise.all([
      accountsStore.loadAccounts(),
      transactionsStore.loadTransactions(),
      assetsStore.loadAssets(),
      goalsStore.loadGoals(),
      recurringStore.loadRecurringItems(),
      todoStore.loadTodos(),
    ]);

    const result = await processRecurringItems();
    if (result.processed > 0) {
      await transactionsStore.loadTransactions();
    }
  }
}

/**
 * Fallback: load from IndexedDB cache when file permission is not yet granted.
 */
async function loadFromIndexedDBCache() {
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
    ]);

    const result = await processRecurringItems();
    if (result.processed > 0) {
      await transactionsStore.loadTransactions();
    }
  }
}

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

    // Step 3: Run legacy migration if needed (old single-DB → per-family DB)
    if (await needsLegacyMigration()) {
      await runLegacyMigration();
    }

    // Step 4: Resolve active family
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
  } finally {
    // Always dismiss the loading overlay, even on early return or error
    isInitializing.value = false;
  }
});

// Flush pending debounced saves before the page unloads (prevents data loss on refresh)
function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    flushPendingSave();
  }
}

function handleBeforeUnload() {
  flushPendingSave();
}

document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('beforeunload', handleBeforeUnload);

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('beforeunload', handleBeforeUnload);
});

// Show passkey or trust device prompt after fresh sign-in.
// Passkey prompt takes priority when platform authenticator is available and encryption is enabled.
// Not triggered on session restore (page refresh) since freshSignIn stays false.
// Watches both freshSignIn and route.path so it re-fires after Create/Join navigates to /nook.
watch(
  () => [authStore.freshSignIn, route.path] as const,
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

    // Try passkey prompt first (per-family check, encryption must be enabled)
    if (!passkeyPromptDismissed.value && syncStore.isEncryptionEnabled && syncStore.isConfigured) {
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

    <!-- PWA banners -->
    <OfflineBanner />
    <UpdatePrompt />
    <InstallPrompt />

    <!-- Celebration toasts and modals -->
    <CelebrationOverlay />
    <ConfirmModal />
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
