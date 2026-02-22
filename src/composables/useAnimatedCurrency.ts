import { computed, type Ref } from 'vue';
import { useCountUp } from './useCountUp';
import { useCurrencyDisplay, formatCurrencyWithCode } from './useCurrencyDisplay';
import { usePrivacyMode } from './usePrivacyMode';
import type { CurrencyCode } from '@/types/models';

/**
 * Returns a formatted, animated currency string for a summary card value.
 *
 * When privacy mode is on the target drops to 0 so that revealing figures
 * triggers a fresh count-up from zero — matching SummaryStatCard behaviour.
 *
 * @param amount  Reactive raw numeric amount (in `fromCurrency`)
 * @param fromCurrency  The currency the amount is expressed in
 * @param delay  Optional animation delay (ms)
 */
export function useAnimatedCurrency(
  amount: Ref<number>,
  fromCurrency: Ref<CurrencyCode> | CurrencyCode,
  delay = 0
) {
  const { convertToDisplay } = useCurrencyDisplay();
  const { isUnlocked, MASK } = usePrivacyMode();

  const fromCode = typeof fromCurrency === 'string' ? fromCurrency : fromCurrency;

  const converted = computed(() =>
    convertToDisplay(amount.value, typeof fromCode === 'string' ? fromCode : fromCode.value)
  );

  const target = computed(() => (isUnlocked.value ? converted.value.displayAmount : 0));
  const { displayValue } = useCountUp(target, delay);

  const formatted = computed(() => {
    if (!isUnlocked.value) return MASK;
    return formatCurrencyWithCode(displayValue.value, converted.value.displayCurrency);
  });

  return { formatted, displayValue };
}
