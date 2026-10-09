/**
 * TimePresetPicker's optional clear. What it must guarantee:
 *   - no clear unless `clearable` AND a time is set (the other users are unchanged),
 *   - the clear is a SIBLING of the trigger, never a button inside a button,
 *   - it emits '' and has its own "Clear time" label.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import { ANCHORED_POPOVER_Z_INDEX } from '@/composables/useAnchoredPopover';

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

describe('TimePresetPicker list', () => {
  it('opens its list on <body>, outside any clipping host, and picking a time closes it', async () => {
    // The card reminder box hosts the picker inside a ConditionalSection (overflow-hidden):
    // an inline list there opened invisibly below the section's edge (#123).
    const host = document.createElement('div');
    host.style.overflow = 'hidden';
    document.body.appendChild(host);
    const w = mount(TimePresetPicker, { props: { modelValue: '' }, attachTo: host });
    await w.find(trigger).trigger('click');
    await w.vm.$nextTick();
    const options = document.querySelectorAll<HTMLButtonElement>('[data-time-preset]');
    expect(options.length).toBeGreaterThan(0);
    expect(host.contains(options[0]!)).toBe(false);
    expect(w.find('[data-time-preset]').exists()).toBe(false);

    const sixThirty = [...options].find((b) => b.textContent?.trim() === '6:30 PM')!;
    sixThirty.click();
    await w.vm.$nextTick();
    expect(w.emitted('update:modelValue')).toEqual([['18:30']]);
    expect(document.querySelectorAll('[data-time-preset]')).toHaveLength(0);
    w.unmount();
    host.remove();
  });
});

describe('TimePresetPicker list: layer and keyboard', () => {
  async function openPicker(modelValue: string) {
    const w = mount(TimePresetPicker, { props: { modelValue }, attachTo: document.body });
    await w.find(trigger).trigger('click');
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    return w;
  }
  const list = () =>
    document.querySelector<HTMLElement>('[data-testid="time-preset-picker-list"]')!;

  it('paints the list on the popover tier, above modals and the onboarding overlay (z 200)', async () => {
    const w = await openPicker('');
    expect(ANCHORED_POPOVER_Z_INDEX).toBeGreaterThan(260);
    expect(list().style.zIndex).toBe(String(ANCHORED_POPOVER_Z_INDEX));
    w.unmount();
  });

  it('focuses the matching preset on open', async () => {
    const w = await openPicker('10:00');
    expect(document.activeElement?.textContent?.trim()).toBe('10:00 AM');
    w.unmount();
  });

  it('focuses the Custom row, not the first preset, for a custom or empty time', async () => {
    for (const value of ['06:15', '']) {
      const w = await openPicker(value);
      expect(document.activeElement?.hasAttribute('data-time-custom')).toBe(true);
      w.unmount();
    }
  });

  it('leaves ArrowUp/ArrowDown in the custom time input to the input', async () => {
    const w = await openPicker('');
    document.querySelector<HTMLButtonElement>('[data-time-custom]')!.click();
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    const input = list().querySelector<HTMLInputElement>('input[type="time"]')!;
    expect(document.activeElement).toBe(input);
    for (const key of ['ArrowDown', 'ArrowUp']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      input.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
    }
    w.unmount();
  });

  it('still roves the preset rows with the arrow keys', async () => {
    const w = await openPicker('10:00');
    const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe('10:30 AM');
    w.unmount();
  });
});
