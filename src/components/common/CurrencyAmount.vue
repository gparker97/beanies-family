<script setup lang="ts">
import { computed } from 'vue';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import type { CurrencyCode } from '@/types/models';

const props = withDefaults(
  defineProps<{
    /** The amount to display */
    amount: number;
    /** The original currency of the amount */
    currency: CurrencyCode;
    /** Show as positive/negative with color (for income/expense) */
    type?: 'income' | 'expense' | 'neutral';
    /** Size variant */
    size?: 'sm' | 'md' | 'lg' | 'xl';
    /** Show the original currency even when not converted */
    alwaysShowOriginal?: boolean;
  }>(),
  {
    type: 'neutral',
    size: 'md',
    alwaysShowOriginal: false,
  }
);

const { convertToDisplay } = useCurrencyDisplay();

const converted = computed(() => convertToDisplay(props.amount, props.currency));

const showSecondary = computed(() => {
  if (props.alwaysShowOriginal) return true;
  return converted.value.isConverted || converted.value.conversionFailed;
});

const primaryClasses = computed(() => {
  const base = 'font-medium';
  const sizes: Record<string, string> = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
    xl: 'text-xl',
  };
  const colors: Record<string, string> = {
    income: 'text-green-600 dark:text-green-400',
    expense: 'text-red-600 dark:text-red-400',
    neutral: 'text-gray-900 dark:text-gray-100',
  };
  return `${base} ${sizes[props.size]} ${colors[props.type]}`;
});

const secondaryClasses = computed(() => {
  const sizes: Record<string, string> = {
    sm: 'text-xs',
    md: 'text-xs',
    lg: 'text-sm',
    xl: 'text-sm',
  };
  return `${sizes[props.size]} text-gray-400 dark:text-gray-500`;
});

const prefix = computed(() => {
  if (props.type === 'income') return '+';
  if (props.type === 'expense') return '-';
  return '';
});
</script>

<template>
  <span class="inline-flex flex-col">
    <!-- Primary amount (display currency) -->
    <span :class="primaryClasses">
      <span
        v-if="converted.conversionFailed"
        class="mr-1 text-yellow-500"
        title="Exchange rate not available"
      >
        <svg class="inline-block h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
      </span>
      {{ prefix }}{{ converted.displayFormatted }}
    </span>
    <!-- Secondary amount (original currency) -->
    <span v-if="showSecondary" :class="secondaryClasses">
      {{ converted.originalFormatted }}
    </span>
  </span>
</template>
