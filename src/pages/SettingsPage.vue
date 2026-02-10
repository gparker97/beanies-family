<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { BaseCard, BaseSelect, BaseButton } from '@/components/ui';
import PasswordModal from '@/components/common/PasswordModal.vue';
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings.vue';
import { CURRENCIES } from '@/constants/currencies';
import { clearAllData } from '@/services/indexeddb/database';
import { useTranslation } from '@/composables/useTranslation';

const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const translationStore = useTranslationStore();
const { t } = useTranslation();

const showClearConfirm = ref(false);
const showLoadFileConfirm = ref(false);
const showSyncConflict = ref(false);
const conflictInfo = ref<{ fileTimestamp: string | null; localTimestamp: string | null } | null>(null);
const importError = ref<string | null>(null);
const importSuccess = ref(false);

// Encryption modal state
const showEnableEncryptionModal = ref(false);
const showDecryptFileModal = ref(false);
const encryptionError = ref<string | null>(null);
const isProcessingEncryption = ref(false);

const currencyOptions = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} - ${c.name}`,
}));

const themeOptions = computed(() => [
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
  { value: 'system', label: t('settings.theme.system') },
]);

onMounted(async () => {
  await syncStore.initialize();
});

async function updateCurrency(value: string | number) {
  await settingsStore.setBaseCurrency(value as string);
}

async function updateTheme(value: string | number) {
  await settingsStore.setTheme(value as 'light' | 'dark' | 'system');
}

async function handleConfigureSync() {
  await syncStore.configureSyncFile();
}

async function handleRequestPermission() {
  await syncStore.requestPermission();
}

async function handleSyncNow() {
  // Check for conflicts first
  const conflict = await syncStore.checkForConflicts();
  if (conflict.hasConflict) {
    conflictInfo.value = {
      fileTimestamp: conflict.fileTimestamp,
      localTimestamp: conflict.localTimestamp,
    };
    showSyncConflict.value = true;
    return;
  }
  await syncStore.syncNow();
}

async function handleForceSyncNow() {
  showSyncConflict.value = false;
  conflictInfo.value = null;
  await syncStore.forceSyncNow();
}

async function handleLoadFromFileInstead() {
  showSyncConflict.value = false;
  conflictInfo.value = null;
  const success = await syncStore.loadFromFile();
  if (success) {
    importSuccess.value = true;
    setTimeout(() => {
      importSuccess.value = false;
    }, 3000);
  }
}

function formatConflictTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function handleLoadFromFileClick() {
  showLoadFileConfirm.value = true;
}

async function handleLoadFromFileConfirmed() {
  showLoadFileConfirm.value = false;
  const result = await syncStore.loadFromNewFile();

  if (result.needsPassword) {
    // File is encrypted, show password modal
    showDecryptFileModal.value = true;
    return;
  }

  if (result.success) {
    importSuccess.value = true;
    setTimeout(() => {
      importSuccess.value = false;
    }, 3000);
  }
}

async function handleDecryptFile(password: string) {
  isProcessingEncryption.value = true;
  encryptionError.value = null;

  const result = await syncStore.decryptPendingFile(password);

  isProcessingEncryption.value = false;

  if (result.success) {
    showDecryptFileModal.value = false;
    importSuccess.value = true;
    setTimeout(() => {
      importSuccess.value = false;
    }, 3000);
  } else {
    encryptionError.value = result.error ?? 'Failed to decrypt file';
  }
}

function handleDecryptModalClose() {
  showDecryptFileModal.value = false;
  syncStore.clearPendingEncryptedFile();
  encryptionError.value = null;
}

function handleEncryptionToggle() {
  if (syncStore.isEncryptionEnabled) {
    // Disable encryption
    handleDisableEncryption();
  } else {
    // Enable encryption - show password modal
    showEnableEncryptionModal.value = true;
  }
}

async function handleEnableEncryption(password: string) {
  isProcessingEncryption.value = true;
  encryptionError.value = null;

  const success = await syncStore.enableEncryption(password);

  isProcessingEncryption.value = false;

  if (success) {
    showEnableEncryptionModal.value = false;
  } else {
    encryptionError.value = syncStore.error ?? 'Failed to enable encryption';
  }
}

async function handleDisableEncryption() {
  isProcessingEncryption.value = true;
  await syncStore.disableEncryption();
  isProcessingEncryption.value = false;
}

function handleEnableEncryptionModalClose() {
  showEnableEncryptionModal.value = false;
  encryptionError.value = null;
}

async function handleDisconnect() {
  await syncStore.disconnect();
}

async function handleManualExport() {
  await syncStore.manualExport();
}

async function handleManualImport() {
  importError.value = null;
  importSuccess.value = false;
  const result = await syncStore.manualImport();
  if (result.success) {
    importSuccess.value = true;
    setTimeout(() => {
      importSuccess.value = false;
    }, 3000);
  } else {
    importError.value = result.error ?? 'Import failed';
  }
}

async function handleExportTranslations() {
  await translationStore.exportCacheToFile();
}

async function handleClearData() {
  await clearAllData();
  showClearConfirm.value = false;
  window.location.reload();
}

function formatLastSync(timestamp: string | null): string {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  return date.toLocaleString();
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ t('settings.title') }}</h1>
      <p class="text-gray-500 dark:text-gray-400">{{ t('settings.subtitle') }}</p>
    </div>

    <!-- First Row: General Settings and File Sync side by side on wide screens -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <!-- General Settings -->
      <BaseCard :title="t('settings.general')">
        <div class="space-y-6">
          <BaseSelect
            :model-value="settingsStore.baseCurrency"
            :options="currencyOptions"
            :label="t('settings.baseCurrency')"
            :hint="t('settings.baseCurrencyHint')"
            @update:model-value="updateCurrency"
          />

          <BaseSelect
            :model-value="settingsStore.theme"
            :options="themeOptions"
            :label="t('settings.theme')"
            :hint="t('settings.themeHint')"
            @update:model-value="updateTheme"
          />
        </div>
      </BaseCard>

      <!-- File Sync Settings -->
      <BaseCard :title="t('settings.fileSync')">
        <!-- Modern browsers with File System Access API -->
      <div v-if="syncStore.supportsAutoSync">
        <!-- Not configured state -->
        <div v-if="!syncStore.isConfigured" class="text-center py-6">
          <svg class="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p class="font-medium text-gray-900 dark:text-gray-100 mb-2">{{ t('settings.syncToFile') }}</p>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {{ t('settings.syncToFileDescription') }}
          </p>
          <div class="flex flex-col gap-3">
            <BaseButton @click="handleConfigureSync">
              {{ t('settings.createNewSyncFile') }}
            </BaseButton>
            <BaseButton variant="secondary" @click="handleLoadFromFileClick">
              {{ t('settings.loadFromExistingFile') }}
            </BaseButton>
          </div>

          <!-- Load file confirmation dialog (when not configured) -->
          <div v-if="showLoadFileConfirm" class="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-left">
            <p class="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
              This will replace all local data with the contents of the selected file and set it as your sync file. Continue?
            </p>
            <div class="flex gap-2">
              <BaseButton variant="primary" size="sm" @click="handleLoadFromFileConfirmed">
                Yes, Load File
              </BaseButton>
              <BaseButton variant="ghost" size="sm" @click="showLoadFileConfirm = false">
                Cancel
              </BaseButton>
            </div>
          </div>
        </div>

        <!-- Configured state -->
        <div v-else class="space-y-4">
          <!-- Needs permission state -->
          <div v-if="syncStore.needsPermission" class="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <p class="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
              Click to grant permission to access your sync file.
            </p>
            <BaseButton variant="primary" @click="handleRequestPermission">
              Grant Permission
            </BaseButton>
          </div>

          <!-- Ready state -->
          <div v-else>
            <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-slate-700">
              <div>
                <p class="font-medium text-gray-900 dark:text-gray-100">Sync File</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">{{ syncStore.fileName }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  :class="{
                    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400': syncStore.syncStatus === 'ready',
                    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400': syncStore.syncStatus === 'syncing',
                    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400': syncStore.syncStatus === 'error',
                  }"
                >
                  {{ syncStore.syncStatus === 'syncing' ? 'Syncing...' : syncStore.syncStatus === 'error' ? 'Error' : 'Connected' }}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-slate-700">
              <div>
                <p class="font-medium text-gray-900 dark:text-gray-100">Last Sync</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">{{ formatLastSync(syncStore.lastSync) }}</p>
              </div>
              <BaseButton
                variant="secondary"
                size="sm"
                :loading="syncStore.isSyncing"
                @click="handleSyncNow"
              >
                Sync Now
              </BaseButton>
            </div>

            <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-slate-700">
              <div>
                <p class="font-medium text-gray-900 dark:text-gray-100">Load from File</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">Load data from a different file</p>
              </div>
              <BaseButton
                variant="secondary"
                size="sm"
                :loading="syncStore.isSyncing"
                @click="handleLoadFromFileClick"
              >
                Browse...
              </BaseButton>
            </div>

            <!-- Load file confirmation dialog -->
            <div v-if="showLoadFileConfirm" class="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <p class="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
                This will replace all local data with the contents of the selected file and switch your sync connection to that file. Continue?
              </p>
              <div class="flex gap-2">
                <BaseButton variant="primary" size="sm" @click="handleLoadFromFileConfirmed">
                  Yes, Load File
                </BaseButton>
                <BaseButton variant="ghost" size="sm" @click="showLoadFileConfirm = false">
                  Cancel
                </BaseButton>
              </div>
            </div>

            <div class="flex items-center justify-between py-3">
              <div>
                <p class="font-medium text-gray-900 dark:text-gray-100">Disconnect</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">Stop syncing to this file</p>
              </div>
              <BaseButton variant="ghost" size="sm" @click="handleDisconnect">
                Disconnect
              </BaseButton>
            </div>

            <!-- Sync conflict dialog -->
            <div v-if="showSyncConflict" class="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div class="flex-1">
                  <p class="font-medium text-yellow-800 dark:text-yellow-200">Sync Conflict Detected</p>
                  <p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    The sync file has newer data than your local data. This can happen if changes were made on another device.
                  </p>
                  <div class="text-xs text-yellow-600 dark:text-yellow-400 mt-2 space-y-1">
                    <p><strong>File last updated:</strong> {{ formatConflictTimestamp(conflictInfo?.fileTimestamp ?? null) }}</p>
                    <p><strong>Local last sync:</strong> {{ formatConflictTimestamp(conflictInfo?.localTimestamp ?? null) }}</p>
                  </div>
                  <div class="flex gap-2 mt-3">
                    <BaseButton variant="primary" size="sm" @click="handleLoadFromFileInstead">
                      Load from File
                    </BaseButton>
                    <BaseButton variant="ghost" size="sm" @click="handleForceSyncNow">
                      Overwrite File
                    </BaseButton>
                    <BaseButton variant="ghost" size="sm" @click="showSyncConflict = false">
                      Cancel
                    </BaseButton>
                  </div>
                </div>
              </div>
            </div>

            <!-- Error display -->
            <div v-if="syncStore.error && !showSyncConflict" class="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p class="text-sm text-red-600 dark:text-red-400">{{ syncStore.error }}</p>
            </div>

            <!-- Success message -->
            <div v-if="importSuccess" class="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <p class="text-sm text-green-600 dark:text-green-400">Data loaded successfully!</p>
            </div>

            <!-- Auto-sync toggle -->
            <div class="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="settingsStore.settings.autoSyncEnabled"
                  class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  @change="settingsStore.setAutoSyncEnabled(!settingsStore.settings.autoSyncEnabled)"
                />
                <div>
                  <p class="font-medium text-gray-900 dark:text-gray-100">Auto-sync</p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">Automatically save changes to the sync file</p>
                </div>
              </label>
            </div>

            <!-- Encryption toggle -->
            <div class="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="syncStore.isEncryptionEnabled"
                  :disabled="isProcessingEncryption"
                  class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  @change="handleEncryptionToggle"
                />
                <div>
                  <p class="font-medium text-gray-900 dark:text-gray-100">
                    Encrypt sync file
                    <span v-if="syncStore.isEncryptionEnabled" class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Encrypted
                    </span>
                  </p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">Protect your data with password encryption</p>
                </div>
              </label>
              <p v-if="!syncStore.hasSessionPassword && syncStore.isEncryptionEnabled" class="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                Note: You'll need to enter your password when you return to sync changes.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Fallback for older browsers -->
      <div v-else class="space-y-4">
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Your browser doesn't support automatic file sync. Use manual export/import instead.
        </p>
        <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-slate-700">
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">Export Data</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">Download your data as a JSON file</p>
          </div>
          <BaseButton variant="secondary" size="sm" @click="handleManualExport">
            Export
          </BaseButton>
        </div>
        <div class="flex items-center justify-between py-3">
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">Import Data</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">Load data from a JSON file</p>
          </div>
          <BaseButton variant="secondary" size="sm" @click="handleManualImport">
            Import
          </BaseButton>
        </div>

        <!-- Import error -->
        <div v-if="importError" class="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p class="text-sm text-red-600 dark:text-red-400">{{ importError }}</p>
        </div>

        <!-- Import success -->
        <div v-if="importSuccess" class="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p class="text-sm text-green-600 dark:text-green-400">Data imported successfully!</p>
        </div>
      </div>
    </BaseCard>
    </div>

    <!-- Second Row: AI Settings and About side by side on wide screens -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <!-- AI Settings -->
      <BaseCard :title="t('settings.aiInsights')">
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg class="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p class="font-medium">{{ t('settings.aiPoweredInsights') }}</p>
          <p class="mt-1 text-sm">{{ t('settings.aiComingSoon') }}</p>
        </div>
      </BaseCard>

      <!-- About -->
      <BaseCard :title="t('settings.about')">
        <div class="space-y-2 text-sm text-gray-500 dark:text-gray-400">
          <p><strong class="text-gray-900 dark:text-gray-100">{{ t('settings.appName') }}</strong></p>
          <p>{{ t('settings.version') }}</p>
          <p>{{ t('settings.appDescription') }}</p>
          <p class="pt-2">
            {{ t('settings.privacyNote') }}
          </p>
        </div>
      </BaseCard>
    </div>

    <!-- Exchange Rate Settings (full width, rarely changed) -->
    <ExchangeRateSettings />

    <!-- Data Management (full width) -->
    <BaseCard :title="t('settings.dataManagement')">
      <div class="space-y-4">
        <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-slate-700">
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">{{ t('settings.exportData') }}</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('settings.exportDataDescription') }}</p>
          </div>
          <BaseButton variant="ghost" size="sm" @click="handleManualExport">
            {{ t('action.export') }}
          </BaseButton>
        </div>
        <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-slate-700">
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">Export Translation Cache</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">Download cached translations as a JSON file to commit to the repository</p>
          </div>
          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="settingsStore.language === 'en'"
            @click="handleExportTranslations"
          >
            Export Translations
          </BaseButton>
        </div>
        <div class="flex items-center justify-between py-3">
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">{{ t('settings.clearAllData') }}</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('settings.clearAllDataDescription') }}</p>
          </div>
          <BaseButton variant="danger" size="sm" @click="showClearConfirm = true">
            {{ t('settings.clearData') }}
          </BaseButton>
        </div>
      </div>

      <!-- Clear confirmation dialog -->
      <div v-if="showClearConfirm" class="mt-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <p class="text-sm text-red-800 dark:text-red-200 mb-3">
          {{ t('settings.clearDataConfirmation') }}
        </p>
        <div class="flex gap-2">
          <BaseButton variant="danger" size="sm" @click="handleClearData">
            {{ t('settings.yesDeleteEverything') }}
          </BaseButton>
          <BaseButton variant="ghost" size="sm" @click="showClearConfirm = false">
            {{ t('action.cancel') }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <!-- Enable Encryption Password Modal -->
    <PasswordModal
      :open="showEnableEncryptionModal"
      title="Set Encryption Password"
      description="Choose a strong password to encrypt your sync file. You'll need this password to access your data on other devices."
      confirm-label="Enable Encryption"
      :require-confirmation="true"
      @close="handleEnableEncryptionModalClose"
      @confirm="handleEnableEncryption"
    />

    <!-- Decrypt File Password Modal -->
    <PasswordModal
      :open="showDecryptFileModal"
      title="Enter Password"
      description="This file is encrypted. Enter your password to decrypt and load the data."
      confirm-label="Decrypt & Load"
      @close="handleDecryptModalClose"
      @confirm="handleDecryptFile"
    />

    <!-- Encryption error toast -->
    <div
      v-if="encryptionError"
      class="fixed bottom-4 right-4 p-4 bg-red-50 dark:bg-red-900/90 border border-red-200 dark:border-red-800 rounded-lg shadow-lg max-w-sm"
    >
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p class="text-sm font-medium text-red-800 dark:text-red-200">Encryption Error</p>
          <p class="text-sm text-red-600 dark:text-red-300 mt-1">{{ encryptionError }}</p>
        </div>
        <button
          class="text-red-400 hover:text-red-600 dark:hover:text-red-200"
          @click="encryptionError = null"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
