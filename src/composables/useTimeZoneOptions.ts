import { computed, type Ref } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { uiLocale } from '@/utils/uiLocale';
import { allTimeZones, utcOffsetLabel, zoneDisplayName, zonesForCountry } from '@/utils/timeZone';
import type { CountryCode } from '@/types/models';
import type { ComboboxOption } from '@/components/ui/BaseCombobox.vue';

/** Built rows, memoised per (locale, zone): ~400 zones x 2 formatter constructions is
 *  noticeable on a low-end phone, and a row never changes for a given locale + zone. */
const optionCache = new Map<string, ComboboxOption>();

/** "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
function cityOf(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/**
 * The cache is stamped by the UTC HOUR: a row's offset badge changes across a DST switch,
 * and a PWA can stay open across one. The stamp is checked once per options build (the
 * drawer opening, or the country changing), and a new hour clears the map, so reopening
 * the drawer after a DST switch shows fresh offsets. A drawer left OPEN across the switch
 * keeps its badges until it is reopened; that is accepted (the badge is a hint, the
 * stored value is the zone id).
 */
let cacheStamp = '';
function currentStamp(): string {
  return new Date().toISOString().slice(0, 13);
}

function optionFor(zone: string, locale: string): ComboboxOption {
  const key = `${locale}|${zone}`;
  const hit = optionCache.get(key);
  if (hit) return hit;
  const generic = zoneDisplayName(zone, locale);
  const city = cityOf(zone);
  const option: ComboboxOption = {
    value: zone,
    // Closed state shows `label`; the city keeps id searches ("tokyo") matching too.
    label: `${generic} · ${city}`,
    rich: { primary: generic, secondary: city, badge: utcOffsetLabel(zone) },
  };
  optionCache.set(key, option);
  return option;
}

/**
 * Time-zone options for the Settings "Home Time Zone" `BaseCombobox`: the country's
 * zones when this engine knows them, else every zone it supports. The current value is
 * ALWAYS included (engines alias ids, `Asia/Calcutta` vs `Asia/Kolkata`, and the combobox
 * shows `selectedOption.label`, so a missing row would render a raw id).
 *
 * Lazy: nothing is built until `enabled` is true (the drawer is open).
 */
export function useTimeZoneOptions(
  country: Ref<CountryCode | null>,
  current: Ref<string | undefined>,
  enabled: Ref<boolean>
) {
  const settingsStore = useSettingsStore();

  const timeZoneOptions = computed<ComboboxOption[]>(() => {
    if (!enabled.value) return [];
    const stamp = currentStamp();
    if (stamp !== cacheStamp) {
      optionCache.clear();
      cacheStamp = stamp;
    }
    const locale = uiLocale(settingsStore.language);
    const countryZones = zonesForCountry(country.value);
    const zones = new Set(countryZones.length > 0 ? countryZones : allTimeZones());
    if (current.value) zones.add(current.value);
    return [...zones].map((z) => optionFor(z, locale));
  });

  return { timeZoneOptions };
}
