<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  modelValue: number[];
}

defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: number[]];
}>();

const { t } = useTranslation();

// Day labels: Mon-Sun (indices 1-6, 0)
const days = [
  { index: 1, label: () => t('planner.day.mon').charAt(0) },
  { index: 2, label: () => t('planner.day.tue').charAt(0) },
  { index: 3, label: () => t('planner.day.wed').charAt(0) },
  { index: 4, label: () => t('planner.day.thu').charAt(0) },
  { index: 5, label: () => t('planner.day.fri').charAt(0) },
  { index: 6, label: () => t('planner.day.sat').charAt(0) },
  { index: 0, label: () => t('planner.day.sun').charAt(0) },
];

function toggle(dayIndex: number, current: number[]) {
  const copy = [...current];
  const idx = copy.indexOf(dayIndex);
  if (idx >= 0) {
    copy.splice(idx, 1);
  } else {
    copy.push(dayIndex);
  }
  emit('update:modelValue', copy);
}
</script>

<template>
  <div class="flex gap-1.5">
    <button
      v-for="day in days"
      :key="day.index"
      type="button"
      class="font-outfit flex h-[38px] w-[38px] items-center justify-center rounded-[11px] text-xs font-bold transition-all duration-150"
      :class="
        modelValue.includes(day.index)
          ? 'bg-secondary-500 text-white shadow-sm dark:bg-slate-200 dark:text-slate-900'
          : 'bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
      "
      @click="toggle(day.index, modelValue)"
    >
      {{ day.label() }}
    </button>
  </div>
</template>
