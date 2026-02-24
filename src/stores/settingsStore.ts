import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import * as settingsRepo from '@/services/indexeddb/repositories/settingsRepository';
import * as globalSettingsRepo from '@/services/indexeddb/repositories/globalSettingsRepository';
import type {
  Settings,
  GlobalSettings,
  CurrencyCode,
  AIProvider,
  ExchangeRate,
  LanguageCode,
} from '@/types/models';

export const useSettingsStore = defineStore('settings', () => {
  // State
  const settings = ref<Settings>(settingsRepo.getDefaultSettings());
  const globalSettings = ref<GlobalSettings>(globalSettingsRepo.getDefaultGlobalSettings());
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const baseCurrency = computed(() => settings.value.baseCurrency);
  const displayCurrency = computed(
    () => settings.value.displayCurrency ?? settings.value.baseCurrency
  );
  // Theme and language are global (device-level) settings
  const theme = computed(() => globalSettings.value.theme);
  const language = computed(() => globalSettings.value.language ?? 'en');
  const syncEnabled = computed(() => settings.value.syncEnabled);
  const aiProvider = computed(() => settings.value.aiProvider);
  const exchangeRates = computed(() => globalSettings.value.exchangeRates);
  const exchangeRateAutoUpdate = computed(() => globalSettings.value.exchangeRateAutoUpdate);
  const exchangeRateLastFetch = computed(() => globalSettings.value.exchangeRateLastFetch);
  const beanieMode = computed(() => globalSettings.value.beanieMode ?? false);
  const soundEnabled = computed(() => globalSettings.value.soundEnabled ?? true);
  const preferredCurrencies = computed(() => settings.value.preferredCurrencies ?? []);
  const effectiveDisplayCurrencies = computed(() => {
    const prefs = preferredCurrencies.value;
    const base = baseCurrency.value;
    const set = new Set([...prefs, base]);
    return Array.from(set);
  });
  const customInstitutions = computed(() => settings.value.customInstitutions ?? []);
  const onboardingCompleted = computed(() => settings.value.onboardingCompleted ?? true);
  const isTrustedDevice = computed(() => globalSettings.value.isTrustedDevice ?? false);
  const trustedDevicePromptShown = computed(
    () => globalSettings.value.trustedDevicePromptShown ?? false
  );
  const passkeyPromptShown = computed(() => globalSettings.value.passkeyPromptShown ?? false);

  // Apply theme to document
  watch(
    theme,
    (newTheme) => {
      const html = document.documentElement;
      if (newTheme === 'dark') {
        html.classList.add('dark');
      } else if (newTheme === 'light') {
        html.classList.remove('dark');
      } else {
        // System preference
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          html.classList.add('dark');
        } else {
          html.classList.remove('dark');
        }
      }
    },
    { immediate: true }
  );

  // Actions

  /**
   * Load global settings from registry DB (works before family is active).
   */
  async function loadGlobalSettings() {
    try {
      globalSettings.value = await globalSettingsRepo.getGlobalSettings();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load global settings';
    }
  }

  /**
   * Load per-family settings from the active family DB.
   */
  async function loadSettings() {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.getSettings();
      // Also sync theme/language from per-family settings to global if they differ
      // This maintains backward compatibility
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      isLoading.value = false;
    }
  }

  async function setBaseCurrency(currency: CurrencyCode): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setBaseCurrency(currency);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update base currency';
    } finally {
      isLoading.value = false;
    }
  }

  async function setDisplayCurrency(currency: CurrencyCode): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setDisplayCurrency(currency);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update display currency';
    } finally {
      isLoading.value = false;
    }
  }

  async function setTheme(newTheme: 'light' | 'dark' | 'system'): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      // Save to global settings (device-level)
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({ theme: newTheme });
      // Also save to per-family settings for backward compatibility
      settings.value = await settingsRepo.setTheme(newTheme);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update theme';
    } finally {
      isLoading.value = false;
    }
  }

  async function setLanguage(lang: LanguageCode): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      // Save to global settings (device-level)
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({ language: lang });
      // Also save to per-family settings for backward compatibility
      settings.value = await settingsRepo.setLanguage(lang);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update language';
    } finally {
      isLoading.value = false;
    }
  }

  async function setSyncEnabled(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setSyncEnabled(enabled);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update sync setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function setAutoSyncEnabled(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setAutoSyncEnabled(enabled);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update auto-sync setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function setAIProvider(provider: AIProvider): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setAIProvider(provider);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update AI provider';
    } finally {
      isLoading.value = false;
    }
  }

  async function setAIApiKey(provider: 'claude' | 'openai' | 'gemini', key: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setAIApiKey(provider, key);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update API key';
    } finally {
      isLoading.value = false;
    }
  }

  async function setExchangeRateAutoUpdate(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      // Save to global settings (exchange rates are device-level)
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
        exchangeRateAutoUpdate: enabled,
      });
      // Also save to per-family settings for backward compatibility
      settings.value = await settingsRepo.setExchangeRateAutoUpdate(enabled);
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : 'Failed to update exchange rate auto-update setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function setBeanieMode(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({ beanieMode: enabled });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update beanie mode';
    } finally {
      isLoading.value = false;
    }
  }

  async function setSoundEnabled(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({ soundEnabled: enabled });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update sound setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function setPreferredCurrencies(currencies: CurrencyCode[]): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const limited = currencies.slice(0, 4);
      settings.value = await settingsRepo.setPreferredCurrencies(limited);
      // If current display currency is no longer in the effective list, fall back to base
      const effective = new Set([...limited, settings.value.baseCurrency]);
      if (!effective.has(settings.value.displayCurrency)) {
        settings.value = await settingsRepo.setDisplayCurrency(settings.value.baseCurrency);
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update preferred currencies';
    } finally {
      isLoading.value = false;
    }
  }

  async function setOnboardingCompleted(completed: boolean): Promise<void> {
    try {
      settings.value = await settingsRepo.saveSettings({ onboardingCompleted: completed });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update onboarding status';
    }
  }

  async function addCustomInstitution(name: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.addCustomInstitution(name);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add custom institution';
    } finally {
      isLoading.value = false;
    }
  }

  async function removeCustomInstitution(name: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.removeCustomInstitution(name);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to remove custom institution';
    } finally {
      isLoading.value = false;
    }
  }

  async function updateExchangeRates(rates: ExchangeRate[]): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      // Save to global settings (exchange rates are device-level)
      globalSettings.value = await globalSettingsRepo.updateGlobalExchangeRates(rates);
      // Also save to per-family settings for backward compatibility
      settings.value = await settingsRepo.updateExchangeRates(rates);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update exchange rates';
    } finally {
      isLoading.value = false;
    }
  }

  async function addExchangeRate(rate: ExchangeRate): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.addExchangeRate(rate);
      // Sync to global settings
      globalSettings.value = await globalSettingsRepo.updateGlobalExchangeRates([rate]);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add exchange rate';
    } finally {
      isLoading.value = false;
    }
  }

  async function removeExchangeRate(from: CurrencyCode, to: CurrencyCode): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.removeExchangeRate(from, to);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to remove exchange rate';
    } finally {
      isLoading.value = false;
    }
  }

  async function setTrustedDevice(trusted: boolean): Promise<void> {
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      isTrustedDevice: trusted,
      trustedDevicePromptShown: true,
    });
  }

  async function setTrustedDevicePromptShown(): Promise<void> {
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      trustedDevicePromptShown: true,
    });
  }

  async function setPasskeyPromptShown(): Promise<void> {
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      passkeyPromptShown: true,
    });
  }

  /**
   * Cache the encryption password on trusted devices so it survives page refresh.
   * Only stores when isTrustedDevice is true.
   */
  async function cacheEncryptionPassword(password: string): Promise<void> {
    if (!isTrustedDevice.value) return;
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      cachedEncryptionPassword: password,
    });
  }

  /**
   * Retrieve the cached encryption password (returns null if not cached).
   */
  function getCachedEncryptionPassword(): string | null {
    return globalSettings.value.cachedEncryptionPassword ?? null;
  }

  /**
   * Clear the cached encryption password.
   */
  async function clearCachedEncryptionPassword(): Promise<void> {
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      cachedEncryptionPassword: null,
    });
  }

  function resetState() {
    settings.value = settingsRepo.getDefaultSettings();
    isLoading.value = false;
    error.value = null;
  }

  async function convertAmount(
    amount: number,
    from: CurrencyCode,
    to: CurrencyCode
  ): Promise<number | undefined> {
    return settingsRepo.convertAmount(amount, from, to);
  }

  return {
    // State
    settings,
    globalSettings,
    isLoading,
    error,
    // Getters
    baseCurrency,
    displayCurrency,
    theme,
    language,
    syncEnabled,
    aiProvider,
    exchangeRates,
    exchangeRateAutoUpdate,
    exchangeRateLastFetch,
    beanieMode,
    soundEnabled,
    preferredCurrencies,
    effectiveDisplayCurrencies,
    customInstitutions,
    onboardingCompleted,
    isTrustedDevice,
    trustedDevicePromptShown,
    passkeyPromptShown,
    // Actions
    loadGlobalSettings,
    loadSettings,
    setBaseCurrency,
    setDisplayCurrency,
    setTheme,
    setLanguage,
    setSyncEnabled,
    setAutoSyncEnabled,
    setAIProvider,
    setAIApiKey,
    setBeanieMode,
    setSoundEnabled,
    setPreferredCurrencies,
    setOnboardingCompleted,
    addCustomInstitution,
    removeCustomInstitution,
    setExchangeRateAutoUpdate,
    updateExchangeRates,
    addExchangeRate,
    removeExchangeRate,
    setTrustedDevice,
    setTrustedDevicePromptShown,
    setPasskeyPromptShown,
    cacheEncryptionPassword,
    getCachedEncryptionPassword,
    clearCachedEncryptionPassword,
    convertAmount,
    resetState,
  };
});
