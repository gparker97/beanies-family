<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import ConfettiEffect from '@/components/ui/ConfettiEffect.vue';
import { useTranslation } from '@/composables/useTranslation';
import { playFanfare } from '@/composables/useSounds';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useAuthStore } from '@/stores/authStore';
import { reconnectForWriteRetry } from '@/services/google/driveTokenRecovery';
import { logEvent } from '@/services/telemetry';
import { delay } from '@/utils/timing';
import { reportError } from '@/utils/errorReporter';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ complete: []; back: [] }>();

const { t } = useTranslation();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const authStore = useAuthStore();

const familyName = computed(() => familyContextStore.activeFamilyName || 'Family');

// ── State machine ──
type Phase = 'progress' | 'error' | 'success';
type StepStatus = 'pending' | 'active' | 'done' | 'error';

const phase = ref<Phase>('progress');
const currentStep = ref(-1);
const stepStatuses = ref<StepStatus[]>(['pending', 'pending', 'pending', 'pending', 'pending']);
const errorMessage = ref('');
const showSuccess = ref(false); // delayed for crossfade

import type { UIStringKey } from '@/services/translation/uiStrings';

interface StepConfig {
  emoji: string;
  labelKey: UIStringKey;
  activeKey: UIStringKey;
  doneKey: UIStringKey;
  msgKey: UIStringKey;
}

const steps: StepConfig[] = [
  {
    emoji: '🌱',
    labelKey: 'setupProgress.step0.label',
    activeKey: 'setupProgress.step0.active',
    doneKey: 'setupProgress.step0.done',
    msgKey: 'setupProgress.msg0',
  },
  {
    emoji: '🔐',
    labelKey: 'setupProgress.step1.label',
    activeKey: 'setupProgress.step1.active',
    doneKey: 'setupProgress.step1.done',
    msgKey: 'setupProgress.msg1',
  },
  {
    emoji: '👨‍👩‍👦',
    labelKey: 'setupProgress.step2.label',
    activeKey: 'setupProgress.step2.active',
    doneKey: 'setupProgress.step2.done',
    msgKey: 'setupProgress.msg2',
  },
  {
    emoji: '💾',
    labelKey: 'setupProgress.step3.label',
    activeKey: 'setupProgress.step3.active',
    doneKey: 'setupProgress.step3.done',
    msgKey: 'setupProgress.msg3',
  },
  {
    emoji: '✨',
    labelKey: 'setupProgress.step4.label',
    activeKey: 'setupProgress.step4.active',
    doneKey: 'setupProgress.step4.done',
    msgKey: 'setupProgress.msg4',
  },
];

const progressPercent = computed(() => {
  const weights = [15, 40, 60, 85, 100];
  const doneCount = stepStatuses.value.filter((s) => s === 'done').length;
  if (doneCount >= 5) return 100;
  const activeIdx = stepStatuses.value.indexOf('active');
  if (activeIdx >= 0) {
    const prev = activeIdx > 0 ? weights[activeIdx - 1] : 0;
    return Math.round(prev + (weights[activeIdx] - prev) * 0.5);
  }
  return doneCount > 0 ? weights[doneCount - 1] : 0;
});

const isE2E = import.meta.env.DEV && sessionStorage.getItem('e2e_auto_auth') === 'true';

// ── Step orchestration ──
function setStep(idx: number, status: StepStatus) {
  stepStatuses.value[idx] = status;
}

/**
 * Enter the error phase from anywhere in the flow and report it. The pod
 * itself was already written back in CreatePodView's step 2, so reaching
 * here means "pod exists but a follow-up step failed" — exactly the
 * signal we want surfaced rather than silently swallowed.
 */
function enterErrorPhase(stepIdx: number, msg: string, err?: unknown): void {
  errorMessage.value = msg || t('setupProgress.error.title');
  setStep(stepIdx, 'error');
  phase.value = 'error';
  reportError({
    surface: 'setupProgress.firstSync',
    message: errorMessage.value,
    error: err,
    severity: 'critical',
    context: {
      provider_type: syncStore.storageProviderType ?? null,
      save_failure_level: syncStore.saveFailureLevel ?? null,
    },
  });
}

/** Run real async work (sync) without UI delays. */
async function runRealWork() {
  if (syncStore.isConfigured) {
    let saved = await syncStore.syncNow(true);
    if (!saved) saved = await syncStore.syncNow(true);
  }
  // setupAutoSync + ensureRegistered run ONCE, canonically, in
  // LoginPage.handleSignedIn (the single arm-and-register point for every entry
  // path — create/load/join/reconnect), reached a tick after 'complete'.
  // Removed here to avoid a duplicate registry network write on every create.
}

async function runFromStep(startIdx: number) {
  phase.value = 'progress';

  // E2E fast-path: do real work, skip all UI ceremony, auto-complete
  if (isE2E) {
    await runRealWork();
    emit('complete');
    return;
  }

  // Claim the critical-write flag for the modal's entire animation +
  // finalize phase. Without this, back-button / close-tab during the step-
  // by-step animation would bypass the router guard + beforeunload confirm
  // (criticalWriteState went back to idle the moment createNewFile returned
  // — well before this modal's UI work finishes and emits 'complete'). See
  // 2026-05-15 incident notes — greg hit this on a real device.
  const previousCriticalWriteState = syncStore.criticalWriteState;
  if (previousCriticalWriteState.kind === 'idle') {
    syncStore.criticalWriteState = { kind: 'creating' };
  }

  try {
    for (let i = startIdx; i < 5; i++) {
      currentStep.value = i;
      setStep(i, 'active');

      if (i <= 2) {
        // Perceived steps — timer only
        const durations = [800, 1000, 800];
        await delay(durations[i]);
      } else if (i === 3) {
        // Real: syncStore.syncNow
        if (syncStore.isConfigured) {
          try {
            let saved = await syncStore.syncNow(true);
            if (!saved) {
              // Transient iOS token failure right after setup (same class as the
              // initial pod write): silently re-acquire a token and retry the save
              // ONCE. The old "call syncNow twice" retried nothing for a token
              // expiry — nothing re-acquired the token between the two attempts, so
              // both failed and the user was dropped to the error screen even though
              // tapping Continue (which only SKIPS the save) then let autosync flush
              // it later. Now we actually recover the save inline.
              const canRetry = await reconnectForWriteRetry(authStore.currentUser?.email);
              logEvent({
                level: 'info',
                surface: 'setupProgress',
                message: 'member-sync save failed on setup finish — attempting silent retry',
                context: {
                  action: `member-sync-retry:${canRetry ? 'reconnected' : 'no-token'}`,
                  provider_type: syncStore.storageProviderType ?? null,
                },
              });
              if (canRetry) saved = await syncStore.syncNow(true);
            }
            if (!saved) {
              enterErrorPhase(i, syncStore.lastSaveError || syncStore.error || '');
              return;
            }
          } catch (e) {
            enterErrorPhase(i, (e as Error).message || '', e);
            return;
          }
        } else {
          await delay(500); // No sync configured — brief pause
        }
      } else if (i === 4) {
        // Perceived "finishing touches" beat. The real arm-and-register
        // (setupAutoSync + ensureRegistered) runs ONCE in
        // LoginPage.handleSignedIn — the single canonical point for every entry
        // path — a tick after this modal emits 'complete'. Kept as a timer for
        // visual continuity; no duplicate registry write here.
        await delay(500);
      }

      setStep(i, 'done');
    }

    // All done — transition to success
    await delay(400);
    phase.value = 'success';
    // Brief delay then show success content (for crossfade)
    await delay(300);
    showSuccess.value = true;
    try {
      playFanfare();
    } catch {
      // Sound is best-effort — never let it knock the user off the success screen.
    }
  } catch (e) {
    // Unexpected throw mid-flow — never leave the modal frozen on a spinner.
    // Drop to the error phase (retry / continue / back) and report.
    reportError({
      surface: 'setupProgress.unexpected',
      message: (e as Error)?.message || 'Unexpected error during pod setup',
      error: e,
      severity: 'critical',
      context: { provider_type: syncStore.storageProviderType ?? null },
    });
    errorMessage.value = (e as Error)?.message || t('setupProgress.error.title');
    setStep(Math.min(Math.max(currentStep.value, 0), 4), 'error');
    phase.value = 'error';
  } finally {
    // Release the critical-write flag — but only if we set it. Idle restore
    // covers the success path AND the early-error path; for the latter the
    // user can still cancel/retry/continue without being silently blocked.
    if (previousCriticalWriteState.kind === 'idle') {
      syncStore.criticalWriteState = { kind: 'idle' };
    }
  }
}

// ── Error actions ──
function handleRetry() {
  setStep(3, 'pending');
  errorMessage.value = '';
  runFromStep(3);
}

function handleContinueAnyway() {
  setStep(3, 'done');
  errorMessage.value = '';
  runFromStep(4);
}

function handleGoBack() {
  reset();
  emit('back');
}

function handleComplete() {
  emit('complete');
}

// ── Lifecycle ──
function reset() {
  phase.value = 'progress';
  currentStep.value = -1;
  stepStatuses.value = ['pending', 'pending', 'pending', 'pending', 'pending'];
  errorMessage.value = '';
  showSuccess.value = false;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      reset();
      runFromStep(0);
    }
  }
);
</script>

<template>
  <BaseModal :open="open" size="sm" :closable="false" layer="overlay" fullscreen-mobile>
    <!-- Progress phase -->
    <div
      v-if="phase === 'progress' || phase === 'error'"
      class="px-2 py-4"
      :class="{ 'scale-95 opacity-0 transition-all duration-300': phase === 'error' && false }"
    >
      <!-- Beanie character with sparkles -->
      <div class="relative mx-auto mb-5 w-fit">
        <img
          src="/brand/beanies_celebrating_circle_transparent_400x400.png"
          alt=""
          class="animate-beanie-float mx-auto h-24 w-24 object-contain drop-shadow-md"
        />
        <!-- Sparkle dots -->
        <span
          v-for="(s, i) in [
            'top-1 left-2 bg-[#F15D22]',
            'top-4 right-0 bg-[#E67E22]',
            'bottom-3 left-0 bg-[#AED6F1]',
            'top-2 right-4 bg-[#27AE60]',
            'bottom-4 right-2 bg-[#F15D22]',
          ]"
          :key="i"
          class="absolute h-2 w-2 rounded-full"
          :class="s"
          :style="{ animation: `sparkle 2s ease-in-out ${i * 0.3}s infinite` }"
        />
      </div>

      <!-- Title -->
      <h2 class="font-outfit dark:text-ink text-center text-xl font-bold text-[#2C3E50]">
        {{ fillTemplate(t('setupProgress.title'), { name: familyName }) }}
      </h2>
      <p class="dark:text-ink-faint mb-6 text-center text-sm text-gray-400">
        {{ t('setupProgress.subtitle') }}
      </p>

      <!-- Progress bar -->
      <div class="mb-4">
        <div
          class="dark:bg-surface-overlay h-1.5 overflow-hidden rounded-full bg-[rgba(44,62,80,0.05)]"
        >
          <div
            class="progress-shimmer h-full rounded-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] transition-all duration-600 ease-out"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <p class="font-outfit mt-1.5 text-right text-xs font-semibold text-[#F15D22]">
          {{ progressPercent }}%
        </p>
      </div>

      <!-- Step list -->
      <ul class="mb-5 flex flex-col gap-1.5">
        <li
          v-for="(status, i) in stepStatuses"
          :key="i"
          class="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300"
          :class="{
            'dark:bg-surface-overlay/30 bg-[#F8F9FA]': status === 'pending',
            'bg-[#FFF8F0] shadow-[0_0_0_1.5px_rgba(241,93,34,0.15)] dark:bg-orange-950/20':
              status === 'active',
            'bg-[#f0faf4] dark:bg-emerald-950/20': status === 'done',
            'bg-red-50 dark:bg-red-950/20': status === 'error',
          }"
        >
          <!-- Icon squircle -->
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-base transition-all duration-300"
            :class="{
              'dark:bg-surface-hover/40 bg-gray-200/60': status === 'pending',
              'bg-gradient-to-br from-[#F15D22] to-[#E67E22] shadow-[0_3px_12px_rgba(241,93,34,0.3)]':
                status === 'active',
              'bg-[#27AE60] shadow-[0_3px_12px_rgba(39,174,96,0.25)]': status === 'done',
              'bg-red-500': status === 'error',
            }"
            :style="
              status === 'active'
                ? { animation: 'icon-pulse 1.5s ease-in-out infinite' }
                : undefined
            "
          >
            <!-- Pending: emoji -->
            <span v-if="status === 'pending'">{{ steps[i].emoji }}</span>
            <!-- Active: BeanieSpinner -->
            <BeanieSpinner v-else-if="status === 'active'" size="xs" />
            <!-- Done: animated checkmark -->
            <svg
              v-else-if="status === 'done'"
              class="h-[18px] w-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path class="check-draw" d="M4 12l6 6L20 6" />
            </svg>
            <!-- Error: X -->
            <span v-else class="text-sm text-white">✕</span>
          </div>

          <!-- Text -->
          <div class="min-w-0 flex-1">
            <p
              class="font-outfit text-sm font-semibold transition-colors duration-300"
              :class="{
                'dark:text-ink-faint text-gray-400': status === 'pending',
                'dark:text-ink text-[#2C3E50]': status === 'active' || status === 'done',
                'dark:text-danger-lift text-red-600': status === 'error',
              }"
            >
              {{ t(steps[i].labelKey) }}
            </p>
            <p
              class="text-xs transition-colors duration-300"
              :class="{
                'dark:text-ink-faint text-gray-400': status === 'pending',
                'dark:text-accent-lift font-medium text-[#E67E22]': status === 'active',
                'dark:text-success-lift text-[#27AE60]': status === 'done',
                'dark:text-danger-lift text-red-500': status === 'error',
              }"
            >
              <span
                v-if="status === 'active'"
                class="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#F15D22] align-middle"
              />
              {{ t(status === 'done' ? steps[i].doneKey : steps[i].activeKey) }}
            </p>
          </div>
        </li>
      </ul>

      <!-- Bottom message (progress) or Error state -->
      <p
        v-if="phase === 'progress'"
        class="dark:text-ink-faint text-center text-xs text-gray-400 italic"
      >
        {{ t(steps[Math.max(0, currentStep)].msgKey) }}
      </p>

      <!-- Error state -->
      <div v-if="phase === 'error'" class="mt-2 rounded-2xl bg-red-50 p-4 dark:bg-red-950/30">
        <p class="font-outfit dark:text-danger-lift mb-1 text-sm font-bold text-red-600">
          {{ t('setupProgress.error.title') }}
        </p>
        <p v-if="errorMessage" class="dark:text-danger-lift mb-2 text-xs text-red-500/80">
          {{ errorMessage }}
        </p>
        <p class="dark:text-ink-soft mb-4 text-xs text-gray-500">
          {{ t('setupProgress.error.description') }}
        </p>
        <div class="flex flex-col gap-2">
          <BaseButton variant="primary" size="sm" @click="handleRetry">
            {{ t('setupProgress.error.retry') }}
          </BaseButton>
          <BaseButton variant="outline" size="sm" @click="handleContinueAnyway">
            {{ t('setupProgress.error.continue') }}
          </BaseButton>
          <button
            type="button"
            class="dark:hover:text-ink-soft text-xs text-gray-400 transition-colors hover:text-gray-600"
            @click="handleGoBack"
          >
            {{ t('setupProgress.error.back') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Success phase -->
    <div v-if="phase === 'success'" class="relative px-2 py-6 text-center">
      <ConfettiEffect :active="showSuccess" />

      <Transition
        enter-active-class="transition-all duration-500 ease-out"
        enter-from-class="opacity-0 scale-75"
        enter-to-class="opacity-100 scale-100"
      >
        <div v-if="showSuccess">
          <img
            src="/brand/beanies_celebrating_line_transparent_560x225.png"
            alt=""
            class="mx-auto mb-5 w-full max-w-[220px] object-contain"
          />

          <h2 class="font-outfit dark:text-ink text-2xl font-extrabold text-[#2C3E50]">
            {{ t('setupProgress.success.title') }}
          </h2>
          <p class="dark:text-ink-faint mt-1 text-sm text-gray-400">
            {{ fillTemplate(t('setupProgress.success.subtitle'), { name: familyName }) }}
          </p>

          <BaseButton
            class="mt-6 w-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] shadow-[0_4px_16px_rgba(241,93,34,0.35)] transition-shadow hover:shadow-[0_6px_24px_rgba(241,93,34,0.45)]"
            size="lg"
            @click="handleComplete"
          >
            {{ t('setupProgress.success.cta') }}
          </BaseButton>
        </div>
      </Transition>
    </div>
  </BaseModal>
</template>

<style scoped>
/* Sparkle animation */
@keyframes sparkle {
  0%,
  100% {
    opacity: 0;
    transform: scale(0);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

/* Icon pulse for active step */
@keyframes icon-pulse {
  0%,
  100% {
    box-shadow: 0 3px 12px rgb(241 93 34 / 30%);
  }

  50% {
    box-shadow: 0 3px 20px rgb(241 93 34 / 50%);
  }
}

/* Checkmark draw animation */
.check-draw {
  animation: draw-check 0.35s ease-out forwards;
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
}

@keyframes draw-check {
  to {
    stroke-dashoffset: 0;
  }
}

/* Progress bar shimmer */
.progress-shimmer::after {
  animation: shimmer 1.5s ease-in-out infinite;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 40%), transparent);
  content: '';
  inset: 0;
  position: absolute;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
}

/* Smooth transition for progress width */
.duration-600 {
  transition-duration: 600ms;
}
</style>
