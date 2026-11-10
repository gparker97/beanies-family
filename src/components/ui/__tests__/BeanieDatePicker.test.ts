/**
 * The two hooks inline-edit hosts rely on: `autoOpen` shows the calendar on mount, and `close`
 * fires whenever the calendar shuts, after `update:modelValue` when a day was picked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BeanieDatePicker from '../BeanieDatePicker.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('BeanieDatePicker inline-edit hooks', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
  });

  it('stays closed on mount by default', () => {
    const w = mount(BeanieDatePicker, {
      props: { modelValue: '2026-10-14' },
      attachTo: document.body,
    });
    expect((w.vm as unknown as { isOpen: boolean }).isOpen).toBe(false);
    expect(w.emitted('close')).toBeUndefined();
    w.unmount();
  });

  it('autoOpen opens the calendar on mount; Escape closes it and emits close once', async () => {
    const w = mount(BeanieDatePicker, {
      props: { modelValue: '2026-10-14', autoOpen: true },
      attachTo: document.body,
    });
    expect((w.vm as unknown as { isOpen: boolean }).isOpen).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect((w.vm as unknown as { isOpen: boolean }).isOpen).toBe(false);
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('update:modelValue')).toBeUndefined();
    w.unmount();
  });
});
