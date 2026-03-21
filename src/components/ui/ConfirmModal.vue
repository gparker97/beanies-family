<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
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
    layer="overlay"
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
      <p v-if="state.detail" class="text-xs text-gray-500 dark:text-gray-400">
        {{ state.detail }}
      </p>
    </div>

    <!-- Footer — uses native buttons to avoid click event delegation issues -->
    <template #footer>
      <div class="flex justify-end gap-3">
        <button
          v-if="state.showCancel"
          type="button"
          class="inline-flex items-center justify-center rounded-2xl bg-transparent px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          @click="handleCancel"
        >
          {{ state.cancelLabel ? t(state.cancelLabel) : t('action.cancel') }}
        </button>
        <button
          type="button"
          class="inline-flex touch-manipulation items-center justify-center rounded-2xl px-3 py-1.5 text-sm font-medium text-white transition-colors"
          :class="
            state.variant === 'danger'
              ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
              : 'bg-primary-500 hover:bg-primary-600'
          "
          @click="handleConfirm"
        >
          {{
            state.confirmLabel
              ? t(state.confirmLabel)
              : state.showCancel
                ? t('action.delete')
                : t('action.ok')
          }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>
