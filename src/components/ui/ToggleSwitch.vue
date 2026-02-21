<script setup lang="ts">
interface Props {
  modelValue: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  size: 'md',
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function toggle() {
  if (!props.disabled) {
    emit('update:modelValue', !props.modelValue);
  }
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="focus:ring-primary-500 relative inline-flex flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:ring-2 focus:ring-offset-2 focus:outline-none"
    :class="[
      modelValue
        ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r'
        : 'bg-[var(--tint-slate-10)] dark:bg-slate-600',
      disabled ? 'cursor-not-allowed opacity-50' : '',
      size === 'sm' ? 'h-5 w-9' : 'h-6 w-11',
    ]"
    @click="toggle"
  >
    <span
      class="pointer-events-none inline-block transform rounded-full bg-white shadow-md transition-transform duration-200"
      :class="[
        size === 'sm'
          ? modelValue
            ? 'h-3.5 w-3.5 translate-x-[18px]'
            : 'h-3.5 w-3.5 translate-x-[3px]'
          : modelValue
            ? 'h-[18px] w-[18px] translate-x-[22px]'
            : 'h-[18px] w-[18px] translate-x-[3px]',
        size === 'sm' ? 'mt-[3px]' : 'mt-[3px]',
      ]"
    />
  </button>
</template>
