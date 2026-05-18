<script setup lang="ts">
/**
 * NoPodEmptyState — single-use redirect panel.
 *
 * Replaces the storage cards in LoadPodView once a Google Drive lookup
 * confirms zero .beanpod files. Reframes "no pod found" as "you may be in
 * the wrong section — try Create" rather than a yellow error. Closes the
 * onboarding loop the pilot user got stuck in (May 2026 feedback): clicking
 * Drive on the storage picker, getting "no files," then re-clicking Drive
 * because it was still the most prominent thing on screen.
 *
 * Single-use; do not generalize speculatively. If a future flow needs a
 * similar redirect panel, evaluate whether to add a shared primitive then —
 * not now. The copy and three-CTA structure are specific to the
 * Sign-In-but-no-pod path.
 *
 * Stateless: zero direct access to syncStore/authStore. All async work
 * happens in the parent (LoadPodView); this component only emits intents.
 */
import LoginChoiceCard from './LoginChoiceCard.vue';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{
  accountEmail?: string;
}>();

const emit = defineEmits<{
  create: [];
  'switch-account': [];
  'load-local': [];
  retry: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <div class="space-y-5">
    <!-- Header: seed icon (Sky Silk backdrop, reuses existing pattern from
         LoadPodView.vue:654) + title + account email + body copy. -->
    <div class="text-center">
      <div
        class="bg-sky-silk-300/[0.22] dark:bg-sky-silk-300/[0.15] mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
        aria-hidden="true"
      >
        <span class="text-3xl">🌱</span>
      </div>
      <h3 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.noPodOnAccount.title') }}
      </h3>
      <p v-if="accountEmail" class="mt-1 text-xs text-gray-400 dark:text-gray-500">
        {{ accountEmail }}
      </p>
      <p class="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
        {{ t('loginV6.noPodOnAccount.body') }}
      </p>
    </div>

    <!-- Primary CTA: Create (gradient orange — matches WelcomeGate's Create
         card so the visual language is consistent across the flow). -->
    <LoginChoiceCard
      testid="no-pod-create-cta"
      :aria-label="t('loginV6.noPodOnAccount.createCta')"
      class="from-primary-500 to-terracotta-400 rounded-2xl bg-gradient-to-r p-5 shadow-lg hover:shadow-xl"
      @click="emit('create')"
    >
      <div class="flex items-center gap-4">
        <div
          class="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-white/20"
          aria-hidden="true"
        >
          <svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
        </div>
        <div class="flex-1">
          <p class="font-outfit text-sm font-bold text-white">
            {{ t('loginV6.noPodOnAccount.createCta') }}
          </p>
          <p class="mt-0.5 text-xs text-white/80">
            {{ t('loginV6.noPodOnAccount.createDesc') }}
          </p>
        </div>
      </div>
    </LoginChoiceCard>

    <!-- Secondary CTAs: Switch account + Load local file (white surface). -->
    <LoginChoiceCard
      testid="no-pod-switch-account-cta"
      :aria-label="t('loginV6.noPodOnAccount.switchCta')"
      class="rounded-[18px] bg-white p-4 shadow-[0_4px_16px_rgba(44,62,80,0.04)] hover:shadow-md dark:bg-slate-700/50 dark:shadow-none"
      @click="emit('switch-account')"
    >
      <div class="flex items-center gap-3">
        <div
          class="bg-sky-silk-300/[0.22] dark:bg-sky-silk-300/[0.15] flex h-9 w-9 flex-none items-center justify-center rounded-full"
          aria-hidden="true"
        >
          <svg class="h-4 w-4 text-[#3498db]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>
        <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.noPodOnAccount.switchCta') }}
        </p>
      </div>
    </LoginChoiceCard>

    <LoginChoiceCard
      testid="no-pod-load-local-cta"
      :aria-label="t('loginV6.noPodOnAccount.loadLocalCta')"
      class="rounded-[18px] bg-white p-4 shadow-[0_4px_16px_rgba(44,62,80,0.04)] hover:shadow-md dark:bg-slate-700/50 dark:shadow-none"
      @click="emit('load-local')"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700"
          aria-hidden="true"
        >
          <svg
            class="h-4 w-4 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </div>
        <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.noPodOnAccount.loadLocalCta') }}
        </p>
      </div>
    </LoginChoiceCard>

    <!-- Footer hints. Join hint is purely advisory copy (no action this app
         can perform — the user has to ask their family owner offline). Retry
         hint is a deliberate-retry path (rare: user just copied a pod file
         to Drive between attempts) — kept low-visual-weight so it doesn't
         compete with the primary Create CTA above. -->
    <div class="space-y-2 pt-1 text-center text-xs">
      <p class="font-outfit text-gray-500 dark:text-gray-400" data-testid="no-pod-join-hint">
        {{ t('loginV6.noPodOnAccount.joinHint') }}
      </p>
      <p>
        <button
          type="button"
          class="font-outfit hover:text-primary-500 text-gray-500 underline-offset-2 transition-colors hover:underline dark:text-gray-400"
          data-testid="no-pod-retry-hint"
          @click="emit('retry')"
        >
          {{ t('loginV6.noPodOnAccount.retryHint') }}
        </button>
      </p>
    </div>
  </div>
</template>
