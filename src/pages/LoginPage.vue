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
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useFamilyStore } from '@/stores/familyStore';

const router = useRouter();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const familyStore = useFamilyStore();

type LoginView = 'welcome' | 'load-pod' | 'pick-bean' | 'create' | 'join';

const props = withDefaults(defineProps<{ initialView?: LoginView }>(), {
  initialView: 'welcome',
});

const activeView = ref<LoginView>(props.initialView);
const needsPermissionGrant = ref(false);
const autoLoadPod = ref(false);
const fileUnencrypted = ref(false);
const isInitializing = ref(true);

onMounted(async () => {
  // If no members loaded yet, initialize file context
  if (familyStore.members.length === 0) {
    await familyContextStore.initialize();
    await syncStore.initialize();

    if (syncStore.isConfigured && !syncStore.needsPermission) {
      // Has a configured file — go to load-pod with auto-load
      activeView.value = 'load-pod';
      autoLoadPod.value = true;
    } else if (syncStore.isConfigured && syncStore.needsPermission) {
      // File handle exists but needs permission
      activeView.value = 'load-pod';
      needsPermissionGrant.value = true;
    }
    // else: no file handle — show welcome
  } else {
    // Members already loaded (e.g. navigated back) — go to pick-bean
    activeView.value = 'pick-bean';
    fileUnencrypted.value = !syncStore.isEncryptionEnabled;
  }

  isInitializing.value = false;
});

function handleNavigate(view: 'load-pod' | 'create' | 'join') {
  activeView.value = view;
  needsPermissionGrant.value = false;
  autoLoadPod.value = false;
}

function handleFileLoaded() {
  fileUnencrypted.value = !syncStore.isEncryptionEnabled;
  activeView.value = 'pick-bean';
}

function handleSwitchFamily() {
  // Reset state and go to load-pod without auto-load
  needsPermissionGrant.value = false;
  autoLoadPod.value = false;
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
      <WelcomeGate v-if="activeView === 'welcome'" @navigate="handleNavigate" />

      <LoadPodView
        v-else-if="activeView === 'load-pod'"
        :needs-permission-grant="needsPermissionGrant"
        :auto-load="autoLoadPod"
        @back="activeView = 'welcome'"
        @file-loaded="handleFileLoaded"
        @switch-family="handleSwitchFamily"
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
