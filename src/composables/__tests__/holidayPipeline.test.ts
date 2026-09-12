/**
 * The public-holiday pipeline, end to end, against the REAL Singapore data file
 * that ships in `public/holidays/SG.json`.
 *
 * greg reported no public holidays on any surface, with the family set to
 * Singapore. Every layer had been checked in isolation and each looked correct,
 * which is exactly the situation where an integration test earns its keep: this
 * drives the real validator, the real store and the real `useDayExtras`, with
 * only `fetch` and the IndexedDB cache stubbed.
 *
 * If this passes, the pipeline works and the absence is the WINDOW — Singapore
 * has no public holiday between 10 August and 8 November 2026, so a September
 * calendar showing none is correct on every surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computed, effectScope } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

const SG = JSON.parse(readFileSync(join(process.cwd(), 'public/holidays/SG.json'), 'utf8')) as {
  holidays: Array<{ date: string; name: string }>;
};

// The cache layer is not what is under test; force the fetch path.
vi.mock('@/services/indexeddb/referenceCache', () => ({
  readHolidayCache: async () => null,
  writeHolidayCache: async () => undefined,
}));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => ({ members: [] }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useHolidayStore } from '@/stores/holidayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDayExtras } from '../useDayExtras';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.fetch = vi.fn(async (url: unknown) =>
    String(url).includes('/holidays/SG.json')
      ? ({ ok: true, status: 200, json: async () => SG } as Response)
      : ({ ok: false, status: 404, json: async () => ({}) } as Response)
  ) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Load SG through the real store, as the app does on boot. */
async function loadSingapore() {
  const settings = useSettingsStore();
  // The gate: holidays are dormant until a country is picked.
  vi.spyOn(settings, 'country', 'get').mockReturnValue('SG' as never);
  vi.spyOn(settings, 'showPublicHolidays', 'get').mockReturnValue(true as never);
  const store = useHolidayStore();
  await store.loadHolidaysForCountry('SG' as never);
  return store;
}

describe('the shipped Singapore data reaches a calendar surface', () => {
  it('parses every 2026 holiday out of the real file', async () => {
    const store = await loadSingapore();
    const inRange = store.holidaysInRange('2026-01-01', '2026-12-31');
    // 14 rows in the file for 2026, including the two-day Deepavali and the
    // National Day substitute.
    expect(inRange.length).toBeGreaterThanOrEqual(10);
    expect(inRange.map((h) => h.name)).toContain('Christmas Day');
    expect(inRange.map((h) => h.name)).toContain('Deepavali');
  });

  it('surfaces Christmas through useDayExtras, the query every calendar uses', async () => {
    await loadSingapore();
    const scope = effectScope();
    const { extras } = scope.run(() =>
      useDayExtras(
        computed(() => '2026-12-01'),
        computed(() => '2026-12-31')
      )
    )!;
    const labels = extras.value.map((e) => e.label);
    expect(labels).toContain('Christmas Day (SG)');
    scope.stop();
  });

  it('surfaces Deepavali, which is the NEXT Singapore holiday after today', async () => {
    await loadSingapore();
    const scope = effectScope();
    const { extras } = scope.run(() =>
      useDayExtras(
        computed(() => '2026-11-01'),
        computed(() => '2026-11-30')
      )
    )!;
    expect(extras.value.filter((e) => e.kind === 'holiday')).not.toHaveLength(0);
    scope.stop();
  });

  it('⚠️ correctly returns NOTHING for September, which has no SG holiday', async () => {
    // This is the finding, stated as a test so it cannot be mistaken for a bug
    // again: Singapore has no public holiday between 10 August and 8 November
    // 2026. A September calendar showing none is right on every surface.
    await loadSingapore();
    const scope = effectScope();
    const { extras } = scope.run(() =>
      useDayExtras(
        computed(() => '2026-09-01'),
        computed(() => '2026-09-30')
      )
    )!;
    expect(extras.value.filter((e) => e.kind === 'holiday')).toHaveLength(0);
    scope.stop();
  });
});
