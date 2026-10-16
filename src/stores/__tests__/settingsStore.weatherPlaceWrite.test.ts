/**
 * #134: picking a home town writes a place that came straight out of reactive state (the
 * field's `ref` list of suggestions). This runs the REAL store and the REAL settings
 * repository, mocking only the worker RPC, because the bug it pins lived between the two:
 * the repository's `structuredClone` threw `DataCloneError` on the Vue proxy, the town never
 * saved, and the store-level tests (which mock the repository) could not see it.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isProxy, ref } from 'vue';

const h = vi.hoisted(() => ({
  mutate: vi.fn(async (op: { args: { patch: Record<string, unknown> } }) => ({
    id: 'app_settings',
    ...op.args.patch,
  })),
  showToast: vi.fn(),
}));

vi.mock('@/services/automerge/worker/docClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/automerge/worker/docClient')>()),
  mutate: h.mutate,
}));
vi.mock('@/composables/useToast', () => ({
  showToast: h.showToast,
  useToast: () => ({ toasts: [], dismissToast: vi.fn() }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ id: 'global_settings', theme: 'light', language: 'en' }),
  getGlobalSettings: vi.fn(async () => ({ id: 'global_settings', theme: 'light', language: 'en' })),
  saveGlobalSettings: vi.fn(),
}));
vi.mock('@/services/automerge/docService', () => ({
  isDocLoaded: () => true,
  isAuthoritativeDocLoaded: () => true,
}));
vi.mock('@/services/automerge/projection', () => ({ getSettings: () => ({ id: 'app_settings' }) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { useSettingsStore } from '@/stores/settingsStore';
import type { WeatherPlace } from '@/types/models';

const PORTLAND: WeatherPlace = {
  id: 5746545,
  name: 'Portland',
  admin1: 'Oregon',
  country: 'United States',
  countryCode: 'US',
  lat: 45.52,
  lon: -122.68,
};

describe('settingsStore.setWeatherPlace through the real repository', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.mutate.mockClear();
    h.showToast.mockClear();
  });

  it('saves a place read out of a reactive list, as a plain object, with no error toast', async () => {
    const places = ref<WeatherPlace[]>([{ ...PORTLAND }]);
    const picked = places.value[0]!;
    expect(isProxy(picked)).toBe(true);

    const store = useSettingsStore();
    await expect(store.setWeatherPlace(picked)).resolves.toBeUndefined();

    expect(h.showToast).not.toHaveBeenCalled();
    expect(h.mutate).toHaveBeenCalledTimes(1);
    const sent = h.mutate.mock.calls[0]![0].args.patch.weatherPlace;
    expect(sent).toEqual(PORTLAND);
    expect(isProxy(sent)).toBe(false);
    expect(store.weatherPlace).toEqual(PORTLAND);
  });
});
