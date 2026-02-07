<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTranslationStore } from '@/stores/translationStore';
import { processRecurringItems } from '@/services/recurring/recurringProcessor';
import { updateRatesIfStale } from '@/services/exchangeRate';
import AppSidebar from '@/components/common/AppSidebar.vue';
import AppHeader from '@/components/common/AppHeader.vue';

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

      <div class="flex-1 flex flex-col">
        <AppHeader>
          <template #title>
            {{ route.meta.title }}
          </template>
        </AppHeader>

        <main class="flex-1 p-6 overflow-auto">
          <router-view />
        </main>
      </div>
    </div>

    <div v-else>
      <router-view />
    </div>
  </div>
</template>
