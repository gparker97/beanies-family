import { computed } from 'vue';
import { getCurrencyInfo } from '@/constants/currencies';
import { useSettingsStore } from '@/stores/settingsStore';
import { getRate } from '@/utils/currency';
import type { CurrencyCode } from '@/types/models';

/**
 * Format currency with code prefix (e.g., "USD $100.00", "SGD $100.00")
 * Uses $ for dollar-based currencies, otherwise the currency's symbol
 */
export function formatCurrencyWithCode(amount: number, currencyCode: CurrencyCode): string {
  const info = getCurrencyInfo(currencyCode);
  const decimals = info?.decimals ?? 2;

  // Format the number with proper decimal places and thousand separators
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);

  // Use $ for dollar-based currencies (USD, SGD, etc.), otherwise use the symbol
  const isDollarBased = currencyCode.endsWith('D') || currencyCode === 'USD';
  const symbol = isDollarBased ? '$' : info?.symbol || '';

  return `${currencyCode} ${symbol}${formattedNumber}`;
}

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
 * Composable for currency display and conversion
 */
export function useCurrencyDisplay() {
  const settingsStore = useSettingsStore();

  const displayCurrency = computed(() => settingsStore.displayCurrency);
  const exchangeRates = computed(() => settingsStore.exchangeRates);

  /**
   * Convert an amount from its original currency to the display currency
   */
  function convertToDisplay(amount: number, originalCurrency: CurrencyCode): ConvertedAmount {
    const targetCurrency = displayCurrency.value;
    const isConverted = originalCurrency !== targetCurrency;

    if (!isConverted) {
      const formatted = formatCurrencyWithCode(amount, originalCurrency);
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
      const formatted = formatCurrencyWithCode(amount, originalCurrency);
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
      displayFormatted: formatCurrencyWithCode(convertedAmount, targetCurrency),
      originalAmount: amount,
      originalCurrency,
      originalFormatted: formatCurrencyWithCode(amount, originalCurrency),
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
