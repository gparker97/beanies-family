<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import LoginBackground from '@/components/login/LoginBackground.vue';
import LoginSecurityFooter from '@/components/login/LoginSecurityFooter.vue';
import WelcomeGate from '@/components/login/WelcomeGate.vue';
import FamilyPickerView from '@/components/login/FamilyPickerView.vue';
import LoadPodView from '@/components/login/LoadPodView.vue';
import PickBeanView from '@/components/login/PickBeanView.vue';
import CreatePodView from '@/components/login/CreatePodView.vue';
import JoinPodView from '@/components/login/JoinPodView.vue';
import BiometricLoginView from '@/components/login/BiometricLoginView.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { getProviderConfig } from '@/services/sync/fileHandleStore';
import type { PersistedProviderConfig } from '@/services/sync/fileHandleStore';

const router = useRouter();
const { t } = useTranslation();
const syncStore = useSyncStore();
const settingsStore = useSettingsStore();
const familyContextStore = useFamilyContextStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

const SESSION_PASSWORD_KEY = 'beanies-file-password';

type LoginView =
  | 'welcome'
  | 'loading'
  | 'load-pod'
  | 'pick-bean'
  | 'create'
  | 'join'
  | 'biometric'
  | 'family-picker';

const props = withDefaults(defineProps<{ initialView?: LoginView }>(), {
  initialView: 'welcome',
});

const activeView = ref<LoginView>(props.initialView);
const needsPermissionGrant = ref(false);
const autoLoadPod = ref(false);
const fileUnencrypted = ref(false);
const isInitializing = ref(true);
const biometricFamilyId = ref('');
const biometricFamilyName = ref<string | undefined>();
const biometricDeclined = ref(false);
const forceNewGoogleAccount = ref(false);
const loadError = ref<string | undefined>();
const loadErrorProviderHint = ref<'local' | 'google_drive' | undefined>();
const isSingleFamilyAutoSelect = ref(false);

onMounted(async () => {
  if (familyStore.members.length === 0) {
    await familyContextStore.initialize();
    await syncStore.initialize();

    // Single-family fast login: skip WelcomeGate + FamilyPicker
    const allFamilies = familyContextStore.allFamilies;
    const singleFamily = allFamilies.length === 1 ? allFamilies[0] : undefined;
    if (singleFamily) {
      const [hasPasskeys, providerConfig] = await Promise.all([
        authStore.checkHasRegisteredPasskeys(singleFamily.id),
        getProviderConfig(singleFamily.id),
      ]);
      isSingleFamilyAutoSelect.value = true;
      isInitializing.value = false;
      await handleFamilySelected({
        id: singleFamily.id,
        name: singleFamily.name ?? 'My Family',
        hasPasskeys,
        providerConfig,
      });
      return;
    }
  } else {
    // Members already loaded (e.g. navigated back) — go to pick-bean
    activeView.value = 'pick-bean';
    fileUnencrypted.value = !syncStore.isEncryptionEnabled;
  }

  isInitializing.value = false;
});

/**
 * Activate a family and prepare for biometric login.
 * Pre-loads the encrypted file so BiometricLoginView can decrypt it with a passkey.
 * Falls back to load-pod if file loading fails or file turns out to be unencrypted.
 */
async function activateFamilyForBiometric(
  familyId: string,
  familyName: string,
  providerConfig?: PersistedProviderConfig | null
) {
  // Switch to the selected family
  if (familyContextStore.activeFamilyId !== familyId) {
    await familyContextStore.switchFamily(familyId);
    syncStore.resetState();
    await syncStore.initialize();
  }

  // Pre-load the encrypted file so biometric login can decrypt it
  if (syncStore.isConfigured) {
    try {
      if (syncStore.needsPermission) {
        // After PWA restart, local file handle permissions are revoked by the browser.
        // Request permission first (safe — this runs during a user gesture).
        const granted = await syncStore.requestPermission();
        if (!granted) {
          // Permission denied — fall back to load-pod with permission grant UI
          autoLoadPod.value = false;
          needsPermissionGrant.value = true;
          biometricDeclined.value = false;
          activeView.value = 'load-pod';
          return;
        }
        // Permission granted — requestPermission() internally loaded the file.
        // If file was unencrypted, it auto-decrypted (no pending file).
      } else {
        const loadResult = await syncStore.loadFromFile();
        if (!loadResult.success && !loadResult.needsPassword) {
          // Load failed for non-password reasons — fall back with error
          const hint = toProviderHint(providerConfig ?? null);
          loadError.value = providerErrorMessage(hint);
          loadErrorProviderHint.value = hint;
          autoLoadPod.value = false;
          needsPermissionGrant.value = false;
          biometricDeclined.value = false;
          activeView.value = 'load-pod';
          return;
        }
        // success: true → file loaded (unencrypted, auto-decrypted)
        // needsPassword: true → file encrypted, pending for biometric decrypt
      }
    } catch {
      // File moved/deleted/network error — fall back with error
      const hint = toProviderHint(providerConfig ?? null);
      loadError.value = providerErrorMessage(hint);
      loadErrorProviderHint.value = hint;
      autoLoadPod.value = false;
      needsPermissionGrant.value = false;
      biometricDeclined.value = false;
      activeView.value = 'load-pod';
      return;
    }
  }

  // If the file was unencrypted or auto-decrypted, there's no pending encrypted file.
  // Biometric decrypt would fail, so skip biometric and go straight to pick-bean.
  if (syncStore.isConfigured && !syncStore.hasPendingEncryptedFile) {
    // Last resort: try auto-decrypt with cached passwords in case pending file was set
    // but hasPendingEncryptedFile is somehow false (defensive)
    if (!(await tryAutoDecrypt(familyId))) {
      // File was genuinely unencrypted or already decrypted — go to pick-bean
      fileUnencrypted.value = !syncStore.isEncryptionEnabled;
      activeView.value = 'pick-bean';
      return;
    }
    // Auto-decrypt succeeded — go to pick-bean
    fileUnencrypted.value = !syncStore.isEncryptionEnabled;
    activeView.value = 'pick-bean';
    return;
  }

  // Happy path: encrypted file is pending, show biometric login
  biometricFamilyId.value = familyId;
  biometricFamilyName.value = familyName;
  activeView.value = 'biometric';
}

/**
 * Try to auto-decrypt using cached passwords (sessionStorage, then per-family cache).
 * Returns true if decryption succeeded.
 */
async function tryAutoDecrypt(familyId: string): Promise<boolean> {
  const passwords = [
    sessionStorage.getItem(SESSION_PASSWORD_KEY),
    settingsStore.getCachedEncryptionPassword(familyId),
  ].filter(Boolean) as string[];

  for (const pw of passwords) {
    try {
      const result = await syncStore.decryptPendingFile(pw);
      if (result.success) return true;
    } catch {
      // Try next password
    }
  }
  return false;
}

/**
 * Derive a provider hint from a PersistedProviderConfig for LoadPodView.
 */
function toProviderHint(
  config: PersistedProviderConfig | null
): 'local' | 'google_drive' | undefined {
  if (!config) return undefined;
  return config.type === 'google_drive' ? 'google_drive' : 'local';
}

function providerErrorMessage(hint: 'local' | 'google_drive' | undefined): string {
  if (hint === 'local') return t('fastLogin.loadErrorLocal');
  if (hint === 'google_drive') return t('fastLogin.loadErrorDrive');
  return t('familyPicker.loadError');
}

/**
 * Handle family selection from FamilyPickerView.
 * Routes to biometric (if passkeys), attempts auto-load, or falls back to load-pod.
 */
async function handleFamilySelected(payload: {
  id: string;
  name: string;
  hasPasskeys: boolean;
  providerConfig: PersistedProviderConfig | null;
}) {
  // Switch to selected family
  if (familyContextStore.activeFamilyId !== payload.id) {
    await familyContextStore.switchFamily(payload.id);
    syncStore.resetState();
    await syncStore.initialize();
  }

  // Reset error state
  loadError.value = undefined;
  loadErrorProviderHint.value = undefined;

  if (payload.hasPasskeys) {
    // Go to biometric login (pre-load file)
    await activateFamilyForBiometric(payload.id, payload.name, payload.providerConfig);
  } else if (syncStore.isConfigured && !syncStore.needsPermission) {
    // File configured and accessible — try auto-load
    activeView.value = 'loading';
    try {
      const loadResult = await syncStore.loadFromFile();
      if (loadResult.success) {
        // Loaded successfully — go to pick-bean
        fileUnencrypted.value = !syncStore.isEncryptionEnabled;
        activeView.value = 'pick-bean';
      } else if (loadResult.needsPassword) {
        // Encrypted — try auto-decrypt
        if (await tryAutoDecrypt(payload.id)) {
          fileUnencrypted.value = !syncStore.isEncryptionEnabled;
          activeView.value = 'pick-bean';
        } else {
          // Can't auto-decrypt — fall back to LoadPodView with decrypt modal
          autoLoadPod.value = true;
          needsPermissionGrant.value = false;
          biometricDeclined.value = false;
          loadErrorProviderHint.value = toProviderHint(payload.providerConfig);
          activeView.value = 'load-pod';
        }
      } else {
        // Load failed for other reasons — fall back with error
        const hint = toProviderHint(payload.providerConfig);
        loadError.value = providerErrorMessage(hint);
        loadErrorProviderHint.value = hint;
        autoLoadPod.value = false;
        needsPermissionGrant.value = false;
        biometricDeclined.value = false;
        activeView.value = 'load-pod';
      }
    } catch {
      // File moved/deleted/corrupt — fall back with error
      const hint = toProviderHint(payload.providerConfig);
      loadError.value = providerErrorMessage(hint);
      loadErrorProviderHint.value = hint;
      autoLoadPod.value = false;
      needsPermissionGrant.value = false;
      biometricDeclined.value = false;
      activeView.value = 'load-pod';
    }
  } else if (syncStore.isConfigured && syncStore.needsPermission) {
    // File configured but needs permission — go to load-pod with permission grant UI
    autoLoadPod.value = false;
    needsPermissionGrant.value = true;
    biometricDeclined.value = false;
    activeView.value = 'load-pod';
  } else {
    // No file configured — go to load-pod for manual selection
    autoLoadPod.value = false;
    needsPermissionGrant.value = false;
    biometricDeclined.value = false;
    activeView.value = 'load-pod';
  }
}

/**
 * Handle "Load a different file" from FamilyPickerView.
 * Forces Google account chooser when loading via Drive.
 */
function handleLoadDifferentFile() {
  forceNewGoogleAccount.value = true;
  autoLoadPod.value = false;
  needsPermissionGrant.value = false;
  biometricDeclined.value = false;
  activeView.value = 'load-pod';
}

function handleNavigate(view: 'load-pod' | 'create' | 'join') {
  biometricDeclined.value = false;
  forceNewGoogleAccount.value = false;

  if (view === 'load-pod') {
    // "Sign In" from welcome → go to family picker if families exist
    const hasFamilies = familyContextStore.allFamilies.length > 0;
    if (hasFamilies) {
      activeView.value = 'family-picker';
      return;
    }
    // No families — fall through to load-pod with account chooser
    autoLoadPod.value = false;
    needsPermissionGrant.value = false;
    forceNewGoogleAccount.value = true;
  } else {
    autoLoadPod.value = false;
    needsPermissionGrant.value = false;
  }

  activeView.value = view;
}

function handleBiometricAvailable(payload: { familyId: string; familyName?: string }) {
  biometricFamilyId.value = payload.familyId;
  biometricFamilyName.value = payload.familyName;
  activeView.value = 'biometric';
}

function handleFileLoaded() {
  fileUnencrypted.value = !syncStore.isEncryptionEnabled;
  activeView.value = 'pick-bean';
}

function handleBiometricFallback() {
  // Fall back to password flow — go to load-pod with auto-load
  biometricDeclined.value = true;
  autoLoadPod.value = syncStore.isConfigured && !syncStore.needsPermission;
  needsPermissionGrant.value = syncStore.isConfigured && syncStore.needsPermission;
  activeView.value = 'load-pod';
}

function handleSignedIn(destination: string) {
  syncStore.setupAutoSync();
  router.replace(destination);
}
</script>

<template>
  <LoginBackground>
    <!-- Loading state during initialization -->
    <div v-if="isInitializing" class="py-12 text-center">
      <div
        class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#F15D22]"
      ></div>
    </div>

    <template v-else>
      <FamilyPickerView
        v-if="activeView === 'family-picker'"
        @back="activeView = 'welcome'"
        @family-selected="handleFamilySelected"
        @load-different-file="handleLoadDifferentFile"
      />

      <BiometricLoginView
        v-else-if="activeView === 'biometric'"
        :family-id="biometricFamilyId"
        :family-name="biometricFamilyName"
        :show-not-you-link="isSingleFamilyAutoSelect"
        @signed-in="handleSignedIn"
        @use-password="handleBiometricFallback"
        @back="activeView = isSingleFamilyAutoSelect ? 'welcome' : 'family-picker'"
      />

      <WelcomeGate v-else-if="activeView === 'welcome'" @navigate="handleNavigate" />

      <!-- Branded loading spinner during auto-load -->
      <div
        v-else-if="activeView === 'loading'"
        class="mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800"
      >
        <div class="py-12 text-center">
          <img
            src="/brand/beanies_family_icon_transparent_384x384.png"
            alt=""
            class="mx-auto mb-4 h-16 w-16"
          />
          <div
            class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#F15D22]"
          ></div>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('auth.loadingFile') }}</p>
        </div>
      </div>

      <LoadPodView
        v-else-if="activeView === 'load-pod'"
        :needs-permission-grant="needsPermissionGrant"
        :auto-load="autoLoadPod"
        :skip-biometric="biometricDeclined"
        :force-new-google-account="forceNewGoogleAccount"
        :load-error="loadError"
        :provider-hint="loadErrorProviderHint"
        @back="activeView = isSingleFamilyAutoSelect ? 'welcome' : 'family-picker'"
        @file-loaded="handleFileLoaded"
        @biometric-available="handleBiometricAvailable"
      />

      <PickBeanView
        v-else-if="activeView === 'pick-bean'"
        :file-unencrypted="fileUnencrypted"
        @back="activeView = isSingleFamilyAutoSelect ? 'welcome' : 'family-picker'"
        @signed-in="handleSignedIn"
      />

      <CreatePodView
        v-else-if="activeView === 'create'"
        @back="activeView = 'welcome'"
        @signed-in="handleSignedIn"
        @navigate="handleNavigate"
      />

      <JoinPodView
        v-else-if="activeView === 'join'"
        @back="activeView = 'welcome'"
        @signed-in="handleSignedIn"
        @navigate="handleNavigate"
      />
    </template>

    <template #below-card>
      <LoginSecurityFooter />
    </template>
  </LoginBackground>
</template>
