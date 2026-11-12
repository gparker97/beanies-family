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
const setWallMemoriesMock = vi.fn().mockResolvedValue(undefined);
const setWallMemoryTypeMock = vi.fn().mockResolvedValue(undefined);
const memoriesState = {
  viewer: true,
  show: { milestone: true, favorite: true, saying: true, note: true },
  slideshow: 'around',
  brightness: 'medium',
  speed: 'medium',
};
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    wallSleep: sleepState,
    setWallSleep: setWallSleepMock,
    get wallWeatherStyle() {
      return wallState.wallWeatherStyle;
    },
    setWallWeather: setWallWeatherMock,
    get wallMemories() {
      return memoriesState;
    },
    setWallMemories: setWallMemoriesMock,
    setWallMemoryType: setWallMemoryTypeMock,
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
    props: ['modelValue', 'testid'],
    emits: ['update:modelValue'],
    template:
      '<button :data-test="testid === \'wall-sleep-toggle\' ? \'sleep-toggle\' : testid" :data-on="modelValue" @click="$emit(\'update:modelValue\', !modelValue)" />',
  },
  BeanieTimePicker: { template: '<input data-test="sleep-time" />' },
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

describe('WallSettingsDrawer: family memories', () => {
  const reset = () => {
    memoriesState.viewer = true;
    memoriesState.slideshow = 'around';
    memoriesState.brightness = 'medium';
    memoriesState.speed = 'medium';
    memoriesState.show = { milestone: true, favorite: true, saying: true, note: true };
    setWallMemoriesMock.mockClear();
    setWallMemoryTypeMock.mockClear();
    logEventMock.mockClear();
  };

  it('renders the defaults: viewer, four types, slideshow pills and brightness', () => {
    reset();
    const wrapper = render();
    expect(wrapper.get('[data-test="wall-memories-viewer"]').attributes('data-on')).toBe('true');
    for (const type of ['milestone', 'favorite', 'saying', 'note']) {
      expect(wrapper.find(`[data-test="wall-memories-type-${type}"]`).exists()).toBe(true);
    }
    expect(wrapper.text()).toContain('settings.wall.memories.hint');
    expect(wrapper.find('[data-test="pill-around"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="pill-bright"]').exists()).toBe(true);
  });

  it('the viewer switch writes through the store and logs the change', async () => {
    reset();
    const wrapper = render();
    await wrapper.get('[data-test="wall-memories-viewer"]').trigger('click');
    await flushPromises();
    expect(setWallMemoriesMock).toHaveBeenCalledWith({ viewer: false });
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'wall-settings',
        message: 'wall_memories_change',
        context: { action: 'settings', kind: 'viewer', detail: 'false' },
      })
    );
  });

  it.each(['milestone', 'favorite', 'saying', 'note'])(
    'the %s switch sets that type',
    async (type) => {
      reset();
      const wrapper = render();
      await wrapper.get(`[data-test="wall-memories-type-${type}"]`).trigger('click');
      await flushPromises();
      expect(setWallMemoryTypeMock).toHaveBeenCalledWith(type, false);
      expect(logEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'wall_memories_change',
          context: { action: 'settings', kind: `type-${type}`, detail: 'false' },
        })
      );
    }
  );

  it('slideshow and brightness pills write the chosen value', async () => {
    reset();
    const wrapper = render();
    await wrapper.get('[data-test="pill-full"]').trigger('click');
    await wrapper.get('[data-test="pill-bright"]').trigger('click');
    await flushPromises();
    expect(setWallMemoriesMock).toHaveBeenCalledWith({ slideshow: 'full' });
    expect(setWallMemoriesMock).toHaveBeenCalledWith({ brightness: 'bright' });
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { action: 'settings', kind: 'brightness', detail: 'bright' },
      })
    );
  });

  it('hides What to Show only when the viewer and the slideshow are both off', () => {
    reset();
    memoriesState.viewer = false;
    memoriesState.slideshow = 'off';
    let wrapper = render();
    expect(wrapper.find('[data-test="wall-memories-type-note"]').exists()).toBe(false);
    memoriesState.slideshow = 'around';
    wrapper = render();
    expect(wrapper.find('[data-test="wall-memories-type-note"]').exists()).toBe(true);
    memoriesState.viewer = true;
    memoriesState.slideshow = 'off';
    wrapper = render();
    expect(wrapper.find('[data-test="wall-memories-type-note"]').exists()).toBe(true);
    reset();
  });

  it('hides Brightness and Speed when the slideshow is off', () => {
    reset();
    let wrapper = render();
    expect(wrapper.find('[data-test="pill-fast"]').exists()).toBe(true);
    memoriesState.slideshow = 'off';
    wrapper = render();
    expect(wrapper.find('[data-test="pill-bright"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="pill-fast"]').exists()).toBe(false);
    reset();
  });

  it('the speed pills write the chosen speed and log it', async () => {
    reset();
    const wrapper = render();
    for (const s of ['slow', 'fast']) {
      await wrapper.get(`[data-test="pill-${s}"]`).trigger('click');
      await flushPromises();
      expect(setWallMemoriesMock).toHaveBeenCalledWith({ speed: s });
      expect(logEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'wall_memories_change',
          context: { action: 'settings', kind: 'speed', detail: s },
        })
      );
    }
  });

  it('a failed memories write is not logged as a change', async () => {
    reset();
    setWallMemoryTypeMock.mockRejectedValueOnce(new Error('persist failed'));
    const wrapper = render();
    await wrapper.get('[data-test="wall-memories-type-note"]').trigger('click');
    await flushPromises();
    expect(logEventMock).not.toHaveBeenCalled();
  });
});
