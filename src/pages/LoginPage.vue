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
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFamilyStore } from '@/stores/familyStore';

const router = useRouter();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const familyStore = useFamilyStore();

type LoginView =
  | 'welcome'
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

onMounted(async () => {
  // Initialize stores but always show the Welcome Gate first — never skip
  if (familyStore.members.length === 0) {
    await familyContextStore.initialize();
    await syncStore.initialize();
  } else {
    // Members already loaded (e.g. navigated back) — go to pick-bean
    activeView.value = 'pick-bean';
    fileUnencrypted.value = !syncStore.isEncryptionEnabled;
  }

  isInitializing.value = false;
});

/**
 * Activate a family and prepare for biometric login.
 */
async function activateFamilyForBiometric(familyId: string, familyName: string) {
  // Switch to the selected family
  if (familyContextStore.activeFamilyId !== familyId) {
    await familyContextStore.switchFamily(familyId);
    syncStore.resetState();
    await syncStore.initialize();
  }

  // Pre-load the encrypted file so biometric login can decrypt it
  if (syncStore.isConfigured && !syncStore.needsPermission) {
    await syncStore.loadFromFile();
  }

  biometricFamilyId.value = familyId;
  biometricFamilyName.value = familyName;
  activeView.value = 'biometric';
}

/**
 * Handle family selection from FamilyPickerView.
 * Routes to biometric (if passkeys) or load-pod (auto-load configured file).
 */
async function handleFamilySelected(payload: { id: string; name: string; hasPasskeys: boolean }) {
  // Switch to selected family
  if (familyContextStore.activeFamilyId !== payload.id) {
    await familyContextStore.switchFamily(payload.id);
    syncStore.resetState();
    await syncStore.initialize();
  }

  if (payload.hasPasskeys) {
    // Go to biometric login (pre-load file)
    await activateFamilyForBiometric(payload.id, payload.name);
  } else if (syncStore.isConfigured) {
    // File configured — go to load-pod with auto-load
    autoLoadPod.value = !syncStore.needsPermission;
    needsPermissionGrant.value = syncStore.needsPermission;
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
    // No families — fall through to load-pod
    autoLoadPod.value = false;
    needsPermissionGrant.value = false;
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
        @signed-in="handleSignedIn"
        @use-password="handleBiometricFallback"
        @back="activeView = 'family-picker'"
      />

      <WelcomeGate v-else-if="activeView === 'welcome'" @navigate="handleNavigate" />

      <LoadPodView
        v-else-if="activeView === 'load-pod'"
        :needs-permission-grant="needsPermissionGrant"
        :auto-load="autoLoadPod"
        :skip-biometric="biometricDeclined"
        :force-new-google-account="forceNewGoogleAccount"
        @back="activeView = 'family-picker'"
        @file-loaded="handleFileLoaded"
        @biometric-available="handleBiometricAvailable"
      />

      <PickBeanView
        v-else-if="activeView === 'pick-bean'"
        :file-unencrypted="fileUnencrypted"
        @back="activeView = 'family-picker'"
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
