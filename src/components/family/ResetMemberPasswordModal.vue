<script setup lang="ts">
/**
 * Admin/owner reset of another member's password.
 *
 * Authorization is enforced server-side (in `authStore.resetMemberPassword`)
 * via the `ResetError` closed union — every reject reason maps onto a
 * `family.resetPassword.error.<key>` translation, so adding a new authz
 * gate requires adding a key. No `if`/`else` ladder in this component.
 */
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import PasswordEntryFields from '@/components/ui/PasswordEntryFields.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
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

const newPassword = ref('');
const confirmPassword = ref('');
const formError = ref<string | null>(null);
const isSubmitting = ref(false);

const memberName = computed(() => props.member?.name ?? '');

const canSubmit = computed(
  () =>
    Boolean(newPassword.value) &&
    Boolean(confirmPassword.value) &&
    newPassword.value === confirmPassword.value &&
    !isSubmitting.value
);

function reset() {
  newPassword.value = '';
  confirmPassword.value = '';
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

function fmt(key: string, replacements: Record<string, string> = {}): string {
  // Hand-built string substitution to match the rest of the app's pattern
  // (e.g. `t('...').replace('{name}', name)`). Centralized here so the
  // template stays declarative.
  let out = t(key as never);
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replace(`{${k}}`, v);
  }
  return out;
}

async function handleSave() {
  formError.value = null;
  if (!props.member) {
    formError.value = t('family.resetPassword.error.memberNotFound');
    return;
  }
  if (!newPassword.value || !confirmPassword.value) {
    formError.value = t('family.resetPassword.error.required');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    formError.value = t('family.resetPassword.error.mismatch');
    return;
  }

  isSubmitting.value = true;
  try {
    const result = await authStore.resetMemberPassword(props.member.id, newPassword.value);
    if (result.success) {
      const successMsg = fmt('family.resetPassword.success', { name: memberName.value });
      // Success is now durable (rotateMemberPassword blocks on the Drive save and
      // rolls back otherwise), so there is no "will sync later" deferred state.
      showToast('success', successMsg, undefined, { surface: 'reset-member-password' });
      emit('reset');
      emit('close');
      return;
    }
    // Closed-union `ResetError` → translated copy. Compile-time forces this
    // key to exist for every error variant declared in authStore.
    formError.value = t(`family.resetPassword.error.${result.error}` as never);
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
    :title="fmt('family.resetPassword.modalTitle', { name: memberName })"
    icon="🔑"
    :save-label="t('family.resetPassword.submit')"
    :save-disabled="!canSubmit"
    :is-submitting="isSubmitting"
    :submitting-label="t('auth.passwordRotation.savingLabel')"
    save-gradient="orange"
    @close="handleClose"
    @save="handleSave"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ fmt('family.resetPassword.modalDescription', { name: memberName }) }}
      </p>

      <p
        class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
      >
        {{ fmt('family.resetPassword.warning', { name: memberName }) }}
      </p>

      <PasswordEntryFields
        v-model:new-password="newPassword"
        v-model:confirm="confirmPassword"
        id-prefix="reset"
        :disabled="isSubmitting"
      />

      <p
        v-if="formError"
        class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300"
      >
        {{ formError }}
      </p>
    </div>
  </BeanieFormModal>
</template>
