/**
 * CHARACTERISATION test — written against `FrequencyChips` BEFORE its markup was extracted
 * into `ChipButton`, and required to stay green through that extraction without being edited.
 *
 * Written after the fact it would characterise the refactor rather than the original, which is
 * worth nothing. `FrequencyChips` has 16 call sites across 12 files and had no test at all, so
 * this is the only thing standing between an internals refactor and sixteen silently restyled
 * controls.
 *
 * These assertions deliberately pin CLASS STRINGS. That is normally a brittle way to test a
 * component; here the brittleness is the point — a changed selected-state class IS the
 * regression being guarded against.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import FrequencyChips, { type ChipOption } from '../FrequencyChips.vue';

const OPTIONS: ChipOption[] = [
  { value: 'daily', label: 'Daily', icon: '📅' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'never', label: 'Never', disabled: true, disabledHint: 'not for this plan' },
];

function factory(props: Record<string, unknown> = {}) {
  return mount(FrequencyChips, {
    props: { modelValue: 'daily', options: OPTIONS, ...props },
  });
}

describe('FrequencyChips (characterisation)', () => {
  it('renders one button per option, with icon and label', () => {
    const buttons = factory().findAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.text()).toContain('📅');
    expect(buttons[0]!.text()).toContain('Daily');
    expect(buttons[1]!.text()).toBe('Weekly');
  });

  it('gives the selected chip the orange accent by default', () => {
    const cls = factory().findAll('button')[0]!.classes().join(' ');
    expect(cls).toContain('border-primary-500');
    expect(cls).toContain('text-primary-500');
    expect(cls).toContain('bg-[var(--tint-orange-8)]');
    expect(cls).toContain('border-2');
  });

  it('gives the selected chip the purple accent when asked', () => {
    const cls = factory({ accent: 'purple' }).findAll('button')[0]!.classes().join(' ');
    expect(cls).toContain('border-purple-500');
    expect(cls).toContain('text-purple-500');
    expect(cls).toContain('bg-[var(--tint-purple-12)]');
    expect(cls).not.toContain('border-primary-500');
  });

  it('gives unselected chips the muted treatment', () => {
    const cls = factory().findAll('button')[1]!.classes().join(' ');
    expect(cls).toContain('border-transparent');
    expect(cls).toContain('bg-[var(--tint-slate-5)]');
    expect(cls).toContain('hover:bg-[var(--tint-slate-10)]');
    expect(cls).not.toContain('opacity-40');
  });

  it('dims a disabled chip, marks it not-allowed, and drops the hover', () => {
    const btn = factory().findAll('button')[2]!;
    const cls = btn.classes().join(' ');
    expect(cls).toContain('opacity-40');
    expect(cls).toContain('cursor-not-allowed');
    expect(cls).not.toContain('hover:bg-[var(--tint-slate-10)]');
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('renders the disabled hint tooltip', () => {
    expect(factory().text()).toContain('not for this plan');
  });

  it('emits the chosen value on click', async () => {
    const wrapper = factory();
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['weekly']);
  });

  it('does not emit when the option is disabled', async () => {
    const wrapper = factory();
    await wrapper.findAll('button')[2]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('disables every chip when the whole group is disabled', () => {
    const wrapper = factory({ disabled: true });
    for (const btn of wrapper.findAll('button')) {
      expect(btn.attributes('disabled')).toBeDefined();
    }
  });

  it('wraps by default', () => {
    expect(factory().find('div').classes()).toContain('flex-wrap');
  });
});
