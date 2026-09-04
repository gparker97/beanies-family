<script setup lang="ts">
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';

withDefaults(
  defineProps<{
    size?: 'sm' | 'md';
    editTestId?: string;
  }>(),
  { size: 'sm' }
);

defineEmits<{
  edit: [];
  delete: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <div class="flex gap-1">
    <button
      :class="[
        size === 'sm' ? 'p-1.5' : 'p-2',
        'hover:text-primary-600 dark:hover:bg-surface-hover rounded-lg text-gray-400 transition-colors hover:bg-gray-100',
      ]"
      :data-testid="editTestId"
      :title="t('action.edit')"
      @click="$emit('edit')"
    >
      <BeanieIcon name="edit" :size="size" />
    </button>
    <button
      :class="[
        size === 'sm' ? 'p-1.5' : 'p-2',
        'dark:hover:bg-surface-hover rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600',
      ]"
      :title="t('action.delete')"
      @click="$emit('delete')"
    >
      <BeanieIcon name="trash" :size="size" />
    </button>
  </div>
</template>
