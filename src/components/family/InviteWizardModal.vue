<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue';
import { BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ShareChannelGrid from '@/components/family/ShareChannelGrid.vue';
import InvitePickerStep from '@/components/family/InvitePickerStep.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { useSounds } from '@/composables/useSounds';
import { isUnshareableEmail } from '@/utils/email';
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
  /** User tapped the picker's "+ add a new beanie" tile. Parent should
   *  close the wizard, open FamilyMemberModal, and on save reopen the
   *  wizard with `prefill` set to the new member. */
  'add-bean': [];
}>();

const { t } = useTranslation();
const { pulse } = useAttentionPulse();
const { playClink } = useSounds();
const familyStore = useFamilyStore();

// --- UI state (this component only — flow state lives in props.inviteFlow) ---
type Step = 0 | 1 | 2;
const currentStep = ref<Step>(1);
/** Member picked from Step 0. Null when entered via per-bean share (uses
 *  `props.prefill` instead) or when the user hasn't picked yet. */
const pickedMember = ref<Prefill | null>(null);
const emailValue = ref('');
const confirmed = ref(false);
const faqOpen = ref(false);
const childHintOpen = ref(false);
const emailFieldRef = useTemplateRef<HTMLInputElement>('emailField');

// --- Derived ---
/** Effective invitee on Step 1+ — prefill (per-bean share entry) takes
 *  precedence over picker selection so the wizard stays consistent for
 *  callers that arrive prefilled. */
const invitee = computed<Prefill | null>(() => props.prefill ?? pickedMember.value);

/** Empty when the supplied email is missing or unshareable (system
 *  placeholder like *@temp.beanies.family). Drives the Step 1 prefill
 *  decision and the warning-chip rendering. */
function realEmailFor(email: string | undefined): string {
  return email && !isUnshareableEmail(email) ? email : '';
}

const heroTitle = computed(() => {
  if (currentStep.value === 2) return t('inviteWizard.step2.title');
  if (currentStep.value === 0) return t('inviteWizard.picker.title');
  return invitee.value
    ? t('inviteWizard.step1.titlePrefilled').replace('{name}', invitee.value.memberName)
    : t('inviteWizard.step1.title');
});

const trimmedEmail = computed(() => emailValue.value.trim());
const hasEmail = computed(() => trimmedEmail.value.length > 3 && trimmedEmail.value.includes('@'));
const canSubmit = computed(
  () => hasEmail.value && confirmed.value && !props.inviteFlow.isGenerating.value
);

const isDriveProvider = computed(() => props.provider === 'google_drive');

const ctaLabel = computed(() => {
  if (!hasEmail.value) return t('inviteWizard.step1.cta.addEmail');
  if (!confirmed.value) return t('inviteWizard.step1.cta.unconfirmed');
  const key = isDriveProvider.value
    ? 'inviteWizard.step1.cta.share'
    : 'inviteWizard.step1.cta.confirm';
  return t(key).replace('{email}', trimmedEmail.value);
});

const step2Caption = computed(() =>
  t('inviteWizard.step2.caption').replace(
    '{email}',
    props.inviteFlow.lastSharedEmail.value ?? trimmedEmail.value
  )
);

const noEmailChipMessage = computed(() => {
  const name = invitee.value?.memberName ?? t('family.title');
  return t('inviteWizard.step1.noEmailChip').replace('{name}', name);
});

const error = computed(() => props.inviteFlow.error.value);
const showRetryButton = computed(() => error.value?.recovery === 'retry');
/** Change-link visible only when entered via picker (not per-bean share),
 *  so the user can swap recipient without closing the wizard. */
const showChangeLink = computed(() => !props.prefill && pickedMember.value !== null);

// --- Lifecycle ---
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    pickedMember.value = null;
    confirmed.value = false;
    faqOpen.value = false;
    childHintOpen.value = false;
    if (props.prefill) {
      currentStep.value = 1;
      emailValue.value = realEmailFor(props.prefill.email);
      // If real-email prefilled, pulse the field so the user verifies.
      if (emailValue.value) {
        await new Promise((r) => setTimeout(r, 80));
        pulse(emailFieldRef.value);
      }
    } else {
      currentStep.value = 0;
      emailValue.value = '';
    }
  },
  { immediate: true }
);

// --- Actions ---
function handlePickerSelect(memberId: string): void {
  const m = familyStore.members.find((x) => x.id === memberId);
  if (!m) {
    // Race vs. delete during open modal — log for diagnostics, then
    // abort. Wizard stays on Step 0 so the user can re-pick.
    console.warn('[InviteWizardModal] picker select for unknown member', { memberId });
    return;
  }
  pickedMember.value = { email: m.email ?? '', memberName: m.name };
  emailValue.value = realEmailFor(m.email);
  confirmed.value = false;
  childHintOpen.value = false;
  props.inviteFlow.clearError();
  currentStep.value = 1;
  // Pulse the email field if prefilled, mirroring the per-bean-share
  // entry path so the user always re-verifies the value.
  if (emailValue.value) {
    void Promise.resolve().then(() => {
      setTimeout(() => pulse(emailFieldRef.value), 80);
    });
  }
}

function handlePickerAddBean(): void {
  emit('add-bean');
}

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
  props.inviteFlow.clearError();
}

function goBackToStep1() {
  confirmed.value = false;
  props.inviteFlow.clearError();
  currentStep.value = 1;
}

function changeRecipient() {
  // Step 1 → back to picker. Reset selection state so user actively re-picks.
  pickedMember.value = null;
  emailValue.value = '';
  confirmed.value = false;
  childHintOpen.value = false;
  props.inviteFlow.clearError();
  currentStep.value = 0;
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
    <!-- Hero band — Step 0 (picker) gets a single-mascot lobby header;
         Step 1+ get the existing 2-mascot progress strip. -->
    <template #header>
      <div
        class="relative overflow-hidden rounded-t-3xl"
        :style="{ backgroundColor: 'var(--tint-orange-8)' }"
      >
        <button
          type="button"
          class="absolute top-3 right-3 z-10 rounded-full bg-white/80 p-1.5 text-gray-500 backdrop-blur-sm transition-all hover:bg-white hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800/80 dark:hover:bg-slate-800"
          :aria-label="t('action.close')"
          :disabled="inviteFlow.isGenerating.value"
          @click="handleClose"
        >
          <BeanieIcon name="close" size="md" />
        </button>

        <!-- Step 0 lobby header -->
        <div v-if="currentStep === 0" class="px-8 pt-7 pb-5 text-center">
          <img
            src="/brand/beanies_logo_transparent_logo_only_192x192.png"
            alt=""
            aria-hidden="true"
            class="wizard-bean-active mx-auto mb-2 h-16 w-16 object-contain"
          />
          <h2 class="font-outfit text-secondary-500 text-xl font-bold dark:text-gray-100">
            {{ t('inviteWizard.picker.title') }}
          </h2>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ t('inviteWizard.picker.subhead') }}
          </p>
        </div>

        <!-- Step 1+ progress strip -->
        <div v-else class="flex items-center justify-center gap-3 px-8 pt-7 pb-4">
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

    <!-- Step 0 — Picker -->
    <InvitePickerStep
      v-if="currentStep === 0"
      :members="familyStore.sortedHumans"
      @select="handlePickerSelect"
      @add-bean="handlePickerAddBean"
    />

    <!-- Step 1 — Confirm Email -->
    <div v-else-if="currentStep === 1" data-testid="invite-wizard-step-1" class="space-y-4">
      <div>
        <h2 class="font-outfit text-secondary-500 text-2xl font-bold dark:text-gray-100">
          {{ heroTitle }}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {{ t('inviteWizard.step1.subhead') }}
        </p>
      </div>

      <!-- Invitee chip (always shown on Step 1) — name + optional change link.
           Change link visible only when entered via picker, so the user can
           swap without closing the wizard. -->
      <div
        v-if="invitee"
        class="flex items-center gap-2 rounded-full border border-[var(--color-primary)]/20 bg-[var(--tint-orange-8)] px-3 py-1.5"
        data-testid="invite-wizard-invitee-chip"
      >
        <span
          class="font-outfit text-[10px] font-semibold tracking-[0.08em] text-gray-400 uppercase"
        >
          {{ t('inviteWizard.invitee.label') }}
        </span>
        <span class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-100">
          {{ invitee.memberName }}
        </span>
        <button
          v-if="showChangeLink"
          type="button"
          class="font-outfit ml-auto rounded-full border border-[var(--color-primary)]/25 bg-white px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--tint-orange-8)] dark:bg-slate-800"
          data-testid="invite-wizard-change"
          @click="changeRecipient"
        >
          {{ t('inviteWizard.invitee.change') }}
        </button>
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

      <!-- No-default-email warning chip + child-hint disclosure: only when the
           invitee has no usable email and the user hasn't typed one yet. -->
      <template v-if="invitee && !emailValue.trim()">
        <div
          class="flex items-start gap-2.5 rounded-xl border border-[#AED6F1]/50 bg-[#AED6F1]/15 px-3.5 py-3"
          data-testid="invite-wizard-no-email-chip"
        >
          <BeanieIcon name="alert-circle" size="sm" class="mt-0.5 flex-shrink-0 text-[#1E5A85]" />
          <p class="text-sm leading-relaxed text-[#1E5A85]">
            {{ noEmailChipMessage }}
          </p>
        </div>

        <details
          class="child-hint group -mt-1"
          :open="childHintOpen"
          @toggle="childHintOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary
            class="font-outfit inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-1 text-xs font-semibold text-gray-500 transition-colors hover:text-[var(--color-primary)] dark:text-gray-400"
            data-testid="invite-wizard-child-hint-toggle"
          >
            <span
              class="text-[10px] text-[var(--color-primary)] transition-transform group-open:rotate-90"
              aria-hidden="true"
              >▸</span
            >
            <span>{{ t('inviteWizard.step1.childHint.toggle') }}</span>
          </summary>
          <div
            class="mt-2 rounded-r-xl border-l-2 border-[#E67E22] bg-[var(--tint-orange-8)] px-3.5 py-2.5"
          >
            <p class="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
              {{ t('inviteWizard.step1.childHint.body1') }}
              <a
                href="https://families.google/familylink/"
                target="_blank"
                rel="noopener"
                class="wizard-faq-link"
                >{{ t('inviteWizard.step1.childHint.linkLabel') }}</a
              >
              {{ t('inviteWizard.step1.childHint.body2') }}
            </p>
          </div>
        </details>
      </template>

      <!-- Inline error chip from useInviteFlow.error -->
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

      <!-- Confirm checkbox — only render once an email is entered. The
           CTA itself communicates the "add an email first" state, so a
           dashed-border placeholder here would be redundant noise. -->
      <label
        v-if="hasEmail"
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
          <span
            class="rounded-md border border-[var(--color-primary)]/30 bg-white px-1.5 py-0.5 font-semibold text-[var(--color-primary)] dark:bg-slate-800"
          >
            {{ trimmedEmail }}
          </span>
          {{ ' is their Google account email for the family pod' }}
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

      <!-- FAQ disclosure — Outfit-bold (no Caveat); answers via v-html for
           static HTML link content (XSS-safe — strings are static literals
           from uiStrings.ts, never interpolated with user data). -->
      <div class="pt-2">
        <button
          type="button"
          class="font-outfit inline-flex items-center gap-1.5 text-sm font-bold text-gray-700 transition-colors hover:text-[var(--color-primary)] dark:text-gray-200"
          data-testid="invite-wizard-faq"
          @click="faqOpen = !faqOpen"
        >
          <span
            class="text-[var(--color-primary)] transition-transform"
            :class="faqOpen ? 'rotate-90' : ''"
            >›</span
          >
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
              <p
                class="pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400"
                v-html="t('inviteWizard.step1.faq.a2')"
              />
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
              <p
                class="pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400"
                v-html="t('inviteWizard.step1.faq.a3')"
              />
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

      <ShareChannelGrid
        :link="inviteFlow.inviteLink.value"
        :family-name="familyName"
        :member-name="invitee?.memberName ?? inviterName"
        hide-expiry-note
      />

      <p v-if="!isDriveProvider" class="text-center text-xs text-gray-500 dark:text-gray-400">
        {{ t('inviteWizard.local.reminder') }}
      </p>

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

/* :deep() — anchors come from v-html (FAQ a2/a3, child-hint Family Link),
   so they don't carry the data-v-* scoped attribute. Without :deep() the
   rule never reaches them and links render as browser defaults. */
:deep(.wizard-faq-link) {
  color: var(--color-primary);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  transition: color 0.15s ease;
}

:deep(.wizard-faq-link:hover) {
  color: #d14d1a;
}
</style>
