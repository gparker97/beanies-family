<script setup lang="ts">
export interface ChipOption {
  value: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  disabledHint?: string;
}

interface Props {
  modelValue: string;
  options: ChipOption[];
  disabled?: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <span v-for="opt in options" :key="opt.value" class="group relative inline-flex">
      <button
        type="button"
        class="font-outfit rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
        :class="[
          modelValue === opt.value
            ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
            : opt.disabled
              ? 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] opacity-40 dark:bg-slate-700 dark:text-gray-500'
              : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400',
          opt.disabled ? 'cursor-not-allowed' : '',
        ]"
        :disabled="disabled || opt.disabled"
        @click="!opt.disabled && emit('update:modelValue', opt.value)"
      >
        <span v-if="opt.icon" class="mr-1">{{ opt.icon }}</span>
        {{ opt.label }}
      </button>
      <!-- Disabled hint tooltip -->
      <span
        v-if="opt.disabled && opt.disabledHint"
        class="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 rounded-lg bg-gray-800 px-2.5 py-1 text-[10px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-slate-600"
      >
        {{ opt.disabledHint }}
      </span>
    </span>
  </div>
</template>
