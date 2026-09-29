/**
 * TimePresetPicker's optional clear. What it must guarantee:
 *   - no clear unless `clearable` AND a time is set (the other users are unchanged),
 *   - the clear is a SIBLING of the trigger, never a button inside a button,
 *   - it emits '' and has its own "Clear time" label.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const clear = '[data-testid="time-preset-picker-clear"]';
const trigger = '[data-testid="time-preset-picker-trigger"]';

describe('TimePresetPicker clearable', () => {
  it('shows no clear by default, even with a time set', () => {
    const w = mount(TimePresetPicker, { props: { modelValue: '10:00' } });
    expect(w.find(clear).exists()).toBe(false);
  });

  it('shows no clear while no time is set', () => {
    const w = mount(TimePresetPicker, { props: { modelValue: '', clearable: true } });
    expect(w.find(clear).exists()).toBe(false);
  });

  it('renders the clear beside the trigger, not inside it', () => {
    const w = mount(TimePresetPicker, { props: { modelValue: '10:00', clearable: true } });
    const button = w.find(clear);
    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-label')).toBe('time.clearAriaLabel');
    expect(w.find(trigger).find(clear).exists()).toBe(false);
    expect(w.findAll('button button')).toHaveLength(0);
  });

  it('emits an empty time on clear, without opening the list', async () => {
    const w = mount(TimePresetPicker, { props: { modelValue: '10:00', clearable: true } });
    await w.find(clear).trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([['']]);
    expect(w.text()).not.toContain('modal.customTime');
  });
});
