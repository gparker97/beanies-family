<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const { state, handleConfirm, handleCancel } = useConfirm();
</script>

<template>
  <BaseModal
    :open="state.open"
    :title="t(state.title)"
    size="sm"
    :closable="state.showCancel"
    @close="handleCancel"
  >
    <!-- Body -->
    <div class="flex flex-col items-center gap-4 text-center">
      <!-- Icon in colored squircle -->
      <div
        class="flex h-12 w-12 items-center justify-center rounded-2xl"
        :class="
          state.variant === 'danger'
            ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
        "
      >
        <BeanieIcon :name="state.variant === 'danger' ? 'trash' : 'info'" size="lg" />
      </div>

      <p class="text-sm text-gray-600 dark:text-gray-300">
        {{ t(state.message) }}
      </p>
    </div>

    <!-- Footer -->
    <template #footer>
      <div class="flex justify-end gap-3">
        <BaseButton v-if="state.showCancel" variant="ghost" size="sm" @click="handleCancel">
          {{ t('action.cancel') }}
        </BaseButton>
        <BaseButton
          :variant="state.variant === 'danger' ? 'danger' : 'primary'"
          size="sm"
          @click="handleConfirm"
        >
          {{ state.showCancel ? t('action.delete') : t('action.ok') }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
