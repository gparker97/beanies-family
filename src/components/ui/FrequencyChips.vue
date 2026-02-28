<script setup lang="ts">
interface ChipOption {
  value: string;
  label: string;
  icon?: string;
}

interface Props {
  modelValue: string;
  options: ChipOption[];
}

defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="font-outfit rounded-full px-3.5 py-1.5 text-[0.65rem] font-semibold transition-all duration-150"
      :class="
        modelValue === opt.value
          ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
      "
      @click="emit('update:modelValue', opt.value)"
    >
      <span v-if="opt.icon" class="mr-1">{{ opt.icon }}</span>
      {{ opt.label }}
    </button>
  </div>
</template>
