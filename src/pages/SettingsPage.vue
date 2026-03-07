<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import PasswordModal from '@/components/common/PasswordModal.vue';
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings.vue';
import PasskeySettings from '@/components/settings/PasskeySettings.vue';
import ProfileHeader from '@/components/settings/ProfileHeader.vue';
import SettingsCard from '@/components/settings/SettingsCard.vue';
import { BaseSelect, BaseButton } from '@/components/ui';
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';

import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
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
const { isReconnecting, reconnect } = useGoogleReconnect();

// ── Modal state ──────────────────────────────────────────────────────────────
const showAppearance = ref(false);
const showCurrency = ref(false);
const showSecurity = ref(false);
const showFamilyData = ref(false);
const showDataManagement = ref(false);

// ── Family Data state ────────────────────────────────────────────────────────
const showClearConfirm = ref(false);
const showLoadFileConfirm = ref(false);
const importError = ref<string | null>(null);
const importSuccess = ref(false);
const showDecryptFileModal = ref(false);
const encryptionError = ref<string | null>(null);
const isProcessingEncryption = ref(false);

// ── Currency ─────────────────────────────────────────────────────────────────
const { currencyOptions } = useCurrencyOptions();

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

// ── Theme / Toggles ──────────────────────────────────────────────────────────
const themeOptions = computed(() => [
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
  { value: 'system', label: t('settings.theme.system') },
]);

async function updateCurrency(value: string | number) {
  await settingsStore.setBaseCurrency(value as string);
}

async function updateTheme(value: string | number) {
  await settingsStore.setTheme(value as 'light' | 'dark' | 'system');
}

// ── Family Data handlers ─────────────────────────────────────────────────────
onMounted(async () => {
  await syncStore.initialize();
});

async function handleSettingsReconnect() {
  const success = await reconnect();
  if (success) await syncStore.handleGoogleReconnected();
}

async function handleForceSave() {
  await syncStore.forceSyncNow();
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

function formatLastSync(timestamp: string | null): string {
  if (!timestamp) return t('settings.lastSyncNever');
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// ── Data Management handlers ─────────────────────────────────────────────────
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
  await settingsStore.clearCachedFamilyKey();
  await settingsStore.setTrustedDevice(false);
  const familyId = useFamilyContextStore().activeFamilyId;
  if (familyId) {
    await deleteFamilyDatabase(familyId);
  }
  showClearConfirm.value = false;
  window.location.reload();
}
</script>

<template>
  <div class="space-y-6">
    <!-- ── Profile Header ──────────────────────────────────────────────── -->
    <ProfileHeader />

    <!-- ── Settings Card Grid ──────────────────────────────────────────── -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SettingsCard
        icon="🔒"
        :title="t('settings.card.security')"
        :description="t('settings.card.securityDesc')"
        icon-bg="var(--tint-orange-8)"
        @click="showSecurity = true"
      />
      <SettingsCard
        icon="👨‍👩‍👧"
        :title="t('settings.card.familyMembers')"
        :description="t('settings.card.familyMembersDesc')"
        icon-bg="var(--tint-orange-8)"
        @click="router.push('/family')"
      />
      <SettingsCard
        icon="🎨"
        :title="t('settings.card.appearance')"
        :description="t('settings.card.appearanceDesc')"
        icon-bg="var(--tint-slate-05)"
        @click="showAppearance = true"
      />
      <SettingsCard
        icon="💱"
        :title="t('settings.card.currency')"
        :description="t('settings.card.currencyDesc')"
        icon-bg="var(--tint-silk-20)"
        @click="showCurrency = true"
      />
      <SettingsCard
        v-if="canManagePod"
        icon="💾"
        :title="t('settings.card.familyData')"
        :description="t('settings.card.familyDataDesc')"
        icon-bg="var(--tint-silk-20)"
        @click="showFamilyData = true"
      />
      <SettingsCard
        v-if="canManagePod"
        icon="📤"
        :title="t('settings.card.dataManagement')"
        :description="t('settings.card.dataManagementDesc')"
        icon-bg="var(--tint-slate-05)"
        @click="showDataManagement = true"
      />
    </div>

    <!-- ── Install App Banner ──────────────────────────────────────────── -->
    <div
      v-if="canInstall || isInstalled"
      class="flex items-center justify-between rounded-3xl bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <div>
        <p class="font-outfit text-sm font-bold text-slate-700 dark:text-slate-200">
          {{ t('settings.installApp') }}
        </p>
        <p class="text-xs text-slate-400 dark:text-slate-500">
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

    <!-- ── Quick Toggles ───────────────────────────────────────────────── -->
    <div>
      <p
        class="font-outfit mb-4 text-[0.75rem] font-bold tracking-[0.1em] text-[var(--deep-slate)]/35 uppercase dark:text-slate-500"
      >
        {{ t('settings.quickToggles') }}
      </p>
      <div
        class="rounded-[var(--sq)] bg-white px-6 shadow-[0_2px_12px_rgba(44,62,80,0.04)] dark:bg-slate-800"
      >
        <!-- Dark Mode -->
        <div
          class="flex items-center justify-between border-b border-[var(--tint-slate-05)] py-3.5 dark:border-slate-700"
        >
          <div>
            <p class="text-[0.8rem] font-semibold text-[var(--deep-slate)] dark:text-slate-200">
              {{ t('settings.darkMode') }}
            </p>
            <p class="text-[0.65rem] leading-snug text-[var(--deep-slate)]/40 dark:text-slate-500">
              {{ t('settings.darkModeDescription') }}
            </p>
          </div>
          <ToggleSwitch
            :model-value="settingsStore.theme === 'dark'"
            @update:model-value="settingsStore.setTheme($event ? 'dark' : 'light')"
          />
        </div>
        <!-- Beanie Mode -->
        <div
          class="flex items-center justify-between border-b border-[var(--tint-slate-05)] py-3.5 dark:border-slate-700"
        >
          <div>
            <p class="text-[0.8rem] font-semibold text-[var(--deep-slate)] dark:text-slate-200">
              {{ t('settings.beanieMode') }}
            </p>
            <p class="text-[0.65rem] leading-snug text-[var(--deep-slate)]/40 dark:text-slate-500">
              {{ t('settings.beanieModeDescription') }}
            </p>
            <p
              v-if="!translationStore.isEnglish"
              class="text-[0.65rem] text-amber-600 dark:text-amber-400"
            >
              {{ t('settings.beanieModeDisabled') }}
            </p>
          </div>
          <ToggleSwitch
            data-testid="beanie-mode-toggle"
            :model-value="settingsStore.beanieMode"
            :disabled="!translationStore.isEnglish"
            @update:model-value="settingsStore.setBeanieMode($event)"
          />
        </div>
        <!-- Sound Effects -->
        <div class="flex items-center justify-between py-3.5">
          <div>
            <p class="text-[0.8rem] font-semibold text-[var(--deep-slate)] dark:text-slate-200">
              {{ t('settings.soundEffects') }}
            </p>
            <p class="text-[0.65rem] leading-snug text-[var(--deep-slate)]/40 dark:text-slate-500">
              {{ t('settings.soundEffectsDescription') }}
            </p>
          </div>
          <ToggleSwitch
            data-testid="sound-toggle"
            :model-value="settingsStore.soundEnabled"
            @update:model-value="settingsStore.setSoundEnabled($event)"
          />
        </div>
      </div>
    </div>

    <!-- ── About Footer ────────────────────────────────────────────────── -->
    <div class="px-2 pb-4 text-center text-xs text-slate-400 dark:text-slate-500">
      <p>
        <span class="opacity-60">🫘</span>
        <strong class="text-slate-500 dark:text-slate-400">{{ t('settings.appName') }}</strong>
        · {{ t('settings.version') }}
      </p>
      <p class="mt-1"><span class="opacity-60">🔒</span> {{ t('settings.privacyNote') }}</p>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!-- ── MODALS ────────────────────────────────────────────────────── -->
    <!-- ══════════════════════════════════════════════════════════════════ -->

    <!-- ── Appearance Modal ────────────────────────────────────────────── -->
    <BaseModal
      :open="showAppearance"
      :title="t('settings.card.appearance')"
      size="lg"
      @close="showAppearance = false"
    >
      <div class="space-y-6 p-6">
        <BaseSelect
          :model-value="settingsStore.theme"
          :options="themeOptions"
          :label="t('settings.theme')"
          :hint="t('settings.themeHint')"
          @update:model-value="updateTheme"
        />

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
            @click="
              settingsStore.setOnboardingCompleted(false).then(() => {
                showAppearance = false;
                router.push('/nook');
              })
            "
          >
            {{ t('onboarding.restartOnboarding') }}
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- ── Currency & Rates Modal ──────────────────────────────────────── -->
    <BaseModal
      :open="showCurrency"
      :title="t('settings.card.currency')"
      size="xl"
      @close="showCurrency = false"
    >
      <div class="space-y-6 p-6">
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

          <BaseSelect
            v-if="(settingsStore.preferredCurrencies || []).length < 4"
            model-value=""
            :options="availableForPreferred"
            :placeholder="t('settings.addCurrency')"
            @update:model-value="addPreferredCurrency"
          />
        </div>

        <!-- Exchange Rates (inline, no BaseCard wrapper) -->
        <div class="border-t border-gray-200 pt-4 dark:border-slate-700">
          <ExchangeRateSettings :standalone="false" />
        </div>
      </div>
    </BaseModal>

    <!-- ── Security & Privacy Modal ────────────────────────────────────── -->
    <BaseModal
      v-if="authStore.isAuthenticated"
      :open="showSecurity"
      :title="t('settings.card.security')"
      size="xl"
      @close="showSecurity = false"
    >
      <div class="space-y-6 p-6">
        <!-- Trusted device toggle -->
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
          <ToggleSwitch
            :model-value="settingsStore.isTrustedDevice"
            @update:model-value="settingsStore.setTrustedDevice($event)"
          />
        </div>

        <!-- Passkey Settings -->
        <PasskeySettings />
      </div>
    </BaseModal>

    <!-- ── Family Data Modal ───────────────────────────────────────────── -->
    <BaseModal
      v-if="canManagePod"
      :open="showFamilyData"
      :title="t('settings.familyDataOptions')"
      size="xl"
      @close="showFamilyData = false"
    >
      <div class="space-y-4 p-6">
        <p class="text-sm text-gray-500 dark:text-gray-400">
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

            <div v-else>
              <!-- My Family's Data -->
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

              <!-- Google Drive info -->
              <div
                v-if="syncStore.isGoogleDriveConnected"
                class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
              >
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {{ t('googleDrive.fileLocation') }}
                </p>
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

              <!-- Last Saved -->
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

              <!-- Load another file -->
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

              <!-- Load file confirmation -->
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
              <div
                v-if="syncStore.error"
                class="mt-4 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20"
              >
                <p class="text-sm text-amber-800 dark:text-amber-300">{{ syncStore.error }}</p>
                <div class="mt-2 flex gap-2">
                  <BaseButton
                    v-if="syncStore.isGoogleDriveConnected"
                    variant="primary"
                    size="sm"
                    :loading="isReconnecting"
                    @click="handleSettingsReconnect"
                  >
                    {{ t('settings.reconnectDrive') }}
                  </BaseButton>
                  <BaseButton variant="secondary" size="sm" @click="handleForceSave">
                    {{ t('settings.forceSave') }}
                  </BaseButton>
                </div>
              </div>

              <!-- Cache persist warning -->
              <div
                v-if="syncStore.cachePersistFailed"
                class="mt-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20"
              >
                <p class="text-sm text-amber-700 dark:text-amber-300">
                  {{ t('settings.cachePersistWarning') }}
                </p>
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

          <div v-if="importError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
            <p class="text-sm text-red-600 dark:text-red-400">{{ importError }}</p>
          </div>
          <div v-if="importSuccess" class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
            <p class="text-sm text-green-600 dark:text-green-400">
              {{ t('settings.dataLoadedSuccess') }}
            </p>
          </div>
        </div>
      </div>
    </BaseModal>

    <!-- ── Data Management Modal ───────────────────────────────────────── -->
    <BaseModal
      v-if="canManagePod"
      :open="showDataManagement"
      :title="t('settings.dataManagement')"
      size="lg"
      @close="showDataManagement = false"
    >
      <div class="space-y-4 p-6">
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

        <div v-if="showClearConfirm" class="rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
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
      </div>
    </BaseModal>

    <!-- ── Decrypt File Password Modal ─────────────────────────────────── -->
    <PasswordModal
      :open="showDecryptFileModal"
      :title="t('password.enterPassword')"
      :description="t('password.enterPasswordDescription')"
      :confirm-label="t('password.decryptAndLoad')"
      @close="handleDecryptModalClose"
      @confirm="handleDecryptFile"
    />

    <!-- ── Encryption error toast ──────────────────────────────────────── -->
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
