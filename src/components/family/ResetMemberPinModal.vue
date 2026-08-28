<script setup lang="ts">
/**
 * Admin/owner reset of another member's PIN (Phase 4 — supersedes the admin
 * password reset; parents use it for kids and for any member who forgot theirs).
 * Setting a PIN on a legacy password member also completes their migration —
 * the prove screen stops offering password once a PIN exists (warm).
 *
 * Authorization is enforced in the store (`authStore.adminResetMemberPin` →
 * `assertCanResetMember`) via the `ResetError` closed union — every reject reason
 * maps onto a `family.resetPassword.error.<key>` translation (the keys are shared
 * with the retired password modal). No `if`/`else` ladder in this component.
 */
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import PinInput from '@/components/ui/PinInput.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { isValidPin, PIN_LENGTH } from '@/services/auth/deviceUnlock';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const authStore = useAuthStore();

const props = defineProps<{
  open: boolean;
  member: FamilyMember | null;
}>();

const emit = defineEmits<{
  close: [];
  reset: [];
}>();

const newPin = ref('');
const confirmPin = ref('');
const formError = ref<string | null>(null);
const isSubmitting = ref(false);

const memberName = computed(() => props.member?.name ?? '');

const canSubmit = computed(
  () =>
    newPin.value.length === PIN_LENGTH &&
    confirmPin.value.length === PIN_LENGTH &&
    !isSubmitting.value
);

function reset() {
  newPin.value = '';
  confirmPin.value = '';
  formError.value = null;
  isSubmitting.value = false;
}

// Reset state whenever the modal closes so reopening shows a clean form.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) reset();
  }
);

async function handleSave() {
  formError.value = null;
  if (!props.member) {
    formError.value = t('family.resetPassword.error.memberNotFound');
    return;
  }
  if (!isValidPin(newPin.value)) {
    formError.value = t('pin.invalidFormat');
    return;
  }
  if (newPin.value !== confirmPin.value) {
    formError.value = t('pin.mismatch');
    return;
  }

  isSubmitting.value = true;
  try {
    const result = await authStore.adminResetMemberPin(props.member.id, newPin.value);
    if (result.success) {
      showToast(
        'success',
        fillTemplate(t('family.resetPin.success'), { name: memberName.value }),
        undefined,
        { surface: 'reset-member-pin' }
      );
      emit('reset');
      emit('close');
      return;
    }
    // Closed-union `ResetError` → translated copy; a free-text error (thrown
    // message inside the store) renders as-is. `t()` yields undefined for unknown
    // keys (R2-F14) — never call string methods on it.
    const known = t(`family.resetPassword.error.${result.error}` as never) as string | undefined;
    formError.value = known || String(result.error);
  } catch (e) {
    formError.value = t('family.resetPassword.error.unexpected');
    reportError({
      surface: 'reset-member-pin',
      message: 'adminResetMemberPin threw',
      severity: 'error',
      error: e,
    });
  } finally {
    isSubmitting.value = false;
  }
}

function handleClose() {
  if (isSubmitting.value) return;
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    :open="props.open"
    :title="fillTemplate(t('family.resetPin.modalTitle'), { name: memberName })"
    icon="🔢"
    :save-label="t('family.resetPin.submit')"
    :save-disabled="!canSubmit"
    :is-submitting="isSubmitting"
    save-gradient="orange"
    @close="handleClose"
    @save="handleSave"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ fillTemplate(t('family.resetPin.modalDescription'), { name: memberName }) }}
      </p>
      <div>
        <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('pin.newPin') }}
        </p>
        <PinInput
          v-model="newPin"
          :label="t('pin.newPin')"
          autofocus
          :disabled="isSubmitting"
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
          :disabled="isSubmitting"
          @update:model-value="formError = null"
        />
      </div>
      <p v-if="formError" class="text-sm text-red-600 dark:text-red-400" role="alert">
        {{ formError }}
      </p>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        {{ fillTemplate(t('family.resetPin.warning'), { name: memberName }) }}
      </p>
    </div>
  </BeanieFormModal>
</template>
