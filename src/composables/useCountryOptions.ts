import { computed } from 'vue';
import { COUNTRIES } from '@/constants/countries';
import { useTranslation } from '@/composables/useTranslation';
import type { ComboboxOption } from '@/components/ui/BaseCombobox.vue';

/**
 * Country options for the `BaseCombobox` used by the Settings "Country &
 * Holidays" card and the onboarding step-1 picker. Alpha-sorted by English
 * name (COUNTRIES is already sorted), with a leading "Not set" sentinel (value
 * `''`) so the family can clear their country. The search-friendly `label`
 * includes the name and the ISO code so typing either matches; the dropdown
 * renders the name with the code as a right-aligned badge.
 */
export function useCountryOptions() {
  const { t } = useTranslation();

  const countryOptions = computed<ComboboxOption[]>(() => {
    const notSet: ComboboxOption = { value: '', label: t('settings.countryNotSet') };
    const items: ComboboxOption[] = COUNTRIES.map((c) => ({
      value: c.code,
      label: `${c.name} (${c.code})`,
      rich: { primary: c.name, badge: c.code },
    }));
    return [notSet, ...items];
  });

  return { countryOptions };
}
