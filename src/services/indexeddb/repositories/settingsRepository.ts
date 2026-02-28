import { getDatabase } from '../database';
import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { DEFAULT_LANGUAGE } from '@/constants/languages';
import type {
  Settings,
  ExchangeRate,
  AIProvider,
  CurrencyCode,
  LanguageCode,
} from '@/types/models';
import { toISODateString } from '@/utils/date';

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
    theme: 'light',
    language: DEFAULT_LANGUAGE,
    syncEnabled: false,
    autoSyncEnabled: true,
    encryptionEnabled: true,
    aiProvider: 'none',
    aiApiKeys: {},
    preferredCurrencies: [],
    customInstitutions: [],
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSettings(): Promise<Settings> {
  const db = await getDatabase();
  const settings = await db.get('settings', SETTINGS_ID);
  return settings ?? getDefaultSettings();
}

export async function saveSettings(
  settings: Partial<Settings>,
  options?: { preserveTimestamp?: boolean }
): Promise<Settings> {
  const db = await getDatabase();
  const existing = await getSettings();

  const updated: Settings = {
    ...existing,
    ...settings,
    id: SETTINGS_ID,
    updatedAt: options?.preserveTimestamp ? existing.updatedAt : toISODateString(new Date()),
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

export async function setLanguage(language: LanguageCode): Promise<Settings> {
  return saveSettings({ language });
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

  // Exchange rate updates are housekeeping — don't bump updatedAt so they
  // don't win cross-device merges and overwrite user settings like preferredCurrencies.
  return saveSettings(
    {
      exchangeRates: Array.from(rateMap.values()),
      exchangeRateLastFetch: now,
    },
    { preserveTimestamp: true }
  );
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
  const exchangeRates = settings.exchangeRates.filter((r) => !(r.from === from && r.to === to));
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

export async function setPreferredCurrencies(currencies: CurrencyCode[]): Promise<Settings> {
  return saveSettings({ preferredCurrencies: currencies });
}

export async function addCustomInstitution(name: string): Promise<Settings> {
  const settings = await getSettings();
  const existing = settings.customInstitutions ?? [];
  if (existing.includes(name)) return settings;
  const updated = [...existing, name].sort((a, b) => a.localeCompare(b));
  return saveSettings({ customInstitutions: updated });
}

export async function removeCustomInstitution(name: string): Promise<Settings> {
  const settings = await getSettings();
  const existing = settings.customInstitutions ?? [];
  const updated = existing.filter((n) => n !== name);
  return saveSettings({ customInstitutions: updated });
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
