<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import OnboardingWelcome from './OnboardingWelcome.vue';
import OnboardingMoney from './OnboardingMoney.vue';
import OnboardingFamily from './OnboardingFamily.vue';
import OnboardingComplete from './OnboardingComplete.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useActivityStore } from '@/stores/activityStore';
import { useSyncStore } from '@/stores/syncStore';
import { celebrate } from '@/composables/useCelebration';
import { useTranslation } from '@/composables/useTranslation';

const settingsStore = useSettingsStore();
const accountsStore = useAccountsStore();
const recurringStore = useRecurringStore();
const activityStore = useActivityStore();
const syncStore = useSyncStore();
const { t } = useTranslation();

const currentStep = ref(1);
const direction = ref<'forward' | 'backward'>('forward');
const visible = ref(true);

// Summary data for completion screen
const savingsPercent = ref(20);

const accountCount = computed(() => accountsStore.accounts.length);
const recurringCount = computed(() => recurringStore.recurringItems.length);
const activityCount = computed(() => activityStore.activities.length);

onMounted(() => {
  // E2E auto-skip: same pattern as InviteGateOverlay and TrustDeviceModal.
  // The e2e_force_onboarding flag allows E2E tests to show the wizard even with auto-auth.
  if (
    import.meta.env.DEV &&
    sessionStorage.getItem('e2e_auto_auth') === 'true' &&
    sessionStorage.getItem('e2e_force_onboarding') !== 'true'
  ) {
    settingsStore.setOnboardingCompleted(true);
    visible.value = false;
  }
});

function goNext() {
  direction.value = 'forward';
  if (currentStep.value < 4) {
    currentStep.value++;
  }
}

function goBack() {
  direction.value = 'backward';
  if (currentStep.value > 1) {
    currentStep.value--;
  }
}

async function handleSkip() {
  settingsStore.setOnboardingCompleted(true);
  if (syncStore.isConfigured) {
    await syncStore.syncNow(true);
  }
  visible.value = false;
}

async function handleFinish() {
  settingsStore.setOnboardingCompleted(true);
  if (syncStore.isConfigured) {
    await syncStore.syncNow(true);
  }
  visible.value = false;
  celebrate('setup-complete');
}

const transitionName = computed(() =>
  direction.value === 'forward' ? 'ob-slide-left' : 'ob-slide-right'
);
</script>

<template>
  <Teleport to="body">
    <Transition name="ob-fade">
      <div v-if="visible" class="ob-overlay" data-testid="onboarding-wizard">
        <div class="ob-container">
          <!-- Step content -->
          <div class="ob-content">
            <Transition :name="transitionName" mode="out-in">
              <OnboardingWelcome v-if="currentStep === 1" :key="1" @next="goNext" />
              <OnboardingMoney
                v-else-if="currentStep === 2"
                :key="2"
                @next="goNext"
                @back="goBack"
              />
              <OnboardingFamily
                v-else-if="currentStep === 3"
                :key="3"
                @next="goNext"
                @back="goBack"
              />
              <OnboardingComplete
                v-else
                :key="4"
                :account-count="accountCount"
                :recurring-count="recurringCount"
                :savings-percent="savingsPercent"
                :activity-count="activityCount"
                @finish="handleFinish"
              />
            </Transition>
          </div>

          <!-- Nav bar (steps 2 & 3 only) -->
          <div v-if="currentStep === 2 || currentStep === 3" class="ob-nav">
            <button class="ob-nav-back" @click="goBack">
              {{ t('onboarding.back') }}
            </button>
            <div class="flex items-center gap-3 sm:gap-4">
              <button class="ob-nav-skip" @click="handleSkip">
                {{ t('onboarding.skip') }}
              </button>
              <button
                class="ob-nav-next"
                data-testid="onboarding-next"
                @click="currentStep === 3 ? ((direction = 'forward'), (currentStep = 4)) : goNext()"
              >
                {{ currentStep === 3 ? t('onboarding.allDone') : t('onboarding.nextFamily') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ob-overlay {
  align-items: center;
  background: rgb(44 62 80 / 60%);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 0;
  position: fixed;
  z-index: 9999;
}

/* Blur lives on a pseudo-element so the Vue-transitioned .ob-overlay itself
   carries no backdrop-filter — webkit stalls the leave transition when the
   transitioning element has an active backdrop-filter. See issue #153. */
.ob-overlay::before {
  backdrop-filter: blur(8px);
  content: '';
  inset: 0;
  position: absolute;
  z-index: -1;
}

@media (width >= 640px) {
  .ob-overlay {
    padding: 24px;
  }
}

.ob-container {
  background: var(--cloud-white, #f8f9fa);
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100%;
  max-width: 800px;
  overflow: hidden;
  width: 100%;
}

.dark .ob-container {
  background: #1a252f;
}

@media (width >= 640px) {
  .ob-container {
    border-radius: 24px;
    box-shadow: 0 20px 60px rgb(44 62 80 / 25%);
    height: auto;
    max-height: 90vh;
  }
}

.ob-content {
  flex: 1;
  overflow: hidden auto;
  position: relative;
}

.ob-nav {
  align-items: center;
  background: var(--cloud-white, #f8f9fa);
  border-top: 1px solid rgb(44 62 80 / 5%);
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  position: relative;
  z-index: 1;
}

.dark .ob-nav {
  background: #1a252f;
  border-top-color: rgb(255 255 255 / 6%);
}

@media (width >= 640px) {
  .ob-nav {
    padding: 16px 40px;
  }
}

.ob-nav-back {
  background: none;
  border: none;
  color: var(--deep-slate, #2c3e50);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.78rem;
  font-weight: 500;
  opacity: 0.35;
  padding: 12px 16px;
}

.dark .ob-nav-back {
  color: #94a3b8;
}

.ob-nav-skip {
  background: none;
  border: none;
  color: var(--deep-slate, #2c3e50);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.68rem;
  font-weight: 500;
  opacity: 0.3;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dark .ob-nav-skip {
  color: #94a3b8;
}

.ob-nav-next {
  background: linear-gradient(135deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  border: none;
  border-radius: 30px;
  box-shadow: 0 6px 20px rgb(241 93 34 / 20%);
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 10px 20px;
  transition: transform 0.2s;
}

@media (width >= 640px) {
  .ob-nav-next {
    border-radius: 40px;
    font-size: 0.82rem;
    padding: 12px 32px;
  }
}

.ob-nav-next:hover {
  transform: translateY(-2px);
}

/* Overlay fade transition */
.ob-fade-enter-active,
.ob-fade-leave-active {
  transition: opacity 0.3s ease;
}

.ob-fade-enter-from,
.ob-fade-leave-to {
  opacity: 0;
}

/* Step slide transitions */
.ob-slide-left-enter-active,
.ob-slide-left-leave-active,
.ob-slide-right-enter-active,
.ob-slide-right-leave-active {
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
}

.ob-slide-left-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.ob-slide-left-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

.ob-slide-right-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}

.ob-slide-right-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

@media (prefers-reduced-motion: reduce) {
  .ob-slide-left-enter-active,
  .ob-slide-left-leave-active,
  .ob-slide-right-enter-active,
  .ob-slide-right-leave-active {
    transition: opacity 0.15s ease;
  }

  .ob-slide-left-enter-from,
  .ob-slide-left-leave-to,
  .ob-slide-right-enter-from,
  .ob-slide-right-leave-to {
    transform: none;
  }
}
</style>
