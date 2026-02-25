import { getRegistryDatabase } from '../registryDatabase';
import { DEFAULT_LANGUAGE } from '@/constants/languages';
import type { GlobalSettings, ExchangeRate, LanguageCode } from '@/types/models';

const GLOBAL_SETTINGS_ID = 'global_settings';

export function getDefaultGlobalSettings(): GlobalSettings {
  return {
    id: GLOBAL_SETTINGS_ID,
    theme: 'light',
    language: DEFAULT_LANGUAGE,
    lastActiveFamilyId: null,
    exchangeRates: [],
    exchangeRateAutoUpdate: true,
    exchangeRateLastFetch: null,
  };
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const db = await getRegistryDatabase();
  const settings = await db.get('globalSettings', GLOBAL_SETTINGS_ID);
  return settings ?? getDefaultGlobalSettings();
}

export async function saveGlobalSettings(
  settings: Partial<GlobalSettings>
): Promise<GlobalSettings> {
  const db = await getRegistryDatabase();
  const existing = await getGlobalSettings();

  const updated: GlobalSettings = {
    ...existing,
    ...settings,
    id: GLOBAL_SETTINGS_ID,
  };

  await db.put('globalSettings', updated);
  return updated;
}

export async function setGlobalTheme(theme: 'light' | 'dark' | 'system'): Promise<GlobalSettings> {
  return saveGlobalSettings({ theme });
}

export async function setGlobalLanguage(language: LanguageCode): Promise<GlobalSettings> {
  return saveGlobalSettings({ language });
}

export async function setLastActiveFamilyId(familyId: string | null): Promise<GlobalSettings> {
  return saveGlobalSettings({ lastActiveFamilyId: familyId });
}

export async function updateGlobalExchangeRates(rates: ExchangeRate[]): Promise<GlobalSettings> {
  const settings = await getGlobalSettings();
  const now = new Date().toISOString();

  const rateMap = new Map<string, ExchangeRate>();

  for (const rate of settings.exchangeRates) {
    rateMap.set(`${rate.from}-${rate.to}`, rate);
  }

  for (const rate of rates) {
    rateMap.set(`${rate.from}-${rate.to}`, rate);
  }

  return saveGlobalSettings({
    exchangeRates: Array.from(rateMap.values()),
    exchangeRateLastFetch: now,
  });
}
