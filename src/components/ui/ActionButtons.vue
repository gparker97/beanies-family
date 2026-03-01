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
        'hover:text-primary-600 rounded-lg text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700',
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
        'rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700',
      ]"
      :title="t('action.delete')"
      @click="$emit('delete')"
    >
      <BeanieIcon name="trash" :size="size" />
    </button>
  </div>
</template>
