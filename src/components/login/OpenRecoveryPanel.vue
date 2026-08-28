<script setup lang="ts">
/**
 * The `open-recovery` renderer (2026-08-28 login rethink): a transport problem stopped
 * the pod from opening AFTER (or while) the user proved who they are. Fix the
 * transport, retry — never bounce back to a credential screen. Pure renderer; every
 * action emits up to the flow driver.
 */
import { computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { OpenFailReason } from '@/services/auth/loginFlow';

const props = defineProps<{
  reason: Exclude<OpenFailReason, 'wrong-password'>;
  familyName: string;
  isBusy: boolean;
  /**
   * Identity was proven BEFORE the transport failed. False on the web cold-start case
   * (the envelope fetch died before the assert could run) — the copy must not claim
   * "you're verified" there, and retry returns to the prove screen.
   */
  proven: boolean;
  /** Failure text from a recovery action (reconnect/grant failed) — owned by the driver. */
  error: string | null;
}>();

const emit = defineEmits<{
  /** Drive token gone → run the Google reconnect, then retry. */
  reconnect: [];
  /** Local file-handle permission revoked → re-grant, then retry. */
  'grant-permission': [];
  /** Generic retry (network blip). */
  retry: [];
  /** File gone / unrecoverable here → the load-a-file bootstrap surface. */
  'use-bootstrap': [];
  back: [];
}>();

const { t } = useTranslation();

const body = computed(() => {
  switch (props.reason) {
    case 'auth':
      return props.proven
        ? t('loginFlow.recoveryAuthBody')
        : t('loginFlow.recoveryAuthBodyUnproven');
    case 'permission':
      return t('loginFlow.recoveryPermissionBody');
    case 'not-found':
      return t('loginFlow.recoveryNotFoundBody');
    default:
      return t('loginFlow.recoveryErrorBody');
  }
});
</script>

<template>
  <div class="mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <div class="mb-6 text-center">
      <img
        src="/brand/beanies_family_icon_transparent_384x384.png"
        alt=""
        class="mx-auto mb-3 h-16 w-16"
      />
      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ proven ? t('loginFlow.recoveryTitle') : t('loginFlow.recoveryTitleUnproven') }}
      </h2>
      <p v-if="familyName" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ familyName }}
      </p>
    </div>

    <p class="mb-6 text-center text-sm text-gray-600 dark:text-gray-400">
      {{ body }}
    </p>

    <!-- Recovery-action failure (reconnect/grant failed) — never invisible -->
    <div
      v-if="error"
      role="alert"
      class="mb-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ error }}
    </div>

    <div class="space-y-3">
      <BaseButton
        v-if="reason === 'auth'"
        class="w-full"
        :disabled="isBusy"
        @click="emit('reconnect')"
      >
        <BeanieSpinner v-if="isBusy" size="sm" class="mr-2" />
        {{ t('loginFlow.recoveryReconnect') }}
      </BaseButton>

      <BaseButton
        v-else-if="reason === 'permission'"
        class="w-full"
        :disabled="isBusy"
        @click="emit('grant-permission')"
      >
        {{ t('loginFlow.recoveryGrant') }}
      </BaseButton>

      <BaseButton v-else class="w-full" :disabled="isBusy" @click="emit('retry')">
        {{ t('action.tryAgain') }}
      </BaseButton>

      <button
        class="w-full text-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        @click="emit('use-bootstrap')"
      >
        {{ t('loginFlow.recoveryUseBootstrap') }}
      </button>
    </div>
  </div>
</template>
