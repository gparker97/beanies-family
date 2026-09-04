<script setup lang="ts">
/**
 * Shared multi-line text input. Mirrors BaseInput's styling (border,
 * padding, focus ring, dark mode) so forms that mix single-line and
 * multi-line fields look cohesive. Use for `notes`, `address`,
 * `description`, and any prose field where users need line breaks.
 *
 * Passes through every extra attribute (aria, data, autocomplete,
 * etc.) to the underlying `<textarea>` rather than the wrapper div —
 * matches BaseInput.
 */
import { computed } from 'vue';

defineOptions({ inheritAttrs: false });

interface Props {
  modelValue: string | undefined;
  label?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  rows?: number;
  /** Allow manual vertical resize. Default: false (fixed height). */
  resize?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  required: false,
  rows: 3,
  resize: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
}>();

const textareaId = computed(() => props.id || `textarea-${Math.random().toString(36).slice(2, 9)}`);

const textareaClasses = computed(() => {
  // `text-base` (1rem) is REQUIRED, not cosmetic — see BaseInput: a focusable
  // <textarea> that computes < 16px triggers iOS's stuck-zoom-on-focus. rem-based
  // so Large reading mode still scales it.
  const base =
    'block w-full rounded-xl border px-3 py-2 text-base text-gray-900 dark:text-ink bg-white dark:bg-surface-raised placeholder-gray-400 dark:placeholder-ink-faint focus:outline-none focus:ring-2 transition-colors';
  const states = props.error
    ? 'border-red-500 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-900'
    : 'border-gray-300 dark:border-line-strong focus:border-primary-500 focus:ring-sky-silk-100 dark:focus:ring-primary-700';
  const disabled = props.disabled
    ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-surface-ground'
    : '';
  const resize = props.resize ? 'resize-y' : 'resize-none';
  return [base, states, disabled, resize];
});

function handleInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="space-y-1">
    <label
      v-if="label"
      :for="textareaId"
      class="font-outfit dark:text-ink-soft block text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase"
    >
      {{ label }}
      <span v-if="required" class="text-primary-500">*</span>
    </label>

    <textarea
      :id="textareaId"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :rows="rows"
      :class="textareaClasses"
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
