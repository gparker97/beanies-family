<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  modelValue: number | undefined;
  currencySymbol?: string;
  fontSize?: string;
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currencySymbol: '$',
  fontSize: '1.4rem',
  label: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: number | undefined];
}>();

const displayValue = computed(() => {
  if (props.modelValue === undefined || props.modelValue === null) return '';
  return String(props.modelValue);
});

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const val = target.value;
  if (val === '') {
    emit('update:modelValue', undefined);
  } else {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      emit('update:modelValue', num);
    }
  }
}
</script>

<template>
  <div>
    <label
      v-if="label"
      class="font-outfit mb-2 block text-[0.6rem] font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35 dark:text-gray-300"
    >
      {{ label }}
    </label>
    <div
      class="focus-within:border-primary-500 flex items-center gap-2 rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] dark:bg-slate-700"
    >
      <span
        class="font-outfit flex-shrink-0 font-bold text-[var(--color-text)] opacity-25 dark:text-gray-400"
        :style="{ fontSize }"
      >
        {{ currencySymbol }}
      </span>
      <input
        type="number"
        step="0.01"
        min="0"
        class="font-outfit w-full border-none bg-transparent font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :style="{ fontSize }"
        :value="displayValue"
        placeholder="0.00"
        @input="handleInput"
      />
    </div>
  </div>
</template>
