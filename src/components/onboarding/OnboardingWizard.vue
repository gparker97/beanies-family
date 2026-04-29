<script setup lang="ts">
import { ref, onMounted, computed, type Component } from 'vue';

// Outer overlay fade is driven by a class toggle + setTimeout unmount rather
// than Vue's <Transition>. On WebKit/Safari, <Transition> inside <Teleport>
// occasionally fails to fire `transitionend`, leaving the overlay stuck in
// `leave-from + leave-active` and blocking all clicks (issue #153). A plain
// class + timeout is deterministic across browsers.
const OVERLAY_FADE_MS = 300;

import OnboardingWelcome from './OnboardingWelcome.vue';
import OnboardingAccount from './OnboardingAccount.vue';
import OnboardingRecurring from './OnboardingRecurring.vue';
import OnboardingSavings from './OnboardingSavings.vue';
import OnboardingActivity from './OnboardingActivity.vue';
import OnboardingComplete from './OnboardingComplete.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { reportError } from '@/utils/errorReporter';
import { ErrorSurfaces } from './errorSurfaces';

const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const { t } = useTranslation();

interface StepDef {
  component: Component;
  /** True for the data-entry steps (2-5); false for Welcome and Complete which own their primary CTA. */
  hasNavBar: boolean;
  /** Skip-button label key — only relevant when hasNavBar is true. */
  skipKey: 'onboarding.skip' | 'onboarding.skipAddLater' | null;
}

const STEPS: readonly StepDef[] = [
  { component: OnboardingWelcome, hasNavBar: false, skipKey: null },
  { component: OnboardingAccount, hasNavBar: true, skipKey: 'onboarding.skip' },
  { component: OnboardingRecurring, hasNavBar: true, skipKey: 'onboarding.skip' },
  { component: OnboardingSavings, hasNavBar: true, skipKey: 'onboarding.skip' },
  { component: OnboardingActivity, hasNavBar: true, skipKey: 'onboarding.skipAddLater' },
  { component: OnboardingComplete, hasNavBar: false, skipKey: null },
] as const;

const currentStep = ref(1);
const direction = ref<'forward' | 'backward'>('forward');
const mounted = ref(true);
const visible = ref(true);

const currentDef = computed(() => STEPS[currentStep.value - 1] ?? STEPS[0]);
const totalSteps = STEPS.length;
const skipLabelKey = computed(() => currentDef.value.skipKey ?? 'onboarding.skip');

// Owned here, threaded into Savings via v-model and Complete via prop. Today's
// hardcoded `20` is the same default; the slider now actually reaches Complete.
const savingsPercent = ref(20);

function dismiss() {
  visible.value = false;
  setTimeout(() => {
    mounted.value = false;
  }, OVERLAY_FADE_MS);
}

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
    mounted.value = false;
  }
});

function goNext() {
  direction.value = 'forward';
  if (currentStep.value < totalSteps) {
    currentStep.value++;
  }
}

function goBack() {
  direction.value = 'backward';
  if (currentStep.value > 1) {
    currentStep.value--;
  }
}

/**
 * Fire-and-forget background sync on dismiss. NOT awaited — the user has
 * moved on, awaiting risks racing the unmount. Failure routes to Slack
 * via reportError without blocking dismissal. Non-blocking + non-silent.
 */
function syncInBackground(surface: string) {
  if (!syncStore.isConfigured) return;
  syncStore.syncNow(true).catch((e) =>
    reportError({
      surface,
      message: 'Background sync failed on onboarding dismiss — user already proceeded.',
      error: e,
    })
  );
}

function handleSkip() {
  settingsStore.setOnboardingCompleted(true);
  syncInBackground(ErrorSurfaces.onboardingSkipSync);
  dismiss();
}

function handleFinish() {
  settingsStore.setOnboardingCompleted(true);
  syncInBackground(ErrorSurfaces.onboardingFinishSync);
  dismiss();
  // No celebrate('setup-complete') — OnboardingComplete IS the celebration
  // moment. Two consecutive "all set" surfaces is redundant.
}

const transitionName = computed(() =>
  direction.value === 'forward' ? 'ob-slide-left' : 'ob-slide-right'
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="mounted"
      class="ob-overlay"
      :class="{ 'ob-overlay-hidden': !visible }"
      data-testid="onboarding-wizard"
    >
      <div class="ob-container">
        <!-- Step content -->
        <div class="ob-content">
          <Transition :name="transitionName" mode="out-in">
            <component
              :is="currentDef.component"
              :key="currentStep"
              v-model:savings-percent="savingsPercent"
              @next="goNext"
              @back="goBack"
              @finish="handleFinish"
            />
          </Transition>
        </div>

        <!-- Nav bar — data-entry steps only -->
        <div v-if="currentDef.hasNavBar" class="ob-nav">
          <button class="ob-nav-back" @click="goBack">
            {{ t('onboarding.back') }}
          </button>
          <div class="flex items-center gap-3 sm:gap-4">
            <button class="ob-nav-skip" @click="handleSkip">
              {{ t(skipLabelKey) }}
            </button>
            <button class="ob-nav-next" data-testid="onboarding-next" @click="goNext">
              {{ t('onboarding.next') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Overlay: full-screen backdrop. On desktop, scrolls vertically if the
 * modal is taller than the viewport — keeps modal-internal scroll bars
 * from ever showing. On mobile, the modal fills the screen and the
 * overlay matches; no scroll needed at this level. */
.ob-overlay {
  align-items: center;
  backdrop-filter: blur(8px);
  background: rgb(44 62 80 / 60%);
  display: flex;
  inset: 0;
  justify-content: center;
  opacity: 1;
  padding: 0;
  position: fixed;
  transition: opacity 0.3s ease;

  /*
   * 200 matches the documented chrome tier in BaseModal (PublicNav etc.).
   * BaseModal's layer="top" is z-[250] — that's specifically reserved for
   * modals that must stack above this overlay (e.g. the InviteWizardModal
   * spawned from OnboardingInvitePanel on the Complete step). Don't bump
   * this above 200 without also bumping BaseModal's top layer.
   */
  z-index: 200;
}

.ob-overlay-hidden {
  opacity: 0;
  pointer-events: none;
}

@media (width >= 640px) {
  .ob-overlay {
    align-items: flex-start; /* anchor modal near top so growth happens downward */
    overflow-y: auto; /* outer scroll if modal > viewport — no inner bars */
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

    /* Auto-sized to content. No max-height: when modal exceeds viewport,
     * the OVERLAY scrolls (above), so modal-internal scrollbars never
     * show. The gradient on .ob-content always covers the full content. */
    max-height: none;
  }
}

/* Content: gradient lives here so it covers the full scrollable area on
 * any step — fixes the "gradient turns to white when scrolling" bug
 * (caused by min-height: 100% being shorter than scroll-extent on the form).
 *
 * Overflow strategy:
 *   - Mobile: `overflow: hidden auto` — horizontal hidden (defense against
 *     future layout bugs that could otherwise produce an x-scrollbar; the
 *     outer .ob-container's overflow:hidden also clips, but specifying it
 *     here too means no spec quirk where visible-paired-with-hidden silently
 *     turns the other axis into auto). Vertical auto so content scrolls
 *     within the modal when viewport is short.
 *   - Desktop: `overflow: visible` (both axes explicit, no spec quirk).
 *     The outer overlay scrolls if the modal exceeds the viewport. The
 *     .ob-container's overflow:hidden still clips any sideways overflow.
 *     No internal scrollbar ever shows on desktop. */
.ob-content {
  background: linear-gradient(180deg, var(--cloud-white, #f8f9fa) 0%, #edf6fc 100%);
  flex: 1;
  overflow: hidden auto;
  position: relative;
}

.dark .ob-content {
  background: linear-gradient(180deg, #1a252f 0%, #1e3040 100%);
}

@media (width >= 640px) {
  .ob-content {
    overflow: visible;
  }
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
