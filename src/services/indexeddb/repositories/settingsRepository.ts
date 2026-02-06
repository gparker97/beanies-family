import { getDatabase } from '../database';
import type { Settings, ExchangeRate, AIProvider, CurrencyCode } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { DEFAULT_CURRENCY } from '@/constants/currencies';

const SETTINGS_ID = 'app_settings';

export function getDefaultSettings(): Settings {
  const now = toISODateString(new Date());
  return {
    id: SETTINGS_ID,
    baseCurrency: DEFAULT_CURRENCY,
    displayCurrency: DEFAULT_CURRENCY,
    exchangeRates: [],
    exchangeRateAutoUpdate: true,
    exchangeRateLastFetch: null,
    theme: 'system',
    syncEnabled: false,
    autoSyncEnabled: true,
    encryptionEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSettings(): Promise<Settings> {
  const db = await getDatabase();
  const settings = await db.get('settings', SETTINGS_ID);
  return settings ?? getDefaultSettings();
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const db = await getDatabase();
  const existing = await getSettings();

  const updated: Settings = {
    ...existing,
    ...settings,
    id: SETTINGS_ID,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('settings', updated);
  return updated;
}

export async function setBaseCurrency(currency: CurrencyCode): Promise<Settings> {
  return saveSettings({ baseCurrency: currency });
}

export async function setDisplayCurrency(currency: CurrencyCode): Promise<Settings> {
  return saveSettings({ displayCurrency: currency });
}

export async function setTheme(theme: 'light' | 'dark' | 'system'): Promise<Settings> {
  return saveSettings({ theme });
}

export async function setSyncEnabled(enabled: boolean): Promise<Settings> {
  return saveSettings({ syncEnabled: enabled });
}

export async function setAutoSyncEnabled(enabled: boolean): Promise<Settings> {
  return saveSettings({ autoSyncEnabled: enabled });
}

export async function setAIProvider(provider: AIProvider): Promise<Settings> {
  return saveSettings({ aiProvider: provider });
}

export async function setAIApiKey(
  provider: 'claude' | 'openai' | 'gemini',
  key: string
): Promise<Settings> {
  const settings = await getSettings();
  const aiApiKeys = { ...settings.aiApiKeys, [provider]: key };
  return saveSettings({ aiApiKeys });
}

export async function setExchangeRateAutoUpdate(enabled: boolean): Promise<Settings> {
  return saveSettings({ exchangeRateAutoUpdate: enabled });
}

export async function setExchangeRateLastFetch(timestamp: string | null): Promise<Settings> {
  return saveSettings({ exchangeRateLastFetch: timestamp });
}

export async function updateExchangeRates(rates: ExchangeRate[]): Promise<Settings> {
  const settings = await getSettings();
  const now = toISODateString(new Date());

  // Merge new rates with existing, replacing duplicates
  const rateMap = new Map<string, ExchangeRate>();

  // Add existing rates
  for (const rate of settings.exchangeRates) {
    rateMap.set(`${rate.from}-${rate.to}`, rate);
  }

  // Add/replace with new rates
  for (const rate of rates) {
    rateMap.set(`${rate.from}-${rate.to}`, rate);
  }

  return saveSettings({
    exchangeRates: Array.from(rateMap.values()),
    exchangeRateLastFetch: now,
  });
}

export async function addExchangeRate(rate: ExchangeRate): Promise<Settings> {
  const settings = await getSettings();
  const exchangeRates = settings.exchangeRates.filter(
    (r) => !(r.from === rate.from && r.to === rate.to)
  );
  exchangeRates.push(rate);
  return saveSettings({ exchangeRates });
}

export async function removeExchangeRate(from: CurrencyCode, to: CurrencyCode): Promise<Settings> {
  const settings = await getSettings();
  const exchangeRates = settings.exchangeRates.filter(
    (r) => !(r.from === from && r.to === to)
  );
  return saveSettings({ exchangeRates });
}

export async function getExchangeRate(
  from: CurrencyCode,
  to: CurrencyCode
): Promise<number | undefined> {
  if (from === to) return 1;

  const settings = await getSettings();

  // Direct rate
  const direct = settings.exchangeRates.find((r) => r.from === from && r.to === to);
  if (direct) return direct.rate;

  // Inverse rate
  const inverse = settings.exchangeRates.find((r) => r.from === to && r.to === from);
  if (inverse) return 1 / inverse.rate;

  return undefined;
}

export async function convertAmount(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode
): Promise<number | undefined> {
  const rate = await getExchangeRate(from, to);
  if (rate === undefined) return undefined;
  return amount * rate;
}
