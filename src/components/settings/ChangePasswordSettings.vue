<script setup lang="ts">
/**
 * Change Password — Settings tile + modal.
 *
 * Self-contained section embedded in the Security & Privacy modal.
 * Renders an inline tile with a "Change Password" button; clicking
 * opens a BeanieFormModal for entering current + new + confirm.
 *
 * Visibility: only when the current member has a passwordHash. Users
 * who joined via passkey or were never assigned a password don't see
 * this tile (a separate "Set Password" affordance can be added later
 * for those users — different flow, different copy).
 */
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import PasswordEntryFields from '@/components/ui/PasswordEntryFields.vue';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();

const showModal = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const formError = ref<string | null>(null);
const isSubmitting = ref(false);

const currentMember = computed(() =>
  familyStore.members.find((m) => m.id === authStore.currentUser?.memberId)
);

const hasPassword = computed(() => Boolean(currentMember.value?.passwordHash));

const canSubmit = computed(
  () =>
    Boolean(currentPassword.value) &&
    Boolean(newPassword.value) &&
    Boolean(confirmPassword.value) &&
    newPassword.value === confirmPassword.value &&
    newPassword.value !== currentPassword.value
);

function reset() {
  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  formError.value = null;
  isSubmitting.value = false;
}

function handleOpen() {
  reset();
  showModal.value = true;
}

function handleClose() {
  showModal.value = false;
  reset();
}

async function handleSave() {
  formError.value = null;

  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    formError.value = t('changePassword.error.required');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    formError.value = t('changePassword.error.mismatch');
    return;
  }
  if (newPassword.value === currentPassword.value) {
    formError.value = t('changePassword.error.sameAsCurrent');
    return;
  }

  isSubmitting.value = true;
  try {
    const result = await authStore.changePassword(currentPassword.value, newPassword.value);
    if (result.success) {
      showToast('success', t('changePassword.success'), undefined, {
        surface: 'changePassword',
      });
      handleClose();
    } else {
      formError.value = result.error ?? t('changePassword.error.failed');
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : t('changePassword.error.failed');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div
    v-if="hasPassword"
    class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-slate-700"
  >
    <div class="min-w-0 flex-1 pr-3">
      <p class="font-medium text-gray-900 dark:text-gray-100">
        {{ t('changePassword.tileTitle') }}
      </p>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('changePassword.tileDescription') }}
      </p>
    </div>
    <button
      type="button"
      class="font-outfit border-primary-500 text-primary-500 hover:bg-primary-500/5 dark:bg-primary-500/15 flex-shrink-0 rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
      @click="handleOpen"
    >
      {{ t('changePassword.tileAction') }}
    </button>
  </div>

  <BeanieFormModal
    :open="showModal"
    :title="t('changePassword.modalTitle')"
    icon="🔑"
    :save-label="t('changePassword.submit')"
    :save-disabled="!canSubmit"
    :is-submitting="isSubmitting"
    save-gradient="orange"
    @close="handleClose"
    @save="handleSave"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('changePassword.modalDescription') }}
      </p>

      <div class="space-y-1">
        <label
          for="cp-current"
          class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
        >
          {{ t('changePassword.currentPassword') }}
        </label>
        <BaseInput
          id="cp-current"
          v-model="currentPassword"
          type="password"
          autocomplete="current-password"
          :placeholder="t('changePassword.currentPasswordPlaceholder')"
        />
      </div>

      <PasswordEntryFields
        v-model:new-password="newPassword"
        v-model:confirm="confirmPassword"
        id-prefix="cp"
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
