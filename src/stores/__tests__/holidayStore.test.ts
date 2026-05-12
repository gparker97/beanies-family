import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { HolidayRecord } from '@/types/models';

// Mock the loader so the store's behaviour is tested in isolation.
const loadHolidays = vi.fn();
vi.mock('@/services/referenceData/holidays', () => ({
  loadHolidays: (...args: unknown[]) => loadHolidays(...args),
}));

// Mock the settings store: `country` stays null so the store's self-loading
// watcher is a no-op (so tests can drive `loadHolidaysForCountry` / `records`
// deterministically); `showPublicHolidays` is a flag tests can flip.
let mockCountry: string | null = null;
let mockShowPublicHolidays = true;
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get country() {
      return mockCountry;
    },
    get showPublicHolidays() {
      return mockShowPublicHolidays;
    },
  }),
}));

// Imported after the mocks are registered.
import { useHolidayStore } from '@/stores/holidayStore';

const rec = (date: string, name: string, extra: Partial<HolidayRecord> = {}): HolidayRecord => ({
  date,
  name,
  type: 'public',
  ...extra,
});

describe('holidayStore', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockCountry = null;
    mockShowPublicHolidays = true;
    loadHolidays.mockReset();
    loadHolidays.mockResolvedValue({ records: [], ok: true, retryable: false });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holidaysInRange is inclusive on both ends and respects showPublicHolidays', () => {
    const store = useHolidayStore();
    store.records = [
      rec('2026-01-01', "New Year's Day"),
      rec('2026-06-15', 'Mid-June'),
      rec('2026-12-25', 'Christmas'),
    ];
    store.loadedCountry = 'SG';

    expect(store.holidaysInRange('2026-01-01', '2026-06-15').map((o) => o.name)).toEqual([
      "New Year's Day",
      'Mid-June',
    ]);
    expect(store.holidaysInRange('2026-02-01', '2026-11-30').map((o) => o.name)).toEqual([
      'Mid-June',
    ]);

    mockShowPublicHolidays = false;
    expect(store.holidaysInRange('2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('holidayForDate returns the matching occurrence (or undefined / when disabled)', () => {
    const store = useHolidayStore();
    store.records = [rec('2026-05-31', 'Vesak Day', { name_local: undefined })];
    store.loadedCountry = 'SG';

    expect(store.holidayForDate('2026-05-31')?.name).toBe('Vesak Day');
    expect(store.holidayForDate('2026-05-31')?.countryCode).toBe('SG');
    expect(store.holidayForDate('2026-06-01')).toBeUndefined();

    mockShowPublicHolidays = false;
    expect(store.holidayForDate('2026-05-31')).toBeUndefined();
  });

  it('expands a multi-day endDate into one occurrence per covered date', () => {
    const store = useHolidayStore();
    store.records = [rec('2026-02-17', 'Chinese New Year', { endDate: '2026-02-19' })];
    store.loadedCountry = 'CN';
    const occ = store.allHolidayOccurrences;
    expect(occ.map((o) => o.date)).toEqual(['2026-02-17', '2026-02-18', '2026-02-19']);
    expect(occ.every((o) => o.name === 'Chinese New Year')).toBe(true);
  });

  it('treats endDate < date as a single-day record (and warns)', () => {
    const store = useHolidayStore();
    store.records = [rec('2026-05-31', 'Vesak Day', { endDate: '2026-05-30' })];
    store.loadedCountry = 'SG';
    expect(store.allHolidayOccurrences.map((o) => o.date)).toEqual(['2026-05-31']);
  });

  it('loadHolidaysForCountry stores records on success and clears loadFailed', async () => {
    const store = useHolidayStore();
    loadHolidays.mockResolvedValueOnce({
      records: [rec('2026-01-01', "New Year's Day")],
      ok: true,
      retryable: false,
    });
    await store.loadHolidaysForCountry('SG');
    expect(store.loadedCountry).toBe('SG');
    expect(store.records).toHaveLength(1);
    expect(store.loadFailed).toBe(false);
    expect(loadHolidays).toHaveBeenCalledWith('SG');
  });

  it('loadHolidaysForCountry sets loadFailed on a retryable miss', async () => {
    const store = useHolidayStore();
    loadHolidays.mockResolvedValueOnce({ records: [], ok: false, retryable: true });
    await store.loadHolidaysForCountry('SG');
    expect(store.records).toEqual([]);
    expect(store.loadFailed).toBe(true);
    // Already-loaded guard does NOT skip a retry when loadFailed is true.
    expect(store.loadedCountry).toBe('SG');
  });

  it('loadHolidaysForCountry never throws even if the loader rejects', async () => {
    const store = useHolidayStore();
    loadHolidays.mockRejectedValueOnce(new Error('boom'));
    await expect(store.loadHolidaysForCountry('SG')).resolves.toBeUndefined();
    expect(store.records).toEqual([]);
    expect(store.loadFailed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('ignores a null / unsupported country code (and warns for unsupported)', async () => {
    const store = useHolidayStore();
    await store.loadHolidaysForCountry(null);
    expect(store.loadedCountry).toBeNull();
    expect(loadHolidays).not.toHaveBeenCalled();

    await store.loadHolidaysForCountry('ZZ' as never); // not in SUPPORTED_COUNTRY_CODES
    expect(store.loadedCountry).toBeNull();
    expect(loadHolidays).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('resetState clears the loaded data', async () => {
    const store = useHolidayStore();
    loadHolidays.mockResolvedValueOnce({
      records: [rec('2026-01-01', 'X')],
      ok: true,
      retryable: false,
    });
    await store.loadHolidaysForCountry('SG');
    store.resetState();
    expect(store.records).toEqual([]);
    expect(store.loadedCountry).toBeNull();
    expect(store.loadFailed).toBe(false);
  });
});
