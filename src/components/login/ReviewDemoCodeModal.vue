<script setup lang="ts">
/**
 * REVIEW-DEMO: access-code entry for store-review demo mode. TEMPORARY — see the
 * retirement checklist in `docs/runbooks/native-store-submission.md`.
 *
 * Deliberately NOT a clone of `InviteGateOverlay`: that is a three-mode overlay
 * carrying Discord links, a request-an-invite webhook form and marketing copy,
 * none of which a reviewer needs. This shares the *validation* with that gate
 * (`hashedCodeGate`) and builds its UI on the standard Tier-2 `BeanieFormModal`,
 * which already supplies the submit button, submitting spinner, close handling
 * and mobile-fullscreen behaviour.
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { validateReviewDemoCode, isReviewDemoAvailable } from '@/utils/reviewDemo';
import { isCryptoAvailable } from '@/utils/hashedCodeGate';
import { logEvent } from '@/services/telemetry/logEvent';
import { assertNever } from '@/utils/assertNever';
import type { DemoSeedErrorCode } from '@/services/demo/demoSeed';

const SURFACE = 'review-demo';

const { t } = useTranslation();
const router = useRouter();

const emit = defineEmits<{ close: [] }>();

const code = ref('');
const formError = ref('');
const isSubmitting = ref(false);

/**
 * Reviewer-facing message per failure code.
 *
 * Exhaustive by construction: `DemoSeedErrorCode` is a closed union and the
 * fallthrough is `assertNever`, so adding a seed stage without adding its copy
 * is a compile error rather than a blank toast.
 */
function seedFailureMessage(reason: DemoSeedErrorCode): string {
  switch (reason) {
    case 'session-exists':
      return t('reviewDemo.seedFailed.sessionExists');
    case 'not-available':
      return t('reviewDemo.seedFailed.unavailable');
    case 'provider-install':
      return t('reviewDemo.seedFailed.storage');
    // Every remaining stage is an internal failure the reviewer can only retry;
    // the specific stage is already in telemetry via `error_code`.
    case 'signup':
    case 'fixture-write':
    case 'concurrent-write':
    case 'precondition':
    case 'existing-pod':
    case 'write':
    case 'verify':
    case 'persist':
    case 'register':
      return t('reviewDemo.seedFailed.generic');
    default:
      return assertNever(reason, 'reviewDemoSeedError');
  }
}

/** Reject the entered code inline, and record WHY — never a bare false. */
function rejectCode(message: string, errorCode: string): void {
  formError.value = message;
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'demo access code rejected',
    context: { action: 'code-rejected', error_code: errorCode },
  });
}

async function handleSubmit(): Promise<void> {
  formError.value = '';

  if (!code.value.trim()) {
    // Purely client-side; no event — this is not a failed attempt, just an
    // empty field.
    formError.value = t('reviewDemo.codeRequired');
    return;
  }

  // A non-secure origin has no Web Crypto, and "can't verify" must not be
  // indistinguishable from "wrong code" for someone following written
  // instructions.
  if (!isCryptoAvailable()) {
    rejectCode(t('reviewDemo.cryptoUnavailable'), 'crypto-unavailable');
    return;
  }

  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'demo access code submitted',
    context: { action: 'code-submitted' },
  });

  isSubmitting.value = true;
  try {
    const accepted = await validateReviewDemoCode(code.value);
    if (!accepted) {
      // Distinguish "wrong code" from "this build's demo window has closed" —
      // the second is not something a reviewer can fix by retyping.
      rejectCode(
        isReviewDemoAvailable() ? t('reviewDemo.codeInvalid') : t('reviewDemo.codeExpired'),
        isReviewDemoAvailable() ? 'invalid-code' : 'expired'
      );
      return;
    }

    // Dynamically imported so the fixture + seeding chunk is never fetched in a
    // build where demo mode is not armed.
    const { seedDemoFamily } = await import('@/services/demo/demoSeed');
    const result = await seedDemoFamily();

    if (!result.ok) {
      // `seedDemoFamily` has already reported this (with the stage, the Error and
      // severity: 'critical'), so this toast is `silent` — reporting again here
      // would double-page #beanies-errors for one failure.
      showToast('error', t('reviewDemo.seedFailedTitle'), seedFailureMessage(result.code), {
        silent: true,
      });
      return;
    }

    code.value = '';
    emit('close');
    await router.push('/nook');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="true"
    :title="t('reviewDemo.modalTitle')"
    icon="🫘"
    size="narrow"
    :save-label="t('reviewDemo.unlock')"
    :submitting-label="t('reviewDemo.unlocking')"
    :is-submitting="isSubmitting"
    :save-disabled="!code.trim()"
    @close="emit('close')"
    @save="handleSubmit"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-300">
        {{ t('reviewDemo.description') }}
      </p>
      <BaseInput
        v-model="code"
        :label="t('reviewDemo.codeLabel')"
        :placeholder="t('reviewDemo.codePlaceholder')"
        :error="formError"
        :disabled="isSubmitting"
        @keyup.enter="handleSubmit"
      />
    </div>
  </BeanieFormModal>
</template>
