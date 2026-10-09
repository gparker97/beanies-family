import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import RecurrencePicker from './RecurrencePicker.vue';
import FrequencyChips from './FrequencyChips.vue';
import type { RecurrenceRule } from '@/types/recurrence';
import { cadenceOf, cadenceToRule } from '@/services/recurrence/cadence';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    // The one template the `time` summary needs; every other key renders as itself.
    t: (k: string) => (k === 'recurrence.desc.atTime' ? '{cadence} at {time}' : k),
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
    // Held in an object because the picker now emits its default on MOUNT (so a
    // form saved without touching the control still gets a rule) — that fires
    // before `mount()` has returned, so the handler cannot close over a binding
    // that is still being initialized.
    const held: { wrapper?: ReturnType<typeof mount<typeof RecurrencePicker>> } = {};
    held.wrapper = mount(RecurrencePicker, {
      props: {
        modelValue: null,
        startDate: ANCHOR,
        'onUpdate:modelValue': (v: RecurrenceRule) => {
          model = v;
          void held.wrapper?.setProps({ modelValue: v });
        },
      },
    });
    const wrapper = held.wrapper;

    // The mount emit publishes the default (monthly), before any interaction.
    expect(model).toMatchObject({ unit: 'month', interval: 1 });

    await wrapper.getComponent(FrequencyChips).vm.$emit('update:modelValue', 'biweekly');
    await nextTick();
    await nextTick();

    expect(model).toEqual({ unit: 'week', interval: 2, weekdays: [0], end: { kind: 'never' } });
    // Bounded emits — a loop would produce dozens/hundreds. One for the mount
    // default, one for the selection.
    expect(wrapper.emitted('update:modelValue')!.length).toBeLessThan(5);
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

describe('RecurrencePicker — own echo by ruleKey (#123)', () => {
  it('a host that hands the rule back rebuilt (another key order) does not snap Custom to Simple', async () => {
    // The card reminder round trip: the host stores the cadence and hands back
    // `cadenceToRule(cadenceOf(rule))`, an equal rule with `end` moved last. Custom opens on
    // every 2 weeks, which matches the Biweekly preset; re-syncing from the rebuilt rule
    // would flip the control back to Simple and leave Custom unreachable.
    const weekly: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [0],
      end: { kind: 'never' },
    };
    const held: { wrapper?: ReturnType<typeof mount<typeof RecurrencePicker>> } = {};
    held.wrapper = mount(RecurrencePicker, {
      props: {
        modelValue: weekly,
        startDate: ANCHOR,
        'onUpdate:modelValue': (v: RecurrenceRule) => {
          void held.wrapper?.setProps({ modelValue: cadenceToRule(cadenceOf(v)) });
        },
      },
    });
    const wrapper = held.wrapper;

    const custom = wrapper.findAll('button').find((b) => b.text() === 'recurrence.mode.custom')!;
    await custom.trigger('click');
    await nextTick();
    await nextTick();

    const emitted = wrapper.emitted('update:modelValue')!;
    expect(JSON.stringify(wrapper.props('modelValue'))).not.toBe(
      JSON.stringify(emitted.at(-1)![0])
    );
    expect(emitted.at(-1)![0]).toEqual({
      unit: 'week',
      interval: 2,
      weekdays: [0],
      end: { kind: 'never' },
    });
    expect(wrapper.findComponent(FrequencyChips).exists()).toBe(false);
    expect(emitted.length).toBe(1);
  });
});

describe('RecurrencePicker — start-date re-anchoring (#70)', () => {
  it('re-anchors an UNTOUCHED weekday when the start date moves', async () => {
    // Regression: the anchor watcher only ever re-derived monthlyDay, so a series
    // moved from a Sunday to a Tuesday kept repeating on Sundays.
    let model: RecurrenceRule | null = null;
    const wrapper = mount(RecurrencePicker, {
      props: {
        modelValue: { unit: 'week', interval: 1, weekdays: [0], end: { kind: 'never' } },
        startDate: ANCHOR, // Sunday
        'onUpdate:modelValue': (v: RecurrenceRule) => {
          model = v;
        },
      },
    });

    await wrapper.setProps({ startDate: '2026-08-25' }); // Tuesday
    await nextTick();
    await nextTick();

    expect(model).toEqual({ unit: 'week', interval: 1, weekdays: [2], end: { kind: 'never' } });
  });

  it('leaves a USER-CHOSEN weekday set alone when the start date moves', async () => {
    let model: RecurrenceRule | null = null;
    const wrapper = mount(RecurrencePicker, {
      props: {
        modelValue: { unit: 'week', interval: 1, weekdays: [1, 3], end: { kind: 'never' } },
        startDate: ANCHOR,
        'onUpdate:modelValue': (v: RecurrenceRule) => {
          model = v;
        },
      },
    });

    await wrapper.setProps({ startDate: '2026-08-25' });
    await nextTick();
    await nextTick();

    // Mon+Wed was a deliberate choice — moving the start date must not rewrite
    // it. Either nothing is emitted at all (no change), or the set is unchanged.
    expect(model === null ? [1, 3] : (model as RecurrenceRule).weekdays).toEqual([1, 3]);
  });

  it('shows the clamp hint only for a 29th-31st monthly anchor', async () => {
    const on31 = mount(RecurrencePicker, {
      props: { modelValue: null, startDate: '2026-01-31' },
    });
    expect(on31.text()).toContain('recurrence.monthly.clampHint');

    const on15 = mount(RecurrencePicker, {
      props: { modelValue: null, startDate: '2026-01-15' },
    });
    expect(on15.text()).not.toContain('recurrence.monthly.clampHint');
  });
});

describe('RecurrencePicker — defaultCadence (#70)', () => {
  it('starts on the requested cadence for a NEW entity', async () => {
    // REGRESSION: adopting this control in ActivityModal silently changed the
    // default for a new activity from WEEKLY (its own long-standing default) to
    // the picker's MONTHLY. E2E caught it — `planner.spec.ts` asserts a newly
    // created activity has `recurrence: 'weekly'`, and a monthly series also has
    // no second occurrence in the visible window, so two tests went red.
    let model: RecurrenceRule | null = null;
    mount(RecurrencePicker, {
      props: {
        modelValue: null,
        startDate: ANCHOR,
        defaultCadence: 'weekly',
        'onUpdate:modelValue': (v: RecurrenceRule) => {
          model = v;
        },
      },
    });
    expect(model).toMatchObject({ unit: 'week', interval: 1 });
  });

  it('still defaults to monthly when the prop is omitted (money surfaces)', () => {
    let model: RecurrenceRule | null = null;
    mount(RecurrencePicker, {
      props: {
        modelValue: null,
        startDate: ANCHOR,
        'onUpdate:modelValue': (v: RecurrenceRule) => {
          model = v;
        },
      },
    });
    expect(model).toMatchObject({ unit: 'month', interval: 1 });
  });
});

describe('RecurrencePicker: hideEnd + time (#123)', () => {
  it('hideEnd hides the Ends row and keeps the "Repeats" wording', () => {
    const shown = mount(RecurrencePicker, { props: { modelValue: null, startDate: ANCHOR } });
    expect(shown.find('select[aria-label="recurrence.ends"]').exists()).toBe(true);

    const hidden = mount(RecurrencePicker, {
      props: { modelValue: null, startDate: ANCHOR, hideEnd: true },
    });
    expect(hidden.find('select[aria-label="recurrence.ends"]').exists()).toBe(false);
    expect(hidden.text()).toContain('recurrence.repeats');
    expect(hidden.text()).not.toContain('recurrence.resets');
  });

  it('adds " at {time}" to the live summary only when a time is given', () => {
    const plain = mount(RecurrencePicker, {
      props: { modelValue: null, startDate: ANCHOR, defaultCadence: 'weekly' },
    });
    expect(plain.text()).not.toContain(' at ');

    const timed = mount(RecurrencePicker, {
      props: { modelValue: null, startDate: ANCHOR, defaultCadence: 'weekly', time: '20:00' },
    });
    expect(timed.text()).toMatch(/ at 8(:00)?\s?pm/i);
  });
});
