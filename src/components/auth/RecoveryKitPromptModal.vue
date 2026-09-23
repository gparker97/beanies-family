<script setup lang="ts">
/**
 * The recovery-kit nag (Phase 4): shown to pod managers of a family that lacks the
 * kit confirmed-signal — legacy families that never generated one, and kit-born
 * families whose creator abandoned the wizard's kit step (the envelope has a wrap
 * whose code nobody stored). Generating here mints an ADDITIONAL kit: kits accumulate
 * (`addRecoveryKey` only adds), so any kit already stored keeps working.
 *
 * Generation, display and the confirm-stored push are the shared `useRecoveryKitFlow`
 * (also used by Settings and the sign-out kit guard); the intro is the shared
 * `AuthPromptModal` shell; the kit itself is the shared `RecoveryKitDisplay`.
 */
import AuthPromptModal from '@/components/auth/AuthPromptModal.vue';
import { BaseButton } from '@/components/ui';
import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecoveryKitFlow } from '@/composables/useRecoveryKitFlow';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ done: []; decline: [] }>();

const { t } = useTranslation();
// `flow.isConfirming` carries review R2-F9: while the confirmation stamp + push are in
// flight the intro must NOT reappear, or a second Generate tap mints another kit.
const flow = useRecoveryKitFlow();

async function handleStored(via: 'saved' | 'acknowledged') {
  // The nag closes whatever the push result: an unsynced stamp rides the next save, and
  // the nag's job (get a kit stored) is done. The sign-out guard is the surface that
  // insists on durability, because it is about to drop this device's keys.
  await flow.confirmStored(via);
  emit('done');
}
</script>

<template>
  <div v-if="props.open">
    <AuthPromptModal
      :open="open && !flow.showKit.value && !flow.isConfirming.value"
      :title="t('recovery.kitPromptTitle')"
      :body="t('recovery.kitPromptBody')"
      :error="flow.error.value"
    >
      <BaseButton
        variant="primary"
        :disabled="flow.isGenerating.value"
        :loading="flow.isGenerating.value"
        @click="flow.generate"
      >
        {{ t('recovery.kitGenerate') }}
      </BaseButton>
      <BaseButton variant="ghost" :disabled="flow.isGenerating.value" @click="emit('decline')">
        {{ t('passkey.promptDecline') }}
      </BaseButton>
    </AuthPromptModal>
    <RecoveryKitDisplay
      :open="flow.showKit.value"
      :kit-id="flow.kitId.value"
      :code="flow.kitCode.value"
      @stored="handleStored"
    />
  </div>
</template>
