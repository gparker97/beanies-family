<script setup lang="ts">
import { computed } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';
import { addMonths, formatMonthYearShort } from '@/utils/date';

const { t } = useTranslation();

const props = defineProps<{
  modelValue: Date;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Date];
}>();

const isCurrentMonth = computed(() => {
  const now = new Date();
  return (
    props.modelValue.getFullYear() === now.getFullYear() &&
    props.modelValue.getMonth() === now.getMonth()
  );
});

function prev() {
  emit('update:modelValue', addMonths(props.modelValue, -1));
}

function next() {
  emit('update:modelValue', addMonths(props.modelValue, 1));
}

function goToToday() {
  emit('update:modelValue', new Date());
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
    <button
      v-if="!isCurrentMonth"
      type="button"
      class="font-outfit ml-1 rounded-[10px] bg-[var(--color-primary)] px-2 py-0.5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
      @click="goToToday"
    >
      {{ t('date.today') }}
    </button>
  </div>
</template>
