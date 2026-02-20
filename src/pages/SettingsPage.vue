<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import PasswordModal from '@/components/common/PasswordModal.vue';
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings.vue';
import PasskeySettings from '@/components/settings/PasskeySettings.vue';
import { BaseCard, BaseSelect, BaseButton } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { useTranslation } from '@/composables/useTranslation';
import { CURRENCIES } from '@/constants/currencies';
import { clearAllData } from '@/services/indexeddb/database';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const translationStore = useTranslationStore();
const { t } = useTranslation();

const showClearConfirm = ref(false);
const showLoadFileConfirm = ref(false);
const showDisableEncryptionConfirm = ref(false);
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
    // Show confirmation warning before disabling encryption
    showDisableEncryptionConfirm.value = true;
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

async function handleDisableEncryptionConfirmed() {
  showDisableEncryptionConfirm.value = false;
  isProcessingEncryption.value = true;
  await syncStore.disableEncryption();
  isProcessingEncryption.value = false;
}

function handleEnableEncryptionModalClose() {
  showEnableEncryptionModal.value = false;
  encryptionError.value = null;
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
    <PageHeader icon="cog" :title="t('settings.title')" :subtitle="t('settings.subtitle')" />

    <!-- First Row: General Settings and File Sync side by side on wide screens -->
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
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

      <!-- Family Data Options -->
      <BaseCard title="Family Data Options">
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Your family's financial data is encrypted and safely stored in a file you control.
        </p>

        <!-- Modern browsers with File System Access API -->
        <div v-if="syncStore.supportsAutoSync">
          <!-- Not configured state -->
          <div v-if="!syncStore.isConfigured" class="py-6 text-center">
            <img
              src="/brand/beanies_covering_eyes_transparent_512x512.png"
              alt=""
              class="mx-auto mb-4 h-12 w-12"
            />
            <p class="mb-2 font-medium text-gray-900 dark:text-gray-100">
              Save your data to a file
            </p>
            <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Create an encrypted data file or load an existing one.
            </p>
            <div class="flex flex-col gap-3">
              <BaseButton @click="handleConfigureSync"> Create New Family Data File </BaseButton>
              <BaseButton variant="secondary" @click="handleLoadFromFileClick">
                Load Existing Family Data File
              </BaseButton>
            </div>

            <!-- Load file confirmation dialog (when not configured) -->
            <div
              v-if="showLoadFileConfirm"
              class="mt-4 rounded-lg bg-yellow-50 p-4 text-left dark:bg-yellow-900/20"
            >
              <p class="mb-3 text-sm text-yellow-800 dark:text-yellow-200">
                This will replace all local data with the contents of the selected file and set it
                as your data file. Continue?
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
            <div
              v-if="syncStore.needsPermission"
              class="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20"
            >
              <p class="mb-3 text-sm text-yellow-800 dark:text-yellow-200">
                Click to grant permission to access your data file.
              </p>
              <BaseButton variant="primary" @click="handleRequestPermission">
                Grant Permission
              </BaseButton>
            </div>

            <!-- Ready state -->
            <div v-else>
              <!-- Row 1: My Family's Data + filename + status -->
              <div
                class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
              >
                <div>
                  <p class="font-medium text-gray-900 dark:text-gray-100">My Family's Data</p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">{{ syncStore.fileName }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    :class="{
                      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400':
                        syncStore.syncStatus === 'ready',
                      'bg-sky-silk-100 text-secondary-500 dark:bg-primary-900/30 dark:text-primary-400':
                        syncStore.syncStatus === 'syncing',
                      'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400':
                        syncStore.syncStatus === 'error',
                    }"
                  >
                    {{
                      syncStore.syncStatus === 'syncing'
                        ? 'Saving...'
                        : syncStore.syncStatus === 'error'
                          ? 'Error'
                          : 'Saved'
                    }}
                  </span>
                </div>
              </div>

              <!-- Row 2: Last Saved (read-only, no sync button) -->
              <div
                class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
              >
                <div>
                  <p class="font-medium text-gray-900 dark:text-gray-100">Last Saved</p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    {{ formatLastSync(syncStore.lastSync) }}
                  </p>
                </div>
              </div>

              <!-- Row 3: Load another Family Data File -->
              <div class="flex items-center justify-between py-3">
                <div>
                  <p class="font-medium text-gray-900 dark:text-gray-100">
                    Load another Family Data File
                  </p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    Switch to a different data file
                  </p>
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
              <div
                v-if="showLoadFileConfirm"
                class="mt-4 rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20"
              >
                <p class="mb-3 text-sm text-yellow-800 dark:text-yellow-200">
                  This will replace all local data with the contents of the selected file and switch
                  to that file. Continue?
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

              <!-- Error display -->
              <div v-if="syncStore.error" class="mt-4 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
                <p class="text-sm text-red-600 dark:text-red-400">{{ syncStore.error }}</p>
              </div>

              <!-- Success message -->
              <div
                v-if="importSuccess"
                class="mt-4 rounded-lg bg-green-50 p-3 dark:bg-green-900/20"
              >
                <p class="text-sm text-green-600 dark:text-green-400">Data loaded successfully!</p>
              </div>

              <!-- Encryption toggle -->
              <div class="mt-4 border-t border-gray-200 pt-4 dark:border-slate-700">
                <label class="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    :checked="syncStore.isEncryptionEnabled"
                    :disabled="isProcessingEncryption"
                    class="text-primary-600 focus:ring-primary-500 h-4 w-4 rounded"
                    @click.prevent="handleEncryptionToggle"
                  />
                  <div>
                    <p class="font-medium text-gray-900 dark:text-gray-100">
                      Encrypt data file
                      <span
                        v-if="syncStore.isEncryptionEnabled"
                        class="ml-2 inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      >
                        <img
                          src="/brand/beanies_covering_eyes_transparent_512x512.png"
                          alt=""
                          class="mr-1 h-3 w-3"
                        />
                        Encrypted
                      </span>
                    </p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                      Protect your data with password encryption
                    </p>
                  </div>
                </label>

                <!-- Disable encryption confirmation -->
                <div
                  v-if="showDisableEncryptionConfirm"
                  class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
                >
                  <p class="mb-3 text-sm text-red-800 dark:text-red-200">
                    Disabling encryption means your financial data will be stored as clear text and
                    could be read by anyone with access to the file. Are you sure?
                  </p>
                  <div class="flex gap-2">
                    <BaseButton
                      variant="danger"
                      size="sm"
                      @click="handleDisableEncryptionConfirmed"
                    >
                      Yes, Disable Encryption
                    </BaseButton>
                    <BaseButton
                      variant="ghost"
                      size="sm"
                      @click="showDisableEncryptionConfirm = false"
                    >
                      Cancel
                    </BaseButton>
                  </div>
                </div>

                <p
                  v-if="!syncStore.hasSessionPassword && syncStore.isEncryptionEnabled"
                  class="mt-2 text-sm text-yellow-600 dark:text-yellow-400"
                >
                  Note: You'll need to enter your password when you return to access your data.
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Fallback for older browsers -->
        <div v-else class="space-y-4">
          <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Your browser doesn't support automatic file saving. Use manual export/import instead.
            For automatic saving, use Chrome or Edge.
          </p>
          <div
            class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
          >
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">Download Your Data</p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Download your data as a JSON file
              </p>
            </div>
            <BaseButton variant="secondary" size="sm" @click="handleManualExport">
              Download
            </BaseButton>
          </div>
          <div class="flex items-center justify-between py-3">
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">Load Data File</p>
              <p class="text-sm text-gray-500 dark:text-gray-400">Load data from a JSON file</p>
            </div>
            <BaseButton variant="secondary" size="sm" @click="handleManualImport">
              Load
            </BaseButton>
          </div>

          <!-- Import error -->
          <div v-if="importError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
            <p class="text-sm text-red-600 dark:text-red-400">{{ importError }}</p>
          </div>

          <!-- Import success -->
          <div v-if="importSuccess" class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
            <p class="text-sm text-green-600 dark:text-green-400">Data loaded successfully!</p>
          </div>
        </div>
      </BaseCard>
    </div>

    <!-- Second Row: AI Settings and About side by side on wide screens -->
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <!-- AI Settings -->
      <BaseCard :title="t('settings.aiInsights')">
        <div class="py-8 text-center text-gray-500 dark:text-gray-400">
          <BeanieIcon name="light-bulb" size="xl" class="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <p class="font-medium">{{ t('settings.aiPoweredInsights') }}</p>
          <p class="mt-1 text-sm">{{ t('settings.aiComingSoon') }}</p>
        </div>
      </BaseCard>

      <!-- About -->
      <BaseCard :title="t('settings.about')">
        <div class="space-y-2 text-sm text-gray-500 dark:text-gray-400">
          <p>
            <strong class="text-gray-900 dark:text-gray-100">{{ t('settings.appName') }}</strong>
          </p>
          <p>{{ t('settings.version') }}</p>
          <p>{{ t('settings.appDescription') }}</p>
          <p class="pt-2">
            {{ t('settings.privacyNote') }}
          </p>
        </div>
      </BaseCard>
    </div>

    <!-- Security Settings (only shown when auth is configured) -->
    <div v-if="authStore.isAuthConfigured && !authStore.isLocalOnlyMode">
      <h2 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Security</h2>
      <PasskeySettings />
    </div>

    <!-- Exchange Rate Settings (full width, rarely changed) -->
    <ExchangeRateSettings />

    <!-- Data Management (full width) -->
    <BaseCard :title="t('settings.dataManagement')">
      <div class="space-y-4">
        <div
          class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
        >
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">
              {{ t('settings.exportData') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.exportDataDescription') }}
            </p>
          </div>
          <BaseButton variant="ghost" size="sm" @click="handleManualExport">
            {{ t('action.export') }}
          </BaseButton>
        </div>
        <div
          class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
        >
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">Export Translation Cache</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Download cached translations as a JSON file to commit to the repository
            </p>
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
            <p class="font-medium text-gray-900 dark:text-gray-100">
              {{ t('settings.clearAllData') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.clearAllDataDescription') }}
            </p>
          </div>
          <BaseButton variant="danger" size="sm" @click="showClearConfirm = true">
            {{ t('settings.clearData') }}
          </BaseButton>
        </div>
      </div>

      <!-- Clear confirmation dialog -->
      <div v-if="showClearConfirm" class="mt-4 rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
        <p class="mb-3 text-sm text-red-800 dark:text-red-200">
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
      description="Choose a strong password to encrypt your data file. You'll need this password each time you open the app."
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
      class="fixed right-4 bottom-4 max-w-sm rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg dark:border-red-800 dark:bg-red-900/90"
    >
      <div class="flex items-start gap-3">
        <BeanieIcon name="exclamation-circle" size="md" class="mt-0.5 flex-shrink-0 text-red-500" />
        <div>
          <p class="text-sm font-medium text-red-800 dark:text-red-200">Encryption Error</p>
          <p class="mt-1 text-sm text-red-600 dark:text-red-300">{{ encryptionError }}</p>
        </div>
        <button
          class="text-red-400 hover:text-red-600 dark:hover:text-red-200"
          @click="encryptionError = null"
        >
          <BeanieIcon name="close" size="sm" />
        </button>
      </div>
    </div>
  </div>
</template>
