<script setup lang="ts">
import { onMounted, computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/common/AppHeader.vue';
import AppSidebar from '@/components/common/AppSidebar.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CelebrationOverlay from '@/components/ui/CelebrationOverlay.vue';
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
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useAuthStore } from '@/stores/authStore';
import { setSoundEnabled } from '@/composables/useSounds';

const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const assetsStore = useAssetsStore();
const goalsStore = useGoalsStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const recurringStore = useRecurringStore();
const translationStore = useTranslationStore();
const memberFilterStore = useMemberFilterStore();
const authStore = useAuthStore();

const isInitializing = ref(true);

const showLayout = computed(() => {
  // Don't show sidebar/header on setup, login, magic link callback, or 404 pages
  return (
    route.name !== 'Setup' &&
    route.name !== 'NotFound' &&
    route.name !== 'Login' &&
    route.name !== 'MagicLinkCallback'
  );
});

/**
 * Load all family data. The data file is the source of truth.
 *
 * Priority:
 * 1. File handle exists + permission → load from file
 * 2. File handle exists + needs permission → fallback to IndexedDB cache with warning
 * 3. No file handle → redirect to setup (which now requires file creation)
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
    const hasData = await syncStore.loadFromFile();
    if (hasData) {
      if (!familyStore.isSetupComplete && route.name !== 'Setup') {
        router.replace('/setup');
        return;
      }
      memberFilterStore.initialize();
      const result = await processRecurringItems();
      if (result.processed > 0) {
        await transactionsStore.loadTransactions();
      }
      // Auto-sync is always on when file is configured + has permission
      syncStore.setupAutoSync();
      return;
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

  if (!familyStore.isSetupComplete && route.name !== 'Setup') {
    // No data and no file — redirect to setup (which now requires file creation)
    router.replace('/setup');
    return;
  }

  // Existing user with IndexedDB data but no file configured — load normally
  // They'll be prompted to configure a file in setup step 3 or settings
  if (familyStore.isSetupComplete) {
    memberFilterStore.initialize();

    await Promise.all([
      accountsStore.loadAccounts(),
      transactionsStore.loadTransactions(),
      assetsStore.loadAssets(),
      goalsStore.loadGoals(),
      recurringStore.loadRecurringItems(),
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

  if (!familyStore.isSetupComplete && route.name !== 'Setup') {
    router.replace('/setup');
    return;
  }

  if (familyStore.isSetupComplete) {
    memberFilterStore.initialize();

    await Promise.all([
      accountsStore.loadAccounts(),
      transactionsStore.loadTransactions(),
      assetsStore.loadAssets(),
      goalsStore.loadGoals(),
      recurringStore.loadRecurringItems(),
    ]);

    const result = await processRecurringItems();
    if (result.processed > 0) {
      await transactionsStore.loadTransactions();
    }
  }
}

onMounted(async () => {
  try {
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

    // Step 2: Initialize auth
    await authStore.initializeAuth();

    // If auth is required and user is not authenticated, redirect to login
    if (authStore.needsAuth) {
      if (route.name !== 'Login' && route.name !== 'MagicLinkCallback') {
        router.replace('/login');
      }
      return;
    }

    // Step 3: Run legacy migration if needed (old single-DB → per-family DB)
    if (await needsLegacyMigration()) {
      await runLegacyMigration();
    }

    // Step 4: Resolve active family
    // If auth resolved a specific family, use it authoritatively (don't let
    // familyContextStore.initialize() override it with lastActiveFamilyId)
    const authFamilyId = authStore.currentUser?.familyId;

    // DEBUG: trace family resolution
    console.log('[App] Auth user:', JSON.stringify(authStore.currentUser));
    console.log('[App] Auth familyId:', authFamilyId, 'type:', typeof authFamilyId);

    if (authFamilyId) {
      // Auth resolved a family — switch to it and load families list
      const { closeDatabase } = await import('@/services/indexeddb/database');
      await closeDatabase();
      const switched = await familyContextStore.switchFamily(authFamilyId);
      await familyContextStore.reload();
      console.log(
        '[App] switchFamily result:',
        switched,
        'active:',
        familyContextStore.activeFamilyId
      );

      if (!switched) {
        // Family not in registry on this device — create with the auth-resolved ID
        // (NOT a random new ID, which would lose the association with the Cognito user)
        console.warn(`Auth family ${authFamilyId} not found in registry, creating with auth ID`);
        const family = await familyContextStore.createFamilyWithId(authFamilyId, 'My Family');
        if (!family) {
          console.error('Failed to create family');
          return;
        }
      }
    } else if (!authStore.isLocalOnlyMode && authStore.isAuthenticated) {
      // Authenticated but familyId could not be resolved from any source.
      // DO NOT fall back to initialize() — that loads lastActiveFamilyId which
      // could belong to a DIFFERENT user, causing cross-family data leakage.
      console.warn('[App] Authenticated user but no familyId resolved — creating new family');
      const family = await familyContextStore.createFamily('My Family');
      if (!family) {
        console.error('Failed to create family for authenticated user');
        return;
      }
    } else {
      // Local-only mode (no auth configured) — safe to use lastActiveFamilyId
      console.log('[App] Local-only mode, using initialize() fallback');
      const activeFamily = await familyContextStore.initialize();
      console.log('[App] initialize() returned:', activeFamily?.id, activeFamily?.name);

      if (!activeFamily) {
        // No family exists yet — first-time user or fresh device
        const family = await familyContextStore.createFamily('My Family');
        if (!family) {
          console.error('Failed to create default family');
          return;
        }
      }
    }

    // Step 5: Load family data from the active per-family DB
    // Close any previously opened DB to ensure we open the correct family's DB
    const { closeDatabase: closeDb, getActiveFamilyId: getActiveId } =
      await import('@/services/indexeddb/database');
    await closeDb();
    console.log('[App] Before loadFamilyData, activeFamily:', getActiveId());
    await loadFamilyData();
    console.log(
      '[App] After loadFamilyData, members:',
      familyStore.members.map((m) => m.name)
    );

    // Auto-update exchange rates if enabled (non-blocking, requires active family)
    if (settingsStore.exchangeRateAutoUpdate) {
      updateRatesIfStale().catch(console.error);
    }
  } finally {
    // Always dismiss the loading overlay, even on early return or error
    isInitializing.value = false;
  }
});
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

    <!-- Celebration toasts and modals -->
    <CelebrationOverlay />

    <div v-if="showLayout" class="flex h-screen overflow-hidden">
      <AppSidebar />

      <div class="flex min-w-0 flex-1 flex-col">
        <AppHeader />

        <main class="flex-1 overflow-auto p-6">
          <router-view />
        </main>
      </div>
    </div>

    <div v-else>
      <router-view />
    </div>
  </div>
</template>
