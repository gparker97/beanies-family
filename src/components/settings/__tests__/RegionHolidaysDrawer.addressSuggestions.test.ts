import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import { defaultUnitFor } from '@/utils/weather/weatherReading';
import type { TemperatureUnit } from '@/types/models';

const settings = reactive({
  country: 'US' as string | null,
  get familyCountry() {
    return this.country;
  },
  weatherEnabled: true,
  weatherPlace: null,
  unitOverride: null as TemperatureUnit | null,
  // Mirrors the store getter: absent = the family country's default.
  get temperatureUnit(): TemperatureUnit {
    return this.unitOverride ?? defaultUnitFor(this.country);
  },
  showPublicHolidays: true,
  addressSuggestionsEnabled: true,
  setAddressSuggestionsEnabled: vi.fn(async (on: boolean) => {
    settings.addressSuggestionsEnabled = on;
  }),
  resolveHomeTimeZoneNow: () => ({ zone: 'America/Los_Angeles', source: 'stored' }),
  setCountry: vi.fn(async () => {}),
  setHomeTimeZone: vi.fn(async () => {}),
  setShowPublicHolidays: vi.fn(async () => {}),
  setWeatherEnabled: vi.fn(async (on: boolean) => {
    settings.weatherEnabled = on;
  }),
  setTemperatureUnit: vi.fn(async (u: TemperatureUnit) => {
    settings.unitOverride = u;
  }),
});
const canManagePod = ref(true);
const flags = vi.hoisted(() => ({ on: true }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));
const logEventMock = vi.fn();

vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));
vi.mock('@/stores/holidayStore', () => ({ useHolidayStore: () => ({ loadFailed: false }) }));
vi.mock('@/composables/useFamilyDataAccess', () => ({
  useFamilyDataAccess: () => ({ canManagePod }),
}));
vi.mock('@/composables/useCountryOptions', () => ({
  useCountryOptions: () => ({ countryOptions: ref([]) }),
}));
vi.mock('@/composables/useTimeZoneOptions', () => ({
  useTimeZoneOptions: () => ({ timeZoneOptions: ref([]) }),
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ lastVisibleAt: ref(0) }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEventMock(...a),
}));

import RegionHolidaysDrawer from '../RegionHolidaysDrawer.vue';

const stubs = {
  BeanieFormModal: { template: '<div><slot /></div>' },
  SettingsAdminOnlyNotice: { template: '<div data-test="admin-only" />' },
  BaseCombobox: {
    props: ['label', 'hint', 'disabled'],
    template: '<div data-test="combobox" :data-hint="hint" :data-disabled="disabled" />',
  },
  FormFieldGroup: { props: ['label'], template: '<div :data-label="label"><slot /></div>' },
  HomeTownField: {
    props: ['disabled', 'placeholder'],
    template: '<div data-test="home-town" :data-disabled="disabled" />',
  },
  SettingToggleRow: {
    props: ['modelValue', 'title', 'hint', 'disabled', 'testid'],
    emits: ['update:modelValue'],
    template:
      '<div :data-test="testid" :data-hint="hint" :data-disabled="disabled"><button @click="$emit(\'update:modelValue\', !modelValue)" /><slot /></div>',
  },
  TogglePillGroup: {
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    template:
      '<div data-test="unit" :data-value="modelValue"><button v-for="o in options" :key="o.value" :data-test="\'unit-\' + o.value" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</button></div>',
  },
};

const render = () => mount(RegionHolidaysDrawer, { props: { open: true }, global: { stubs } });

beforeEach(() => {
  settings.country = 'US';
  settings.weatherEnabled = true;
  settings.unitOverride = null;
  canManagePod.value = true;
  flags.on = true;
  settings.addressSuggestionsEnabled = true;
  vi.clearAllMocks();
});

describe('RegionHolidaysDrawer: address suggestions switch (#150)', () => {
  const toggle = '[data-test="address-suggestions-toggle"]';

  it('is hidden while the feature flag is off, and the home town hint is the weather-only one', () => {
    flags.on = false;
    const wrapper = render();
    expect(wrapper.find(toggle).exists()).toBe(false);
    expect(wrapper.text()).toContain('settings.weather.homeTownHint');
    expect(wrapper.text()).not.toContain('homeTownHintPlaces');
  });

  it('shows with weather off (outside the weather block), and the hint mentions places', () => {
    settings.weatherEnabled = false;
    expect(render().find(toggle).exists()).toBe(true);
    settings.weatherEnabled = true;
    const wrapper = render();
    expect(wrapper.text()).toContain('settings.weather.homeTownHintPlaces');
  });

  it('is disabled unless the member can manage the pod', () => {
    canManagePod.value = false;
    expect(render().get(toggle).attributes('data-disabled')).toBe('true');
    canManagePod.value = true;
    expect(render().get(toggle).attributes('data-disabled')).toBe('false');
  });

  it('flips through the store setter and logs the change', async () => {
    const wrapper = render();
    await wrapper.get(`${toggle} button`).trigger('click');
    await flushPromises();
    expect(settings.setAddressSuggestionsEnabled).toHaveBeenCalledWith(false);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'place-search',
        message: 'place_suggestions_settings',
        context: { action: 'settings', detail: 'off' },
      })
    );
  });

  it('a failed write is left to the store toast: no log, no unhandled rejection', async () => {
    settings.setAddressSuggestionsEnabled.mockRejectedValueOnce(new Error('write failed'));
    const wrapper = render();
    await wrapper.get(`${toggle} button`).trigger('click');
    await flushPromises();
    expect(logEventMock).not.toHaveBeenCalled();
    expect(settings.addressSuggestionsEnabled).toBe(true);
  });
});
