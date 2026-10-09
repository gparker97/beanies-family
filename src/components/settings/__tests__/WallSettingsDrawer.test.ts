import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const sleepState = {
  enabled: true,
  screen: 'night',
  startTime: '21:00',
  endTime: '07:00',
  idleMinutes: 10,
};
const setWallSleepMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ wallSleep: sleepState, setWallSleep: setWallSleepMock }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

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
  TogglePillGroup: {
    emits: ['update:modelValue'],
    template: '<button data-test="sleep-idle" @click="$emit(\'update:modelValue\', \'30\')" />',
  },
};

const render = () => mount(WallSettingsDrawer, { props: { open: true }, global: { stubs } });

describe('WallSettingsDrawer: night mode on its own', () => {
  it('shows the hours and the wait while it is on, and saves changes through the store', async () => {
    sleepState.enabled = true;
    const wrapper = render();
    expect(wrapper.findAll('[data-test="sleep-time"]')).toHaveLength(2);
    await wrapper.get('[data-test="sleep-idle"]').trigger('click');
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
