<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue';
import PasswordModal from '@/components/common/PasswordModal.vue';
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings.vue';
import SettingsAdminOnlyNotice from '@/components/settings/SettingsAdminOnlyNotice.vue';
import PasskeySettings from '@/components/settings/PasskeySettings.vue';
import PinSettings from '@/components/settings/PinSettings.vue';
import RecoverySettings from '@/components/settings/RecoverySettings.vue';
import DeviceLinkCard from '@/components/settings/DeviceLinkCard.vue';
import WallSetupCard from '@/components/settings/WallSetupCard.vue';
import GoogleDisconnectCard from '@/components/settings/GoogleDisconnectCard.vue';
import ChangePasswordSettings from '@/components/settings/ChangePasswordSettings.vue';
import ProfileHeader from '@/components/settings/ProfileHeader.vue';
import SettingsCard from '@/components/settings/SettingsCard.vue';
import { openDiscord } from '@/utils/discord';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import AiSettings from '@/components/settings/AiSettings.vue';
import CalendarSyncSettings from '@/components/settings/CalendarSyncSettings.vue';
import BeanieLabSection from '@/components/settings/BeanieLabSection.vue';
import RemindersSettings from '@/components/settings/RemindersSettings.vue';
import BeanieBellIcon from '@/components/ui/BeanieBellIcon.vue';
import { useBeanieLab } from '@/composables/useBeanieLab';
import { isFlagEnabled } from '@/config/flags';
import { CALENDAR_SYNC_OPEN, REMINDERS_OPEN } from '@/constants/settingsDeepLinks';
import TransferOwnershipModal from '@/components/family/TransferOwnershipModal.vue';
import { BaseSelect, BaseButton, BaseInput } from '@/components/ui';
import BaseModal from '@/components/ui/BaseModal.vue';
import * as syncService from '@/services/sync/syncService';
import { getAuxStore } from '@/services/sync/storageProvider';
import { safetyCopyName } from '@/constants/compaction';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';

import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { getFullVersionLabel } from '@/utils/diagnosticContext';
import { alert as showAlert, confirm } from '@/composables/useConfirm';
import { usePodExport } from '@/composables/usePodExport';
import { usePodCompaction } from '@/composables/usePodCompaction';
import { usePodHealth } from '@/composables/usePodHealth';
import { showToast } from '@/composables/useToast';
import { requireReauth, canStepUp } from '@/composables/useReauth';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
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
import { COLLECTION_NAMES } from '@/types/automerge';
import { payloadErrorMessageKey } from '@/types/sync';
import { reportPayloadFailure } from '@/utils/payloadFailureSurface';
import { deleteFamilyDatabase } from '@/services/indexeddb/database';
import { tryUnwrapFamilyKey } from '@/services/sync/fileSync';
import { deliverFile } from '@/utils/deliverFile';
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
import { track } from '@/services/analytics/plausible';

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
// The beanie wall's only entry point. Flag-gated, so it is invisible until
// `beanieWall` is on; the card itself gates entry on the member having a PIN.
const showWallCard = computed(() => isFlagEnabled('beanieWall'));

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
const showReminders = ref(false);
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
  [REMINDERS_OPEN]: () => {
    showReminders.value = true;
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

/**
 * Recover an established owner's lost Drive data-file connection: re-derive the
 * provider config from the durable registry (silent), and if that can't fully
 * restore (token/registry unavailable), fall through to the interactive
 * resume-setup recovery. Replaces the dead "resume setup" button for a
 * `podCreated` owner (which the router bounces to /nook).
 */
async function handleDriveReconnect() {
  const familyId = useFamilyContextStore().activeFamilyId;
  if (!familyId) return;
  logEvent({
    level: 'info',
    surface: 'settings-drive-reconnect',
    message: 'user-initiated reconnect from unconfigured card',
    context: { action: 'unconfigured-card' },
  });
  await syncStore.attemptSilentConfigHeal(familyId);
  if (!syncStore.isConfigured) {
    // Silent heal couldn't complete (token/registry) — hand to the interactive
    // registry-resume recovery (fetch envelope + password).
    showFamilyData.value = false;
    await router.push({ path: '/welcome', query: { resume: 'setup' } });
  }
}

async function handleRequestPermission() {
  const result = await syncStore.requestPermission();
  // Clear first: this ref is also the "Encryption Error" panel's visibility, and
  // an early return on success left a stale red panel pinned to the corner for
  // the rest of the session.
  encryptionError.value = null;
  if (!result.payloadError) return;
  // A WARM surface: the app is painting real data behind this button, so the
  // full-screen recovery overlay would be the wrong shape entirely. A TOAST,
  // not `encryptionError` — that slot renders a hard-coded "Encryption Error"
  // heading in Alert Red, and telling a user their data is damaged in red is
  // the exact defect this whole change exists to remove (and the CIG reserves
  // red for destructive confirmations and hard validation errors).
  showToast('warning', t(payloadErrorMessageKey(result.payloadError)), undefined, {
    surface: 'pod-load-failure',
  });
  // Settings had no payload reporter at all, so the corrupt half here reached
  // CloudWatch with zero events.
  reportPayloadFailure(result.payloadError, {
    source: 'reload',
    fileId: syncStore.driveFileId ?? null,
    familyId: useFamilyContextStore().activeFamilyId,
  });
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

  // ⚠️ THE ONE CONFIRMED SITE. Both buttons that reach here go through
  // `handleLoadFromFileClick` → a dialog that says "This will replace all local
  // data with the contents of the selected file". That is what authorises the
  // `user-file` lineage context, and it is passed from here rather than stored,
  // so no other flow can inherit it.
  const result = await syncStore.decryptPendingFile(password, { userChoseThisFile: true });

  isProcessingEncryption.value = false;

  if (result.success) {
    showDecryptFileModal.value = false;
    importSuccess.value = true;
    setTimeout(() => {
      importSuccess.value = false;
    }, 3000);
  } else if (result.payloadError) {
    // A memory limit or a damaged payload, not a wrong password. Re-prompting
    // would loop. Same classification the login and join flows use.
    encryptionError.value = t(result.payloadError.inlineMessageKey);
  } else {
    // `result.error` is a developer-facing string (it can be a raw exception
    // message), so it is not rendered here: a non-English user would get a
    // wall of English. The one case worth distinguishing is a wrong password,
    // which `decryptPendingFile` reports by that exact literal.
    encryptionError.value = t(
      result.error === 'Incorrect password' ? 'password.decryptionError' : 'settings.decryptFailed'
    );
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
/**
 * In-flight guards for the two export buttons.
 *
 * Every other delivery call site already has one (`isExportingPdf`,
 * `exportingFormat`, `isSaving`, `isDeleting`); these two did not, and on
 * native the prepare phase is now multi-second. The seam serialises concurrent
 * native deliveries so a double-tap can no longer corrupt one, but queuing two
 * share sheets for one tap-tap is still wrong — so the button says busy.
 */
// The busy flag now lives with the export logic; aliased so the two template
// bindings keep reading the same name.
const { isExporting: isExportingBeanpod, exportEncryptedPod, confirmBackupLanded } = usePodExport();
const { busy: isCompacting, compact: compactPod } = usePodCompaction();
const { canCompactPod, compactionIsDue, someoneCannotOpenIt } = usePodHealth();
/**
 * Does this family's storage keep the automatic copy beside the pod?
 *
 * Only a provider with a full aux store can (Drive today); a local-file or
 * native family gets the manual export gate alone. The note has to say which,
 * or a family consents to a one-way migration on a guarantee the code did not
 * give them.
 */
const podKeepsSiblingCopy = computed(() => {
  // ⚠️ READ THE REACTIVE REF FIRST. `syncService.getProvider()` is plain module
  // state, so a computed over it alone has NO dependency: Vue evaluates it once
  // and never again. Moving a family Drive → local left the note still
  // promising a copy beside the pod that a local provider cannot write — the
  // family consenting to a one-way migration on a guarantee the code had
  // stopped giving. `storageProviderType` changes on every provider swap.
  // Read into a value the result actually depends on, rather than `void`-ing
  // it: a bare expression statement reads as dead code, and a terser build with
  // `pure_getters` would drop it and silently freeze this computed again.
  const providerType = syncStore.storageProviderType;
  const provider = syncService.getProvider();
  return !!providerType && !!provider && !!getAuxStore(provider);
});
const isExportingJson = ref(false);

async function handleManualExport() {
  // The body moved to `usePodExport` so the compaction flow shares this exact
  // gate rather than a second copy of it.
  await exportEncryptedPod();
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

/**
 * Build the readable-JSON export. Pure — no I/O, no delivery — so it is unit
 * testable without a DOM and so the delivery policy lives in exactly one place.
 */
function buildReadableExportJson(): { json: string; filename: string } {
  // Derived from `COLLECTION_NAMES`, never hand-listed — the same rule
  // `dataBridge.ts` states for the same reason. The hand-written list this
  // replaces held 10 of 29 collections, so the cookbook, medications,
  // allergies, milestones, photos, lists and emergency contacts were all
  // missing. That was survivable while this was merely "Export as JSON"; it is
  // not survivable now the same function is the backup that authorises
  // deleting the family. `COLLECTION_NAME_SEED` is `Record<CollectionName, 0>`,
  // so a new collection is exported the moment it exists or the build fails.
  const data: Record<string, unknown> = {};
  for (const key of COLLECTION_NAMES) {
    data[key] = projectionList(key);
  }
  data.settings = getProjectionSettings();

  const date = new Date().toISOString().split('T')[0];
  return {
    json: JSON.stringify(data, null, 2),
    filename: `beanies-export-${date}.json`,
  };
}

/**
 * Deliver the readable-JSON export. Returns whether a file actually landed, so
 * the delete-family gate can refuse to destroy anything when it did not.
 */
async function exportReadableJson(opts?: {
  errorUi?: 'toast' | 'caller';
  critical?: boolean;
}): Promise<boolean> {
  const { json, filename } = buildReadableExportJson();
  const result = await deliverFile({
    blob: new Blob([json], { type: 'application/json' }),
    filename,
    mimeType: 'application/json',
    title: t('settings.exportAsJson'),
    kind: 'readable-json',
    // A save, not a share — see the note in `handleManualExport`. It also keeps
    // the delete-family gate off `navigator.share`, which needs transient
    // activation that a large `JSON.stringify` can outlive.
    preferDownload: true,
    errorUi: opts?.errorUi,
    critical: opts?.critical,
  });
  return result.delivered;
}

/**
 * Template handler. MUST take zero parameters — it is bound directly to
 * `@click`, so any parameter would receive a `PointerEvent`.
 */
function handleExportAsJson(): void {
  // `void` with no catch was an unhandled rejection waiting to happen:
  // `JSON.stringify` throws `RangeError` on a very large family, and
  // `deliverFile` touches the translation store on its failure branch. Either
  // one left the button doing nothing, with no toast and nothing reported —
  // which is precisely the class of silent failure this work exists to close.
  // Its twin, `handleManualExport`, has always been wrapped.
  if (isExportingJson.value) return;
  isExportingJson.value = true;
  exportReadableJson()
    .catch((e: unknown) => {
      showToast('error', t('fileDelivery.failed'), t('fileDelivery.failedHelp'), {
        surface: 'file-delivery',
        error: e,
        context: { action: 'delivery-failed', kind: 'readable-json', stage: 'source' },
      });
    })
    .finally(() => {
      isExportingJson.value = false;
    });
}

async function handleClearData() {
  // #80: a fresh PIN before wiping. Also the first error handling this destructive action
  // has ever had — any throw previously left the confirm panel open with no message and
  // no reload, i.e. a silent failure sitting directly on "delete everything".
  // Gated only when a step-up is actually possible. This is the recovery escape hatch:
  // people reach for it when the pod is broken, which is the same state where there may
  // be no resolved member or no credential to prove with. Failing closed here would trap
  // them. Low stakes anyway — this clears LOCAL data; the .beanpod on Drive survives.
  if (canStepUp() && !(await requireReauth())) return;
  try {
    await settingsStore.clearCachedFamilyKey();
    await settingsStore.setTrustedDevice(false);
    const familyId = useFamilyContextStore().activeFamilyId;
    if (familyId) {
      await deleteFamilyDatabase(familyId);
    }
  } catch (e) {
    showToast('error', t('settings.clearDataFailed'));
    reportError({
      surface: 'settings-clear-data',
      message: 'clear all data failed',
      error: e,
      severity: 'error',
      context: { action: 'clear_data_failed' },
    });
    return;
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
    // 1. Export if requested — and REFUSE to delete anything if it did not
    //    actually produce a file. This step was previously fire-and-forget, so
    //    on native (where delivery was a guaranteed no-op) a user could tick
    //    "export my data first", receive nothing, and lose everything.
    //    `delivered` is false for a CANCELLED share too, which is deliberate:
    //    dismissing the sheet means no backup exists either.
    if (wantExport.value) {
      const exported = await exportReadableJson({ errorUi: 'caller', critical: true });
      if (!exported) {
        showToast(
          'error',
          t('settings.deleteFamilyExportFailed'),
          t('settings.deleteFamilyExportFailedHelp'),
          // `exportReadableJson` already fired the single critical report;
          // reporting again here would be two incidents for one failure.
          { silent: true }
        );
        // Deliberately NOT `resetDeleteFamilyState()`: that unticks "export my
        // data first", and the toast above tells the user to retry the export
        // or untick it themselves. Someone following that advice would have
        // found the box already cleared, confirmed again, and lost everything
        // with no gate and no backup. Only the typed confirmation is cleared.
        deleteConfirmText.value = '';
        isDeleting.value = false;
        showDeleteFamilyConfirm.value = true;
        return;
      }

      // ⚠️ On native, `delivered` is NOT proof the file was saved, and it
      // cannot be made into proof. `SharePlugin.java:59` resolves the call
      // unless the chooser returned RESULT_CANCELED *and* `stopped` is false —
      // and `handleOnStop()` sets `stopped` the moment the chosen app comes to
      // the foreground. So picking Gmail and then discarding the draft resolves
      // exactly like saving to Files does. The OS simply does not tell us.
      //
      // Since the very next lines are irreversible, the only honest gate is a
      // human one: ask. On web the anchor download is deterministic
      // (`preferDownload` above keeps it off `navigator.share`), so there is
      // nothing to ask about and the flow is unchanged.
      if (
        !(await confirmBackupLanded({
          message: 'settings.deleteFamilyExportCheckMsg',
          variant: 'danger',
        }))
      ) {
        deleteConfirmText.value = '';
        isDeleting.value = false;
        showDeleteFamilyConfirm.value = true;
        return;
      }
    }

    // 2. Delete Drive file if requested
    if (wantDeleteDrive.value) {
      // ⚠️ THE SAFETY COPY GOES FIRST. `deleteAux` resolves the copy's folder by
      // reading the POD'S OWN `parents`, so deleting the pod first makes that
      // lookup 404 and the copy silently survives — a family who asked for
      // erasure keeping a complete, key-openable second copy of everything in
      // Drive. Ordering is the whole fix.
      try {
        const provider = syncService.getProvider();
        const aux = provider ? getAuxStore(provider) : null;
        if (aux && provider) await aux.delete(safetyCopyName(provider.getDisplayName()));
      } catch (e) {
        // Never silent: this is a privacy outcome, not a convenience.
        reportError({
          surface: 'pod-compaction',
          // ⚠️ `critical`, not `warning`. A family that ticked "delete the
          // encrypted .beanpod" and kept a complete, key-openable copy in Drive
          // is data at risk by any reading — and the farewell screen then tells
          // them it is gone. `warning` reaches the firehose and pages nobody.
          severity: 'critical',
          message: 'safety copy survived a family deletion',
          error: e,
          context: { action: 'delete-family', error_code: 'safety-copy-delete-failed' },
        });
      }
      try {
        const config = await getProviderConfig(familyId);
        if (config?.type === 'google_drive' && config.driveFileId) {
          const token = await getValidToken();
          await deleteFile(token, config.driveFileId);
        }
      } catch (e) {
        // Same class as the safety copy above, and it was console-only while
        // its neighbour reported. The user is about to be told their data is
        // gone; if the file survived, someone has to be able to find out.
        reportError({
          surface: 'pod-access',
          severity: 'critical',
          message: 'the pod file survived a family deletion',
          error: e,
          context: { action: 'delete-family', error_code: 'pod-delete-failed' },
        });
      }
    }

    // 3. Delete local family (IndexedDB, passkeys, file handles, registry, etc.)
    await familyContextStore.deleteLocalFamily(familyId);

    // 4. Auth teardown
    await authStore.signOutAndClearData();

    // 5. Track deletion — BEFORE the store reset, not after. `resetAllAppStores`
    // calls `clearDemoSession()`, which sets `isDemoSession` false, so a call
    // placed after it sails straight past `track()`'s demo guard: an App Store
    // or Play reviewer exercising Delete Family in the demo pod would emit a
    // real `family_deleted` into the production property.
    track('family_deleted');

    // 6. Reset all Pinia stores
    resetAllAppStores();

    // 7. Farewell
    await showAlert({
      title: 'settings.deleteFamilyFarewellTitle',
      message: 'settings.deleteFamilyFarewellMsg',
    });

    // 7. Redirect
    router.replace('/welcome');
  } catch (e) {
    // A deletion that dies half-way must not present as a button that simply
    // stopped: the family may now be in a partial state and the user needs to
    // know to go and look.
    console.error('[deleteFamily] Deletion failed:', e);
    showToast('error', t('settings.deleteFamilyFailed'), t('settings.deleteFamilyFailedHelp'), {
      surface: 'delete-family',
      error: e,
      context: { action: 'delete_family_failed' },
      critical: true,
    });
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
        :title="t('settings.card.reminders')"
        :description="t('settings.card.remindersDesc')"
        icon-bg="var(--tint-orange-8)"
        icon-color="var(--heritage-orange)"
        @click="showReminders = true"
      >
        <template #icon><BeanieBellIcon :size="24" /></template>
      </SettingsCard>
    </div>

    <!-- ── Install App Banner ──────────────────────────────────────────── -->
    <div
      v-if="canInstall || isInstalled"
      class="dark:bg-surface-raised flex items-center justify-between rounded-3xl bg-white p-5 shadow-[var(--card-shadow)]"
    >
      <div>
        <p class="font-outfit dark:text-ink text-sm font-bold text-slate-700">
          {{ t('settings.installApp') }}
        </p>
        <p class="dark:text-ink-faint text-xs text-slate-400">
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
        class="dark:text-success-lift inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30"
      >
        &#x2713;
      </span>
    </div>

    <!-- ── Quick Toggles ───────────────────────────────────────────────── -->
    <div>
      <p
        class="font-outfit dark:text-ink-faint mb-4 text-[0.75rem] font-bold tracking-[0.1em] text-[var(--deep-slate)]/35 uppercase"
      >
        {{ t('settings.quickToggles') }}
      </p>
      <div
        class="dark:bg-surface-raised rounded-[var(--sq)] bg-white px-6 shadow-[0_2px_12px_rgba(44,62,80,0.04)]"
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
            class="dark:text-terracotta-lift text-[0.65rem] text-amber-600"
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
          divider
          testid="daily-tips-toggle"
          :title="t('settings.dailyTips')"
          :hint="t('settings.dailyTipsDescription')"
          :model-value="beanTips.tipsEnabled.value"
          @update:model-value="(v) => (v ? beanTips.enableTips() : beanTips.muteAllTips())"
        />
        <!-- #45: periodic feedback prompt. ON = prompt enabled (maps to feedbackOptOut = !v).
             The store toasts + reverts on failure, so the handler can swallow. -->
        <SettingToggleRow
          testid="feedback-prompt-toggle"
          :title="t('feedback.settings.toggleLabel')"
          :hint="t('feedback.settings.toggleHint')"
          :model-value="!settingsStore.feedbackOptOut"
          @update:model-value="(v) => settingsStore.setFeedbackOptOut(!v).catch(() => {})"
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
    <WallSetupCard v-if="showWallCard" />

    <component :is="DevFlagsCard" v-if="DevFlagsCard && (isOwner || canManagePod)" />

    <!-- ── Discord CTA ─────────────────────────────────────────────────────
         Deliberately NOT a settings card: joining a community is an invitation,
         not a preference to configure, and a card gave it the same weight as
         "Currency & Rates".

         Sky Silk panel rather than an orange banner — Silk is the brand's calm/
         welcome colour, so the invitation reads warm instead of shouty, and the
         Deep Slate copy sits on it at full contrast. (The first attempt put
         white text on a gradient fading to `var(--terracotta)`, a token that
         does not exist — it resolved to transparent and the text vanished into
         the page. Colour here comes from real tokens only.)

         Orange is reserved for the one action pill, per the CIG. The whole panel
         is a single <button> so there's one tab stop and one accessible name;
         the pill is presentational. -->
    <button
      type="button"
      class="group dark:bg-surface-raised relative w-full cursor-pointer overflow-hidden rounded-[var(--sq)] bg-[var(--tint-silk-20)] p-5 text-left ring-1 ring-[var(--deep-slate)]/5 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(44,62,80,0.08)] focus-visible:ring-2 focus-visible:ring-[var(--heritage-orange)] focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none dark:ring-white/5"
      @click="openDiscord('settings')"
    >
      <!-- A line of beanies, already holding hands — the community you're being
           invited into. Decorative, low-contrast, and behind the copy. -->
      <img
        src="/brand/beanies_celebrating_line_transparent_560x225.png"
        alt=""
        aria-hidden="true"
        class="pointer-events-none absolute -right-6 -bottom-3 h-24 w-auto opacity-15 select-none dark:opacity-10"
      />
      <div class="relative flex items-center gap-4">
        <span
          class="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-white/70 text-xl shadow-[0_1px_4px_rgba(44,62,80,0.06)] dark:bg-white/10"
          aria-hidden="true"
          >💬</span
        >
        <span class="min-w-0 flex-1">
          <span
            class="font-outfit dark:text-ink block text-sm font-bold text-[var(--deep-slate)]"
            >{{ t('settings.discordCta') }}</span
          >
          <span class="dark:text-ink-soft mt-0.5 block text-xs text-[var(--deep-slate)]/55">{{
            t('settings.discordCtaDesc')
          }}</span>
        </span>
        <span
          class="font-outfit flex-none rounded-[14px] bg-[var(--heritage-orange)] px-4 py-2.5 text-xs font-bold text-white shadow-[0_2px_8px_rgba(241,93,34,0.25)] transition-transform group-hover:scale-[1.03] motion-reduce:transform-none"
          >{{ t('settings.discordCtaAction') }}</span
        >
      </div>
    </button>

    <!-- ── About Footer ────────────────────────────────────────────────── -->
    <div class="dark:text-ink-faint px-2 pb-4 text-center text-xs text-slate-400">
      <p>
        <span class="opacity-60">🫘</span>
        <strong class="dark:text-ink-soft text-slate-500">{{ t('settings.appName') }}</strong>
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

    <!-- ── Reminders drawer (#55) — device-scoped OS notification prefs ─── -->
    <RemindersSettings :open="showReminders" @close="showReminders = false" />

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
          <h3 class="font-outfit dark:text-ink text-base font-bold text-gray-900">
            {{ t('settings.baseCurrency') }}
          </h3>
        </div>
        <p class="dark:text-ink-soft mb-4 text-sm leading-relaxed text-gray-600">
          {{ t('settings.noRatesWarning') }}
        </p>
        <div
          v-if="ratesFetchError"
          class="dark:text-danger-lift mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20"
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
        <label class="dark:text-ink-soft mb-1 block text-sm font-medium text-gray-700">
          {{ t('settings.preferredCurrencies') }}
        </label>
        <p class="dark:text-ink-soft mb-2 text-xs text-gray-500">
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
            class="font-outfit dark:border-line-strong dark:bg-surface-overlay dark:text-ink dark:placeholder-ink-faint w-full rounded-xl border border-gray-200 bg-white py-2 pr-3 pl-9 text-base text-gray-700 placeholder-gray-400 transition-colors outline-none focus:border-[#F15D22]/40 focus:ring-2 focus:ring-[#F15D22]/10"
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
            class="dark:border-line-strong dark:bg-surface-overlay absolute top-full left-0 z-10 mt-1.5 max-h-[200px] w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
          >
            <button
              v-for="curr in searchResults"
              :key="curr.code"
              type="button"
              class="font-outfit dark:hover:bg-surface-hover flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[rgba(241,93,34,0.04)]"
              @click="
                togglePreferredCurrency(curr.code);
                currencySearch = '';
              "
            >
              <span
                class="dark:bg-surface-hover flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-base"
              >
                {{ curr.symbol }}
              </span>
              <div>
                <span class="dark:text-ink font-semibold text-gray-800">{{ curr.code }}</span>
                <span class="dark:text-ink-soft ml-1.5 text-gray-400">{{ curr.name }}</span>
              </div>
            </button>
          </div>

          <!-- No results -->
          <div
            v-if="currencySearch.trim().length > 0 && searchResults.length === 0"
            class="dark:border-line-strong dark:bg-surface-overlay absolute top-full left-0 z-10 mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-4 text-center shadow-lg"
          >
            <p class="dark:text-ink-faint text-xs text-gray-400">{{ t('empty.noResults') }}</p>
          </div>
        </div>

        <!-- Selection count -->
        <p class="dark:text-ink-faint mt-2 text-xs text-gray-400">
          {{ t('settings.preferredSelectedCount').replace('{count}', String(preferredCount)) }}
        </p>
      </div>

      <!-- Exchange Rates (inline, no BaseCard wrapper) -->
      <div class="dark:border-line border-t border-gray-200 pt-4">
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

      <p v-if="showHolidayRetryHint" class="text-secondary-500/70 dark:text-ink-soft text-xs">
        {{ t('holiday.loadFailedRetryHint') }}
      </p>

      <!-- Show / hide public holidays on the planner -->
      <div
        class="dark:border-line flex items-center justify-between rounded-lg border border-gray-200 p-4"
      >
        <div>
          <p class="dark:text-ink font-medium text-gray-900">
            {{ t('settings.showPublicHolidays') }}
          </p>
          <p v-if="!settingsStore.country" class="dark:text-ink-soft text-sm text-gray-500">
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
      <PinSettings class="mt-4" />
      <PasskeySettings class="mt-4" />
    </BeanieFormModal>

    <!-- ── Security & Recovery Modal ─────────────────────────────────────
         Family/device-level protection: device trust, the family recovery
         kit + passphrase, and the emergency Google disconnect. Personal
         sign-in methods (password/PIN/biometric) live in Account & Sign-In
         above — "who am I" vs "how is this family and device protected".
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
        class="dark:border-line flex items-center justify-between rounded-lg border border-gray-200 p-4"
      >
        <div>
          <p class="dark:text-ink font-medium text-gray-900">
            {{ t('trust.settingsLabel') }}
          </p>
          <p class="dark:text-ink-soft text-sm text-gray-500">
            {{ t('trust.settingsDesc') }}
          </p>
        </div>
        <ToggleSwitch
          :model-value="settingsStore.isTrustedDevice"
          @update:model-value="settingsStore.setTrustedDevice($event)"
        />
      </div>

      <RecoverySettings class="mt-4" />
      <DeviceLinkCard class="mt-4" />
      <GoogleDisconnectCard class="mt-4" />
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
      <p class="dark:text-ink-soft text-sm text-gray-500">
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

          <!-- Reconnecting: a lost data-file connection is being re-established
               silently from the registry (never flash the "save your data" copy). -->
          <template v-if="syncStore.reconnecting">
            <p class="dark:text-ink mb-2 font-medium text-gray-900">
              {{ t('settings.dataReconnecting') }}
            </p>
            <p class="dark:text-ink-soft mb-4 text-sm text-gray-500">
              {{ t('settings.dataReconnectingDesc') }}
            </p>
          </template>

          <template v-else>
            <p class="dark:text-ink mb-2 font-medium text-gray-900">
              {{ t('settings.saveDataToFile') }}
            </p>
            <p class="dark:text-ink-soft mb-4 text-sm text-gray-500">
              {{ t('settings.createOrLoadDataFile') }}
            </p>
            <div class="flex flex-col gap-3">
              <!-- Established owner whose Drive connection was lost: reconnect +
                   reload their existing pod (NOT the dead resume-setup button). -->
              <BaseButton v-if="authStore.podCreated" @click="handleDriveReconnect">
                {{ t('settings.reconnectAndReload') }}
              </BaseButton>
              <BaseButton v-else @click="handleResumeSetup">
                {{ t('settings.resumeSetup') }}
              </BaseButton>
              <BaseButton variant="secondary" @click="handleLoadFromFileClick">
                {{ t('settings.loadExistingDataFile') }}
              </BaseButton>
            </div>
          </template>

          <div
            v-if="showLoadFileConfirm"
            class="mt-4 rounded-lg bg-yellow-50 p-4 text-left dark:bg-yellow-900/20"
          >
            <p class="dark:text-terracotta-lift mb-3 text-sm text-yellow-800">
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
            <p class="dark:text-terracotta-lift mb-3 text-sm text-yellow-800">
              {{ t('settings.grantPermissionPrompt') }}
            </p>
            <BaseButton variant="primary" @click="handleRequestPermission">
              {{ t('settings.grantPermission') }}
            </BaseButton>
          </div>

          <div v-else>
            <!-- My Family's Data -->
            <div
              class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3"
            >
              <div class="min-w-0 flex-1">
                <p class="dark:text-ink font-medium text-gray-900">
                  {{ t('settings.myFamilyData') }}
                </p>
                <CloudProviderBadge
                  :provider-type="syncStore.storageProviderType"
                  :file-name="syncStore.fileName"
                  :account-email="syncStore.sessionAccountEmail ?? syncStore.providerAccountEmail"
                  size="md"
                />
                <p
                  v-if="syncStore.isGoogleDriveConnected"
                  class="dark:text-ink-faint mt-0.5 text-xs text-gray-400"
                >
                  {{ t('googleDrive.savedTo') }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="{
                    'dark:text-success-lift bg-green-100 text-green-800 dark:bg-green-900/30':
                      syncStore.syncStatus === 'ready',
                    'bg-sky-silk-100 text-secondary-500 dark:bg-primary-900/30 dark:text-accent-lift':
                      syncStore.syncStatus === 'syncing',
                    'dark:text-danger-lift bg-red-100 text-red-800 dark:bg-red-900/30':
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
              class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3"
            >
              <p class="dark:text-ink-soft text-sm text-gray-500">
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
              v-if="
                syncStore.isGoogleDriveConnected &&
                (syncStore.sessionAccountEmail ?? syncStore.providerAccountEmail)
              "
              class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3"
            >
              <div class="min-w-0 flex-1">
                <p class="dark:text-ink-soft text-sm text-gray-500">
                  {{ t('settings.familyData.signedInAs') }}
                </p>
                <p class="dark:text-ink truncate text-sm font-medium text-gray-900">
                  {{ syncStore.sessionAccountEmail ?? syncStore.providerAccountEmail }}
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
              class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3"
            >
              <div>
                <p class="dark:text-ink font-medium text-gray-900">
                  {{ t('settings.lastSaved') }}
                </p>
                <p class="dark:text-ink-soft text-sm text-gray-500">
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
              class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3"
            >
              <div>
                <p class="dark:text-ink font-medium text-gray-900">
                  {{
                    syncStore.storageProviderType === 'local'
                      ? t('settings.familyData.migrate.moveToGoogleDrive')
                      : t('settings.familyData.migrate.moveToLocalFile')
                  }}
                </p>
                <p class="dark:text-ink-soft text-sm text-gray-500">
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
                <p class="dark:text-ink font-medium text-gray-900">
                  {{ t('settings.loadAnotherDataFile') }}
                </p>
                <p class="dark:text-ink-soft text-sm text-gray-500">
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
              <p class="dark:text-terracotta-lift mb-3 text-sm text-yellow-800">
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
              <p class="dark:text-terracotta-lift text-sm text-amber-800">{{ syncStore.error }}</p>
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
              <p
                v-if="reconnectError"
                class="dark:text-terracotta-lift mt-2 text-xs text-amber-700"
              >
                {{ t('googleDrive.reconnectFailed') }}: {{ reconnectError }}
              </p>
            </div>

            <!-- Cache persist warning -->
            <div
              v-if="syncStore.cachePersistFailed"
              class="mt-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20"
            >
              <p class="dark:text-terracotta-lift text-sm text-amber-700">
                {{ t('settings.cachePersistWarning') }}
              </p>
            </div>

            <!-- Success message -->
            <div v-if="importSuccess" class="mt-4 rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
              <p class="dark:text-success-lift text-sm text-green-600">
                {{ t('settings.dataLoadedSuccess') }}
              </p>
            </div>

            <!-- Family key status -->
            <div class="dark:border-line mt-4 border-t border-gray-200 pt-4">
              <div class="flex items-center gap-3">
                <div
                  class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-green-100 dark:bg-green-900/30"
                >
                  <BeanieIcon name="lock" size="md" class="dark:text-success-lift text-green-600" />
                </div>
                <div>
                  <p class="dark:text-ink font-medium text-gray-900">
                    {{ t('settings.familyKeyStatus') }}
                    <span
                      class="dark:text-success-lift ml-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30"
                    >
                      {{ t('settings.familyKeyActive') }}
                    </span>
                  </p>
                  <p class="dark:text-ink-soft text-sm text-gray-500">
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
        <p class="dark:text-ink-soft mb-4 text-sm text-gray-500">
          {{ t('settings.noAutoSyncWarning') }}
        </p>
        <div
          class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3"
        >
          <div>
            <p class="dark:text-ink font-medium text-gray-900">
              {{ t('settings.downloadYourData') }}
            </p>
            <p class="dark:text-ink-soft text-sm text-gray-500">
              {{ t('settings.downloadDataDescription') }}
            </p>
          </div>
          <BaseButton
            variant="secondary"
            size="sm"
            :disabled="isExportingBeanpod"
            @click="handleManualExport"
          >
            {{ t('action.download') }}
          </BaseButton>
        </div>
        <div class="flex items-center justify-between py-3">
          <div>
            <p class="dark:text-ink font-medium text-gray-900">
              {{ t('settings.loadDataFile') }}
            </p>
            <p class="dark:text-ink-soft text-sm text-gray-500">
              {{ t('settings.loadDataFileDescription') }}
            </p>
          </div>
          <BaseButton variant="secondary" size="sm" @click="handleManualImport">
            {{ t('action.load') }}
          </BaseButton>
        </div>

        <div v-if="importError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
          <p class="dark:text-danger-lift text-sm text-red-600">{{ importError }}</p>
        </div>
        <div v-if="importSuccess" class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
          <p class="dark:text-success-lift text-sm text-green-600">
            {{ t('settings.dataLoadedSuccess') }}
          </p>
        </div>
      </div>

      <!-- ── Pod Ownership ───────────────────────────────────────────────
           Owner-only. Rare action (once-per-pod-lifetime), so it lives
           inside Family Data rather than getting its own Settings tile.
           Members never see this section at all. -->
      <div v-if="isOwner" class="dark:border-line mt-6 border-t border-gray-200 pt-4">
        <h3 class="font-outfit dark:text-ink mb-3 text-base font-semibold text-gray-900">
          👑 {{ t('settings.podOwnershipSection') }}
        </h3>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="dark:text-ink-soft text-xs text-gray-500">
              {{ t('settings.currentOwner') }}
            </p>
            <p class="dark:text-ink truncate font-medium text-gray-900">
              {{ currentOwnerName ?? '—' }}
            </p>
            <p class="dark:text-ink-soft mt-1 text-xs text-gray-500">
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

      <!-- ── Compact the family file (pod compaction) ────────────────────
           Owner-only, dev-flagged, and its OWN section — not a row beside
           Transfer Ownership, where a one-way, family-wide migration read as a
           tidy-up next to a link that restarts onboarding.

           The long "why does this record exist at all" explanation sits behind
           the existing `?` badge (`InfoHintBadge`, as on Reminders and Todos),
           because the headline here is that compacting is SAFE. What the person
           must actually DO stays outside the popover, in the standing notice.

           Heritage Orange for that notice, never Alert Red — nothing is being
           destroyed at this point. Red belongs to the final confirm, which
           legitimately is destructive. -->
      <div
        v-if="isFlagEnabled('podCompaction') && canCompactPod"
        class="dark:border-line mt-6 border-t border-gray-200 pt-4"
      >
        <h3
          class="font-outfit dark:text-ink mb-1 flex items-center gap-1.5 text-base font-semibold text-gray-900"
        >
          {{ t('settings.compactSection') }}
          <InfoHintBadge
            :items="[
              t('compaction.why.record'),
              t('compaction.why.settled'),
              t('compaction.why.older'),
            ]"
          />
        </h3>
        <p class="dark:text-ink-soft mb-3 text-xs text-gray-500">
          {{ t('settings.compactSectionDesc') }}
        </p>

        <!-- The DUE note: the only thing in this section that ever says "yes,
             now". Everything else describes a capability; this says the file has
             actually grown enough to matter, or that a device has already failed
             to open it — a real failure outranking the size heuristic. Sky Silk,
             not Heritage Orange: it is information, not a caution. -->
        <div
          v-if="compactionIsDue"
          class="dark:border-silk-lift/40 dark:bg-silk-lift/10 mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3"
        >
          <!-- ⚠️ `ink-soft`, matching the caution below. `ink` made the merely
               informational note LOUDER on dark (10.70) than the one warning
               that unsynced work is at stake (7.70) — the hierarchy inverted. -->
          <p class="dark:text-ink-soft text-xs leading-relaxed text-sky-900">
            {{
              someoneCannotOpenIt
                ? t('compaction.dueBecauseFailed')
                : t('compaction.dueBecauseLarge')
            }}
          </p>
        </div>

        <!-- The one thing that needs a decision, deliberately NOT behind the
             badge. Stage 3's rebase now replays an offline device's work onto
             the compacted file, so the common case is silent — but a rebase
             that cannot run safely still falls back to the block, and then that
             device is asked to give its changes up. The notice describes the
             fallback, because that is the case a human has to act on. -->
        <div
          class="dark:border-accent-lift/40 dark:bg-accent-lift/10 mb-3 flex gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3"
        >
          <BeanieIcon
            name="exclamation-circle"
            class="text-primary-500 dark:text-accent-lift mt-0.5 h-4 w-4 flex-shrink-0"
            aria-hidden="true"
          />
          <p class="dark:text-ink-soft text-xs leading-relaxed text-orange-900">
            {{ t('compaction.bringDevicesOnline') }}
          </p>
        </div>

        <BaseButton
          variant="primary"
          size="sm"
          :disabled="isCompacting"
          data-testid="compact-pod"
          @click="compactPod"
        >
          {{ t('settings.compactPod') }}
        </BaseButton>
        <p class="dark:text-ink-faint mt-2 text-xs text-gray-500">
          {{
            t(podKeepsSiblingCopy ? 'compaction.safetyCopyNote' : 'compaction.safetyCopyNoteManual')
          }}
        </p>
      </div>

      <!-- ── Restart Onboarding ──────────────────────────────────────────
           Lives in Family Data so it doesn't crowd the Appearance drawer
           with a one-off action. Visible to anyone who can manage the pod
           (the drawer's own v-if). -->
      <div class="dark:border-line mt-6 border-t border-gray-200 pt-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="dark:text-ink font-medium text-gray-900">
              {{ t('onboarding.restartOnboarding') }}
            </p>
            <p class="dark:text-ink-soft text-xs text-gray-500">
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
      <div class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3">
        <div>
          <p class="dark:text-ink font-medium text-gray-900">
            {{ t('settings.exportData') }}
          </p>
          <p class="dark:text-ink-soft text-sm text-gray-500">
            {{ t('settings.exportDataDescription') }}
          </p>
        </div>
        <BaseButton
          variant="ghost"
          size="sm"
          :disabled="isExportingBeanpod"
          @click="handleManualExport"
        >
          {{ t('action.export') }}
        </BaseButton>
      </div>
      <div class="dark:border-line flex items-center justify-between border-b border-gray-200 py-3">
        <div>
          <p class="dark:text-ink font-medium text-gray-900">
            {{ t('settings.exportAsJson') }}
          </p>
          <p class="dark:text-ink-soft text-sm text-gray-500">
            {{ t('settings.exportAsJsonDesc') }}
          </p>
        </div>
        <BaseButton
          variant="ghost"
          size="sm"
          :disabled="isExportingJson"
          @click="handleExportAsJson"
        >
          {{ t('action.export') }}
        </BaseButton>
      </div>
      <div class="flex items-center justify-between py-3">
        <div>
          <p class="dark:text-ink font-medium text-gray-900">
            {{ t('settings.clearAllData') }}
          </p>
          <p class="dark:text-ink-soft text-sm text-gray-500">
            {{ t('settings.clearAllDataDescription') }}
          </p>
        </div>
        <BaseButton variant="danger" size="sm" @click="showClearConfirm = true">
          {{ t('settings.clearData') }}
        </BaseButton>
      </div>

      <div v-if="showClearConfirm" class="rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
        <p class="dark:text-danger-lift mb-3 text-sm text-red-800">
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
            <p class="dark:text-ink font-medium text-gray-900">
              {{ t('settings.deleteFamily') }}
            </p>
            <p class="dark:text-ink-soft text-sm text-gray-500">
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
          <p class="dark:text-ink text-sm text-gray-800">
            {{ t('settings.deleteFamilyWarning') }}
          </p>
        </div>

        <label class="flex cursor-pointer items-start gap-3">
          <input
            v-model="wantExport"
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#F15D22] focus:ring-[#F15D22]"
          />
          <span class="dark:text-ink-soft text-sm text-gray-700">
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
          <span class="dark:text-ink-soft text-sm text-gray-700">
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
          <p class="dark:text-danger-lift text-sm font-medium text-red-800">
            {{ t('password.encryptionError') }}
          </p>
          <p class="dark:text-danger-lift mt-1 text-sm text-red-600">{{ encryptionError }}</p>
        </div>
        <button
          class="dark:hover:text-danger-lift text-red-400 hover:text-red-600"
          @click="encryptionError = null"
        >
          <BeanieIcon name="close" size="sm" />
        </button>
      </div>
    </div>
  </div>
</template>
