<script setup lang="ts">
interface PillOption {
  value: string;
  label: string;
  variant?: 'default' | 'green' | 'orange';
}

interface Props {
  modelValue: string;
  options: PillOption[];
}

defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function getSelectedClasses(variant?: string): string {
  switch (variant) {
    case 'green':
      return 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-sm';
    case 'orange':
      return 'bg-gradient-to-r from-primary-500 to-terracotta-400 text-white shadow-sm';
    default:
      return 'bg-secondary-500 text-white shadow-sm dark:bg-slate-200 dark:text-slate-900';
  }
}
</script>

<template>
  <div class="inline-flex rounded-[14px] bg-[var(--tint-slate-5)] p-1 dark:bg-slate-700">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="font-outfit rounded-[11px] px-4 py-2 text-xs font-semibold transition-all duration-200"
      :class="
        modelValue === opt.value
          ? getSelectedClasses(opt.variant)
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] dark:text-gray-400 dark:hover:text-gray-200'
      "
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
