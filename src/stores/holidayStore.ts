import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useOnline } from '@/composables/useOnline';
import { loadHolidays } from '@/services/referenceData/holidays';
import { SUPPORTED_COUNTRY_CODES } from '@/constants/countries';
import {
  isDateBetween,
  extractDatePart,
  parseLocalDate,
  addDays,
  toDateInputValue,
} from '@/utils/date';
import type { CountryCode, HolidayRecord, HolidayOccurrence } from '@/types/models';

const MAX_SPAN_DAYS = 32; // defensive cap on multi-day expansion (a corrupt endDate can't generate thousands of occurrences)

/**
 * Public-holiday store — a reactive projection of read-only reference data.
 *
 * Holidays aren't user data (nothing to mutate), but the loaded records need
 * to be reactive so the planner views update when the family's country changes.
 * This store self-loads: its setup body installs two watchers once — one on
 * `settingsStore.country` (load/reload), one on `useOnline()` (retry after a
 * transient fetch failure). Consumers just call `holidaysInRange` /
 * `holidayForDate`; they don't trigger loading. `resetState()` (called from
 * `resetAllAppStores()` on sign-out / family switch) clears the data, not the
 * watchers — the new family's country re-fires the load.
 *
 * Mirrors `vacationStore`'s "derived occurrences queried by a date window,
 * rendered read-only" shape (`travelSegmentOccurrencesInRange`).
 */
export const useHolidayStore = defineStore('holidays', () => {
  const records = ref<HolidayRecord[]>([]);
  const loadedCountry = ref<CountryCode | null>(null);
  const isLoading = ref(false);
  /** True after a transient fetch failure with no cached fallback — the online watcher retries. */
  const loadFailed = ref(false);

  function isValidCountryCode(code: string): code is CountryCode {
    return /^[A-Z]{2}$/.test(code) && SUPPORTED_COUNTRY_CODES.includes(code);
  }

  async function loadHolidaysForCountry(country: CountryCode | null | undefined): Promise<void> {
    if (!country) {
      records.value = [];
      loadedCountry.value = null;
      loadFailed.value = false;
      return;
    }
    const cc = country.toUpperCase();
    if (!isValidCountryCode(cc)) {
      console.warn(`[holidays] invalid / unsupported country code "${country}" — ignoring.`);
      records.value = [];
      loadedCountry.value = null;
      loadFailed.value = false;
      return;
    }
    // Already have this country's data — nothing to do (a prior transient
    // failure leaves loadFailed=true, so a reconnect retry won't be skipped).
    if (loadedCountry.value === cc && !loadFailed.value) return;

    isLoading.value = true;
    try {
      const result = await loadHolidays(cc);
      records.value = result.records;
      loadedCountry.value = cc; // even on a 404/corrupt result — don't keep re-fetching it
      loadFailed.value = result.retryable;
    } catch (e) {
      // loadHolidays is documented never-throws; this is belt-and-suspenders.
      console.error(`[holidayStore] loadHolidaysForCountry("${cc}") failed unexpectedly:`, e);
      records.value = [];
      loadedCountry.value = null;
      loadFailed.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /** Records expanded to one occurrence per calendar date (handles the reserved multi-day `endDate`). */
  const allHolidayOccurrences = computed<HolidayOccurrence[]>(() => {
    const cc = loadedCountry.value;
    if (!cc) return [];
    const out: HolidayOccurrence[] = [];
    const seen = new Set<string>();
    const push = (date: string, r: HolidayRecord) => {
      const key = `${date}|${r.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ date, name: r.name, nameLocal: r.name_local, countryCode: cc });
    };
    for (const r of records.value) {
      if (!r.endDate || r.endDate <= r.date) {
        push(r.date, r);
        continue;
      }
      let cur = r.date;
      let cursor = parseLocalDate(r.date);
      for (let i = 0; i < MAX_SPAN_DAYS && cur <= r.endDate; i++) {
        push(cur, r);
        cursor = addDays(cursor, 1);
        cur = toDateInputValue(cursor);
      }
      if (cur <= r.endDate) {
        console.warn(
          `[holidays] holiday "${r.name}" spans more than ${MAX_SPAN_DAYS} days (${r.date} → ${r.endDate}) — clamped.`
        );
      }
    }
    return out;
  });

  function holidaysInRange(startISO: string, endISO: string): HolidayOccurrence[] {
    if (!useSettingsStore().showPublicHolidays) return [];
    return allHolidayOccurrences.value.filter((o) => isDateBetween(o.date, startISO, endISO));
  }

  function holidayForDate(dateISO: string): HolidayOccurrence | undefined {
    if (!useSettingsStore().showPublicHolidays) return undefined;
    const day = extractDatePart(dateISO);
    return allHolidayOccurrences.value.find((o) => o.date === day);
  }

  function resetState(): void {
    records.value = [];
    loadedCountry.value = null;
    isLoading.value = false;
    loadFailed.value = false;
  }

  // --- Self-loading wiring (installed once at first useHolidayStore()) ---
  const settingsStore = useSettingsStore();
  watch(
    () => settingsStore.country,
    (c) => {
      void loadHolidaysForCountry(c);
    },
    { immediate: true }
  );
  const { isOnline } = useOnline();
  watch(isOnline, (online) => {
    if (online && loadFailed.value) void loadHolidaysForCountry(settingsStore.country);
  });

  return {
    records,
    loadedCountry,
    isLoading,
    loadFailed,
    allHolidayOccurrences,
    loadHolidaysForCountry,
    holidaysInRange,
    holidayForDate,
    resetState,
  };
});
