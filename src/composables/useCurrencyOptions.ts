import { computed } from 'vue';
import { CURRENCIES } from '@/constants/currencies';
import { useSettingsStore } from '@/stores/settingsStore';

export interface CurrencyOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function useCurrencyOptions() {
  const settingsStore = useSettingsStore();

  const currencyOptions = computed<CurrencyOption[]>(() => {
    const preferred = settingsStore.preferredCurrencies ?? [];
    const displayCurrency = settingsStore.displayCurrency;

    if (preferred.length === 0) {
      // No preferred currencies: put the display currency first, then the rest alphabetically
      const rest = [...CURRENCIES]
        .filter((c) => c.code !== displayCurrency)
        .sort((a, b) => a.code.localeCompare(b.code));
      const display = CURRENCIES.find((c) => c.code === displayCurrency);
      const items = display ? [display, ...rest] : rest;
      return items.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }));
    }

    const preferredSet = new Set(preferred);
    // Sort preferred currencies with display currency first
    const sortedPreferred = [...preferred].sort((a, b) => {
      if (a === displayCurrency) return -1;
      if (b === displayCurrency) return 1;
      return 0;
    });
    const preferredItems = sortedPreferred
      .map((code) => CURRENCIES.find((c) => c.code === code))
      .filter(Boolean)
      .map((c) => ({ value: c!.code, label: `${c!.code} - ${c!.name}` }));

    const rest = CURRENCIES.filter((c) => !preferredSet.has(c.code))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => ({
        value: c.code,
        label: `${c.code} - ${c.name}`,
      }));

    return [...preferredItems, { value: '', label: '───', disabled: true }, ...rest];
  });

  return { currencyOptions };
}
