/**
 * One time field. What it must guarantee:
 *   - the clear (✕) only with `clearable` AND a time set, as a SIBLING of the trigger, emitting
 *     '' with its own "Clear time" label (carried over from the old picker),
 *   - the panel opens on <body>, outside any clipping host, at the popover tier (#123),
 *   - each pick reaches the v-model exactly once: nothing on an hour tap or a dismiss, one
 *     write on a minute or on Done, and the picker closes when it writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

const hoisted = vi.hoisted(() => ({
  mobile: null as unknown as { value: boolean },
}));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref } = await import('vue');
  hoisted.mobile = ref(false);
  return { useBreakpoint: () => ({ isMobile: hoisted.mobile }) };
});
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import BeanieTimePicker from '@/components/ui/BeanieTimePicker.vue';
import { ANCHORED_POPOVER_Z_INDEX } from '@/composables/useAnchoredPopover';
import { __resetEscapeCloseForTests } from '@/composables/useEscapeClose';
import { resetOverlayStack } from '@/utils/overlayStack';

const clear = '[data-testid="time-picker-clear"]';
const trigger = '[data-testid="time-picker-trigger"]';
const card = () => document.querySelector<HTMLElement>('[data-testid="time-picker-card"]');
const inCard = (sel: string) => card()!.querySelector<HTMLElement>(sel)!;

let wrapper: VueWrapper | null = null;

function mountPicker(props: Record<string, unknown>, attachTo: HTMLElement = document.body) {
  wrapper = mount(BeanieTimePicker, {
    props: { modelValue: '', ...props } as { modelValue: string },
    attachTo,
  });
  return wrapper;
}

async function openPicker(w: VueWrapper) {
  await w.find(trigger).trigger('click');
  await nextTick();
  await nextTick();
}

beforeEach(() => {
  hoisted.mobile.value = false;
  resetOverlayStack();
  __resetEscapeCloseForTests();
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  resetOverlayStack();
  __resetEscapeCloseForTests();
  document.body.innerHTML = '';
});

describe('BeanieTimePicker clearable', () => {
  it('shows no clear by default, even with a time set', () => {
    const w = mountPicker({ modelValue: '10:00' });
    expect(w.find(clear).exists()).toBe(false);
  });

  it('shows no clear while no time is set', () => {
    const w = mountPicker({ modelValue: '', clearable: true });
    expect(w.find(clear).exists()).toBe(false);
  });

  it('renders the clear beside the trigger, not inside it', () => {
    const w = mountPicker({ modelValue: '10:00', clearable: true });
    const button = w.find(clear);
    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-label')).toBe('time.clearAriaLabel');
    expect(w.find(trigger).find(clear).exists()).toBe(false);
    expect(w.findAll('button button')).toHaveLength(0);
  });

  it('emits an empty time on clear, without opening the picker', async () => {
    const w = mountPicker({ modelValue: '10:00', clearable: true });
    await w.find(clear).trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([['']]);
    expect(card()).toBeNull();
  });

  it('offers Clear in the panel too, which writes "" and closes', async () => {
    const w = mountPicker({ modelValue: '10:00', clearable: true });
    await openPicker(w);
    inCard('[data-testid="time-picker-panel-clear"]').click();
    await nextTick();
    expect(w.emitted('update:modelValue')).toEqual([['']]);
    expect(card()).toBeNull();
  });
});

describe('BeanieTimePicker trigger', () => {
  it('shows the 12-hour time, or the placeholder, and announces the dialog it opens', async () => {
    const set = mountPicker({ modelValue: '16:15' });
    expect(set.find(trigger).text()).toBe('4:15pm');
    expect(set.find(trigger).attributes('aria-haspopup')).toBe('dialog');
    expect(set.find(trigger).attributes('aria-expanded')).toBe('false');
    await openPicker(set);
    expect(set.find(trigger).attributes('aria-expanded')).toBe('true');
    set.unmount();
    const empty = mountPicker({ modelValue: '', placeholder: 'Time given' });
    expect(empty.find(trigger).text()).toBe('Time given');
    empty.unmount();
    const fallback = mountPicker({ modelValue: '' });
    expect(fallback.find(trigger).text()).toBe('modal.selectTime');
  });

  it('focuses its own trigger before opening (Safari focus restore)', async () => {
    const w = mountPicker({ modelValue: '' });
    await openPicker(w);
    // The desktop popover then moves focus into the type box; Escape restores it to the pill.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(document.activeElement).toBe(w.find(trigger).element);
  });

  it('closes when its own pill is tapped again', async () => {
    const w = mountPicker({ modelValue: '' });
    await openPicker(w);
    await w.find(trigger).trigger('click');
    await nextTick();
    expect(card()).toBeNull();
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });
});

describe('BeanieTimePicker panel', () => {
  it('opens on <body>, outside a clipping host, at the popover tier; a pick writes and closes', async () => {
    // The card reminder box hosts the picker inside a ConditionalSection (overflow-hidden):
    // an inline list there opened invisibly below the section's edge (#123).
    const host = document.createElement('div');
    host.style.overflow = 'hidden';
    document.body.appendChild(host);
    const w = mountPicker({ modelValue: '' }, host);
    await openPicker(w);
    expect(card()).not.toBeNull();
    expect(host.contains(card())).toBe(false);
    expect(ANCHORED_POPOVER_Z_INDEX).toBeGreaterThan(260);
    expect(card()!.style.zIndex).toBe(String(ANCHORED_POPOVER_Z_INDEX));

    inCard('[data-hour="18"]').click();
    await nextTick();
    expect(w.emitted('update:modelValue')).toBeUndefined();
    expect(card()).not.toBeNull();

    inCard('[data-minute="30"]').click();
    await nextTick();
    expect(w.emitted('update:modelValue')).toEqual([['18:30']]);
    expect(card()).toBeNull();
  });

  it('opens as a sheet on a phone, with the same single write', async () => {
    hoisted.mobile.value = true;
    const w = mountPicker({ modelValue: '09:00' });
    await openPicker(w);
    expect(card()!.getAttribute('aria-modal')).toBe('true');
    inCard('[data-minute="45"]').click();
    await nextTick();
    expect(w.emitted('update:modelValue')).toEqual([['09:45']]);
    expect(card()).toBeNull();
  });

  it('writes nothing when an hour tap is dismissed', async () => {
    const w = mountPicker({ modelValue: '09:00' });
    await openPicker(w);
    inCard('[data-hour="14"]').click();
    await nextTick();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.click();
    await nextTick();
    expect(card()).toBeNull();
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it('writes the lit hour once on Done, and nothing on Done without a change', async () => {
    const w = mountPicker({ modelValue: '09:30' });
    await openPicker(w);
    inCard('[data-hour="14"]').click();
    await nextTick();
    inCard('[data-testid="time-picker-done"]').click();
    await nextTick();
    expect(w.emitted('update:modelValue')).toEqual([['14:30']]);
    expect(card()).toBeNull();

    await w.setProps({ modelValue: '14:30' });
    await openPicker(w);
    inCard('[data-hour="14"]').click();
    await nextTick();
    inCard('[data-testid="time-picker-done"]').click();
    await nextTick();
    expect(w.emitted('update:modelValue')).toHaveLength(1);
    expect(card()).toBeNull();
  });

  it('shows no Recent row, durations or All day', async () => {
    const w = mountPicker({ modelValue: '09:00' });
    await openPicker(w);
    expect(card()!.querySelector('[data-testid="time-picker-recent"]')).toBeNull();
    expect(card()!.querySelector('[data-testid="time-picker-durations"]')).toBeNull();
    expect(card()!.querySelector('[data-testid="time-picker-all-day"]')).toBeNull();
  });
});
