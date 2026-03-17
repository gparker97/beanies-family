<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';

export interface ConfirmDetail {
  label: string;
  value: string;
  highlight?: boolean;
}

defineProps<{
  open: boolean;
  title: string;
  message: string;
  details: ConfirmDetail[];
}>();

const emit = defineEmits<{ close: [] }>();
const { t } = useTranslation();
</script>

<template>
  <BaseModal :open="open" :title="title" size="sm" layer="overlay" @close="emit('close')">
    <div class="-mt-12 flex flex-col items-center gap-0 text-center">
      <img
        src="/brand/beanies_celebrating_circle_transparent_300x300.png"
        alt=""
        class="-mb-2 w-full max-w-[200px]"
      />
      <p class="font-outfit text-sm font-semibold text-gray-700 dark:text-gray-200">
        {{ message }}
      </p>

      <div
        class="mt-2 w-full rounded-2xl bg-gray-50 px-4 py-3 text-left text-sm dark:bg-slate-700/50"
      >
        <div class="space-y-2">
          <div
            v-for="detail in details"
            :key="detail.label"
            class="flex items-center justify-between"
          >
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ detail.label }}</span>
            <span
              class="font-outfit max-w-[60%] truncate text-right font-semibold"
              :class="detail.highlight ? 'text-[#27ae60]' : 'text-gray-800 dark:text-gray-100'"
            >
              {{ detail.value }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <BaseButton variant="primary" size="sm" @click="emit('close')">
          {{ t('action.ok') }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
