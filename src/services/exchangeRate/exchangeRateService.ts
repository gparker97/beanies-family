import { SUPPORTED_CURRENCY_CODES } from '@/constants/currencies';
import * as settingsRepo from '@/services/indexeddb/repositories/settingsRepository';
import type { CurrencyCode, ExchangeRate } from '@/types/models';
import { toISODateString } from '@/utils/date';

// API URLs
const PRIMARY_API_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies';
const FALLBACK_API_URL = 'https://latest.currency-api.pages.dev/v1/currencies';

// Staleness threshold: 24 hours
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface FetchResult {
  success: boolean;
  rates: ExchangeRate[];
  error?: string;
}

export interface UpdateResult {
  success: boolean;
  ratesUpdated: number;
  error?: string;
}

/**
 * Check if a rate is stale (older than 24 hours)
 */
export function isRateStale(rate: ExchangeRate): boolean {
  const updatedAt = new Date(rate.updatedAt).getTime();
  const now = Date.now();
  return now - updatedAt > STALE_THRESHOLD_MS;
}

/**
 * Check if rates need updating based on last fetch timestamp
 */
export async function areRatesStale(): Promise<boolean> {
  const settings = await settingsRepo.getSettings();

  if (!settings.exchangeRateLastFetch) {
    return true;
  }

  const lastFetch = new Date(settings.exchangeRateLastFetch).getTime();
  const now = Date.now();
  return now - lastFetch > STALE_THRESHOLD_MS;
}

/**
 * Fetch exchange rates from the API for a given base currency
 */
export async function fetchExchangeRates(baseCurrency: CurrencyCode): Promise<FetchResult> {
  const baseCode = baseCurrency.toLowerCase();

  // Try primary API first
  let response: Response | null = null;
  let error: string | null = null;

  try {
    response = await fetch(`${PRIMARY_API_URL}/${baseCode}.json`);
    if (!response.ok) {
      throw new Error(`Primary API returned ${response.status}`);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Primary API failed';

    // Try fallback API
    try {
      response = await fetch(`${FALLBACK_API_URL}/${baseCode}.json`);
      if (!response.ok) {
        throw new Error(`Fallback API returned ${response.status}`);
      }
      error = null; // Clear error if fallback succeeded
    } catch (fallbackError) {
      return {
        success: false,
        rates: [],
        error: `Both APIs failed: ${error}, Fallback: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
      };
    }
  }

  if (!response) {
    return {
      success: false,
      rates: [],
      error: 'No response received from APIs',
    };
  }

  try {
    const data = await response.json();
    const rates = parseApiResponse(baseCurrency, data);

    return {
      success: true,
      rates,
    };
  } catch (e) {
    return {
      success: false,
      rates: [],
      error: `Failed to parse API response: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
}

/**
 * Parse the API response and convert to ExchangeRate objects
 */
function parseApiResponse(baseCurrency: CurrencyCode, data: unknown): ExchangeRate[] {
  const rates: ExchangeRate[] = [];
  const now = toISODateString(new Date());
  const baseCode = baseCurrency.toLowerCase();

  if (!data || typeof data !== 'object') {
    return rates;
  }

  const rateData = (data as Record<string, unknown>)[baseCode];
  if (!rateData || typeof rateData !== 'object') {
    return rates;
  }

  const rateMap = rateData as Record<string, number>;

  for (const code of SUPPORTED_CURRENCY_CODES) {
    if (code === baseCurrency) continue;

    const targetCode = code.toLowerCase();
    const rate = rateMap[targetCode];

    if (typeof rate === 'number' && !isNaN(rate) && rate > 0) {
      rates.push({
        from: baseCurrency,
        to: code,
        rate,
        updatedAt: now,
      });
    }
  }

  return rates;
}

/**
 * Update rates if they are stale
 */
export async function updateRatesIfStale(): Promise<UpdateResult> {
  const stale = await areRatesStale();

  if (!stale) {
    return {
      success: true,
      ratesUpdated: 0,
    };
  }

  return forceUpdateRates();
}

/**
 * Force update rates regardless of staleness
 */
export async function forceUpdateRates(): Promise<UpdateResult> {
  const settings = await settingsRepo.getSettings();
  const baseCurrency = settings.baseCurrency;

  const result = await fetchExchangeRates(baseCurrency);

  if (!result.success) {
    return {
      success: false,
      ratesUpdated: 0,
      error: result.error,
    };
  }

  if (result.rates.length === 0) {
    return {
      success: false,
      ratesUpdated: 0,
      error: 'No rates returned from API',
    };
  }

  try {
    await settingsRepo.updateExchangeRates(result.rates);

    return {
      success: true,
      ratesUpdated: result.rates.length,
    };
  } catch (e) {
    return {
      success: false,
      ratesUpdated: 0,
      error: `Failed to save rates: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get a human-readable description of when rates were last updated
 */
export function formatLastUpdate(lastFetch: string | null): string {
  if (!lastFetch) {
    return 'Never';
  }

  const lastDate = new Date(lastFetch);
  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 1) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
}
