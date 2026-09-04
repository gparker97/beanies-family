<script setup lang="ts">
/**
 * The recovery-kit nag (Phase 4): shown to pod managers of a family that lacks the
 * kit confirmed-signal — legacy families that never generated one, and kit-born
 * families whose creator abandoned the wizard's kit step (the envelope has a wrap
 * whose code nobody stored; generating a NEW kit inerts it — the standard
 * regenerate semantics). Generation + display reuse `authStore.createRecoveryKit`
 * and the shared `RecoveryKitDisplay` (one kit surface everywhere).
 */
import { ref } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { BaseButton } from '@/components/ui';
import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ done: []; decline: [] }>();

const { t } = useTranslation();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();

const kitCode = ref('');
const kitId = ref('');
const showKit = ref(false);
const formError = ref<string | null>(null);
const isGenerating = ref(false);
// Review R2-F9: while the confirmation stamp + push are in flight the intro modal
// must NOT reappear — a second Generate tap would mint a new kit and silently inert
// the one the user just confirmed storing.
const isConfirming = ref(false);

async function handleGenerate() {
  formError.value = null;
  isGenerating.value = true;
  try {
    const result = await authStore.createRecoveryKit();
    if (!result.success) {
      formError.value = result.error;
      return;
    }
    kitCode.value = result.code;
    kitId.value = result.kitId;
    showKit.value = true;
  } finally {
    isGenerating.value = false;
  }
}

async function handleStored() {
  isConfirming.value = true;
  showKit.value = false;
  kitCode.value = '';
  try {
    await settingsStore.markRecoveryKitConfirmed();
    await syncStore.syncNowBounded();
  } finally {
    isConfirming.value = false;
    emit('done');
  }
}
</script>

<template>
  <div v-if="props.open">
    <BaseModal :open="open && !showKit && !isConfirming" size="sm" :closable="false">
      <div class="text-center">
        <img
          src="/brand/beanies_logo_transparent_logo_only_192x192.png"
          alt=""
          class="mx-auto mb-4 h-16 w-16"
        />
        <h2 class="font-outfit dark:text-ink mb-2 text-lg font-semibold text-gray-900">
          {{ t('recovery.kitPromptTitle') }}
        </h2>
        <p class="dark:text-ink-soft mb-6 text-sm text-gray-600">
          {{ t('recovery.kitPromptBody') }}
        </p>
        <p v-if="formError" class="dark:text-danger-lift mb-3 text-sm text-red-600" role="alert">
          {{ formError }}
        </p>
        <div class="flex flex-col gap-3">
          <BaseButton
            variant="primary"
            :disabled="isGenerating"
            :loading="isGenerating"
            @click="handleGenerate"
          >
            {{ t('recovery.kitGenerate') }}
          </BaseButton>
          <BaseButton variant="ghost" :disabled="isGenerating" @click="emit('decline')">
            {{ t('passkey.promptDecline') }}
          </BaseButton>
        </div>
      </div>
    </BaseModal>
    <RecoveryKitDisplay :open="showKit" :kit-id="kitId" :code="kitCode" @stored="handleStored" />
  </div>
</template>
