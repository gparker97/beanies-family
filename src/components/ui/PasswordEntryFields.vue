<script setup lang="ts">
/**
 * Shared "new + confirm password" input pair.
 *
 * Used by `ChangePasswordSettings.vue` (Settings → Change Password) and
 * `ResetMemberPasswordModal.vue` (Family page → admin reset). Validation
 * (non-empty + match) is owned by the parent so each surface can layer in
 * its own pre-checks (e.g. "must differ from current") on top.
 *
 * `idPrefix` namespaces the input ids so two instances on the same page
 * don't collide.
 */
import BaseInput from './BaseInput.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

const props = defineProps<{
  newPassword: string;
  confirm: string;
  idPrefix: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:newPassword': [value: string];
  'update:confirm': [value: string];
}>();

function onNewPasswordUpdate(value: string | number) {
  emit('update:newPassword', String(value));
}
function onConfirmUpdate(value: string | number) {
  emit('update:confirm', String(value));
}
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <label
        :for="`${idPrefix}-new`"
        class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
      >
        {{ t('changePassword.newPassword') }}
      </label>
      <BaseInput
        :id="`${idPrefix}-new`"
        :model-value="props.newPassword"
        type="password"
        autocomplete="new-password"
        :placeholder="t('changePassword.newPasswordPlaceholder')"
        :disabled="props.disabled"
        @update:model-value="onNewPasswordUpdate"
      />
    </div>

    <div class="space-y-1">
      <label
        :for="`${idPrefix}-confirm`"
        class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
      >
        {{ t('changePassword.confirmNewPassword') }}
      </label>
      <BaseInput
        :id="`${idPrefix}-confirm`"
        :model-value="props.confirm"
        type="password"
        autocomplete="new-password"
        :placeholder="t('changePassword.confirmNewPasswordPlaceholder')"
        :disabled="props.disabled"
        @update:model-value="onConfirmUpdate"
      />
    </div>
  </div>
</template>
