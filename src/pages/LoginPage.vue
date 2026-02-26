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
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

const router = useRouter();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

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

// Family picker state for multi-family passkey selection
const familiesWithPasskeys = ref<Array<{ id: string; name: string }>>([]);

onMounted(async () => {
  // Initialize stores but always show the Welcome Gate first
  if (familyStore.members.length === 0) {
    await familyContextStore.initialize();
    await syncStore.initialize();

    // Check if biometric login is available
    const hasPlatform = await isPlatformAuthenticatorAvailable();

    if (hasPlatform) {
      // Check all families for passkeys
      const allFamilies = familyContextStore.allFamilies;
      const withPasskeys: Array<{ id: string; name: string }> = [];

      for (const family of allFamilies) {
        const hasPasskeys = await authStore.checkHasRegisteredPasskeys(family.id);
        if (hasPasskeys) {
          withPasskeys.push({ id: family.id, name: family.name ?? 'My Family' });
        }
      }

      if (withPasskeys.length > 1) {
        // Multiple families with passkeys — show family picker
        familiesWithPasskeys.value = withPasskeys;
        activeView.value = 'family-picker';
      } else if (withPasskeys.length === 1) {
        // Single family with passkeys — go straight to biometric
        const family = withPasskeys[0]!;
        await activateFamilyForBiometric(family.id, family.name);
      }
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

async function handleFamilyPicked(family: { id: string; name: string }) {
  await activateFamilyForBiometric(family.id, family.name);
}

async function handleDeleteFamily(family: { id: string; name: string }) {
  const confirmed = await showConfirm({
    title: 'confirm.deleteLocalFamilyTitle',
    message: 'confirm.deleteLocalFamily',
  });
  if (!confirmed) return;

  await familyContextStore.deleteLocalFamily(family.id);
  familiesWithPasskeys.value = familiesWithPasskeys.value.filter((f) => f.id !== family.id);

  // If no families left, go to welcome
  if (familiesWithPasskeys.value.length === 0) {
    activeView.value = 'welcome';
  } else if (familiesWithPasskeys.value.length === 1) {
    // Single family left — go straight to biometric
    const remaining = familiesWithPasskeys.value[0]!;
    await activateFamilyForBiometric(remaining.id, remaining.name);
  }
}

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
      <!-- Family picker for multi-family passkey selection -->
      <div
        v-if="activeView === 'family-picker'"
        class="mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800"
      >
        <div class="mb-6 text-center">
          <img
            src="/brand/beanies_logo_transparent_logo_only_192x192.png"
            alt=""
            class="mx-auto mb-3 h-16 w-16"
          />
          <h2 class="font-outfit text-lg font-bold text-gray-900 dark:text-gray-100">
            Which family?
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose a family to sign into</p>
        </div>
        <div class="space-y-3">
          <div
            v-for="family in familiesWithPasskeys"
            :key="family.id"
            class="flex items-center gap-2"
          >
            <button
              class="flex flex-1 items-center gap-3 rounded-2xl border-2 border-gray-200 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#F15D22]/40 hover:shadow-lg dark:border-slate-600 dark:hover:border-[#F15D22]/30"
              @click="handleFamilyPicked(family)"
            >
              <div
                class="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F15D22]/10 text-[#F15D22]"
              >
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
              </div>
              <span class="font-outfit font-semibold text-gray-900 dark:text-gray-100">
                {{ family.name }}
              </span>
            </button>
            <button
              :title="t('action.delete')"
              class="shrink-0 rounded-xl p-2.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              @click.stop="handleDeleteFamily(family)"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        </div>
        <button
          class="mt-6 w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          @click="handleSwitchFamily"
        >
          Load a different file
        </button>
      </div>

      <BiometricLoginView
        v-else-if="activeView === 'biometric'"
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
