<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

defineProps<{
  open: boolean;
  files: Array<{ fileId: string; name: string; modifiedTime: string }>;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  select: [payload: { fileId: string; fileName: string }];
  refresh: [];
}>();

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
</script>

<template>
  <BaseModal :open="open" @close="emit('close')">
    <div class="text-center">
      <div
        class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
      >
        <svg
          class="h-6 w-6 text-blue-600 dark:text-blue-400"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path
            d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"
          />
        </svg>
      </div>
      <h3 class="font-outfit text-lg font-bold text-gray-900 dark:text-gray-100">
        {{ t('googleDrive.filePickerTitle') }}
      </h3>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="py-8 text-center">
      <BeanieSpinner size="md" />
    </div>

    <!-- Empty state -->
    <div v-else-if="files.length === 0" class="py-8 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('googleDrive.noFilesFound') }}
      </p>
    </div>

    <!-- File list -->
    <div v-else class="mt-4 max-h-64 space-y-2 overflow-y-auto">
      <button
        v-for="file in files"
        :key="file.fileId"
        class="hover:border-primary-500/40 hover:bg-primary-500/5 dark:hover:border-primary-500/30 dark:hover:bg-primary-500/10 flex w-full items-center gap-3 rounded-xl border border-gray-200 p-3 text-left transition-colors dark:border-slate-600"
        @click="emit('select', { fileId: file.fileId, fileName: file.name })"
      >
        <div
          class="bg-primary-500/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
        >
          <svg
            class="text-primary-500 h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {{ file.name }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('googleDrive.lastModified') }}: {{ formatDate(file.modifiedTime) }}
          </p>
        </div>
        <svg
          class="h-4 w-4 flex-shrink-0 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <!-- Actions -->
    <div class="mt-4 flex gap-2">
      <BaseButton variant="secondary" class="flex-1" @click="emit('refresh')">
        {{ t('googleDrive.refresh') }}
      </BaseButton>
      <BaseButton variant="secondary" class="flex-1" @click="emit('close')">
        {{ t('action.cancel') }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
