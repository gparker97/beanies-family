<script setup lang="ts">
import { computed } from 'vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useCurrencyDisplay, formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { useCountUp } from '@/composables/useCountUp';
import type { CurrencyCode } from '@/types/models';

interface Props {
  /** Stat label */
  label: string;
  /** Pre-formatted display value (fallback when amount/currency not provided) */
  value?: string;
  /** Numeric amount — enables count-up animation when paired with currency */
  amount?: number;
  /** Currency code — required with amount for animated display */
  currency?: CurrencyCode;
  /** Animation delay in ms */
  animationDelay?: number;
  /** Show +/- sign prefix (for change values) */
  showSign?: boolean;
  /** Color tint — 'green' | 'orange' | 'slate' | 'purple' */
  tint?: 'green' | 'orange' | 'slate' | 'purple';
  /** Dark variant (inverted colors) */
  dark?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  value: undefined,
  amount: undefined,
  currency: undefined,
  animationDelay: 0,
  showSign: false,
  tint: 'slate',
  dark: false,
});

const { isUnlocked, MASK } = usePrivacyMode();
const { convertToDisplay } = useCurrencyDisplay();

// Animated path: amount + currency provided
const converted = computed(() =>
  props.amount !== undefined && props.currency
    ? convertToDisplay(props.amount, props.currency)
    : null
);
const animTarget = computed(() =>
  isUnlocked.value && converted.value ? converted.value.displayAmount : 0
);
const { displayValue: animatedAmount } = useCountUp(animTarget, props.animationDelay);

const displayValue = computed(() => {
  if (!isUnlocked.value) return MASK;
  if (converted.value) {
    const formatted = formatCurrencyWithCode(animatedAmount.value, converted.value.displayCurrency);
    if (props.showSign && props.amount !== undefined) {
      return (props.amount >= 0 ? '+' : '') + formatted;
    }
    return formatted;
  }
  return props.value ?? '';
});
</script>

<template>
  <div
    class="rounded-[var(--sq)] p-5 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]"
    :class="
      dark
        ? 'from-secondary-500 bg-gradient-to-br to-[#3D5368] text-white'
        : 'bg-white dark:bg-slate-800'
    "
  >
    <div
      class="nook-section-label mb-3"
      :class="dark ? 'text-white' : 'text-secondary-500 dark:text-gray-400'"
    >
      {{ label }}
    </div>
    <div
      class="font-outfit text-2xl font-extrabold"
      :class="dark ? '' : 'text-secondary-500 dark:text-gray-100'"
    >
      {{ displayValue }}
    </div>
  </div>
</template>
