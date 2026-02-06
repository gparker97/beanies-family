import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatCurrency } from '@/constants/currencies';
import type { CurrencyCode, ExchangeRate } from '@/types/models';

export interface ConvertedAmount {
  /** The converted amount in display currency */
  displayAmount: number;
  /** The display currency code */
  displayCurrency: CurrencyCode;
  /** Formatted string in display currency */
  displayFormatted: string;
  /** The original amount */
  originalAmount: number;
  /** The original currency code */
  originalCurrency: CurrencyCode;
  /** Formatted string in original currency */
  originalFormatted: string;
  /** Whether the amount was converted (display !== original currency) */
  isConverted: boolean;
  /** Whether conversion failed (rate not available) */
  conversionFailed: boolean;
}

/**
 * Get exchange rate from the rates array
 */
function getRate(
  rates: ExchangeRate[],
  from: CurrencyCode,
  to: CurrencyCode
): number | undefined {
  if (from === to) return 1;

  // Direct rate
  const direct = rates.find((r) => r.from === from && r.to === to);
  if (direct) return direct.rate;

  // Inverse rate
  const inverse = rates.find((r) => r.from === to && r.to === from);
  if (inverse) return 1 / inverse.rate;

  // Try to find a path through the base currency (commonly USD)
  // First, convert from -> base, then base -> to
  const baseCurrencies: CurrencyCode[] = ['USD', 'EUR', 'GBP'];
  for (const base of baseCurrencies) {
    if (base === from || base === to) continue;

    const fromToBase = rates.find((r) => r.from === from && r.to === base);
    const baseToTarget = rates.find((r) => r.from === base && r.to === to);

    if (fromToBase && baseToTarget) {
      return fromToBase.rate * baseToTarget.rate;
    }

    // Try inverse paths
    const baseToFrom = rates.find((r) => r.from === base && r.to === from);
    const targetToBase = rates.find((r) => r.from === to && r.to === base);

    if (baseToFrom && baseToTarget) {
      return (1 / baseToFrom.rate) * baseToTarget.rate;
    }

    if (fromToBase && targetToBase) {
      return fromToBase.rate * (1 / targetToBase.rate);
    }
  }

  return undefined;
}

/**
 * Composable for currency display and conversion
 */
export function useCurrencyDisplay() {
  const settingsStore = useSettingsStore();

  const displayCurrency = computed(() => settingsStore.displayCurrency);
  const exchangeRates = computed(() => settingsStore.exchangeRates);

  /**
   * Convert an amount from its original currency to the display currency
   */
  function convertToDisplay(
    amount: number,
    originalCurrency: CurrencyCode
  ): ConvertedAmount {
    const targetCurrency = displayCurrency.value;
    const isConverted = originalCurrency !== targetCurrency;

    if (!isConverted) {
      const formatted = formatCurrency(amount, originalCurrency);
      return {
        displayAmount: amount,
        displayCurrency: targetCurrency,
        displayFormatted: formatted,
        originalAmount: amount,
        originalCurrency,
        originalFormatted: formatted,
        isConverted: false,
        conversionFailed: false,
      };
    }

    const rate = getRate(exchangeRates.value, originalCurrency, targetCurrency);

    if (rate === undefined) {
      // Conversion failed - show original with warning
      const formatted = formatCurrency(amount, originalCurrency);
      return {
        displayAmount: amount,
        displayCurrency: originalCurrency,
        displayFormatted: formatted,
        originalAmount: amount,
        originalCurrency,
        originalFormatted: formatted,
        isConverted: false,
        conversionFailed: true,
      };
    }

    const convertedAmount = amount * rate;
    return {
      displayAmount: convertedAmount,
      displayCurrency: targetCurrency,
      displayFormatted: formatCurrency(convertedAmount, targetCurrency),
      originalAmount: amount,
      originalCurrency,
      originalFormatted: formatCurrency(amount, originalCurrency),
      isConverted: true,
      conversionFailed: false,
    };
  }

  /**
   * Format a simple amount in the display currency
   * (for totals that are already in a known currency)
   */
  function formatInDisplayCurrency(amount: number, fromCurrency: CurrencyCode): string {
    const result = convertToDisplay(amount, fromCurrency);
    return result.displayFormatted;
  }

  /**
   * Check if a rate exists for converting between two currencies
   */
  function hasRate(from: CurrencyCode, to: CurrencyCode): boolean {
    return getRate(exchangeRates.value, from, to) !== undefined;
  }

  return {
    displayCurrency,
    convertToDisplay,
    formatInDisplayCurrency,
    hasRate,
  };
}
