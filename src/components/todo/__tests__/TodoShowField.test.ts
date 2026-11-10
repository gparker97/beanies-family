/**
 * "Show from" (TodoShowField). What it must guarantee:
 *   - nothing renders without a due date,
 *   - a one-off shows a date that reads as today for `now`, with the picker bounded by today and
 *     the due date, and the one-tap shortcut flips between "On the due date" and "Today",
 *   - a date between today and the due date emits `from`; the due date emits `due`,
 *   - a repeating to-do offers three choices; "Days before" starts at 3 and steps within 1..30,
 *   - the hint names the surfaces and never calls them lists,
 *   - readonly shows the hint only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import TodoShowField from '../TodoShowField.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import type { TodoShowRule } from '@/utils/todoPlate';

vi.mock('@/composables/useToday', () => ({
  useToday: () => ({
    today: ref('2026-11-10'),
    startOfToday: ref(new Date(2026, 10, 10)),
  }),
}));

const DUE = '2026-12-04';

function mountField(props: {
  modelValue: TodoShowRule;
  repeating?: boolean;
  dueDate?: string;
  readonly?: boolean;
}) {
  return mount(TodoShowField, {
    props: { repeating: false, dueDate: DUE, ...props },
  });
}

const lastEmit = (w: ReturnType<typeof mountField>) =>
  w.emitted('update:modelValue')!.at(-1)![0] as TodoShowRule;

describe('TodoShowField', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders nothing without a due date', () => {
    const w = mountField({ modelValue: { kind: 'now' }, dueDate: '' });
    expect(w.find('[data-testid="todo-show-field"]').exists()).toBe(false);
  });

  it('renders nothing for a one-off already due today or earlier, but still for a repeating one', () => {
    const field = '[data-testid="todo-show-field"]';
    expect(
      mountField({ modelValue: { kind: 'now' }, dueDate: '2026-11-10' })
        .find(field)
        .exists()
    ).toBe(false);
    expect(
      mountField({ modelValue: { kind: 'now' }, dueDate: '2026-11-03' })
        .find(field)
        .exists()
    ).toBe(false);
    expect(
      mountField({ modelValue: { kind: 'due' }, repeating: true, dueDate: '2026-11-10' })
        .find(field)
        .exists()
    ).toBe(true);
  });

  describe('one-off', () => {
    it('shows today by default, bounded by today and the due date', () => {
      const w = mountField({ modelValue: { kind: 'now' } });
      const picker = w.getComponent(BeanieDatePicker);
      expect(picker.props('modelValue')).toBe('2026-11-10');
      expect(picker.props('min')).toBe('2026-11-10');
      expect(picker.props('max')).toBe(DUE);
      expect(w.get('[data-testid="todo-show-shortcut"]').text()).toBe('on the due date');
    });

    it('emits from for a date between today and the due date, due for the due date, now for today', async () => {
      const w = mountField({ modelValue: { kind: 'now' } });
      const picker = w.getComponent(BeanieDatePicker);
      await picker.vm.$emit('update:modelValue', '2026-11-24');
      expect(lastEmit(w)).toEqual({ kind: 'from', date: '2026-11-24' });
      await picker.vm.$emit('update:modelValue', DUE);
      expect(lastEmit(w)).toEqual({ kind: 'due' });
      await picker.vm.$emit('update:modelValue', '2026-11-10');
      expect(lastEmit(w)).toEqual({ kind: 'now' });
    });

    it('the shortcut sets the due date, then offers Today once there', async () => {
      const w = mountField({ modelValue: { kind: 'now' } });
      await w.get('[data-testid="todo-show-shortcut"] button').trigger('click');
      expect(lastEmit(w)).toEqual({ kind: 'due' });

      await w.setProps({ modelValue: { kind: 'due' } });
      expect(w.getComponent(BeanieDatePicker).props('modelValue')).toBe(DUE);
      expect(w.get('[data-testid="todo-show-shortcut"]').text()).toBe('today');
      await w.get('[data-testid="todo-show-shortcut"] button').trigger('click');
      expect(lastEmit(w)).toEqual({ kind: 'now' });
    });

    it('reads a from date that has passed as today', () => {
      const w = mountField({ modelValue: { kind: 'from', date: '2026-11-01' } });
      expect(w.getComponent(BeanieDatePicker).props('modelValue')).toBe('2026-11-10');
    });

    it('the hint names the surfaces, never lists', () => {
      const now = mountField({ modelValue: { kind: 'now' } }).get('[data-testid="todo-show-hint"]');
      expect(now.text().toLowerCase()).toContain('the daily briefing, the nook and your widgets');
      expect(now.text().toLowerCase()).not.toContain('list');

      const from = mountField({ modelValue: { kind: 'from', date: '2026-11-24' } });
      expect(from.get('[data-testid="todo-show-hint"]').text()).toMatch(
        /from .*24.*not overdue until/
      );

      const due = mountField({ modelValue: { kind: 'due' } });
      expect(due.get('[data-testid="todo-show-hint"]').text()).toContain('the day it is due');
    });
  });

  describe('repeating', () => {
    it('offers three choices, defaulting to on each due date, and no date picker', () => {
      const w = mountField({ modelValue: { kind: 'due' }, repeating: true });
      expect(w.findComponent(BeanieDatePicker).exists()).toBe(false);
      const chips = w.getComponent(FrequencyChips);
      expect(chips.props('modelValue')).toBe('due');
      expect(chips.props('options').map((o: { label: string }) => o.label)).toEqual([
        'on each due date',
        'days before',
        'every day',
      ]);
      expect(w.find('[data-testid="todo-show-lead"]').exists()).toBe(false);
    });

    it('Days before reveals a stepper starting at 3', async () => {
      const w = mountField({ modelValue: { kind: 'due' }, repeating: true });
      await w.getComponent(FrequencyChips).vm.$emit('update:modelValue', 'lead');
      expect(lastEmit(w)).toEqual({ kind: 'lead', days: 3 });

      await w.setProps({ modelValue: { kind: 'lead', days: 3 } });
      const stepper = w.getComponent(NumberStepper);
      expect(stepper.props('min')).toBe(1);
      expect(stepper.props('max')).toBe(30);
      expect(w.get('[data-testid="todo-show-hint"]').text()).toContain(
        '3 days before each due date'
      );
      await w.get('[data-testid="stepper-increase"]').trigger('click');
      expect(lastEmit(w)).toEqual({ kind: 'lead', days: 4 });
    });

    it('uses the singular for one day', () => {
      const w = mountField({ modelValue: { kind: 'lead', days: 1 }, repeating: true });
      expect(w.get('[data-testid="todo-show-hint"]').text()).toContain('1 day before');
    });

    it('Every day and On each due date emit their rules', async () => {
      const w = mountField({ modelValue: { kind: 'lead', days: 5 }, repeating: true });
      const chips = w.getComponent(FrequencyChips);
      await chips.vm.$emit('update:modelValue', 'now');
      expect(lastEmit(w)).toEqual({ kind: 'now' });
      await chips.vm.$emit('update:modelValue', 'due');
      expect(lastEmit(w)).toEqual({ kind: 'due' });
    });
  });

  it('readonly shows the hint only', () => {
    const w = mountField({ modelValue: { kind: 'due' }, readonly: true });
    expect(w.findComponent(BeanieDatePicker).exists()).toBe(false);
    expect(w.find('[data-testid="todo-show-shortcut"]').exists()).toBe(false);
    expect(w.get('[data-testid="todo-show-hint"]').text()).toContain('the day it is due');
  });
});
