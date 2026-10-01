import { getSettings as projectionGetSettings } from '../projection';
import { mutate } from '../worker/docClient';
import { pickBase } from '../automergeRepository';
import type { PatchSettingsArgs } from '../worker/protocol';
import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { DEFAULT_LANGUAGE } from '@/constants/languages';
import { apiKeyForProvider } from '@/utils/aiApiKeys';
import type {
  Settings,
  ExchangeRate,
  AIProvider,
  AiTier,
  CurrencyCode,
  LanguageCode,
  ISODateString,
  HelpfulHintType,
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
    aiTier: 'managed',
    preferredCurrencies: [],
    customInstitutions: [],
    onboardingCompleted: true,
    feedbackOptOut: false,
    responsibilityCheckInWeeks: 4,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Backfill any optional fields added after a doc was written, so downstream readers can trust
 * that a field with a default in getDefaultSettings() is present, and apply the #133 migration:
 * a doc written before `aiTier` existed but with a configured BYOK provider+key was effectively
 * on the BYOK tier. ONE place, used by the read AND by what a write returns, so a save can
 * never hand the store an object the read would have corrected.
 */
function withDefaults(current: Partial<Settings>): Settings {
  const merged: Settings = { ...getDefaultSettings(), ...current };
  if (current.aiTier === undefined && apiKeyForProvider(merged.aiProvider, merged.aiApiKeys)) {
    merged.aiTier = 'byok';
  }
  return merged;
}

export async function getSettings(): Promise<Settings> {
  const current = projectionGetSettings();
  if (!current) return getDefaultSettings();
  return withDefaults(current);
}

/**
 * Write some settings fields. The merge happens IN THE WORKER (`patchSettings`), against the
 * authoritative document, never against the main-thread projection: in the window between the
 * worker loading the document and the projection hydrating, `getSettings()` returns the
 * defaults, and a merge-then-replace from that read wiped every field with no default (the
 * plan token, 2026-10-01). Only the fields passed here change.
 *
 * `base` is the projection's value of each passed field (#117, ADR-039), raw: the worker
 * writes only what differs from it, per key and per array item, so a rate or API key a peer
 * added meanwhile is kept. In that boot window the projection is `null`, the base is `{}`,
 * and the write is purely additive: it cannot drop a rate or key it has not seen.
 *
 * `updatedAt` travels beside the patch, not in it, and the worker stamps it only when the
 * write changed something, so a no-op save leaves the document (and Drive) alone. It is
 * omitted under `preserveTimestamp` (sync bookkeeping that must not churn it).
 *
 * The returned object is the document's settings after the write, backfilled with defaults
 * like `getSettings()`.
 */
export async function saveSettings(
  settings: Partial<Settings>,
  options?: { preserveTimestamp?: boolean }
): Promise<Settings> {
  const patch = structuredClone(settings) as Partial<Settings>;
  patch.id = SETTINGS_ID;
  delete patch.updatedAt;
  const args: PatchSettingsArgs = {
    patch,
    base: pickBase(projectionGetSettings(), Object.keys(patch)),
    // `defaults` seed a document that has no settings yet (first write of a fresh family); the
    // worker ignores them when a settings object already exists. Widened to `Partial` (a safe
    // upcast) only because the interface has no index signature for the args' record type.
    defaults: getDefaultSettings() as Partial<Settings>,
  };
  if (!options?.preserveTimestamp) args.updatedAt = toISODateString(new Date());
  const written = await mutate<Partial<Settings> | null>({
    op: 'named',
    name: 'patchSettings',
    args,
  });
  return withDefaults(written ?? {});
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

export async function setShowPublicHolidays(show: boolean): Promise<Settings> {
  return saveSettings({ showPublicHolidays: show });
}

export async function setSkipDocumentConsentPrompt(skip: boolean): Promise<Settings> {
  return saveSettings({ skipDocumentConsentPrompt: skip });
}

export async function setAiStatementConsentAcknowledgedAt(date: ISODateString): Promise<Settings> {
  return saveSettings({ aiStatementConsentAcknowledgedAt: date });
}

export async function setAiIngredientsConsentAcknowledgedAt(
  date: ISODateString
): Promise<Settings> {
  return saveSettings({ aiIngredientsConsentAcknowledgedAt: date });
}

export async function setSyncEnabled(enabled: boolean): Promise<Settings> {
  return saveSettings({ syncEnabled: enabled });
}

export async function setCalendarClashNudgeEnabled(enabled: boolean): Promise<Settings> {
  return saveSettings({ calendarClashNudgeEnabled: enabled });
}

export async function setHelpfulHintsEnabled(enabled: boolean): Promise<Settings> {
  return saveSettings({ helpfulHintsEnabled: enabled });
}

export async function setHelpfulHintLeadDays(
  leadDays: Partial<Record<HelpfulHintType, number>>
): Promise<Settings> {
  return saveSettings({ helpfulHintLeadDays: leadDays });
}

export async function setFeedbackOptOut(optOut: boolean): Promise<Settings> {
  return saveSettings({ feedbackOptOut: optOut });
}

// #45: stamp the feedback cadence clock (date-only). Set when the prompt auto-opens or on submit.
export async function setFeedbackPromptedAt(date: ISODateString): Promise<Settings> {
  return saveSettings({ feedbackLastPromptedAt: date });
}

export async function setAutoSyncEnabled(enabled: boolean): Promise<Settings> {
  return saveSettings({ autoSyncEnabled: enabled });
}

export async function setAIProvider(provider: AIProvider): Promise<Settings> {
  return saveSettings({ aiProvider: provider });
}

export async function setAITier(tier: AiTier): Promise<Settings> {
  return saveSettings({ aiTier: tier });
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

  // Merge new rates with existing, replacing duplicates.
  // structuredClone existing rates to strip Automerge proxy wrappers —
  // passing proxy objects back into changeDoc causes
  // "Cannot create a reference to an existing document object".
  const rateMap = new Map<string, ExchangeRate>();

  const existingRates = structuredClone(settings.exchangeRates) as ExchangeRate[];
  for (const rate of existingRates) {
    rateMap.set(`${rate.from}-${rate.to}`, rate);
  }

  for (const rate of rates) {
    rateMap.set(`${rate.from}-${rate.to}`, rate);
  }

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

  const direct = settings.exchangeRates.find((r) => r.from === from && r.to === to);
  if (direct) return direct.rate;

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
