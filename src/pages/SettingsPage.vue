<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import PasswordModal from '@/components/common/PasswordModal.vue';
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings.vue';
import PasskeySettings from '@/components/settings/PasskeySettings.vue';
import { BaseCard, BaseSelect, BaseButton } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';

import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { usePWA } from '@/composables/usePWA';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { CURRENCIES, getCurrencyInfo } from '@/constants/currencies';
import { getDoc } from '@/services/automerge/docService';
import { deleteFamilyDatabase } from '@/services/indexeddb/database';
import { downloadAsFile } from '@/services/sync/fileSync';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const translationStore = useTranslationStore();
const { t } = useTranslation();
const { canInstall, isInstalled, installApp } = usePWA();
const { canManagePod } = usePermissions();

const showClearConfirm = ref(false);
const showLoadFileConfirm = ref(false);
const importError = ref<string | null>(null);
const importSuccess = ref(false);

// Decrypt-file modal state (for loading encrypted files)
const showDecryptFileModal = ref(false);
const encryptionError = ref<string | null>(null);
const isProcessingEncryption = ref(false);

const { currencyOptions } = useCurrencyOptions();

// Available currencies for preferred picker (exclude already-preferred ones)
const availableForPreferred = computed(() =>
  CURRENCIES.filter((c) => !(settingsStore.preferredCurrencies || []).includes(c.code)).map(
    (c) => ({
      value: c.code,
      label: `${c.code} - ${c.name}`,
    })
  )
);

function addPreferredCurrency(code: string | number) {
  const current = settingsStore.preferredCurrencies || [];
  if (current.length >= 4) return;
  settingsStore.setPreferredCurrencies([...current, code as string]);
}

function removePreferredCurrency(code: string) {
  const current = settingsStore.preferredCurrencies || [];
  settingsStore.setPreferredCurrencies(current.filter((c) => c !== code));
}

const themeOptions = computed(() => [
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
  { value: 'system', label: t('settings.theme.system') },
]);

onMounted(async () => {
  await syncStore.initialize();
});

async function handleTrustedDeviceToggle(event: Event) {
  const target = event.target as HTMLInputElement;
  await settingsStore.setTrustedDevice(target.checked);
}

async function handleBeanieToggle(event: Event) {
  const target = event.target as HTMLInputElement;
  await settingsStore.setBeanieMode(target.checked);
}

async function handleSoundToggle(event: Event) {
  const target = event.target as HTMLInputElement;
  await settingsStore.setSoundEnabled(target.checked);
}

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

function handleExportAsJson() {
  const doc = getDoc();
  const collections = [
    'familyMembers',
    'accounts',
    'transactions',
    'assets',
    'goals',
    'budgets',
    'recurringItems',
    'todos',
    'activities',
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of collections) {
    data[key] = Object.values(doc[key] ?? {});
  }
  data.settings = doc.settings ?? null;

  const json = JSON.stringify(data, null, 2);
  const date = new Date().toISOString().split('T')[0];
  downloadAsFile(json, `beanies-export-${date}.json`);
}

async function handleClearData() {
  // Clear cached encryption password and trust flag from registry DB before wiping per-family data
  await settingsStore.clearCachedFamilyKey();
  await settingsStore.setTrustedDevice(false);
  const familyId = useFamilyContextStore().activeFamilyId;
  if (familyId) {
    await deleteFamilyDatabase(familyId);
  }
  showClearConfirm.value = false;
  window.location.reload();
}

function formatLastSync(timestamp: string | null): string {
  if (!timestamp) return t('settings.lastSyncNever');
  const date = new Date(timestamp);
  return date.toLocaleString();
}
</script>

<template>
  <div class="space-y-6">
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

          <!-- Preferred Currencies -->
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.preferredCurrencies') }}
            </label>
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.preferredCurrenciesHint') }}
            </p>

            <!-- Selected chips -->
            <div
              v-if="(settingsStore.preferredCurrencies || []).length > 0"
              class="mb-2 flex flex-wrap gap-1.5"
            >
              <span
                v-for="code in settingsStore.preferredCurrencies"
                :key="code"
                class="bg-primary-500/10 text-primary-500 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              >
                {{ getCurrencyInfo(code)?.symbol }} {{ code }}
                <button
                  type="button"
                  class="text-primary-500/60 hover:text-primary-500 ml-0.5 cursor-pointer"
                  @click="removePreferredCurrency(code)"
                >
                  &times;
                </button>
              </span>
            </div>

            <!-- Add dropdown -->
            <BaseSelect
              v-if="(settingsStore.preferredCurrencies || []).length < 4"
              model-value=""
              :options="availableForPreferred"
              :placeholder="t('settings.addCurrency')"
              @update:model-value="addPreferredCurrency"
            />
          </div>

          <BaseSelect
            :model-value="settingsStore.theme"
            :options="themeOptions"
            :label="t('settings.theme')"
            :hint="t('settings.themeHint')"
            @update:model-value="updateTheme"
          />

          <!-- Beanie Mode -->
          <div
            class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-slate-700"
            :class="{ 'opacity-50': !translationStore.isEnglish }"
          >
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {{ t('settings.beanieMode') }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('settings.beanieModeDescription') }}
              </p>
              <p
                v-if="!translationStore.isEnglish"
                class="mt-1 text-xs text-amber-600 dark:text-amber-400"
              >
                {{ t('settings.beanieModeDisabled') }}
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="beanie-mode-toggle"
              :checked="settingsStore.beanieMode"
              :disabled="!translationStore.isEnglish"
              class="text-primary-600 focus:ring-primary-500 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
              @change="handleBeanieToggle"
            />
          </div>

          <!-- Sound Effects -->
          <div
            class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-slate-700"
          >
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {{ t('settings.soundEffects') }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('settings.soundEffectsDescription') }}
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="sound-toggle"
              :checked="settingsStore.soundEnabled"
              class="text-primary-600 focus:ring-primary-500 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
              @change="handleSoundToggle"
            />
          </div>

          <!-- Restart Onboarding -->
          <div
            class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-slate-700"
          >
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {{ t('onboarding.restartOnboarding') }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('onboarding.restartOnboardingDescription') }}
              </p>
            </div>
            <BaseButton
              data-testid="restart-onboarding"
              @click="settingsStore.setOnboardingCompleted(false).then(() => router.push('/nook'))"
            >
              {{ t('onboarding.restartOnboarding') }}
            </BaseButton>
          </div>
        </div>
      </BaseCard>

      <!-- Family Data Options (admin only) -->
      <BaseCard v-if="canManagePod" :title="t('settings.familyDataOptions')">
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {{ t('settings.familyDataDescription') }}
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
              {{ t('settings.saveDataToFile') }}
            </p>
            <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.createOrLoadDataFile') }}
            </p>
            <div class="flex flex-col gap-3">
              <BaseButton @click="handleConfigureSync">
                {{ t('settings.createNewDataFile') }}
              </BaseButton>
              <BaseButton variant="secondary" @click="handleLoadFromFileClick">
                {{ t('settings.loadExistingDataFile') }}
              </BaseButton>
            </div>

            <!-- Load file confirmation dialog (when not configured) -->
            <div
              v-if="showLoadFileConfirm"
              class="mt-4 rounded-lg bg-yellow-50 p-4 text-left dark:bg-yellow-900/20"
            >
              <p class="mb-3 text-sm text-yellow-800 dark:text-yellow-200">
                {{ t('settings.loadFileConfirmation') }}
              </p>
              <div class="flex gap-2">
                <BaseButton variant="primary" size="sm" @click="handleLoadFromFileConfirmed">
                  {{ t('settings.yesLoadFile') }}
                </BaseButton>
                <BaseButton variant="ghost" size="sm" @click="showLoadFileConfirm = false">
                  {{ t('action.cancel') }}
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
                {{ t('settings.grantPermissionPrompt') }}
              </p>
              <BaseButton variant="primary" @click="handleRequestPermission">
                {{ t('settings.grantPermission') }}
              </BaseButton>
            </div>

            <!-- Ready state -->
            <div v-else>
              <!-- Row 1: My Family's Data + filename + status -->
              <div
                class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
              >
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-gray-900 dark:text-gray-100">
                    {{ t('settings.myFamilyData') }}
                  </p>
                  <CloudProviderBadge
                    :provider-type="syncStore.storageProviderType"
                    :file-name="syncStore.fileName"
                    :account-email="syncStore.providerAccountEmail"
                    size="md"
                  />
                  <p
                    v-if="syncStore.isGoogleDriveConnected"
                    class="mt-0.5 text-xs text-gray-400 dark:text-gray-500"
                  >
                    {{ t('googleDrive.savedTo') }}
                  </p>
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
                        ? t('settings.saving')
                        : syncStore.syncStatus === 'error'
                          ? t('settings.error')
                          : t('settings.saved')
                    }}
                  </span>
                </div>
              </div>

              <!-- Google Drive info row -->
              <div
                v-if="syncStore.isGoogleDriveConnected"
                class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
              >
                <div>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    {{ t('googleDrive.fileLocation') }}
                  </p>
                </div>
                <a
                  :href="
                    syncStore.driveFolderId
                      ? `https://drive.google.com/drive/folders/${syncStore.driveFolderId}`
                      : 'https://drive.google.com'
                  "
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {{ t('googleDrive.openInDrive') }}
                  <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>

              <!-- Row 2: Last Saved (read-only, no sync button) -->
              <div
                class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
              >
                <div>
                  <p class="font-medium text-gray-900 dark:text-gray-100">
                    {{ t('settings.lastSaved') }}
                  </p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    {{ formatLastSync(syncStore.lastSync) }}
                  </p>
                </div>
              </div>

              <!-- Row 3: Load another Family Data File -->
              <div class="flex items-center justify-between py-3">
                <div>
                  <p class="font-medium text-gray-900 dark:text-gray-100">
                    {{ t('settings.loadAnotherDataFile') }}
                  </p>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    {{ t('settings.switchDataFile') }}
                  </p>
                </div>
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :loading="syncStore.isSyncing"
                  @click="handleLoadFromFileClick"
                >
                  {{ t('settings.browse') }}
                </BaseButton>
              </div>

              <!-- Load file confirmation dialog -->
              <div
                v-if="showLoadFileConfirm"
                class="mt-4 rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20"
              >
                <p class="mb-3 text-sm text-yellow-800 dark:text-yellow-200">
                  {{ t('settings.switchFileConfirmation') }}
                </p>
                <div class="flex gap-2">
                  <BaseButton variant="primary" size="sm" @click="handleLoadFromFileConfirmed">
                    {{ t('settings.yesLoadFile') }}
                  </BaseButton>
                  <BaseButton variant="ghost" size="sm" @click="showLoadFileConfirm = false">
                    {{ t('action.cancel') }}
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
                <p class="text-sm text-green-600 dark:text-green-400">
                  {{ t('settings.dataLoadedSuccess') }}
                </p>
              </div>

              <!-- Family key status -->
              <div class="mt-4 border-t border-gray-200 pt-4 dark:border-slate-700">
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-green-100 dark:bg-green-900/30"
                  >
                    <BeanieIcon name="lock" size="md" class="text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p class="font-medium text-gray-900 dark:text-gray-100">
                      {{ t('settings.familyKeyStatus') }}
                      <span
                        class="ml-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      >
                        {{ t('settings.familyKeyActive') }}
                      </span>
                    </p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                      {{ t('settings.familyKeyDescription') }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Fallback for older browsers -->
        <div v-else class="space-y-4">
          <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {{ t('settings.noAutoSyncWarning') }}
          </p>
          <div
            class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
          >
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {{ t('settings.downloadYourData') }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('settings.downloadDataDescription') }}
              </p>
            </div>
            <BaseButton variant="secondary" size="sm" @click="handleManualExport">
              {{ t('action.download') }}
            </BaseButton>
          </div>
          <div class="flex items-center justify-between py-3">
            <div>
              <p class="font-medium text-gray-900 dark:text-gray-100">
                {{ t('settings.loadDataFile') }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('settings.loadDataFileDescription') }}
              </p>
            </div>
            <BaseButton variant="secondary" size="sm" @click="handleManualImport">
              {{ t('action.load') }}
            </BaseButton>
          </div>

          <!-- Import error -->
          <div v-if="importError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
            <p class="text-sm text-red-600 dark:text-red-400">{{ importError }}</p>
          </div>

          <!-- Import success -->
          <div v-if="importSuccess" class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
            <p class="text-sm text-green-600 dark:text-green-400">
              {{ t('settings.dataLoadedSuccess') }}
            </p>
          </div>
        </div>
      </BaseCard>
    </div>

    <!-- Second Row: AI Settings and About side by side on wide screens -->
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <!-- AI Settings (admin only) -->
      <BaseCard v-if="canManagePod" :title="t('settings.aiInsights')">
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

    <!-- Install App (only when installable) -->
    <BaseCard v-if="canInstall || isInstalled" :title="t('settings.installApp')">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ isInstalled ? t('settings.appInstalled') : t('settings.installAppDesc') }}
          </p>
        </div>
        <BaseButton
          v-if="canInstall && !isInstalled"
          variant="primary"
          size="sm"
          @click="installApp()"
        >
          {{ t('settings.installAppButton') }}
        </BaseButton>
        <span
          v-else-if="isInstalled"
          class="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
        >
          &#x2713;
        </span>
      </div>
    </BaseCard>

    <!-- Security Settings -->
    <div v-if="authStore.isAuthenticated" class="space-y-4">
      <h2 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ t('settings.security') }}
      </h2>

      <!-- Trusted device toggle -->
      <BaseCard>
        <div
          class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-slate-700"
        >
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">
              {{ t('trust.settingsLabel') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('trust.settingsDesc') }}
            </p>
          </div>
          <input
            type="checkbox"
            :checked="settingsStore.isTrustedDevice"
            class="text-primary-600 focus:ring-primary-500 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
            @change="handleTrustedDeviceToggle"
          />
        </div>
      </BaseCard>

      <PasskeySettings />
    </div>

    <!-- Exchange Rate Settings (admin only, full width) -->
    <ExchangeRateSettings v-if="canManagePod" />

    <!-- Data Management (admin only, full width) -->
    <BaseCard v-if="canManagePod" :title="t('settings.dataManagement')">
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
            <p class="font-medium text-gray-900 dark:text-gray-100">
              {{ t('settings.exportAsJson') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.exportAsJsonDesc') }}
            </p>
          </div>
          <BaseButton variant="ghost" size="sm" @click="handleExportAsJson">
            {{ t('action.export') }}
          </BaseButton>
        </div>
        <div
          class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
        >
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">
              {{ t('settings.exportTranslationCache') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.exportTranslationCacheDescription') }}
            </p>
          </div>
          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="settingsStore.language === 'en'"
            @click="handleExportTranslations"
          >
            {{ t('settings.exportTranslations') }}
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

    <!-- Decrypt File Password Modal -->
    <PasswordModal
      :open="showDecryptFileModal"
      :title="t('password.enterPassword')"
      :description="t('password.enterPasswordDescription')"
      :confirm-label="t('password.decryptAndLoad')"
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
          <p class="text-sm font-medium text-red-800 dark:text-red-200">
            {{ t('password.encryptionError') }}
          </p>
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
