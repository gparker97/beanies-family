<script setup lang="ts">
import { computed } from 'vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useCurrencyDisplay, formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { useCountUp } from '@/composables/useCountUp';
import type { CurrencyCode } from '@/types/models';

interface Props {
  /** Card label (e.g., "Monthly Income") */
  label: string;
  /** Amount to display */
  amount: number;
  /** Currency code */
  currency: CurrencyCode;
  /** Change from previous period */
  changeAmount?: number;
  /** Change direction label (e.g., "vs last month") */
  changeLabel?: string;
  /** Icon color tint — 'green' | 'orange' | 'slate' */
  tint?: 'green' | 'orange' | 'slate';
  /** Whether to show as dark/gradient variant (for Cash Flow) */
  dark?: boolean;
  /** Optional data-testid for the card root */
  testId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  changeAmount: 0,
  changeLabel: 'vs last month',
  tint: 'green',
  dark: false,
  testId: undefined,
});

const { isUnlocked, MASK } = usePrivacyMode();
const { convertToDisplay } = useCurrencyDisplay();

const converted = computed(() => convertToDisplay(props.amount, props.currency));
const changeConverted = computed(() =>
  convertToDisplay(Math.abs(props.changeAmount), props.currency)
);

// Animate the display amount on change — returns 0 when masked so
// revealing numbers always triggers a fresh count-up from zero
const displayAmountRef = computed(() => (isUnlocked.value ? converted.value.displayAmount : 0));
const { displayValue: animatedAmount } = useCountUp(displayAmountRef);
const animatedFormatted = computed(() =>
  formatCurrencyWithCode(animatedAmount.value, converted.value.displayCurrency)
);

const isPositiveChange = computed(() => props.changeAmount >= 0);

const tintBg = computed(() => {
  switch (props.tint) {
    case 'green':
      return 'bg-[var(--tint-success-10)]';
    case 'orange':
      return 'bg-[var(--tint-orange-8)]';
    case 'slate':
      return props.dark ? 'bg-white/[0.12]' : 'bg-[var(--tint-slate-5)]';
    default:
      return 'bg-[var(--tint-success-10)]';
  }
});

const changeColor = computed(() => {
  if (props.dark) return 'text-emerald-300';
  switch (props.tint) {
    case 'green':
      return 'text-[#27AE60]';
    case 'orange':
      return 'text-primary-500';
    default:
      return 'text-secondary-500';
  }
});
</script>

<template>
  <div
    :data-testid="testId"
    class="rounded-[var(--sq)] p-5 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]"
    :class="
      dark
        ? 'from-secondary-500 bg-gradient-to-br to-[#3D5368] text-white'
        : 'bg-white dark:bg-slate-800'
    "
  >
    <!-- Icon + Label row -->
    <div class="mb-3 flex items-center gap-2.5">
      <div class="flex h-[38px] w-[38px] items-center justify-center rounded-xl" :class="tintBg">
        <slot name="icon">
          <svg
            v-if="tint === 'green'"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#27AE60"
            stroke-width="2.5"
            stroke-linecap="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          <svg
            v-else-if="tint === 'orange'"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            :class="dark ? 'text-white' : 'text-primary-500'"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          <svg
            v-else
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            :class="dark ? 'text-white' : 'text-secondary-500'"
          >
            <path d="M12 2v20M2 12h20" />
          </svg>
        </slot>
      </div>
      <div
        class="font-outfit text-xs font-semibold tracking-[0.08em] uppercase"
        :class="dark ? 'opacity-50' : 'text-secondary-500 opacity-45 dark:text-gray-300'"
      >
        {{ label }}
      </div>
    </div>

    <!-- Amount -->
    <div
      data-testid="stat-amount"
      class="font-outfit text-2xl font-extrabold"
      :class="dark ? '' : 'text-secondary-500 dark:text-gray-100'"
    >
      {{ isUnlocked ? animatedFormatted : MASK }}
    </div>

    <!-- Change indicator -->
    <div v-if="isUnlocked && changeAmount !== 0" class="mt-1 flex items-center gap-1">
      <span class="font-outfit text-xs font-semibold" :class="changeColor">
        {{ isPositiveChange ? '↑' : '↓' }}
        {{ isPositiveChange ? '+' : '-' }}{{ changeConverted.displayFormatted }}
      </span>
      <span
        class="text-xs"
        :class="dark ? 'opacity-35' : 'text-secondary-500 opacity-30 dark:text-gray-400'"
      >
        {{ changeLabel }}
      </span>
    </div>

    <!-- Slot for extra content (e.g., "Healthy" badge for cash flow) -->
    <slot />
  </div>
</template>
