<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import LoginBackground from '@/components/login/LoginBackground.vue';
import LoginSecurityFooter from '@/components/login/LoginSecurityFooter.vue';
import WelcomeGate from '@/components/login/WelcomeGate.vue';
import LoadPodView from '@/components/login/LoadPodView.vue';
import PickBeanView from '@/components/login/PickBeanView.vue';
import CreatePodView from '@/components/login/CreatePodView.vue';
import JoinPodView from '@/components/login/JoinPodView.vue';
import BiometricLoginView from '@/components/login/BiometricLoginView.vue';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { isPlatformAuthenticatorAvailable } from '@/services/auth/passkeyService';

const router = useRouter();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

type LoginView = 'welcome' | 'load-pod' | 'pick-bean' | 'create' | 'join' | 'biometric';

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

onMounted(async () => {
  // Initialize stores but always show the Welcome Gate first
  if (familyStore.members.length === 0) {
    await familyContextStore.initialize();
    await syncStore.initialize();

    // Check if biometric login is available:
    // 1. File handle is configured + we have permission (or it's pending encrypted)
    // 2. Family has registered passkeys
    // 3. Platform authenticator is available
    if (
      syncStore.isConfigured &&
      familyContextStore.activeFamilyId &&
      syncStore.isEncryptionEnabled
    ) {
      const hasPlatform = await isPlatformAuthenticatorAvailable();
      if (hasPlatform) {
        const hasPasskeys = await authStore.checkHasRegisteredPasskeys(
          familyContextStore.activeFamilyId
        );
        if (hasPasskeys) {
          // Pre-load the encrypted file so biometric login can decrypt it
          if (!syncStore.needsPermission) {
            await syncStore.loadFromFile(); // Will set pendingEncryptedFile if encrypted
          }

          biometricFamilyId.value = familyContextStore.activeFamilyId;
          biometricFamilyName.value = familyContextStore.activeFamilyName ?? undefined;
          activeView.value = 'biometric';
        }
      }
    }
  } else {
    // Members already loaded (e.g. navigated back) — go to pick-bean
    activeView.value = 'pick-bean';
    fileUnencrypted.value = !syncStore.isEncryptionEnabled;
  }

  isInitializing.value = false;
});

function handleNavigate(view: 'load-pod' | 'create' | 'join') {
  biometricDeclined.value = false;
  activeView.value = view;
  if (view === 'load-pod') {
    // Auto-load if file handle is configured and we have permission
    autoLoadPod.value = syncStore.isConfigured && !syncStore.needsPermission;
    needsPermissionGrant.value = syncStore.isConfigured && syncStore.needsPermission;
  } else {
    autoLoadPod.value = false;
    needsPermissionGrant.value = false;
  }
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

function handleSwitchFamily() {
  // Reset state and go to load-pod without auto-load
  needsPermissionGrant.value = false;
  autoLoadPod.value = false;
  biometricDeclined.value = false;
  activeView.value = 'load-pod';
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
      <BiometricLoginView
        v-if="activeView === 'biometric'"
        :family-id="biometricFamilyId"
        :family-name="biometricFamilyName"
        @signed-in="handleSignedIn"
        @use-password="handleBiometricFallback"
        @switch-family="handleSwitchFamily"
      />

      <WelcomeGate v-else-if="activeView === 'welcome'" @navigate="handleNavigate" />

      <LoadPodView
        v-else-if="activeView === 'load-pod'"
        :needs-permission-grant="needsPermissionGrant"
        :auto-load="autoLoadPod"
        :skip-biometric="biometricDeclined"
        @back="activeView = 'welcome'"
        @file-loaded="handleFileLoaded"
        @switch-family="handleSwitchFamily"
        @biometric-available="handleBiometricAvailable"
      />

      <PickBeanView
        v-else-if="activeView === 'pick-bean'"
        :file-unencrypted="fileUnencrypted"
        @back="handleSwitchFamily"
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
