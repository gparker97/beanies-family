/**
 * Weather settings in the settings store (#134): the unit default follows the FAMILY country,
 * the three family setters write flat fields through `persistAiSetting` (toast + rethrow),
 * and `patchWall` keeps the other half of the wall's device object when one half changes.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  saveSettings: vi.fn(async (patch: Record<string, unknown>) => ({ id: 'app_settings', ...patch })),
  saveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
    ...patch,
  })),
  showToast: vi.fn(),
  projected: vi.fn((): Record<string, unknown> | null => ({ id: 'app_settings' })),
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
  saveGlobalSettings: h.saveGlobalSettings,
}));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', language: 'en', theme: 'light' })),
  saveSettings: h.saveSettings,
}));
vi.mock('@/services/automerge/docService', () => ({
  isDocLoaded: () => true,
  isAuthoritativeDocLoaded: () => true,
}));
vi.mock('@/services/automerge/projection', () => ({ getSettings: h.projected }));
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

describe('settingsStore weather', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.projected.mockReturnValue({ id: 'app_settings' });
  });

  describe('getters', () => {
    it('Show Weather defaults on, with no town', () => {
      const store = useSettingsStore();
      expect(store.weatherEnabled).toBe(true);
      expect(store.weatherPlace).toBeNull();
    });

    it('the unit defaults to F for a US family', () => {
      h.projected.mockReturnValue({ id: 'app_settings', country: 'US' });
      expect(useSettingsStore().temperatureUnit).toBe('F');
    });

    it('the unit defaults to C for any other country, and for none', () => {
      h.projected.mockReturnValue({ id: 'app_settings', country: 'GB' });
      expect(useSettingsStore().temperatureUnit).toBe('C');
      setActivePinia(createPinia());
      h.projected.mockReturnValue({ id: 'app_settings' });
      expect(useSettingsStore().temperatureUnit).toBe('C');
    });

    it('a stored unit wins over the country default', async () => {
      h.projected.mockReturnValue({ id: 'app_settings', country: 'US' });
      const store = useSettingsStore();
      await store.setTemperatureUnit('C');
      expect(store.temperatureUnit).toBe('C');
    });

    it('the wall style defaults to large', () => {
      expect(useSettingsStore().wallWeatherStyle).toBe('large');
    });
  });

  describe('family setters write flat fields', () => {
    it('setWeatherEnabled', async () => {
      const store = useSettingsStore();
      await store.setWeatherEnabled(false);
      expect(h.saveSettings).toHaveBeenCalledWith({ weatherEnabled: false });
      expect(store.weatherEnabled).toBe(false);
    });

    it('setWeatherPlace, and clearing it', async () => {
      const store = useSettingsStore();
      await store.setWeatherPlace(PORTLAND);
      expect(h.saveSettings).toHaveBeenCalledWith({ weatherPlace: PORTLAND });
      expect(store.weatherPlace).toEqual(PORTLAND);
      await store.setWeatherPlace(null);
      expect(h.saveSettings).toHaveBeenLastCalledWith({ weatherPlace: null });
      expect(store.weatherPlace).toBeNull();
    });

    it('setTemperatureUnit', async () => {
      await useSettingsStore().setTemperatureUnit('F');
      expect(h.saveSettings).toHaveBeenCalledWith({ temperatureUnit: 'F' });
    });

    it('a failed write toasts with the field label and rethrows (persistAiSetting)', async () => {
      h.saveSettings.mockRejectedValueOnce(new Error('disk full'));
      await expect(useSettingsStore().setWeatherPlace(PORTLAND)).rejects.toThrow('disk full');
      expect(h.showToast).toHaveBeenCalledWith(
        'error',
        'settings.persistFailed',
        'settings.weather.homeTown',
        expect.objectContaining({ surface: 'settings-persist', context: { field: 'weatherPlace' } })
      );
    });
  });

  describe('patchWall', () => {
    it('changing the style keeps the sleep settings', async () => {
      const store = useSettingsStore();
      await store.setWallSleep({ idleMinutes: 30 });
      const sleep = store.wallSleep;
      await store.setWallWeather('small');
      expect(h.saveGlobalSettings).toHaveBeenLastCalledWith({
        wall: { sleep, weather: 'small' },
      });
      expect(store.wallWeatherStyle).toBe('small');
      expect(store.wallSleep).toEqual(sleep);
    });

    it('changing the sleep settings keeps the style', async () => {
      const store = useSettingsStore();
      await store.setWallWeather('off');
      await store.setWallSleep({ idleMinutes: 45 });
      const last = h.saveGlobalSettings.mock.calls.at(-1)![0] as {
        wall: { weather: string; sleep: { idleMinutes: number } };
      };
      expect(last.wall.weather).toBe('off');
      expect(last.wall.sleep.idleMinutes).toBe(45);
      expect(store.wallWeatherStyle).toBe('off');
    });
  });
});
