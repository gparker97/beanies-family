<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import type { CurrencyCode } from '@/types/models';

const props = defineProps<{
  interest: number;
  principal: number;
  remaining: number;
  currency: string;
}>();

const { t } = useTranslation();

function fmt(amount: number): string {
  return formatCurrencyWithCode(amount, props.currency as CurrencyCode);
}
</script>

<template>
  <div class="space-y-2 rounded-2xl bg-[var(--tint-orange-8)] p-4">
    <div
      class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text-muted)] uppercase"
    >
      {{ t('txLink.amortizationBreakdown') }}
    </div>
    <div class="grid grid-cols-3 gap-2 text-sm text-[var(--color-text)]">
      <div>
        <div class="text-xs text-[var(--color-text-muted)]">{{ t('txLink.interestPortion') }}</div>
        <div class="font-outfit font-bold">{{ fmt(interest) }}</div>
      </div>
      <div>
        <div class="text-xs text-[var(--color-text-muted)]">
          {{ t('txLink.principalPortion') }}
        </div>
        <div class="font-outfit font-bold">{{ fmt(principal) }}</div>
      </div>
      <div>
        <div class="text-xs text-[var(--color-text-muted)]">
          {{ t('txLink.remainingBalance') }}
        </div>
        <div class="font-outfit font-bold">{{ fmt(remaining) }}</div>
      </div>
    </div>
    <!-- Slot for extra notes (e.g. "extra payment" message) -->
    <slot />
  </div>
</template>
