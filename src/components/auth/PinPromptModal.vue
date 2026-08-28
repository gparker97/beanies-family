<script setup lang="ts">
/**
 * The PIN migration nag (Phase 4): shown once per dismissal cycle to a LEGACY member
 * (passwordHash, no pinHash) after sign-in. Sets the PIN inline — new + confirm via
 * the shared PinInput — through `authStore.setMemberPin` (allowed with no current
 * PIN because none exists). Uses the long-orphaned `pin.promptTitle/Body` strings.
 */
import { ref } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { BaseButton } from '@/components/ui';
import PinInput from '@/components/ui/PinInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { isValidPin } from '@/services/auth/deviceUnlock';
import { showToast } from '@/composables/useToast';

const props = defineProps<{ open: boolean; memberId: string }>();
const emit = defineEmits<{ done: []; decline: [] }>();

const { t } = useTranslation();
const authStore = useAuthStore();

const pin = ref('');
const confirmPin = ref('');
const formError = ref<string | null>(null);
const isSaving = ref(false);

async function handleSave() {
  formError.value = null;
  if (!isValidPin(pin.value)) {
    formError.value = t('pin.invalidFormat');
    return;
  }
  if (pin.value !== confirmPin.value) {
    formError.value = t('pin.mismatch');
    return;
  }
  isSaving.value = true;
  try {
    const result = await authStore.setMemberPin(props.memberId, pin.value);
    if (result.success) {
      showToast('success', t('pin.setSuccess'));
      emit('done');
    } else {
      formError.value = result.error ?? t('auth.signInFailed');
    }
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <BaseModal :open="open" size="sm" :closable="false">
    <div class="text-center">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-4 h-16 w-16"
      />
      <h2 class="font-outfit mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ t('pin.promptTitle') }}
      </h2>
      <p class="mb-5 text-sm text-gray-600 dark:text-gray-400">
        {{ t('pin.promptBody') }}
      </p>
      <div class="space-y-4 text-left">
        <div>
          <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('pin.newPin') }}
          </p>
          <PinInput
            v-model="pin"
            :label="t('pin.newPin')"
            autofocus
            :disabled="isSaving"
            @update:model-value="formError = null"
          />
        </div>
        <div>
          <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('pin.confirmPin') }}
          </p>
          <PinInput
            v-model="confirmPin"
            :label="t('pin.confirmPin')"
            :disabled="isSaving"
            @update:model-value="formError = null"
          />
        </div>
      </div>
      <p v-if="formError" class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
        {{ formError }}
      </p>
      <div class="mt-5 flex flex-col gap-3">
        <BaseButton variant="primary" :disabled="isSaving" :loading="isSaving" @click="handleSave">
          {{ t('pin.setTitle') }}
        </BaseButton>
        <BaseButton variant="ghost" :disabled="isSaving" @click="emit('decline')">
          {{ t('passkey.promptDecline') }}
        </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
