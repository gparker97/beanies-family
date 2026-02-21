import type { CurrencyCode } from '@/types/models';

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  symbol: string;
  symbolPosition: 'before' | 'after';
  decimals: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', symbolPosition: 'before', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', symbolPosition: 'before', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', symbolPosition: 'before', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', symbolPosition: 'before', decimals: 0 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', symbolPosition: 'before', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', symbolPosition: 'before', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', symbolPosition: 'before', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', symbolPosition: 'before', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', symbolPosition: 'before', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', symbolPosition: 'before', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', symbolPosition: 'before', decimals: 2 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', symbolPosition: 'before', decimals: 0 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', symbolPosition: 'after', decimals: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', symbolPosition: 'after', decimals: 2 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', symbolPosition: 'after', decimals: 2 },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', symbolPosition: 'after', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', symbolPosition: 'before', decimals: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', symbolPosition: 'before', decimals: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', symbolPosition: 'before', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', symbolPosition: 'before', decimals: 2 },
];

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

export const SUPPORTED_CURRENCY_CODES: CurrencyCode[] = CURRENCIES.map((c) => c.code);

export function getCurrencyInfo(code: CurrencyCode): CurrencyInfo | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

export function formatCurrency(
  amount: number,
  currencyCode: CurrencyCode,
  locale: string = 'en-US'
): string {
  const info = getCurrencyInfo(currencyCode);
  if (!info) {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(amount);
  } catch {
    // Fallback for unsupported currencies
    const formatted = amount.toFixed(info.decimals);
    return info.symbolPosition === 'before'
      ? `${info.symbol}${formatted}`
      : `${formatted} ${info.symbol}`;
  }
}
