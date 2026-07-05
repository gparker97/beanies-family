<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue';
import PasswordModal from '@/components/common/PasswordModal.vue';
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings.vue';
import SettingsAdminOnlyNotice from '@/components/settings/SettingsAdminOnlyNotice.vue';
import PasskeySettings from '@/components/settings/PasskeySettings.vue';
import ChangePasswordSettings from '@/components/settings/ChangePasswordSettings.vue';
import ProfileHeader from '@/components/settings/ProfileHeader.vue';
import SettingsCard from '@/components/settings/SettingsCard.vue';
import { openDiscord } from '@/utils/discord';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import AiSettings from '@/components/settings/AiSettings.vue';
import CalendarSyncSettings from '@/components/settings/CalendarSyncSettings.vue';
import BeanieLabSection from '@/components/settings/BeanieLabSection.vue';
import { useBeanieLab } from '@/composables/useBeanieLab';
import { isFlagEnabled } from '@/config/flags';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';
import TransferOwnershipModal from '@/components/family/TransferOwnershipModal.vue';
import { BaseSelect, BaseButton, BaseInput } from '@/components/ui';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';

import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { getFullVersionLabel } from '@/utils/diagnosticContext';
import { alert as showAlert, confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import type { StorageProviderType } from '@/services/sync/storageProvider';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
import { usePermissions } from '@/composables/usePermissions';
import { usePWA } from '@/composables/usePWA';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useCountryOptions } from '@/composables/useCountryOptions';
import { CURRENCIES, getCurrencyInfo } from '@/constants/currencies';
import {
  list as projectionList,
  getSettings as getProjectionSettings,
} from '@/services/automerge/projection';
import { deleteFamilyDatabase } from '@/services/indexeddb/database';
import { downloadAsFile, tryUnwrapFamilyKey } from '@/services/sync/fileSync';
import { getProviderConfig } from '@/services/sync/fileHandleStore';
import { deleteFile } from '@/services/google/driveService';
import {
  getValidToken,
  isUserCancellation,
  shouldUseRedirectAuth,
} from '@/services/google/googleAuth';
import { getDeploymentBadge } from '@/config/features';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useBeanTips } from '@/composables/useBeanTips';
import { resetAllAppStores } from '@/utils/resetStores';
import type { CountryCode } from '@/types/models';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const translationStore = useTranslationStore();
const beanTips = useBeanTips();
const familyStore = useFamilyStore();
const holidayStore = useHolidayStore();
const { t } = useTranslation();
/** Product version + build marker (e.g. "v0.9 · 41f5353 · 19 Jun 2026") for the about footer. */
const fullVersionLabel = getFullVersionLabel();
const deploymentBadge = computed(() => getDeploymentBadge());
const { canInstall, isInstalled, installApp } = usePWA();
const { canManagePod, isOwner } = usePermissions();

// Dev-only Feature Flags card (issue #31). Loaded via a DEV-gated dynamic import
// so the card AND its write transport are dead-code-eliminated from the prod
// bundle (same mechanism main.ts uses for the e2e dataBridge). In prod this is
// `undefined`, so the template `v-if` renders nothing.
const DevFlagsCard = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/components/settings/DevFeatureFlagsCard.vue'))
  : undefined;

// On iOS / installed PWAs, "Move to Google Drive" would route through the
// fragile popup OAuth path (the resume-via-redirect dance isn't wired for the
// migration flow yet — see STATUS pending block). Hide that direction there so
// users don't hit a broken popup. "Move to a local file" (Drive → local) is
// fine — no OAuth — so the row still shows when already on Drive.
const isRedirectAuthBrowser = shouldUseRedirectAuth();

// Current pod owner — surfaced inside the Family Data modal's Pod Ownership
// section so members can see who holds the super-admin role at a glance.
const currentOwnerName = computed(
  () => familyStore.members.find((m) => m.role === 'owner')?.name ?? null
);
const { isReconnecting, reconnectError, reconnect } = useGoogleReconnect();

// ── Modal state ──────────────────────────────────────────────────────────────
const showAppearance = ref(false);
const showCurrency = ref(false);
const showCountryHolidays = ref(false);
const showAccount = ref(false);
const showSecurity = ref(false);
const showFamilyData = ref(false);
const showDataManagement = ref(false);
const showTransferOwnership = ref(false);
const showAi = ref(false);
const showCalendarSync = ref(false);
// beanies AI (#133) still lives inside The Beanie Lab (per-device opt-in);
// useBeanieLab is the single source of truth for its visibility (Lab on + a
// reader flag), shared with BeanieLabSection. Google Calendar (#32/#34)
// graduated to an official Settings card on 2026-07-03 — it's gated on the
// googleCalendarSync flag alone (a kill-switch), not the Lab. isFlagEnabled is
// not reactive (flips take effect on reload), so a plain const is correct.
const { hasAnyLabFeature, aiVisible } = useBeanieLab();
const calendarAvailable = isFlagEnabled('googleCalendarSync');

// ── Deep-link: open a specific card from a route query (e.g. ?open=family-data)
//    Generalizable — additional cards can opt in by extending the map below.
const cardOpenMap: Record<string, () => void> = {
  'family-data': () => {
    showFamilyData.value = true;
  },
  ai: () => {
    // Guarded: AI lives in the Beanie Lab — no-ops unless opted in AND a reader
    // flag (aiPhotoExtract / aiTravelExtract) is alive.
    if (aiVisible.value) showAi.value = true;
  },
  [CALENDAR_SYNC_OPEN]: () => {
    // Official feature — gated on the googleCalendarSync flag (kill-switch), not the Lab.
    if (calendarAvailable) showCalendarSync.value = true;
  },
  appearance: () => {
    showAppearance.value = true;
  },
  currency: () => {
    showCurrency.value = true;
  },
  'country-holidays': () => {
    showCountryHolidays.value = true;
  },
  account: () => {
    showAccount.value = true;
  },
  security: () => {
    showSecurity.value = true;
  },
  'data-management': () => {
    showDataManagement.value = true;
  },
};

function applyOpenQuery() {
  const open = route.query.open;
  if (typeof open !== 'string') return;
  const handler = cardOpenMap[open];
  if (!handler) return;
  handler();
  // Strip the query so a refresh / back-nav doesn't re-open the modal.
  router.replace({ path: route.path, query: {} });
}

onMounted(applyOpenQuery);
watch(() => route.query.open, applyOpenQuery);

// ── Family Data state ────────────────────────────────────────────────────────
const showClearConfirm = ref(false);
const showLoadFileConfirm = ref(false);
const importError = ref<string | null>(null);
const importSuccess = ref(false);
const showDecryptFileModal = ref(false);
const encryptionError = ref<string | null>(null);
const isProcessingEncryption = ref(false);

// ── Delete Family state ────────────────────────────────────────────────────
const showDeleteFamilyConfirm = ref(false);
const showDeleteFamilyPassword = ref(false);
const deleteConfirmText = ref('');
const wantExport = ref(false);
const wantDeleteDrive = ref(false);
const isDeleting = ref(false);
const deletePasswordError = ref<string | null>(null);

// ── Country & holidays ───────────────────────────────────────────────────────
const { countryOptions } = useCountryOptions();
// Shown inside the Country & Holidays drawer when a holiday fetch has failed
// (transient network error with no cached fallback) — informative, with
// recovery direction. The store's online watcher retries automatically.
const showHolidayRetryHint = computed(() => !!settingsStore.country && holidayStore.loadFailed);

async function onPickCountry(value: string) {
  try {
    await settingsStore.setCountry((value || null) as CountryCode | null);
  } catch {
    // persistDualSetting already surfaced this (toast + console.error) and
    // re-threw so the picker can revert its visual state — nothing more to do.
  }
}

// ── Currency ─────────────────────────────────────────────────────────────────
const { currencyOptions } = useCurrencyOptions();

const currencySearch = ref('');

const searchResults = computed(() => {
  const q = currencySearch.value.toLowerCase().trim();
  if (!q) return [];
  const preferred = new Set(settingsStore.preferredCurrencies || []);
  return CURRENCIES.filter(
    (c) =>
      !preferred.has(c.code) &&
      (c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q))
  );
});

const preferredCount = computed(() => (settingsStore.preferredCurrencies || []).length);

function togglePreferredCurrency(code: string) {
  const current = settingsStore.preferredCurrencies || [];
  if (current.includes(code as any)) {
    settingsStore.setPreferredCurrencies(current.filter((c) => c !== code));
  } else {
    if (current.length >= 4) return;
    settingsStore.setPreferredCurrencies([...current, code as string]);
  }
}

// ── Theme / Toggles ──────────────────────────────────────────────────────────
const themeOptions = computed(() => [
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
  { value: 'system', label: t('settings.theme.system') },
]);

const textSizeOptions = computed(() => [
  { value: 'normal', label: t('settings.textSize.normal') },
  { value: 'large', label: t('settings.textSize.large') },
]);

const showRatesWarning = ref(false);
const pendingCurrency = ref<string | null>(null);
const isFetchingRates = ref(false);
const ratesFetchError = ref<string | null>(null);

async function updateCurrency(value: string | number) {
  const hasRates = settingsStore.exchangeRates && settingsStore.exchangeRates.length > 0;
  if (!hasRates && value !== settingsStore.baseCurrency) {
    pendingCurrency.value = value as string;
    ratesFetchError.value = null;
    showRatesWarning.value = true;
    return;
  }
  await settingsStore.setBaseCurrency(value as string);
}

async function handleFetchAndSwitch() {
  isFetchingRates.value = true;
  ratesFetchError.value = null;
  try {
    const { forceUpdateRates } = await import('@/services/exchangeRate');
    const result = await forceUpdateRates();
    if (result.success) {
      await settingsStore.loadGlobalSettings();
      await settingsStore.loadSettings();
      if (pendingCurrency.value) {
        await settingsStore.setBaseCurrency(pendingCurrency.value);
      }
      showRatesWarning.value = false;
      pendingCurrency.value = null;
    } else {
      ratesFetchError.value = result.error ?? t('settings.ratesFetchFailed');
    }
  } catch {
    ratesFetchError.value = t('settings.ratesFetchFailed');
  } finally {
    isFetchingRates.value = false;
  }
}

function handleSwitchWithoutRates() {
  if (pendingCurrency.value) {
    settingsStore.setBaseCurrency(pendingCurrency.value);
  }
  showRatesWarning.value = false;
  pendingCurrency.value = null;
}

async function updateTheme(value: string | number) {
  await settingsStore.setTheme(value as 'light' | 'dark' | 'system');
}

async function updateTextSize(value: string | number) {
  await settingsStore.setTextSize(value as 'normal' | 'large');
}

// ── Family Data handlers ─────────────────────────────────────────────────────

const isSwitchingAccount = ref(false);

async function handleSettingsReconnect() {
  // Pre-fill Google's chooser with the expected account when known so
  // multi-account users land on the right one by default.
  const success = await reconnect(syncStore.providerAccountEmail ?? undefined);
  if (success) await syncStore.handleGoogleReconnected();
}

/**
 * Switch the Google account this member is bound to. Forces a consent
 * screen so the user can pick a different account; the resulting email
 * is treated as the new ground truth and written to the member's
 * googleAccountEmail (via the assertion subscriber).
 *
 * Cancellation contract: if the user dismisses Google's chooser, we
 * disarm the pending-switch flag (so the next legitimate token
 * acquisition isn't silently overwritten) and stay on the previous
 * account. The IDB refresh token is preserved on entry — `forceConsent`
 * already wipes the in-memory tokens, which is enough to force the
 * chooser, while keeping the IDB token means file polling can silently
 * recover from any cancel without spamming the chooser on every tick.
 */
async function handleSwitchGoogleAccount() {
  isSwitchingAccount.value = true;
  const { armAccountSwitch, disarmAccountSwitch } =
    await import('@/services/auth/googleAccountAssertion');
  try {
    const { requestAccessToken, shouldUseRedirectAuth, startRedirectAuth } =
      await import('@/services/google/googleAuth');

    armAccountSwitch();

    if (shouldUseRedirectAuth()) {
      await startRedirectAuth(
        `${window.location.pathname}${window.location.search}`,
        undefined,
        'reconnect'
      );
      return; // page navigates away
    }
    await requestAccessToken({ forceConsent: true });
    await syncStore.handleGoogleReconnected();
  } catch (e) {
    // Cancellation is a deliberate user action — disarm the switch flag
    // so the next token acquisition isn't poisoned, then quietly return
    // without an error alert.
    disarmAccountSwitch();
    if (isUserCancellation(e)) {
      console.warn('[SettingsPage] switch-account cancelled by user');
      return;
    }
    console.warn('[SettingsPage] switch-account failed:', e);
    await showAlert({
      title: 'settings.familyData.switchAccount',
      message: 'settings.familyData.switchAccountFailed',
    });
  } finally {
    isSwitchingAccount.value = false;
  }
}

async function handleForceSave() {
  await syncStore.forceSyncNow();
}

async function handleResumeSetup() {
  showFamilyData.value = false;
  await router.push({ path: '/welcome', query: { resume: 'setup' } });
}

async function handleRequestPermission() {
  await syncStore.requestPermission();
}

// Move the pod's storage between local file and Google Drive. Owner-only
// (the action row is gated on `isOwner`). The store does the work + the
// failure telemetry; we render the user-facing toast here.
async function handleMigrateStorage() {
  const toDrive = syncStore.storageProviderType === 'local';
  const target: StorageProviderType = toDrive ? 'google_drive' : 'local';
  const ok = await confirm({
    variant: 'info', // Heritage Orange — routine action, not destructive
    title: toDrive
      ? 'settings.familyData.migrate.confirmTitleToDrive'
      : 'settings.familyData.migrate.confirmTitleToLocal',
    message: toDrive
      ? 'settings.familyData.migrate.confirmBodyToDrive'
      : 'settings.familyData.migrate.confirmBodyToLocal',
    confirmLabel: 'settings.familyData.migrate.confirmAction',
  });
  if (!ok) return;

  const source = syncStore.fileName ?? '';
  const result = await syncStore.migrateStorage(target);
  switch (result.outcome) {
    case 'success':
      showToast(
        'success',
        t('settings.familyData.migrate.successTitle'),
        t('settings.familyData.migrate.successBody')
          .replace('{source}', source)
          .replace('{dest}', result.dest)
      );
      break;
    case 'cancelled':
      showToast(
        'info',
        t('settings.familyData.migrate.cancelledTitle'),
        t('settings.familyData.migrate.cancelledBody').replace('{source}', source)
      );
      break;
    case 'failed':
      // `silent` — migrateStorage already reported this to #beanies-errors
      // with full from/to/step context; let the toast double-ping and you
      // get two alerts for one failure.
      showToast(
        'error',
        t('settings.familyData.migrate.failedTitle'),
        t('settings.familyData.migrate.failedBody')
          .replace('{reason}', result.reason)
          .replace('{source}', source),
        { silent: true }
      );
      break;
    case 'recovery-needed':
      showToast(
        'error',
        t('settings.familyData.migrate.recoveryNeededTitle'),
        t('settings.familyData.migrate.recoveryNeededBody'),
        { silent: true }
      );
      break;
  }
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

function handleExportAsJson() {
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
    'vacations',
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of collections) {
    data[key] = projectionList(key);
  }
  data.settings = getProjectionSettings();

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

function resetDeleteFamilyState() {
  deleteConfirmText.value = '';
  wantExport.value = false;
  wantDeleteDrive.value = false;
  isDeleting.value = false;
  deletePasswordError.value = null;
}

function handleDeleteFamilyConfirmClose() {
  showDeleteFamilyConfirm.value = false;
  resetDeleteFamilyState();
}

function handleDeleteFamilyClick() {
  showDeleteFamilyConfirm.value = false;
  showDeleteFamilyPassword.value = true;
}

async function handleDeleteFamilyPasswordConfirm(password: string) {
  const familyContextStore = useFamilyContextStore();
  const familyId = familyContextStore.activeFamilyId;
  if (!familyId) return;

  // Verify password against the envelope
  const envelope = syncStore.envelope;
  if (envelope) {
    try {
      await tryUnwrapFamilyKey(envelope, password);
    } catch {
      deletePasswordError.value = t('password.incorrect');
      return;
    }
  }

  deletePasswordError.value = null;
  showDeleteFamilyPassword.value = false;
  isDeleting.value = true;

  try {
    // 1. Export if requested
    if (wantExport.value) {
      handleExportAsJson();
    }

    // 2. Delete Drive file if requested
    if (wantDeleteDrive.value) {
      try {
        const config = await getProviderConfig(familyId);
        if (config?.type === 'google_drive' && config.driveFileId) {
          const token = await getValidToken();
          await deleteFile(token, config.driveFileId);
        }
      } catch (e) {
        console.warn('[deleteFamily] Drive file deletion failed, continuing:', e);
      }
    }

    // 3. Delete local family (IndexedDB, passkeys, file handles, registry, etc.)
    await familyContextStore.deleteLocalFamily(familyId);

    // 4. Auth teardown
    await authStore.signOutAndClearData();

    // 5. Reset all Pinia stores
    resetAllAppStores();

    // 6. Track deletion
    window.plausible?.('family_deleted');

    // 7. Farewell
    await showAlert({
      title: 'settings.deleteFamilyFarewellTitle',
      message: 'settings.deleteFamilyFarewellMsg',
    });

    // 7. Redirect
    router.replace('/welcome');
  } catch (e) {
    console.error('[deleteFamily] Deletion failed:', e);
    isDeleting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- ── Profile Header ──────────────────────────────────────────────── -->
    <ProfileHeader />

    <!-- ── Settings Card Grid ──────────────────────────────────────────── -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <!-- Your Account first — most common self-serve action (password,
           passkeys, sign-out). Moved out of "Security & Privacy" so the
           change-password path is discoverable in two clicks. -->
      <SettingsCard
        icon="👤"
        :title="t('settings.card.account')"
        :description="t('settings.card.accountDesc')"
        icon-bg="var(--tint-orange-8)"
        @click="showAccount = true"
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
        icon="🌍"
        :title="t('settings.card.countryHolidays')"
        :description="t('settings.card.countryHolidaysDesc')"
        icon-bg="var(--tint-silk-20)"
        @click="showCountryHolidays = true"
      />
      <SettingsCard
        v-if="calendarAvailable"
        icon="📅"
        :title="t('settings.card.calendarSync')"
        :description="t('settings.card.calendarSyncDesc')"
        icon-bg="var(--tint-silk-20)"
        @click="showCalendarSync = true"
      />
      <SettingsCard
        v-if="canManagePod"
        icon="📤"
        :title="t('settings.card.dataManagement')"
        :description="t('settings.card.dataManagementDesc')"
        icon-bg="var(--tint-slate-05)"
        @click="showDataManagement = true"
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
        icon="👨‍👩‍👧"
        :title="t('settings.card.familyMembers')"
        :description="t('settings.card.familyMembersDesc')"
        icon-bg="var(--tint-orange-8)"
        @click="router.push('/family')"
      />
      <SettingsCard
        icon="🔒"
        :title="t('settings.card.security')"
        :description="t('settings.card.securityDesc')"
        icon-bg="var(--tint-orange-8)"
        @click="showSecurity = true"
      />
      <SettingsCard
        icon="💬"
        :title="t('settings.card.community')"
        :description="t('settings.card.communityDesc')"
        icon-bg="var(--tint-silk-20)"
        @click="openDiscord('settings')"
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
        <SettingToggleRow
          divider
          :title="t('settings.darkMode')"
          :hint="t('settings.darkModeDescription')"
          :model-value="settingsStore.theme === 'dark'"
          @update:model-value="settingsStore.setTheme($event ? 'dark' : 'light')"
        />
        <SettingToggleRow
          divider
          testid="beanie-mode-toggle"
          :title="t('settings.beanieMode')"
          :hint="t('settings.beanieModeDescription')"
          :model-value="settingsStore.beanieMode"
          :disabled="!translationStore.isEnglish"
          @update:model-value="settingsStore.setBeanieMode($event)"
        >
          <p
            v-if="!translationStore.isEnglish"
            class="text-[0.65rem] text-amber-600 dark:text-amber-400"
          >
            {{ t('settings.beanieModeDisabled') }}
          </p>
        </SettingToggleRow>
        <SettingToggleRow
          divider
          testid="sound-toggle"
          :title="t('settings.soundEffects')"
          :hint="t('settings.soundEffectsDescription')"
          :model-value="settingsStore.soundEnabled"
          @update:model-value="settingsStore.setSoundEnabled($event)"
        />
        <!-- (#133) The "ask before reading photos" consent toggle now lives in the
             flag-gated beanies AI settings card (AiSettings.vue), consolidating the
             whole AI surface in one place. -->
        <!-- Daily Tips — one bell entry per day; mute keeps existing tips
             readable, just stops new ones (see TipBody/useBeanTips). -->
        <SettingToggleRow
          testid="daily-tips-toggle"
          :title="t('settings.dailyTips')"
          :hint="t('settings.dailyTipsDescription')"
          :model-value="beanTips.tipsEnabled.value"
          @update:model-value="(v) => (v ? beanTips.enableTips() : beanTips.muteAllTips())"
        />
      </div>
    </div>

    <!-- ── The Beanie Lab (per-device opt-in to experimental features) ──────
         Quiet + collapsed by default; houses the beanies AI and Google Calendar
         surfaces, revealed only when the user opts in. Mount-gated on
         hasAnyLabFeature so the section disappears (no empty header/glyph/toggle)
         when zero Lab features are available — the Lab stays conceptually
         permanent, this is just a display-time emptiness guard (#35). -->
    <BeanieLabSection v-if="hasAnyLabFeature" @open-ai="showAi = true" />

    <!-- ── Feature Flags (dev-only, owner/admin) ───────────────────────────
         DevFlagsCard is undefined in prod (DEV-gated dynamic import above), so
         this renders nothing and ships no flag-editing code to users. -->
    <component :is="DevFlagsCard" v-if="DevFlagsCard && (isOwner || canManagePod)" />

    <!-- ── About Footer ────────────────────────────────────────────────── -->
    <div class="px-2 pb-4 text-center text-xs text-slate-400 dark:text-slate-500">
      <p>
        <span class="opacity-60">🫘</span>
        <strong class="text-slate-500 dark:text-slate-400">{{ t('settings.appName') }}</strong>
        · {{ fullVersionLabel }}
      </p>
      <p class="mt-1"><span class="opacity-60">🔒</span> {{ t('settings.privacyNote') }}</p>
      <p class="mt-1">
        <span class="opacity-60">{{ deploymentBadge.icon }}</span>
        {{ t(deploymentBadge.labelKey) }}
        <a
          v-if="deploymentBadge.docsUrl"
          :href="deploymentBadge.docsUrl"
          target="_blank"
          rel="noopener"
          class="ml-1 underline-offset-2 hover:underline"
          >{{ t('selfHost.learnMore') }}</a
        >
      </p>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!-- ── MODALS ────────────────────────────────────────────────────── -->
    <!-- ══════════════════════════════════════════════════════════════════ -->

    <!-- ── beanies AI drawer (Beanie Lab surface) ─────────────────────────
         Mount-gated on aiVisible so it can never open while the Lab is off. -->
    <AiSettings v-if="aiVisible" :open="showAi" @close="showAi = false" />
    <!-- ── Google Calendar drawer (official) — gated on the googleCalendarSync
         flag (kill-switch), independent of the Lab. -->
    <CalendarSyncSettings
      v-if="calendarAvailable"
      :open="showCalendarSync"
      @close="showCalendarSync = false"
    />

    <!-- ── Exchange Rates Warning Modal ─────────────────────────────────── -->
    <BaseModal :open="showRatesWarning" size="sm" layer="overlay" @close="showRatesWarning = false">
      <div class="p-5">
        <div class="mb-3 flex items-center gap-2">
          <svg
            class="h-5 w-5 flex-shrink-0 text-amber-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
            {{ t('settings.baseCurrency') }}
          </h3>
        </div>
        <p class="mb-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {{ t('settings.noRatesWarning') }}
        </p>
        <div
          v-if="ratesFetchError"
          class="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          {{ ratesFetchError }}
        </div>
        <div class="flex gap-2">
          <BaseButton
            class="flex-1"
            size="sm"
            :loading="isFetchingRates"
            @click="handleFetchAndSwitch"
          >
            {{ t('settings.fetchRatesNow') }}
          </BaseButton>
          <BaseButton
            variant="ghost"
            size="sm"
            class="flex-1"
            :disabled="isFetchingRates"
            @click="handleSwitchWithoutRates"
          >
            {{ t('settings.switchAnyway') }}
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- ── Appearance Modal ────────────────────────────────────────────── -->
    <BeanieFormModal
      variant="drawer"
      :open="showAppearance"
      :title="t('settings.card.appearance')"
      icon="🎨"
      icon-bg="var(--tint-slate-05)"
      :save-label="t('action.close')"
      @close="showAppearance = false"
      @save="showAppearance = false"
    >
      <BaseSelect
        :model-value="settingsStore.theme"
        :options="themeOptions"
        :label="t('settings.theme')"
        :hint="t('settings.themeHint')"
        @update:model-value="updateTheme"
      />

      <BaseSelect
        :model-value="settingsStore.textSize"
        :options="textSizeOptions"
        :label="t('settings.textSize')"
        :hint="t('settings.textSizeHint')"
        @update:model-value="updateTextSize"
      />

      <BaseSelect
        :model-value="String(settingsStore.weekStartDay)"
        :options="[
          { value: '1', label: t('settings.weekStart.monday') },
          { value: '0', label: t('settings.weekStart.sunday') },
        ]"
        :label="t('settings.weekStart')"
        :hint="t('settings.weekStartHint')"
        :disabled="!canManagePod"
        @update:model-value="settingsStore.setWeekStartDay(Number($event) as 0 | 1)"
      />
      <!-- Week-start is family-shared config (unlike theme/text-size above) — admins only. -->
      <SettingsAdminOnlyNotice v-if="!canManagePod" />
    </BeanieFormModal>

    <!-- ── Currency & Rates Modal ──────────────────────────────────────── -->
    <BeanieFormModal
      variant="drawer"
      :open="showCurrency"
      :title="t('settings.card.currency')"
      icon="💱"
      icon-bg="var(--tint-silk-20)"
      size="wide"
      :save-label="t('action.close')"
      @close="showCurrency = false"
      @save="showCurrency = false"
    >
      <SettingsAdminOnlyNotice v-if="!canManagePod" class="mb-1" />

      <BaseSelect
        :model-value="settingsStore.baseCurrency"
        :options="currencyOptions"
        :label="t('settings.baseCurrency')"
        :hint="t('settings.baseCurrencyHint')"
        :disabled="!canManagePod"
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

        <!-- Selected currency chips -->
        <div v-if="preferredCount > 0" class="mb-3 flex flex-wrap gap-1.5">
          <span
            v-for="code in settingsStore.preferredCurrencies"
            :key="code"
            class="font-outfit inline-flex items-center gap-1.5 rounded-full border-2 border-[#F15D22] bg-[rgba(241,93,34,0.08)] px-3 py-1.5 text-xs font-semibold text-[#F15D22] dark:bg-[rgba(241,93,34,0.15)]"
          >
            <span class="text-sm leading-none">{{ getCurrencyInfo(code)?.symbol }}</span>
            {{ code }}
            <button
              type="button"
              :disabled="!canManagePod"
              class="ml-0.5 cursor-pointer opacity-60 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
              @click="togglePreferredCurrency(code)"
            >
              &times;
            </button>
          </span>
        </div>

        <!-- Search to add — admins only (read-only members still see the chips above) -->
        <div v-if="canManagePod && preferredCount < 4" class="relative">
          <input
            v-model="currencySearch"
            type="text"
            class="font-outfit w-full rounded-xl border border-gray-200 bg-white py-2 pr-3 pl-9 text-sm text-gray-700 placeholder-gray-400 transition-colors outline-none focus:border-[#F15D22]/40 focus:ring-2 focus:ring-[#F15D22]/10 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-200 dark:placeholder-gray-500"
            :placeholder="t('settings.searchCurrencies')"
          />
          <svg
            class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>

          <!-- Search results dropdown -->
          <div
            v-if="currencySearch.trim().length > 0 && searchResults.length > 0"
            class="absolute top-full left-0 z-10 mt-1.5 max-h-[200px] w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-700"
          >
            <button
              v-for="curr in searchResults"
              :key="curr.code"
              type="button"
              class="font-outfit flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[rgba(241,93,34,0.04)] dark:hover:bg-slate-600"
              @click="
                togglePreferredCurrency(curr.code);
                currencySearch = '';
              "
            >
              <span
                class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-base dark:bg-slate-600"
              >
                {{ curr.symbol }}
              </span>
              <div>
                <span class="font-semibold text-gray-800 dark:text-gray-100">{{ curr.code }}</span>
                <span class="ml-1.5 text-gray-400 dark:text-gray-400">{{ curr.name }}</span>
              </div>
            </button>
          </div>

          <!-- No results -->
          <div
            v-if="currencySearch.trim().length > 0 && searchResults.length === 0"
            class="absolute top-full left-0 z-10 mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-4 text-center shadow-lg dark:border-slate-600 dark:bg-slate-700"
          >
            <p class="text-xs text-gray-400 dark:text-gray-500">{{ t('empty.noResults') }}</p>
          </div>
        </div>

        <!-- Selection count -->
        <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
          {{ t('settings.preferredSelectedCount').replace('{count}', String(preferredCount)) }}
        </p>
      </div>

      <!-- Exchange Rates (inline, no BaseCard wrapper) -->
      <div class="border-t border-gray-200 pt-4 dark:border-slate-700">
        <ExchangeRateSettings :standalone="false" :read-only="!canManagePod" />
      </div>
    </BeanieFormModal>

    <!-- ── Country & Holidays Modal ────────────────────────────────────── -->
    <BeanieFormModal
      variant="drawer"
      :open="showCountryHolidays"
      :title="t('settings.card.countryHolidays')"
      icon="🌍"
      icon-bg="var(--tint-silk-20)"
      :save-label="t('action.close')"
      @close="showCountryHolidays = false"
      @save="showCountryHolidays = false"
    >
      <SettingsAdminOnlyNotice v-if="!canManagePod" class="mb-1" />

      <BaseCombobox
        :model-value="settingsStore.country ?? ''"
        :options="countryOptions"
        :label="t('settings.country')"
        :hint="t('settings.countryHelp')"
        :placeholder="t('settings.countryNotSet')"
        :search-placeholder="t('settings.country')"
        :disabled="!canManagePod"
        @update:model-value="onPickCountry"
      />

      <p v-if="showHolidayRetryHint" class="text-secondary-500/70 text-xs dark:text-gray-400">
        {{ t('holiday.loadFailedRetryHint') }}
      </p>

      <!-- Show / hide public holidays on the planner -->
      <div
        class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-slate-700"
      >
        <div>
          <p class="font-medium text-gray-900 dark:text-gray-100">
            {{ t('settings.showPublicHolidays') }}
          </p>
          <p v-if="!settingsStore.country" class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('settings.showPublicHolidaysNeedsCountry') }}
          </p>
        </div>
        <ToggleSwitch
          :model-value="settingsStore.showPublicHolidays"
          :disabled="!settingsStore.country || !canManagePod"
          @update:model-value="settingsStore.setShowPublicHolidays($event)"
        />
      </div>
    </BeanieFormModal>

    <!-- ── Your Account Modal ─────────────────────────────────────────────
         The "this is me" surface: password, passkeys, sign-out lives.
         Separated from Security & Privacy (which is system-level: encryption,
         device trust) so the change-password path is two clicks deep.
    ────────────────────────────────────────────────────────────────────── -->
    <BeanieFormModal
      v-if="authStore.isAuthenticated"
      variant="drawer"
      :open="showAccount"
      :title="t('settings.accountModal.title')"
      icon="👤"
      icon-bg="var(--tint-orange-8)"
      size="wide"
      :save-label="t('action.close')"
      @close="showAccount = false"
      @save="showAccount = false"
    >
      <ChangePasswordSettings />
      <PasskeySettings class="mt-4" />
    </BeanieFormModal>

    <!-- ── Security & Privacy Modal ──────────────────────────────────────
         System-level controls only (trusted device + future advanced
         toggles). Self-serve account actions moved to Your Account above.
    ────────────────────────────────────────────────────────────────────── -->
    <BeanieFormModal
      v-if="authStore.isAuthenticated"
      variant="drawer"
      :open="showSecurity"
      :title="t('settings.card.security')"
      icon="🔒"
      icon-bg="var(--tint-orange-8)"
      size="wide"
      :save-label="t('action.close')"
      @close="showSecurity = false"
      @save="showSecurity = false"
    >
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
    </BeanieFormModal>

    <!-- ── Family Data Modal ───────────────────────────────────────────── -->
    <BeanieFormModal
      v-if="canManagePod"
      variant="drawer"
      :open="showFamilyData"
      :title="t('settings.familyDataOptions')"
      icon="💾"
      icon-bg="var(--tint-silk-20)"
      size="wide"
      :save-label="t('action.close')"
      @close="showFamilyData = false"
      @save="showFamilyData = false"
    >
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
            <BaseButton @click="handleResumeSetup">
              {{ t('settings.resumeSetup') }}
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

            <!-- Signed-in Google account + switch -->
            <div
              v-if="syncStore.isGoogleDriveConnected && syncStore.providerAccountEmail"
              class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {{ t('settings.familyData.signedInAs') }}
                </p>
                <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ syncStore.providerAccountEmail }}
                </p>
              </div>
              <BaseButton
                variant="secondary"
                size="sm"
                :loading="isSwitchingAccount"
                @click="handleSwitchGoogleAccount"
              >
                {{ t('settings.familyData.switchAccount') }}
              </BaseButton>
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

            <!-- Move storage (owner only; "Move to Google Drive" is hidden on
                 iOS / PWAs where the OAuth would hit the fragile popup path) -->
            <div
              v-if="
                isOwner && !(syncStore.storageProviderType === 'local' && isRedirectAuthBrowser)
              "
              class="flex items-center justify-between border-b border-gray-200 py-3 dark:border-slate-700"
            >
              <div>
                <p class="font-medium text-gray-900 dark:text-gray-100">
                  {{
                    syncStore.storageProviderType === 'local'
                      ? t('settings.familyData.migrate.moveToGoogleDrive')
                      : t('settings.familyData.migrate.moveToLocalFile')
                  }}
                </p>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {{
                    syncStore.storageProviderType === 'local'
                      ? t('settings.familyData.migrate.moveToGoogleDriveDesc')
                      : t('settings.familyData.migrate.moveToLocalFileDesc')
                  }}
                </p>
              </div>
              <BaseButton
                variant="secondary"
                size="sm"
                :loading="syncStore.isMigratingStorage"
                @click="handleMigrateStorage"
              >
                {{ t('action.move') }}
              </BaseButton>
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
              <p v-if="reconnectError" class="mt-2 text-xs text-amber-700 dark:text-amber-400">
                {{ t('googleDrive.reconnectFailed') }}: {{ reconnectError }}
              </p>
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
            <div v-if="importSuccess" class="mt-4 rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
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

      <!-- ── Pod Ownership ───────────────────────────────────────────────
           Owner-only. Rare action (once-per-pod-lifetime), so it lives
           inside Family Data rather than getting its own Settings tile.
           Members never see this section at all. -->
      <div v-if="isOwner" class="mt-6 border-t border-gray-200 pt-4 dark:border-slate-700">
        <h3 class="font-outfit mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          👑 {{ t('settings.podOwnershipSection') }}
        </h3>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.currentOwner') }}
            </p>
            <p class="truncate font-medium text-gray-900 dark:text-gray-100">
              {{ currentOwnerName ?? '—' }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.transferOwnershipDesc') }}
            </p>
          </div>
          <BaseButton
            variant="secondary"
            size="sm"
            class="flex-shrink-0"
            @click="showTransferOwnership = true"
          >
            {{ t('settings.transferOwnershipAction') }}
          </BaseButton>
        </div>
      </div>

      <!-- ── Restart Onboarding ──────────────────────────────────────────
           Lives in Family Data so it doesn't crowd the Appearance drawer
           with a one-off action. Visible to anyone who can manage the pod
           (the drawer's own v-if). -->
      <div class="mt-6 border-t border-gray-200 pt-4 dark:border-slate-700">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="font-medium text-gray-900 dark:text-gray-100">
              {{ t('onboarding.restartOnboarding') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('onboarding.restartOnboardingDescription') }}
            </p>
          </div>
          <BaseButton
            variant="secondary"
            size="sm"
            class="flex-shrink-0"
            data-testid="restart-onboarding"
            @click="
              settingsStore.setOnboardingCompleted(false).then(() => {
                showFamilyData = false;
                router.push('/nook');
              })
            "
          >
            {{ t('onboarding.restartButton') }}
          </BaseButton>
        </div>
      </div>
    </BeanieFormModal>

    <!-- ── Data Management Modal ───────────────────────────────────────── -->
    <BeanieFormModal
      v-if="canManagePod"
      variant="drawer"
      :open="showDataManagement"
      :title="t('settings.dataManagement')"
      icon="📤"
      icon-bg="var(--tint-slate-05)"
      :save-label="t('action.close')"
      @close="showDataManagement = false"
      @save="showDataManagement = false"
    >
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

      <!-- ── Danger Zone: Delete Family ──────────────────────────────── -->
      <div class="mt-6 rounded-lg border-2 border-[#F15D22]/40 p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100">
              {{ t('settings.deleteFamily') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.deleteFamilyDesc') }}
            </p>
          </div>
          <BaseButton variant="danger" size="sm" @click="showDeleteFamilyConfirm = true">
            {{ t('settings.deleteFamily') }}
          </BaseButton>
        </div>
      </div>
    </BeanieFormModal>

    <!-- ── Delete Family Confirmation Drawer ───────────────────────────── -->
    <BeanieFormModal
      variant="drawer"
      :open="showDeleteFamilyConfirm"
      :title="t('settings.deleteFamily')"
      icon="⚠️"
      icon-bg="var(--color-heritage-orange)"
      :save-label="t('action.close')"
      @close="handleDeleteFamilyConfirmClose"
      @save="handleDeleteFamilyConfirmClose"
    >
      <div class="space-y-4">
        <div class="rounded-lg bg-[#F15D22]/10 p-4">
          <p class="text-sm text-gray-800 dark:text-gray-200">
            {{ t('settings.deleteFamilyWarning') }}
          </p>
        </div>

        <label class="flex cursor-pointer items-start gap-3">
          <input
            v-model="wantExport"
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#F15D22] focus:ring-[#F15D22]"
          />
          <span class="text-sm text-gray-700 dark:text-gray-300">
            {{ t('settings.deleteFamilyExport') }}
          </span>
        </label>

        <label
          v-if="syncStore.isGoogleDriveConnected"
          class="flex cursor-pointer items-start gap-3"
        >
          <input
            v-model="wantDeleteDrive"
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#F15D22] focus:ring-[#F15D22]"
          />
          <span class="text-sm text-gray-700 dark:text-gray-300">
            {{ t('settings.deleteFamilyDriveDelete') }}
          </span>
        </label>

        <div>
          <BaseInput
            v-model="deleteConfirmText"
            :label="t('settings.deleteFamilyTypeConfirm')"
            placeholder="delete"
            autocomplete="off"
          />
        </div>

        <BaseButton
          variant="danger"
          class="w-full"
          :disabled="deleteConfirmText.toLowerCase() !== 'delete' || isDeleting"
          @click="handleDeleteFamilyClick"
        >
          {{ t('settings.deleteFamily') }}
        </BaseButton>
      </div>
    </BeanieFormModal>

    <!-- ── Delete Family Password Gate ─────────────────────────────────── -->
    <PasswordModal
      :open="showDeleteFamilyPassword"
      :title="t('settings.deleteFamily')"
      :description="t('settings.deleteFamilyAuthDesc')"
      :confirm-label="t('settings.deleteFamily')"
      :external-error="deletePasswordError"
      @close="
        showDeleteFamilyPassword = false;
        deletePasswordError = null;
      "
      @confirm="handleDeleteFamilyPasswordConfirm"
    />

    <!-- ── Decrypt File Password Modal ─────────────────────────────────── -->
    <PasswordModal
      :open="showDecryptFileModal"
      :title="t('password.enterPassword')"
      :description="t('password.enterPasswordDescription')"
      :confirm-label="t('password.decryptAndLoad')"
      @close="handleDecryptModalClose"
      @confirm="handleDecryptFile"
    />

    <!-- ── Transfer Ownership ──────────────────────────────────────────── -->
    <TransferOwnershipModal :open="showTransferOwnership" @close="showTransferOwnership = false" />

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
