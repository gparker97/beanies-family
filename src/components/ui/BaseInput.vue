<script setup lang="ts">
import { computed } from 'vue';

type InputType = 'text' | 'email' | 'password' | 'number' | 'date' | 'time' | 'tel' | 'url';

interface Props {
  modelValue: string | number | undefined;
  type?: InputType;
  label?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  required: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
}>();

const inputId = computed(() => props.id || `input-${Math.random().toString(36).slice(2, 9)}`);

const inputClasses = computed(() => {
  const base =
    'block w-full rounded-xl border px-3 py-2 text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-800 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 transition-colors';

  const states = props.error
    ? 'border-red-500 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-900'
    : 'border-gray-300 dark:border-slate-600 focus:border-primary-500 focus:ring-sky-silk-100 dark:focus:ring-primary-700';

  const disabled = props.disabled
    ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-slate-900'
    : '';

  return [base, states, disabled];
});

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = props.type === 'number' ? parseFloat(target.value) || 0 : target.value;
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="space-y-1">
    <label
      v-if="label"
      :for="inputId"
      class="font-outfit block text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
    >
      {{ label }}
      <span v-if="required" class="text-primary-500">*</span>
    </label>

    <input
      :id="inputId"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :class="inputClasses"
      @input="handleInput"
    />

    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
      {{ error }}
    </p>
    <p v-else-if="hint" class="text-sm text-gray-500 dark:text-gray-400">
      {{ hint }}
    </p>
  </div>
</template>
