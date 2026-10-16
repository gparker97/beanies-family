import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const sleepState = {
  enabled: true,
  screen: 'night',
  startTime: '21:00',
  endTime: '07:00',
  idleMinutes: 10,
};
const setWallSleepMock = vi.fn().mockResolvedValue(undefined);
const setWallWeatherMock = vi.fn().mockResolvedValue(undefined);
const wallState = { wallWeatherStyle: 'large' };
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    wallSleep: sleepState,
    setWallSleep: setWallSleepMock,
    get wallWeatherStyle() {
      return wallState.wallWeatherStyle;
    },
    setWallWeather: setWallWeatherMock,
  }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const logEventMock = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEventMock(...a),
}));

import WallSettingsDrawer from '../WallSettingsDrawer.vue';

const stubs = {
  BeanieFormModal: { template: '<div><slot /></div>' },
  FormFieldGroup: { template: '<div><slot /></div>' },
  SettingToggleRow: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<button data-test="sleep-toggle" @click="$emit(\'update:modelValue\', !modelValue)" />',
  },
  BeanieTimeInput: { template: '<input data-test="sleep-time" />' },
  // One button per option, so the idle-wait pills and the weather-size pills are told apart.
  TogglePillGroup: {
    props: ['options'],
    emits: ['update:modelValue'],
    template:
      '<div><button v-for="o in options" :key="o.value" :data-test="\'pill-\' + o.value" @click="$emit(\'update:modelValue\', o.value)" /></div>',
  },
};

const render = () => mount(WallSettingsDrawer, { props: { open: true }, global: { stubs } });

describe('WallSettingsDrawer: night mode on its own', () => {
  it('shows the hours and the wait while it is on, and saves changes through the store', async () => {
    sleepState.enabled = true;
    const wrapper = render();
    expect(wrapper.findAll('[data-test="sleep-time"]')).toHaveLength(2);
    await wrapper.get('[data-test="pill-30"]').trigger('click');
    expect(setWallSleepMock).toHaveBeenCalledWith({ idleMinutes: 30 });
    await wrapper.get('[data-test="sleep-toggle"]').trigger('click');
    expect(setWallSleepMock).toHaveBeenCalledWith({ enabled: false });
  });

  it('hides the hours while it is off', () => {
    sleepState.enabled = false;
    const wrapper = render();
    expect(wrapper.find('[data-test="sleep-time"]').exists()).toBe(false);
    sleepState.enabled = true;
  });
});

describe('WallSettingsDrawer: weather size on this wall', () => {
  it('shows the chosen size with its hint and the family-wide note', () => {
    wallState.wallWeatherStyle = 'small';
    const wrapper = render();
    expect(wrapper.text()).toContain('wall.weather.smallHint');
    expect(wrapper.text()).not.toContain('wall.weather.largeHint');
    expect(wrapper.text()).toContain('wall.weather.sizeHint');
    expect(wrapper.text()).toContain('weather.title');
    wallState.wallWeatherStyle = 'large';
  });

  it('saves a new size through the store and logs it as a weather setting', async () => {
    logEventMock.mockClear();
    const wrapper = render();
    await wrapper.get('[data-test="pill-off"]').trigger('click');
    await flushPromises();
    expect(setWallWeatherMock).toHaveBeenCalledWith('off');
    expect(setWallSleepMock).not.toHaveBeenCalledWith(expect.objectContaining({ weather: 'off' }));
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'wall-settings',
        message: 'weather_settings',
        context: { action: 'settings', kind: 'wall-style', detail: 'off' },
      })
    );
  });

  it('a sleep change still logs its own message', async () => {
    logEventMock.mockClear();
    const wrapper = render();
    await wrapper.get('[data-test="pill-30"]').trigger('click');
    await flushPromises();
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'wall_sleep_change',
        context: { action: 'settings', kind: 'idleMinutes' },
      })
    );
  });

  it('a failed size write is not logged as a change', async () => {
    logEventMock.mockClear();
    setWallWeatherMock.mockRejectedValueOnce(new Error('persist failed'));
    const wrapper = render();
    await wrapper.get('[data-test="pill-small"]').trigger('click');
    await flushPromises();
    expect(logEventMock).not.toHaveBeenCalled();
  });
});
