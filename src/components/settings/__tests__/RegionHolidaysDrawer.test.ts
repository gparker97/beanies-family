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
  vi.clearAllMocks();
});

describe('RegionHolidaysDrawer: weather group', () => {
  it('shows the home town and the unit while weather is on, with their hints', () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="home-town"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="unit"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="weather-enabled-toggle"]').attributes('data-hint')).toBe(
      'settings.weather.showHintOn'
    );
    expect(wrapper.text()).toContain('settings.weather.homeTownHint');
    expect(wrapper.text()).toContain('settings.weather.unitHint');
    expect(wrapper.text()).toContain('weather.title');
  });

  it('turning weather off folds the fields away, swaps the hint and logs the change', async () => {
    const wrapper = render();
    await wrapper.get('[data-test="weather-enabled-toggle"] button').trigger('click');
    await flushPromises();
    expect(settings.setWeatherEnabled).toHaveBeenCalledWith(false);
    expect(wrapper.find('[data-test="home-town"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="unit"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="weather-enabled-toggle"]').attributes('data-hint')).toBe(
      'settings.weather.showHintOff'
    );
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'weather',
        message: 'weather_settings',
        context: { action: 'settings', kind: 'enabled', detail: 'off' },
      })
    );
  });

  it('a failed switch write is not logged as a change', async () => {
    settings.setWeatherEnabled.mockRejectedValueOnce(new Error('persist failed'));
    const wrapper = render();
    await wrapper.get('[data-test="weather-enabled-toggle"] button').trigger('click');
    await flushPromises();
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it('the unit defaults from the family country: F for the US, C elsewhere', async () => {
    const wrapper = render();
    expect(wrapper.get('[data-test="unit"]').attributes('data-value')).toBe('F');
    settings.country = 'NZ';
    await flushPromises();
    expect(wrapper.get('[data-test="unit"]').attributes('data-value')).toBe('C');
  });

  it('a unit pick is saved and logged', async () => {
    const wrapper = render();
    await wrapper.get('[data-test="unit-C"]').trigger('click');
    await flushPromises();
    expect(settings.setTemperatureUnit).toHaveBeenCalledWith('C');
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'weather_settings',
        context: { action: 'settings', kind: 'unit', detail: 'C' },
      })
    );
  });

  it('a non-manager sees everything disabled and cannot change the unit', async () => {
    canManagePod.value = false;
    const wrapper = render();
    expect(wrapper.find('[data-test="admin-only"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="weather-enabled-toggle"]').attributes('data-disabled')).toBe(
      'true'
    );
    expect(wrapper.get('[data-test="home-town"]').attributes('data-disabled')).toBe('true');
    expect(wrapper.get('[data-testid="weather-unit"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="unit-C"]').trigger('click');
    await flushPromises();
    expect(settings.setTemperatureUnit).not.toHaveBeenCalled();
  });
});

describe('RegionHolidaysDrawer: country and holidays', () => {
  it('passes the country hint copy to the country picker', () => {
    const wrapper = render();
    expect(wrapper.findAll('[data-test="combobox"]')[0]!.attributes('data-hint')).toBe(
      'settings.countryHelp'
    );
  });

  it('disables the holidays row and explains why when no country is set', () => {
    settings.country = null;
    const wrapper = render();
    const row = wrapper.get('[data-test="public-holidays-toggle"]');
    expect(row.attributes('data-disabled')).toBe('true');
    expect(row.text()).toContain('settings.showPublicHolidaysNeedsCountry');
  });

  it('the holidays row is live with a country and saves through the store', async () => {
    const wrapper = render();
    const row = wrapper.get('[data-test="public-holidays-toggle"]');
    expect(row.attributes('data-disabled')).toBe('false');
    expect(row.text()).not.toContain('settings.showPublicHolidaysNeedsCountry');
    await row.get('button').trigger('click');
    expect(settings.setShowPublicHolidays).toHaveBeenCalledWith(false);
  });
});
