import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { Settings, CurrencyCode, AIProvider, ExchangeRate, LanguageCode } from '@/types/models';
import * as settingsRepo from '@/services/indexeddb/repositories/settingsRepository';

export const useSettingsStore = defineStore('settings', () => {
  // State
  const settings = ref<Settings>(settingsRepo.getDefaultSettings());
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const baseCurrency = computed(() => settings.value.baseCurrency);
  const displayCurrency = computed(() => settings.value.displayCurrency ?? settings.value.baseCurrency);
  const theme = computed(() => settings.value.theme);
  const language = computed(() => settings.value.language ?? 'en');
  const syncEnabled = computed(() => settings.value.syncEnabled);
  const aiProvider = computed(() => settings.value.aiProvider);
  const exchangeRates = computed(() => settings.value.exchangeRates);
  const exchangeRateAutoUpdate = computed(() => settings.value.exchangeRateAutoUpdate);
  const exchangeRateLastFetch = computed(() => settings.value.exchangeRateLastFetch);

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
  async function loadSettings() {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.getSettings();
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

  async function setAIApiKey(
    provider: 'claude' | 'openai' | 'gemini',
    key: string
  ): Promise<void> {
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
      settings.value = await settingsRepo.setExchangeRateAutoUpdate(enabled);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update exchange rate auto-update setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function updateExchangeRates(rates: ExchangeRate[]): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
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
    // Actions
    loadSettings,
    setBaseCurrency,
    setDisplayCurrency,
    setTheme,
    setLanguage,
    setSyncEnabled,
    setAutoSyncEnabled,
    setAIProvider,
    setAIApiKey,
    setExchangeRateAutoUpdate,
    updateExchangeRates,
    addExchangeRate,
    removeExchangeRate,
    convertAmount,
  };
});
