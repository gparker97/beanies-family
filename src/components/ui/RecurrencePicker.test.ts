import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import RecurrencePicker from './RecurrencePicker.vue';
import FrequencyChips from './FrequencyChips.vue';
import type { RecurrenceRule } from '@/types/recurrence';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    isEnglish: { value: true },
    isBeanieMode: { value: false },
  }),
}));

// 2026-08-23 is a Sunday (getDay() === 0).
const ANCHOR = '2026-08-23';

describe('RecurrencePicker', () => {
  it('selecting biweekly emits a week/2 rule and does NOT loop (v-model fed back)', async () => {
    // Regression for the infinite reactive loop: the parent reflects every emit
    // straight back as modelValue (real v-model). A loop would recurse until Vue
    // throws "Maximum recursive updates exceeded" and fail this test.
    let model: RecurrenceRule | null = null;
    const wrapper = mount(RecurrencePicker, {
      props: {
        modelValue: null,
        startDate: ANCHOR,
        'onUpdate:modelValue': (v: RecurrenceRule) => {
          model = v;
          void wrapper.setProps({ modelValue: v });
        },
      },
    });

    await wrapper.getComponent(FrequencyChips).vm.$emit('update:modelValue', 'biweekly');
    await nextTick();
    await nextTick();

    expect(model).toEqual({ unit: 'week', interval: 2, weekdays: [0], end: { kind: 'never' } });
    // Bounded emits — a loop would produce dozens/hundreds.
    expect(wrapper.emitted('update:modelValue')!.length).toBeLessThan(4);
  });

  it('loading a monthly-on-15 rule does not silently re-emit or reschedule to the start day', async () => {
    // startDate is the 5th, but the loaded rule lands on the 15th; opening the
    // form must NOT re-derive the day from the start date and emit a changed rule.
    const rule: RecurrenceRule = {
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'date',
      monthlyDay: 15,
      end: { kind: 'never' },
    };
    const wrapper = mount(RecurrencePicker, {
      props: { modelValue: rule, startDate: '2026-01-05' },
    });
    await nextTick();
    await nextTick();

    // No emit on load PROVES the built rule round-trips the loaded one: had the
    // picker re-derived monthlyDay from the start date (5th), builtRule would
    // differ from the loaded rule (15th) and emit. It stays silent → 15 preserved.
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
