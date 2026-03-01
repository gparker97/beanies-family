import { useSettingsStore } from '@/stores/settingsStore';
import type { CurrencyCode, ExchangeRate } from '@/types/models';

/**
 * Get exchange rate between two currencies from a rates array.
 * Tries direct rate, inverse rate, then path-finding through major currencies.
 */
export function getRate(
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

  // Try to find a path through a major currency (USD, EUR, GBP)
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
 * Convert an amount from one currency to the app's base currency.
 * Uses the settings store for base currency and exchange rates.
 */
export function convertToBaseCurrency(amount: number, fromCurrency: CurrencyCode): number {
  const settingsStore = useSettingsStore();
  const baseCurrency = settingsStore.baseCurrency;

  if (fromCurrency === baseCurrency) return amount;

  const rate = getRate(settingsStore.exchangeRates, fromCurrency, baseCurrency);
  return rate !== undefined ? amount * rate : amount;
}

/**
 * Convert an amount between currencies using explicit rates (no store dependency).
 * Useful in composables where rates are already available.
 */
export function convertAmount(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: ExchangeRate[]
): number {
  if (fromCurrency === toCurrency) return amount;
  const rate = getRate(rates, fromCurrency, toCurrency);
  return rate !== undefined ? amount * rate : amount;
}
