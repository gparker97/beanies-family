<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseCard from '@/components/ui/BaseCard.vue';
import LoginBackground from '@/components/login/LoginBackground.vue';
import TrustBadges from '@/components/login/TrustBadges.vue';
import WelcomeGate from '@/components/login/WelcomeGate.vue';
import SignInView from '@/components/login/SignInView.vue';
import CreatePodView from '@/components/login/CreatePodView.vue';
import JoinPodView from '@/components/login/JoinPodView.vue';
import { useSyncStore } from '@/stores/syncStore';

const router = useRouter();
const syncStore = useSyncStore();

type LoginView = 'welcome' | 'signin' | 'create' | 'join';

const props = withDefaults(defineProps<{ initialView?: LoginView }>(), {
  initialView: 'welcome',
});

const activeView = ref<LoginView>(props.initialView);

function handleNavigate(view: 'signin' | 'create' | 'join') {
  activeView.value = view;
}

function handleSignedIn(destination: string) {
  syncStore.setupAutoSync();
  router.replace(destination);
}
</script>

<template>
  <LoginBackground>
    <BaseCard>
      <WelcomeGate v-if="activeView === 'welcome'" @navigate="handleNavigate" />
      <SignInView
        v-else-if="activeView === 'signin'"
        @back="activeView = 'welcome'"
        @signed-in="handleSignedIn"
      />
      <CreatePodView
        v-else-if="activeView === 'create'"
        @back="activeView = 'welcome'"
        @signed-in="handleSignedIn"
      />
      <JoinPodView
        v-else-if="activeView === 'join'"
        @back="activeView = 'welcome'"
        @signed-in="handleSignedIn"
      />
    </BaseCard>
    <template #below-card>
      <TrustBadges />
    </template>
  </LoginBackground>
</template>
