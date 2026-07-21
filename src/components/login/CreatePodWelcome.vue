<script setup lang="ts">
import { onMounted } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import { openExternal } from '@/utils/openExternal';
import { MARKETING_URL } from '@/utils/marketing';

/**
 * The Create-pod welcome / "what to expect" intro. Shown once (per LoginPage
 * mount) as the first surface on the Create path, replacing the retired invite
 * gate. Purely presentational: it previews the three setup steps and calms
 * security nerves, then hands off to the CreatePodView wizard. It never gates —
 * see docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md.
 */
const emit = defineEmits<{
  /** Primary CTA — proceed into the create wizard. */
  dismiss: [];
  /** ✕ — return to the Welcome chooser (never trapped). */
  cancel: [];
}>();

const { t } = useTranslation();

// The broad "how your data stays safe" promise → the zero-knowledge overview
// (nobody, us included, can read your data), not just the encryption mechanics.
// Same destination as the onboarding privacy link (OnboardingAccount.vue).
const SAFETY_HELP_URL = `${MARKETING_URL}/help/security/zero-knowledge-architecture`;

// Conceptual journey (NOT literal wizard steps — see the plan). Numbered because
// setup is a genuinely ordered sequence.
const STEPS = [
  { icon: '👋', titleKey: 'createWelcome.step1Title', bodyKey: 'createWelcome.step1Body' },
  { icon: '🔐', titleKey: 'createWelcome.step2Title', bodyKey: 'createWelcome.step2Body' },
  { icon: '🌳', titleKey: 'createWelcome.step3Title', bodyKey: 'createWelcome.step3Body' },
] as const;

onMounted(() => {
  // E2E seam: auto-proceed so the create-pod spec isn't blocked by the intro.
  if (import.meta.env.DEV && sessionStorage.getItem('e2e_auto_auth') === 'true') {
    emit('dismiss');
    return;
  }
  logEvent({
    level: 'info',
    surface: 'create-welcome',
    message: 'shown',
    context: { action: 'shown' },
  });
});

function proceed() {
  logEvent({
    level: 'info',
    surface: 'create-welcome',
    message: 'proceed',
    context: { action: 'proceed' },
  });
  emit('dismiss');
}

function cancel() {
  logEvent({
    level: 'info',
    surface: 'create-welcome',
    message: 'cancel',
    context: { action: 'cancel' },
  });
  emit('cancel');
}

function openSafetyHelp() {
  // openExternal gives no success/failure signal, so record the click unconditionally.
  logEvent({
    level: 'info',
    surface: 'create-welcome',
    message: 'help_click',
    context: { action: 'help_click' },
  });
  // Defense-in-depth: the URL is a compile-time constant so this catch is
  // effectively unreachable, but a bare call must never fail silently.
  try {
    openExternal(SAFETY_HELP_URL);
  } catch (error) {
    reportError({
      surface: 'create-welcome',
      severity: 'warning',
      message: 'safety help link failed',
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
</script>

<template>
  <BaseModal :open="true" :closable="false" size="md">
    <div class="welcome relative">
      <!-- Cancel — always available so the user is never trapped. -->
      <button
        type="button"
        class="absolute top-0 right-0 rounded-xl p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-slate-700 dark:hover:text-gray-300"
        :aria-label="t('action.close')"
        data-testid="create-welcome-cancel"
        @click="cancel"
      >
        <BeanieIcon name="close" size="md" />
      </button>

      <!-- Hero -->
      <div class="text-center">
        <img
          src="/brand/beanies_family_icon_transparent_384x384.png"
          :alt="t('login.beaniesFamilyIconAlt')"
          class="mx-auto mb-2 h-16 w-16"
        />
        <div class="flex items-center justify-center gap-1">
          <PageWelcomeSubtitle :text="t('createWelcome.eyebrow')" />
          <span aria-hidden="true">🌱</span>
        </div>
        <h2 class="font-outfit mt-1 mb-1.5 text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('createWelcome.title') }}
        </h2>
        <p class="mx-auto max-w-xs text-sm text-gray-500 dark:text-gray-400">
          {{ t('createWelcome.subtitle') }}
        </p>
      </div>

      <!-- Growing journey -->
      <div class="journey relative mt-5 mb-4">
        <span class="vine" aria-hidden="true"></span>
        <div
          v-for="(step, i) in STEPS"
          :key="step.titleKey"
          class="step relative flex items-start gap-4 py-2"
        >
          <div
            class="node relative grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-lg"
            :class="[
              i === 0 ? 'bg-[var(--tint-orange-8)]' : '',
              i === 1 ? 'bg-[var(--tint-silk-20)]' : '',
              i === 2 ? 'bg-[var(--tint-success-10)]' : '',
            ]"
          >
            <span aria-hidden="true">{{ step.icon }}</span>
            <span
              class="font-outfit absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full text-xs font-bold text-white"
              :class="i === 2 ? 'bg-[#27AE60]' : 'bg-[#2C3E50]'"
              aria-hidden="true"
              >{{ i + 1 }}</span
            >
          </div>
          <div class="pt-0.5">
            <h3
              class="font-outfit flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {{ t(step.titleKey) }}
              <span
                v-if="i === 2"
                class="font-outfit rounded-full bg-[var(--tint-silk-20)] px-2 py-0.5 text-xs font-semibold text-[#2C3E50] dark:text-slate-200"
                >{{ t('onboarding.invite.optional') }}</span
              >
            </h3>
            <p class="text-xs leading-snug text-gray-500 dark:text-gray-400">
              {{ t(step.bodyKey) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Security reassurance -->
      <div class="mb-4 flex items-center gap-3 rounded-2xl bg-[var(--tint-silk-10)] p-3">
        <img
          src="/brand/beanies_covering_eyes_transparent_512x512.png"
          alt=""
          aria-hidden="true"
          class="h-10 w-10 shrink-0"
        />
        <p class="text-xs leading-snug text-gray-600 dark:text-gray-300">
          {{ t('createWelcome.safeText') }}
          <button
            type="button"
            class="text-primary-500 hover:text-primary-600 font-semibold whitespace-nowrap"
            data-testid="create-welcome-safe-link"
            @click="openSafetyHelp"
          >
            {{ t('createWelcome.safeLink') }}
            <span aria-hidden="true">→</span>
          </button>
        </p>
      </div>

      <!-- CTA -->
      <button
        type="button"
        class="from-primary-500 to-terracotta-400 font-outfit w-full rounded-2xl bg-gradient-to-br py-3.5 text-sm font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5"
        data-testid="create-welcome-cta"
        @click="proceed"
      >
        {{ t('createWelcome.cta') }}
      </button>
      <p class="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
        {{ t('createWelcome.ctaHint') }}
      </p>
    </div>
  </BaseModal>
</template>

<style scoped>
/* All display copy renders lowercase (warm brand voice); underlying t() strings
   stay standard-cased for CI + screen readers — mirrors the app's CSS-uppercase
   section-header pattern. */
.welcome {
  text-transform: lowercase;
}

/* Dashed Sky-Silk "vine" linking the three steps. */
.vine {
  background: repeating-linear-gradient(
    to bottom,
    var(--silk, #aed6f1) 0 6px,
    transparent 6px 12px
  );
  bottom: 1.75rem;
  left: 1.375rem; /* centered under the 44px nodes */
  position: absolute;
  top: 1.375rem;
  width: 2px;
}

/* Staggered rise-in — pure CSS, removed under reduced-motion. */
.step {
  animation: welcome-rise 0.5s both;
}

.step:nth-child(3) {
  animation-delay: 0.13s;
}

.step:nth-child(4) {
  animation-delay: 0.26s;
}

@keyframes welcome-rise {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .step {
    animation: none;
  }
}
</style>
