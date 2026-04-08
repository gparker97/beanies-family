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
import { delay } from '@/utils/timing';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ complete: []; back: [] }>();

const { t } = useTranslation();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();

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

/** Run real async work (sync + auto-sync) without UI delays. */
async function runRealWork() {
  if (syncStore.isConfigured) {
    let saved = await syncStore.syncNow(true);
    if (!saved) saved = await syncStore.syncNow(true);
  }
  syncStore.setupAutoSync();
  syncStore.ensureRegistered();
}

async function runFromStep(startIdx: number) {
  phase.value = 'progress';

  // E2E fast-path: do real work, skip all UI ceremony, auto-complete
  if (isE2E) {
    await runRealWork();
    emit('complete');
    return;
  }

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
            saved = await syncStore.syncNow(true); // retry once
          }
          if (!saved) {
            errorMessage.value =
              syncStore.lastSaveError || syncStore.error || t('setupProgress.error.title');
            setStep(i, 'error');
            phase.value = 'error';
            return;
          }
        } catch (e) {
          errorMessage.value = (e as Error).message || t('setupProgress.error.title');
          setStep(i, 'error');
          phase.value = 'error';
          return;
        }
      } else {
        await delay(500); // No sync configured — brief pause
      }
    } else if (i === 4) {
      // Real: setupAutoSync + ensureRegistered
      const start = Date.now();
      syncStore.setupAutoSync();
      syncStore.ensureRegistered();
      const elapsed = Date.now() - start;
      if (elapsed < 500) await delay(500 - elapsed); // minimum visibility
    }

    setStep(i, 'done');
  }

  // All done — transition to success
  await delay(400);
  phase.value = 'success';
  // Brief delay then show success content (for crossfade)
  await delay(300);
  showSuccess.value = true;
  playFanfare();
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
      <h2 class="font-outfit text-center text-xl font-bold text-[#2C3E50] dark:text-gray-100">
        {{ t('setupProgress.title').replace('{name}', familyName) }}
      </h2>
      <p class="mb-6 text-center text-sm text-gray-400 dark:text-gray-500">
        {{ t('setupProgress.subtitle') }}
      </p>

      <!-- Progress bar -->
      <div class="mb-4">
        <div class="h-1.5 overflow-hidden rounded-full bg-[rgba(44,62,80,0.05)] dark:bg-slate-700">
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
            'bg-[#F8F9FA] dark:bg-slate-700/30': status === 'pending',
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
              'bg-gray-200/60 dark:bg-slate-600/40': status === 'pending',
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
                'text-gray-400 dark:text-gray-500': status === 'pending',
                'text-[#2C3E50] dark:text-gray-100': status === 'active' || status === 'done',
                'text-red-600 dark:text-red-400': status === 'error',
              }"
            >
              {{ t(steps[i].labelKey) }}
            </p>
            <p
              class="text-xs transition-colors duration-300"
              :class="{
                'text-gray-400 dark:text-gray-500': status === 'pending',
                'font-medium text-[#E67E22] dark:text-orange-400': status === 'active',
                'text-[#27AE60] dark:text-emerald-400': status === 'done',
                'text-red-500 dark:text-red-400': status === 'error',
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
        class="text-center text-xs text-gray-400 italic dark:text-gray-500"
      >
        {{ t(steps[Math.max(0, currentStep)].msgKey) }}
      </p>

      <!-- Error state -->
      <div v-if="phase === 'error'" class="mt-2 rounded-2xl bg-red-50 p-4 dark:bg-red-950/30">
        <p class="font-outfit mb-1 text-sm font-bold text-red-600 dark:text-red-400">
          {{ t('setupProgress.error.title') }}
        </p>
        <p v-if="errorMessage" class="mb-2 text-xs text-red-500/80 dark:text-red-400/70">
          {{ errorMessage }}
        </p>
        <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
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
            class="text-xs text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
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

          <h2 class="font-outfit text-2xl font-extrabold text-[#2C3E50] dark:text-gray-100">
            {{ t('setupProgress.success.title') }}
          </h2>
          <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
            {{ t('setupProgress.success.subtitle').replace('{name}', familyName) }}
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
