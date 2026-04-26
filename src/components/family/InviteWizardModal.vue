<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue';
import { BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ShareChannelGrid from '@/components/family/ShareChannelGrid.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { useSounds } from '@/composables/useSounds';
import type { InviteFlow } from '@/composables/useInviteFlow';
import type { StorageProviderType } from '@/services/sync/storageProvider';

interface Prefill {
  email: string;
  memberName: string;
}

const props = defineProps<{
  /** v-model:open from parent. */
  open: boolean;
  /** Active sync provider — drives Step 1 CTA semantics (share vs confirm). */
  provider: StorageProviderType | null;
  /** Inviter context used in the share message body. */
  inviterName: string;
  familyName: string;
  /** When opened from a per-bean share button, prefill + bean name. */
  prefill?: Prefill;
  /** Single owner of invite-link state. Created in the parent page. */
  inviteFlow: InviteFlow;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const { pulse } = useAttentionPulse();
const { playClink } = useSounds();

// --- UI state (this component only — flow state lives in props.inviteFlow) ---
type Step = 1 | 2;
const currentStep = ref<Step>(1);
const emailValue = ref('');
const confirmed = ref(false);
const faqOpen = ref(false);
const emailFieldRef = useTemplateRef<HTMLInputElement>('emailField');

// --- Derived ---
const isPrefilled = computed(() => Boolean(props.prefill?.email));

const heroTitle = computed(() => {
  if (currentStep.value === 2) return t('inviteWizard.step2.title');
  return isPrefilled.value && props.prefill
    ? t('inviteWizard.step1.titlePrefilled').replace('{name}', props.prefill.memberName)
    : t('inviteWizard.step1.title');
});

const trimmedEmail = computed(() => emailValue.value.trim());
const hasEmail = computed(() => trimmedEmail.value.length > 3 && trimmedEmail.value.includes('@'));
const canSubmit = computed(
  () => hasEmail.value && confirmed.value && !props.inviteFlow.isGenerating.value
);

const isDriveProvider = computed(() => props.provider === 'google_drive');

const ctaLabel = computed(() => {
  if (!hasEmail.value) return t('inviteWizard.step1.cta.empty');
  if (!confirmed.value) return t('inviteWizard.step1.cta.unconfirmed');
  const key = isDriveProvider.value
    ? 'inviteWizard.step1.cta.share'
    : 'inviteWizard.step1.cta.confirm';
  return t(key).replace('{email}', trimmedEmail.value);
});

const confirmLabel = computed(() => {
  if (!hasEmail.value) return t('inviteWizard.step1.confirmLabel.empty');
  return t('inviteWizard.step1.confirmLabel.withEmail').replace('{email}', trimmedEmail.value);
});

const step2Caption = computed(() =>
  t('inviteWizard.step2.caption').replace(
    '{email}',
    props.inviteFlow.lastSharedEmail.value ?? trimmedEmail.value
  )
);

const error = computed(() => props.inviteFlow.error.value);
// Errors with `edit-email` recovery surface near the email field;
// `retry` errors offer a Try-Again button next to the message.
const showRetryButton = computed(() => error.value?.recovery === 'retry');

// --- Lifecycle ---
// Reset wizard UI state when the modal opens. Composable state is reset by
// the parent (it owns the composable's lifecycle).
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    currentStep.value = 1;
    emailValue.value = props.prefill?.email ?? '';
    confirmed.value = false;
    faqOpen.value = false;
    // If prefilled, the user must still actively confirm — pulse the email
    // so their eye lands on the value to verify.
    if (isPrefilled.value) {
      await new Promise((r) => setTimeout(r, 80));
      pulse(emailFieldRef.value);
    }
  },
  { immediate: true }
);

// --- Actions ---
async function handleSubmit() {
  if (!canSubmit.value) return;
  const ok = isDriveProvider.value
    ? await props.inviteFlow.shareDriveAccess(trimmedEmail.value)
    : await props.inviteFlow.regenerateLinkForEmail(trimmedEmail.value);
  if (ok) {
    playClink();
    currentStep.value = 2;
  }
  // On failure: composable already set error; template renders it inline.
}

function handleRetry() {
  // Clear the error and let the user resubmit. CTA is already enabled.
  props.inviteFlow.clearError();
}

function goBackToStep1() {
  // Preserve email value so the user doesn't have to retype.
  // Force re-confirmation so they actively re-acknowledge.
  confirmed.value = false;
  props.inviteFlow.clearError();
  currentStep.value = 1;
}

function handleClose() {
  emit('close');
}
</script>

<template>
  <BaseModal
    :open="open"
    size="md"
    layer="overlay"
    custom-header
    :closable="!inviteFlow.isGenerating.value"
    fullscreen-mobile
    @close="handleClose"
  >
    <!-- Hero band: tinted wash + progress strip -->
    <template #header>
      <div
        class="relative overflow-hidden rounded-t-3xl"
        :style="{ backgroundColor: 'var(--tint-orange-8)' }"
      >
        <!-- Close button -->
        <button
          type="button"
          class="absolute top-3 right-3 z-10 rounded-full bg-white/80 p-1.5 text-gray-500 backdrop-blur-sm transition-all hover:bg-white hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800/80 dark:hover:bg-slate-800"
          :aria-label="t('action.close')"
          :disabled="inviteFlow.isGenerating.value"
          @click="handleClose"
        >
          <BeanieIcon name="close" size="md" />
        </button>

        <!-- Progress strip -->
        <div class="flex items-center justify-center gap-3 px-8 pt-7 pb-4">
          <!-- Step 1 mascot: father icon -->
          <div class="flex flex-col items-center gap-1.5">
            <img
              src="/brand/beanies_father_icon_transparent_360x360.png"
              alt=""
              aria-hidden="true"
              class="h-14 w-14 object-contain transition-all duration-500"
              :class="
                currentStep === 1
                  ? 'wizard-bean-active opacity-100'
                  : 'opacity-80 drop-shadow-[0_4px_10px_rgba(230,126,34,0.22)]'
              "
            />
            <span
              class="font-outfit text-xs font-semibold tracking-[0.08em] uppercase transition-colors"
              :class="currentStep === 1 ? 'text-[var(--color-primary)]' : 'text-[#E67E22]'"
            >
              {{ t('inviteWizard.step1.label') }}
            </span>
          </div>

          <!-- Curve -->
          <div
            class="mb-6 h-[3px] w-12 overflow-hidden rounded-sm bg-gray-200/80 dark:bg-slate-600"
          >
            <div
              class="from-primary-500 to-terracotta-400 h-full bg-gradient-to-r transition-transform duration-500 ease-out"
              :style="{
                transform: `scaleX(${currentStep === 2 ? 1 : 0})`,
                transformOrigin: 'left',
              }"
            />
          </div>

          <!-- Step 2 mascot: parent + child holding hands (logo only) -->
          <div class="flex flex-col items-center gap-1.5">
            <img
              src="/brand/beanies_logo_transparent_logo_only_192x192.png"
              alt=""
              aria-hidden="true"
              class="h-14 w-16 object-contain transition-all duration-500"
              :class="currentStep === 2 ? 'wizard-bean-active opacity-100' : 'opacity-60'"
            />
            <span
              class="font-outfit text-xs font-semibold tracking-[0.08em] uppercase transition-colors"
              :class="currentStep === 2 ? 'text-[var(--color-primary)]' : 'text-gray-400'"
            >
              {{ t('inviteWizard.step2.label') }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- Step 1 -->
    <div v-if="currentStep === 1" data-testid="invite-wizard-step-1" class="space-y-4">
      <div>
        <h2 class="font-outfit text-secondary-500 text-2xl font-bold dark:text-gray-100">
          {{ heroTitle }}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {{ t('inviteWizard.step1.subhead') }}
        </p>
      </div>

      <input
        ref="emailField"
        v-model="emailValue"
        type="email"
        autocomplete="off"
        :placeholder="t('invite.shareEmail.placeholder')"
        data-testid="invite-email-input"
        class="font-inter w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-base font-medium text-gray-900 transition-all outline-none placeholder:font-normal placeholder:text-gray-400 focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--tint-orange-15)] dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
      />

      <!-- Inline error chip -->
      <div
        v-if="error"
        class="flex items-start gap-2 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--tint-orange-8)] px-3.5 py-3"
        data-testid="invite-wizard-error"
      >
        <BeanieIcon
          name="alert-circle"
          size="sm"
          class="mt-0.5 flex-shrink-0 text-[var(--color-primary)]"
        />
        <div class="flex-1 text-sm text-[var(--color-primary)]">
          {{ error.message }}
        </div>
        <button
          v-if="showRetryButton"
          type="button"
          class="font-outfit flex-shrink-0 rounded-lg bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#D14D1A]"
          data-testid="invite-wizard-retry"
          @click="handleRetry"
        >
          {{ t('inviteWizard.error.tryAgain') }}
        </button>
      </div>

      <!-- Confirm checkbox — gated on this for explicit user confirmation -->
      <label
        class="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-dashed border-[var(--color-primary)]/30 px-4 py-3 transition-all"
        :class="
          confirmed
            ? 'border-solid border-[var(--color-primary)] bg-[var(--tint-orange-8)]'
            : 'hover:border-[var(--color-primary)]/60 hover:bg-[var(--tint-orange-8)]/50'
        "
      >
        <input
          v-model="confirmed"
          type="checkbox"
          class="peer sr-only"
          data-testid="invite-wizard-confirm-checkbox"
        />
        <span
          class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 border-gray-300 bg-white transition-all peer-checked:border-[var(--color-primary)] peer-checked:bg-[var(--color-primary)] dark:border-slate-500 dark:bg-slate-700"
        >
          <BeanieIcon v-if="confirmed" name="check" size="sm" class="text-white" />
        </span>
        <span class="text-sm leading-relaxed font-medium text-gray-700 dark:text-gray-300">
          <span v-if="hasEmail">
            <span
              class="rounded-md border border-[var(--color-primary)]/30 bg-white px-1.5 py-0.5 font-semibold text-[var(--color-primary)] dark:bg-slate-800"
            >
              {{ trimmedEmail }}
            </span>
            {{ ' is their Google account email for the family pod' }}
          </span>
          <span v-else>{{ confirmLabel }}</span>
        </span>
      </label>

      <!-- Primary CTA -->
      <button
        type="button"
        class="font-outfit flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-bold text-white shadow-md transition-all enabled:bg-gradient-to-br enabled:from-[var(--color-primary)] enabled:to-[#E67E22] enabled:shadow-[var(--color-primary)]/30 enabled:hover:-translate-y-0.5 enabled:hover:from-[#D14D1A] enabled:hover:to-[#D86E15] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        :disabled="!canSubmit"
        data-testid="invite-wizard-submit"
        @click="handleSubmit"
      >
        <span v-if="inviteFlow.isGenerating.value" class="flex items-center gap-2">
          <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {{ t('common.saving') }}
        </span>
        <template v-else>
          <span>{{ ctaLabel }}</span>
          <span v-if="canSubmit" class="transition-transform group-hover:translate-x-1">→</span>
        </template>
      </button>

      <!-- FAQ disclosure (Caveat font once per step — at this trigger) -->
      <div class="pt-2">
        <button
          type="button"
          class="font-caveat inline-flex items-center gap-1.5 text-base text-gray-500 transition-colors hover:text-[var(--color-primary)] dark:text-gray-400"
          data-testid="invite-wizard-faq"
          @click="faqOpen = !faqOpen"
        >
          <span class="transition-transform" :class="faqOpen ? 'rotate-90' : ''">›</span>
          <span>{{ t('inviteWizard.step1.faq.toggle') }}</span>
        </button>
        <div
          class="overflow-hidden transition-all duration-300"
          :class="faqOpen ? 'mt-2 max-h-[600px]' : 'max-h-0'"
        >
          <div
            class="space-y-1 rounded-2xl px-4 py-2"
            :style="{ backgroundColor: 'var(--tint-orange-8)' }"
          >
            <details class="group border-b border-[var(--color-primary)]/10 last:border-0">
              <summary
                class="font-outfit flex cursor-pointer list-none items-center justify-between py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <span>{{ t('inviteWizard.step1.faq.q1') }}</span>
                <span
                  class="text-gray-400 transition-transform group-open:rotate-45 group-open:text-[var(--color-primary)]"
                  >+</span
                >
              </summary>
              <p class="pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {{ t('inviteWizard.step1.faq.a1') }}
              </p>
            </details>
            <details class="group border-b border-[var(--color-primary)]/10 last:border-0">
              <summary
                class="font-outfit flex cursor-pointer list-none items-center justify-between py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <span>{{ t('inviteWizard.step1.faq.q2') }}</span>
                <span
                  class="text-gray-400 transition-transform group-open:rotate-45 group-open:text-[var(--color-primary)]"
                  >+</span
                >
              </summary>
              <p class="pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {{ t('inviteWizard.step1.faq.a2') }}
              </p>
            </details>
            <details class="group">
              <summary
                class="font-outfit flex cursor-pointer list-none items-center justify-between py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <span>{{ t('inviteWizard.step1.faq.q3') }}</span>
                <span
                  class="text-gray-400 transition-transform group-open:rotate-45 group-open:text-[var(--color-primary)]"
                  >+</span
                >
              </summary>
              <p class="pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {{ t('inviteWizard.step1.faq.a3') }}
              </p>
            </details>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 2 -->
    <div v-else data-testid="invite-wizard-step-2" class="space-y-4">
      <div>
        <h2 class="font-outfit text-secondary-500 text-2xl font-bold dark:text-gray-100">
          {{ heroTitle }}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {{ step2Caption }}
        </p>
      </div>

      <!-- QR card — always visible centerpiece -->
      <div
        class="rounded-3xl px-5 py-5 text-center"
        :style="{ backgroundColor: 'var(--tint-orange-8)' }"
      >
        <p class="font-outfit text-secondary-500 mb-3 text-sm font-semibold dark:text-gray-200">
          {{ t('inviteWizard.step2.qr.title') }}
          <span class="font-caveat ml-1 text-base text-[var(--color-primary)]">
            {{ t('inviteWizard.step2.qr.accent') }}
          </span>
        </p>

        <div v-if="inviteFlow.inviteQrUrl.value" class="mx-auto inline-block">
          <img
            :src="inviteFlow.inviteQrUrl.value"
            alt="QR code"
            class="h-44 w-44 rounded-3xl border-2 border-white bg-white p-2 shadow-md"
            data-testid="invite-wizard-qr"
          />
        </div>
        <div
          v-else
          class="font-outfit mx-auto inline-flex h-44 w-44 items-center justify-center rounded-3xl border-2 border-dashed border-[var(--color-primary)]/30 bg-white/50 p-4 text-center text-sm text-gray-500"
        >
          {{ t('inviteWizard.step2.qr.unavailable') }}
        </div>

        <p class="mt-3 text-xs text-gray-500 italic dark:text-gray-400">
          {{ t('inviteWizard.step2.qr.help') }}
        </p>
      </div>

      <!-- Channel divider + grid + copy -->
      <ShareChannelGrid
        :link="inviteFlow.inviteLink.value"
        :family-name="familyName"
        :member-name="prefill?.memberName ?? inviterName"
        hide-expiry-note
      />

      <!-- Local-provider reminder -->
      <p v-if="!isDriveProvider" class="text-center text-xs text-gray-500 dark:text-gray-400">
        {{ t('inviteWizard.local.reminder') }}
      </p>

      <!-- Footer: back + expiry -->
      <div
        class="flex items-center justify-between border-t border-dashed border-gray-200 pt-3 dark:border-slate-600"
      >
        <button
          type="button"
          class="font-outfit inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-[var(--color-primary)] dark:text-gray-400"
          data-testid="invite-wizard-back"
          @click="goBackToStep1"
        >
          <span>←</span>
          <span>{{ t('inviteWizard.step2.useDifferent') }}</span>
        </button>
        <p class="text-xs text-gray-400 dark:text-gray-500">🔒 {{ t('family.linkExpiry') }}</p>
      </div>
    </div>

    <!-- Brand foot tagline (italic Outfit, low opacity, per CIG wordmark spec) -->
    <p
      class="font-outfit mt-3 -mb-2 text-center text-xs tracking-[0.06em] text-gray-400 italic opacity-60"
    >
      {{ t('app.tagline') }}
    </p>
  </BaseModal>
</template>

<style scoped>
.wizard-bean-active {
  animation: bean-wiggle 2.4s ease-in-out infinite;
  filter: drop-shadow(0 6px 14px rgb(241 93 34 / 35%));
}

@keyframes bean-wiggle {
  0%,
  100% {
    transform: rotate(0deg) translateY(0);
  }

  25% {
    transform: rotate(-3deg) translateY(-2px);
  }

  50% {
    transform: rotate(0deg) translateY(0);
  }

  75% {
    transform: rotate(3deg) translateY(-1px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .wizard-bean-active {
    animation: none;
  }
}
</style>
