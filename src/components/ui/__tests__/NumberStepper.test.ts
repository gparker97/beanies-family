import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import NumberStepper from '../NumberStepper.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function factory(modelValue: number | undefined, extra: Record<string, unknown> = {}) {
  const wrapper = mount(NumberStepper, {
    props: {
      modelValue,
      min: 1,
      max: 99,
      label: 'Servings',
      unit: 'people',
      'onUpdate:modelValue': (v: number | undefined) => wrapper.setProps({ modelValue: v }),
      ...extra,
    },
  });
  return wrapper;
}

function emitted(wrapper: ReturnType<typeof factory>): (number | undefined)[] {
  return (wrapper.emitted('update:modelValue') ?? []).map((args) => args[0] as number | undefined);
}

describe('NumberStepper', () => {
  it('renders the value, the unit and labelled buttons', () => {
    const w = factory(4);
    expect((w.get('input').element as HTMLInputElement).value).toBe('4');
    expect(w.text()).toContain('people');
    expect(w.get('input').attributes('aria-label')).toBe('Servings');
    expect(w.get('[data-testid="stepper-decrease"]').attributes('aria-label')).toBe(
      'common.stepper.fewer'
    );
    expect(w.get('[data-testid="stepper-increase"]').attributes('aria-label')).toBe(
      'common.stepper.more'
    );
    expect(w.findAll('button').every((b) => b.attributes('type') === 'button')).toBe(true);
  });

  it('steps up and down', async () => {
    const w = factory(4);
    await w.get('[data-testid="stepper-increase"]').trigger('click');
    await w.get('[data-testid="stepper-decrease"]').trigger('click');
    await w.get('[data-testid="stepper-decrease"]').trigger('click');
    expect(emitted(w)).toEqual([5, 4, 3]);
  });

  it('starts a blank field at min from either button', async () => {
    const w = factory(undefined);
    expect((w.get('input').element as HTMLInputElement).value).toBe('');
    await w.get('[data-testid="stepper-increase"]').trigger('click');
    expect(emitted(w)).toEqual([1]);
  });

  it('disables − at min and + at max', () => {
    expect(factory(1).get('[data-testid="stepper-decrease"]').attributes('disabled')).toBeDefined();
    expect(
      factory(99).get('[data-testid="stepper-increase"]').attributes('disabled')
    ).toBeDefined();
  });

  it('emits undefined when the digits are deleted', async () => {
    const w = factory(4);
    await w.get('input').setValue('');
    expect(emitted(w)).toEqual([undefined]);
  });

  it('drops anything that is not a digit', async () => {
    const w = factory(undefined);
    await w.get('input').setValue('6a');
    expect(emitted(w)).toEqual([6]);
    expect((w.get('input').element as HTMLInputElement).value).toBe('6');
  });

  it('emits a clamped value while typing and snaps the text on blur', async () => {
    const w = factory(undefined);
    const input = w.get('input');
    await input.setValue('150');
    expect(emitted(w)).toEqual([99]);
    // Not rewritten mid-typing.
    expect((input.element as HTMLInputElement).value).toBe('150');
    await input.trigger('blur');
    expect((input.element as HTMLInputElement).value).toBe('99');

    await input.setValue('0');
    expect(emitted(w).at(-1)).toBe(1);
    await input.trigger('blur');
    expect((input.element as HTMLInputElement).value).toBe('1');
  });

  it('shows a value the parent resets', async () => {
    const w = factory(4);
    await w.setProps({ modelValue: undefined });
    expect((w.get('input').element as HTMLInputElement).value).toBe('');
    await w.setProps({ modelValue: 8 });
    expect((w.get('input').element as HTMLInputElement).value).toBe('8');
  });
});
