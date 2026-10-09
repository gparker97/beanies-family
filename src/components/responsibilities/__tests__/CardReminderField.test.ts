/**
 * Who Owns What (#123): one card part's reminder control in the card edit drawer.
 * What it must guarantee:
 *   - the switch row's copy says who it reminds (on / off / nobody holds it), "Remind {holder}"
 *     on a split part;
 *   - every change emits a reminder built by `buildCardReminder` (blank say → the card name);
 *   - the picker's start date is the reminder's next occurrence (today for a new one), and a
 *     cadence change stores exactly that date as the anchor;
 *   - a collapsed split part shows the summary, what it says and Change.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import type { CardReminder } from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useRecurrenceLabel', () => ({
  useRecurrenceLabel: () => ({
    describeWithTime: (rule: RecurrenceRule, anchor: string, time?: string) =>
      `${rule.unit}/${anchor}/${time ?? 'all-day'}`,
  }),
}));
vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  // A Wednesday.
  return { useToday: () => ({ today: ref('2026-10-14') }) };
});

import CardReminderField from '../CardReminderField.vue';
import ToggleRow from '@/components/ui/ToggleRow.vue';

const PickerStub = defineComponent({
  name: 'RecurrencePicker',
  props: {
    modelValue: { type: Object, default: null },
    startDate: String,
    time: String,
    hideEnd: Boolean,
    accent: String,
  },
  emits: ['update:modelValue'],
  template: '<div data-testid="picker" />',
});
const TimeStub = defineComponent({
  name: 'TimePresetPicker',
  props: ['modelValue', 'clearable'],
  emits: ['update:modelValue'],
  template: '<div />',
});

/** Every Monday at 8pm, anchored on a past Monday: next occurrence is Mon 19 Oct. */
const MONDAYS: CardReminder = {
  say: 'Put the trash out',
  cadence: { unit: 'week', interval: 1, weekdays: [1] },
  time: '20:00',
  anchor: '2026-09-07',
};
const WEEKLY_WED: RecurrenceRule = {
  unit: 'week',
  interval: 1,
  weekdays: [3],
  end: { kind: 'never' },
};

function mountField(props: Partial<InstanceType<typeof CardReminderField>['$props']> = {}) {
  return mount(CardReminderField, {
    props: {
      modelValue: null,
      holderName: 'Sofia',
      cardName: 'Trash Night',
      childHolder: false,
      expanded: true,
      ...props,
    },
    global: { stubs: { RecurrencePicker: PickerStub, TimePresetPicker: TimeStub } },
  });
}
const lastValue = (w: ReturnType<typeof mountField>) =>
  w.emitted('update:modelValue')!.at(-1)![0] as CardReminder | null;

describe('CardReminderField', () => {
  it('off: names the holder in the hint, shows the no-reminder box and no picker', () => {
    const w = mountField();
    const row = w.findComponent(ToggleRow);
    expect(row.props('modelValue')).toBe(false);
    expect(row.props('title')).toBe('whoOwnsWhat.reminder.toggle');
    expect(row.props('hint')).toBe('whoOwnsWhat.reminder.hintOff');
    expect(w.find('[data-testid="card-reminder-off"]').text()).toContain(
      'whoOwnsWhat.reminder.none'
    );
    expect(w.findComponent(PickerStub).exists()).toBe(false);
  });

  it('nobody holds the part: the hint says it starts when someone does', () => {
    const w = mountField({ holderName: null });
    expect(w.findComponent(ToggleRow).props('hint')).toBe('whoOwnsWhat.reminder.hintNobody');
  });

  it('turning it on opens it, and the picker default becomes a reminder anchored today', async () => {
    const w = mountField({ expanded: false });
    w.findComponent(ToggleRow).vm.$emit('update:modelValue', true);
    await w.vm.$nextTick();
    expect(w.emitted('update:expanded')).toEqual([[true]]);
    await w.setProps({ expanded: true });
    const picker = w.findComponent(PickerStub);
    expect(picker.props('startDate')).toBe('2026-10-14');
    expect(picker.props('hideEnd')).toBe(true);
    expect(picker.props('accent')).toBe('orange');
    expect(w.findComponent(ToggleRow).props('hint')).toBe('whoOwnsWhat.reminder.hintOn');

    picker.vm.$emit('update:modelValue', WEEKLY_WED);
    // A blank What to Say saves the card's name, so the to-do always has a title.
    expect(lastValue(w)).toEqual({
      say: 'Trash Night',
      cadence: { unit: 'week', interval: 1, weekdays: [3] },
      anchor: '2026-10-14',
    });
  });

  it('an existing reminder: the picker starts on its next occurrence, edits keep the anchor', async () => {
    const w = mountField({ modelValue: MONDAYS });
    const picker = w.findComponent(PickerStub);
    expect(picker.props('startDate')).toBe('2026-10-19');
    expect(picker.props('time')).toBe('20:00');

    w.findComponent(TimeStub).vm.$emit('update:modelValue', '19:30');
    expect(lastValue(w)).toEqual({ ...MONDAYS, time: '19:30' });

    await w.find('input').setValue('Bins out');
    expect(lastValue(w)).toEqual({ ...MONDAYS, say: 'Bins out' });

    // Cleared: saves the card's name, but the box itself stays empty while typing.
    await w.find('input').setValue('');
    expect(lastValue(w)!.say).toBe('Trash Night');
    expect((w.find('input').element as HTMLInputElement).value).toBe('');

    // A clock cleared: an all-day reminder.
    w.findComponent(TimeStub).vm.$emit('update:modelValue', '');
    expect(lastValue(w)!.time).toBeUndefined();
  });

  it('a cadence change stores the date the picker started on as the new anchor', () => {
    const w = mountField({ modelValue: MONDAYS });
    w.findComponent(PickerStub).vm.$emit('update:modelValue', WEEKLY_WED);
    expect(lastValue(w)).toEqual({
      say: 'Put the trash out',
      cadence: { unit: 'week', interval: 1, weekdays: [3] },
      time: '20:00',
      anchor: '2026-10-19',
    });
  });

  it('turning it off clears the reminder and closes the control', () => {
    const w = mountField({ modelValue: MONDAYS });
    w.findComponent(ToggleRow).vm.$emit('update:modelValue', false);
    expect(w.emitted('update:modelValue')).toEqual([[null]]);
    expect(w.emitted('update:expanded')).toEqual([[false]]);
  });

  it('a split part reads "Remind {holder}"; collapsed it shows the summary and Change', async () => {
    const w = mountField({ modelValue: MONDAYS, partLabel: 'for Leo', expanded: false });
    const row = w.findComponent(ToggleRow);
    expect(row.props('title')).toBe('whoOwnsWhat.reminder.togglePart');
    expect(row.props('hint')).toBe('');
    expect(w.find('[data-testid="card-reminder-off"]').exists()).toBe(false);
    expect(w.findComponent(PickerStub).exists()).toBe(false);
    const summary = w.find('[data-testid="card-reminder-summary"]');
    expect(summary.text()).toContain('week/2026-09-07/20:00');
    expect(summary.text()).toContain('"Put the trash out"');
    await w.find('[data-testid="card-reminder-change"]').trigger('click');
    expect(w.emitted('update:expanded')).toEqual([[true]]);
  });

  it('a child holder: adults see it too', () => {
    expect(mountField({ modelValue: MONDAYS, childHolder: true }).text()).toContain(
      'whoOwnsWhat.reminder.adultsSee'
    );
    expect(mountField({ modelValue: MONDAYS }).text()).not.toContain(
      'whoOwnsWhat.reminder.adultsSee'
    );
  });
  it('hands the picker the stored cadence as a rule (the picker recognises its own echo)', async () => {
    const w = mountField({ modelValue: MONDAYS });
    const picker = w.findComponent(PickerStub);
    // Custom opens on every 2 weeks. The stored cadence rebuilds to an equal rule in another key
    // order; the picker treats that as its own echo by `ruleKey` (RecurrencePicker.test.ts).
    const custom: RecurrenceRule = {
      unit: 'week',
      interval: 2,
      end: { kind: 'never' },
      weekdays: [1],
    };
    picker.vm.$emit('update:modelValue', custom);
    await w.setProps({ modelValue: lastValue(w) });
    expect(w.findComponent(PickerStub).props('modelValue')).toEqual(custom);

    // A cadence changed elsewhere (not by this picker) is rebuilt from the stored value.
    await w.setProps({ modelValue: { ...MONDAYS, cadence: { unit: 'day', interval: 1 } } });
    expect(w.findComponent(PickerStub).props('modelValue')).toEqual({
      unit: 'day',
      interval: 1,
      end: { kind: 'never' },
    });
  });
});
