<script setup lang="ts">
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { addMonths, formatMonthYearShort } from '@/utils/date';

const props = defineProps<{
  modelValue: Date;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Date];
}>();

function prev() {
  emit('update:modelValue', addMonths(props.modelValue, -1));
}

function next() {
  emit('update:modelValue', addMonths(props.modelValue, 1));
}
</script>

<template>
  <div
    class="inline-flex items-center gap-1 rounded-[14px] bg-white px-3 py-1.5 shadow-[0_2px_8px_rgba(44,62,80,0.05)] dark:bg-slate-800"
  >
    <button
      type="button"
      aria-label="Previous month"
      class="rounded-lg p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-200"
      @click="prev"
    >
      <BeanieIcon name="chevron-left" size="sm" />
    </button>
    <span
      class="font-outfit min-w-[100px] text-center text-xs font-semibold text-[var(--color-text)]"
    >
      {{ formatMonthYearShort(modelValue) }}
    </span>
    <button
      type="button"
      aria-label="Next month"
      class="rounded-lg p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-200"
      @click="next"
    >
      <BeanieIcon name="chevron-right" size="sm" />
    </button>
  </div>
</template>
