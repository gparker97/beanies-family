<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';

/**
 * Reusable warning modal shown before a user commits to "Local File" as
 * their storage provider. Surfaces the trade-offs honestly: cloud-storage-
 * folder sync works on desktop Chromium browsers; iOS/Android/Safari fall
 * back to manual export-import; encryption applies in all cases.
 *
 * Used by both `CreatePodView` (first-run wizard) and `LoadPodView`
 * (returning-user file picker). Single source of truth for the copy.
 */
defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  proceed: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <BaseModal :open="open" size="sm" @close="emit('close')">
    <div class="p-5">
      <div class="mb-3 flex items-center gap-2">
        <svg
          class="h-5 w-5 flex-shrink-0 text-amber-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
          {{ t('storage.localFile') }}
        </h3>
      </div>
      <p class="mb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {{ t('storage.localFileWarning') }}
      </p>
      <p class="mb-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        🔒 {{ t('storage.localFileWarningEncryption') }}
      </p>
      <p class="mb-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        💻 {{ t('storage.localFileBestOnDesktop') }}
      </p>
      <div class="flex gap-2">
        <BaseButton variant="secondary" size="sm" class="flex-1" @click="emit('close')">
          {{ t('action.back') }}
        </BaseButton>
        <BaseButton size="sm" class="flex-1" @click="emit('proceed')">
          {{ t('storage.localFileContinue') }}
        </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
