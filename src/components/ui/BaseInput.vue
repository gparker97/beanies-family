<script setup lang="ts">
import { computed } from 'vue';

/**
 * Forward every extra attribute (`aria-*`, `data-*`, `autocomplete`,
 * etc.) to the underlying `<input>` element rather than the wrapper
 * div. This makes labels, aria wiring, and test selectors behave as
 * callers expect.
 */
defineOptions({ inheritAttrs: false });

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
  blur: [event: FocusEvent];
}>();

const inputId = computed(() => props.id || `input-${Math.random().toString(36).slice(2, 9)}`);

const inputClasses = computed(() => {
  // `text-base` (1rem) is REQUIRED, not cosmetic: native inputs are font-size:100%
  // (inherit), so under any `text-sm` ancestor the field would compute < 16px and
  // iOS would auto-zoom the webview on focus and not zoom back (a stuck zoom only a
  // force-quit clears). Pinning 1rem keeps every BaseInput above that threshold;
  // it's rem-based so Large reading mode still scales it.
  const base =
    'block w-full rounded-xl border px-3 py-2 text-base text-gray-900 dark:text-ink bg-white dark:bg-surface-raised placeholder-gray-400 dark:placeholder-ink-faint focus:outline-none focus:ring-2 transition-colors';

  const states = props.error
    ? 'border-red-500 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-900'
    : 'border-gray-300 dark:border-line-strong focus:border-primary-500 focus:ring-sky-silk-100 dark:focus:ring-primary-700';

  const disabled = props.disabled
    ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-surface-ground'
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
      class="font-outfit dark:text-ink-soft block text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase"
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
      v-bind="$attrs"
      @input="handleInput"
      @blur="emit('blur', $event)"
    />

    <p v-if="error" class="dark:text-danger-lift text-sm text-red-600">
      {{ error }}
    </p>
    <p v-else-if="hint" class="dark:text-ink-soft text-sm text-gray-500">
      {{ hint }}
    </p>
  </div>
</template>
