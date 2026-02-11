<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/common/AppHeader.vue';
import AppSidebar from '@/components/common/AppSidebar.vue';
import { updateRatesIfStale } from '@/services/exchangeRate';
import { processRecurringItems } from '@/services/recurring/recurringProcessor';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';

const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const assetsStore = useAssetsStore();
const goalsStore = useGoalsStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const recurringStore = useRecurringStore();
const translationStore = useTranslationStore();
const memberFilterStore = useMemberFilterStore();

const showLayout = computed(() => {
  // Don't show sidebar/header on setup page
  return route.name !== 'Setup' && route.name !== 'NotFound';
});

onMounted(async () => {
  // Load settings first
  await settingsStore.loadSettings();

  // Auto-update exchange rates if enabled (non-blocking)
  if (settingsStore.settings.exchangeRateAutoUpdate) {
    updateRatesIfStale().catch(console.error);
  }

  // Load translations if language is not English (non-blocking)
  if (settingsStore.language !== 'en') {
    translationStore.loadTranslations(settingsStore.language).catch(console.error);
  }

  // Initialize sync service (restores file handle if configured)
  await syncStore.initialize();

  // If sync is configured and we have permission, load from file (file always wins)
  if (syncStore.isConfigured && !syncStore.needsPermission) {
    const hasData = await syncStore.loadFromFile();
    if (hasData) {
      // Data was loaded from file, stores are already refreshed
      // Check if setup is needed
      if (!familyStore.isSetupComplete && route.name !== 'Setup') {
        router.replace('/setup');
        return;
      }
      // Initialize member filter with all members selected
      memberFilterStore.initialize();
      // Process recurring items to generate due transactions
      const result = await processRecurringItems();
      if (result.processed > 0) {
        // Reload transactions to include newly generated ones
        await transactionsStore.loadTransactions();
      }
      // Setup auto-sync for future changes
      syncStore.setupAutoSync();
      return;
    }
  }

  // No sync data or sync not configured - load from local IndexedDB
  await familyStore.loadMembers();

  // Check if setup is needed
  if (!familyStore.isSetupComplete && route.name !== 'Setup') {
    router.replace('/setup');
    return;
  }

  // Load remaining data if setup is complete
  if (familyStore.isSetupComplete) {
    // Initialize member filter with all members selected
    memberFilterStore.initialize();

    await Promise.all([
      accountsStore.loadAccounts(),
      transactionsStore.loadTransactions(),
      assetsStore.loadAssets(),
      goalsStore.loadGoals(),
      recurringStore.loadRecurringItems(),
    ]);

    // Process recurring items to generate due transactions
    const result = await processRecurringItems();
    if (result.processed > 0) {
      // Reload transactions to include newly generated ones
      await transactionsStore.loadTransactions();
    }

    // Setup auto-sync for future changes
    if (syncStore.isConfigured) {
      syncStore.setupAutoSync();
    }
  }
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-slate-900">
    <div v-if="showLayout" class="flex">
      <AppSidebar />

      <div class="flex flex-1 flex-col">
        <AppHeader>
          <template #title>
            {{ route.meta.title }}
          </template>
        </AppHeader>

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
