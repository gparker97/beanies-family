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
      // No preferred currencies: put the display currency first, then the rest
      const sorted = [...CURRENCIES].sort((a, b) => {
        if (a.code === displayCurrency) return -1;
        if (b.code === displayCurrency) return 1;
        return 0;
      });
      return sorted.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }));
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

    const rest = CURRENCIES.filter((c) => !preferredSet.has(c.code)).map((c) => ({
      value: c.code,
      label: `${c.code} - ${c.name}`,
    }));

    return [...preferredItems, { value: '', label: '───', disabled: true }, ...rest];
  });

  return { currencyOptions };
}
