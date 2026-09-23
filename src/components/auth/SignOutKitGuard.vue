<script setup lang="ts">
/**
 * The sign-out recovery-kit guard (2026-09-23). Shown before a menu sign-out that would
 * drop this device's key material, to a pod manager whose kit was never detected as SAVED
 * (see `needsKitGuardBeforeSignOut`). greg's wording, deliberately short: we did not
 * detect you saving your kit, create one first or lose access to the family file forever.
 *
 *   - Create Recovery Kit → the shared kit flow. The sign-out continues ONLY once the new
 *     kit has reached the family file; if the push did not land, the intro stays with the
 *     not-synced message and the primary becomes "Try again", which re-pushes the SAME kit
 *     (it never mints another).
 *   - Sign out anyway → the destructive choice, stated plainly.
 *   - Cancel / Escape / backdrop → stay signed in; nothing has changed yet.
 *
 * While the kit is being pushed (`isConfirming`) the intro STAYS OPEN with its primary
 * loading and every action disabled: hiding it left the user looking at the normal app
 * for up to the save timeout, with the menu's Sign out a silent no-op. Disabling (rather
 * than hiding) is also what keeps a second tap from minting another kit (R2-F9).
 *
 * Mounted with `v-if` by SignOutHost, so every guard starts with a fresh flow.
 * Stays on the 'base' layer: the unclosable RecoveryKitDisplay it opens is 'base' too.
 */
import AuthPromptModal from '@/components/auth/AuthPromptModal.vue';
import { BaseButton } from '@/components/ui';
import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecoveryKitFlow } from '@/composables/useRecoveryKitFlow';
import { useSignOutHost } from '@/composables/useSignOut';

const { t } = useTranslation();
const { resolveKitGuard } = useSignOutHost();
const flow = useRecoveryKitFlow();

async function handlePrimary() {
  if (flow.unsynced.value) {
    if (await flow.retrySync()) resolveKitGuard('kit_saved');
    return;
  }
  await flow.generate();
}

async function handleStored(via: 'saved' | 'acknowledged') {
  if (await flow.confirmStored(via)) resolveKitGuard('kit_saved');
}

function handleClose() {
  if (flow.isGenerating.value || flow.isConfirming.value) return;
  resolveKitGuard('cancelled');
}
</script>

<template>
  <div>
    <AuthPromptModal
      :open="!flow.showKit.value"
      :title="t('recovery.kitPromptTitle')"
      :body="t('recovery.kitGuardBody')"
      :error="flow.error.value"
      :closable="!flow.isGenerating.value && !flow.isConfirming.value"
      @close="handleClose"
    >
      <BaseButton
        variant="primary"
        data-testid="kit-guard-primary"
        :disabled="flow.isGenerating.value || flow.isConfirming.value"
        :loading="flow.isGenerating.value || flow.isConfirming.value"
        @click="handlePrimary"
      >
        {{
          flow.isConfirming.value
            ? t('recovery.kitSaving')
            : flow.unsynced.value
              ? t('action.tryAgain')
              : t('recovery.kitGenerate')
        }}
      </BaseButton>
      <BaseButton
        variant="danger"
        data-testid="kit-guard-sign-out-anyway"
        :disabled="flow.isGenerating.value || flow.isConfirming.value"
        @click="resolveKitGuard('sign_out_anyway')"
      >
        {{ t('auth.signOutAnyway') }}
      </BaseButton>
      <!-- A visible way to back out: a phone has no Escape key, and a person who does not
           spot the backdrop tap should never feel the only exits are "create" or "lose it". -->
      <button
        type="button"
        class="font-outfit dark:text-ink-faint dark:hover:text-ink-soft mx-auto text-xs font-medium text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed"
        data-testid="kit-guard-cancel"
        :disabled="flow.isGenerating.value || flow.isConfirming.value"
        @click="handleClose"
      >
        {{ t('action.cancel') }}
      </button>
    </AuthPromptModal>
    <RecoveryKitDisplay
      :open="flow.showKit.value"
      :kit-id="flow.kitId.value"
      :code="flow.kitCode.value"
      @stored="handleStored"
    />
  </div>
</template>
