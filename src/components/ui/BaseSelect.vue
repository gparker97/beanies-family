<script setup lang="ts">
import { computed } from 'vue';

interface Option {
  value: string | number;
  label: string;
  /** Render the option but block selection (e.g. a "coming soon" tier). Optional —
   *  existing callers omit it and the option stays selectable. */
  disabled?: boolean;
}

interface OptionGroup {
  label: string;
  options: Option[];
}

interface Props {
  modelValue: string | number;
  options?: Option[];
  groupedOptions?: OptionGroup[];
  label?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  required: false,
  placeholder: 'Select an option',
});

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
}>();

const selectId = computed(() => props.id || `select-${Math.random().toString(36).slice(2, 9)}`);

const isGrouped = computed(() => props.groupedOptions && props.groupedOptions.length > 0);

const selectClasses = computed(() => {
  // `text-base` (1rem) is REQUIRED, not cosmetic — see BaseInput: a focusable
  // <select> that computes < 16px triggers iOS's stuck-zoom-on-focus. rem-based so
  // Large reading mode still scales it.
  const base =
    'block w-full rounded-xl border pl-3 pr-8 py-2 text-base text-gray-900 dark:text-ink bg-white dark:bg-surface-raised focus:outline-none focus:ring-2 transition-colors appearance-none cursor-pointer';

  const states = props.error
    ? 'border-red-500 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-900'
    : 'border-gray-300 dark:border-line-strong focus:border-primary-500 focus:ring-sky-silk-100 dark:focus:ring-primary-700';

  const disabled = props.disabled
    ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-surface-ground'
    : '';

  return [base, states, disabled];
});

function handleChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  emit('update:modelValue', target.value);
}
</script>

<template>
  <div class="space-y-1">
    <label
      v-if="label"
      :for="selectId"
      class="dark:text-ink-soft block text-sm font-medium text-gray-700"
    >
      {{ label }}
      <span v-if="required" class="text-red-500">*</span>
    </label>

    <div class="relative">
      <select
        :id="selectId"
        :value="modelValue"
        :disabled="disabled"
        :required="required"
        :class="selectClasses"
        @change="handleChange"
      >
        <option value="" disabled>{{ placeholder }}</option>

        <!-- Grouped options with optgroup -->
        <template v-if="isGrouped">
          <optgroup
            v-for="group in groupedOptions"
            :key="group.label"
            :label="group.label"
            class="dark:text-ink font-semibold text-gray-900"
          >
            <option
              v-for="option in group.options"
              :key="option.value"
              :value="option.value"
              :disabled="option.disabled"
              class="font-normal"
            >
              {{ option.label }}
            </option>
          </optgroup>
        </template>

        <!-- Flat options -->
        <template v-else>
          <option
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            {{ option.label }}
          </option>
        </template>
      </select>

      <!-- Dropdown arrow -->
      <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
        <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>

    <p v-if="error" class="dark:text-danger-lift text-sm text-red-600">
      {{ error }}
    </p>
    <p v-else-if="hint" class="dark:text-ink-soft text-sm text-gray-500">
      {{ hint }}
    </p>
  </div>
</template>
