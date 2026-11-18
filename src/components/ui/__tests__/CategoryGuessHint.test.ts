/**
 * `CategoryGuessHint` (#152). The press guard: with `holdFocus` (a pending guess) a press on the
 * chip or Change must not blur the field the guess was read from, because blurring the activity
 * title commits a pending occasion guess and takes the hint away before the click can land.
 * Without it a press is an ordinary press (no phone keyboard kept up for nothing).
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import CategoryGuessHint from '../CategoryGuessHint.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const factory = (props: Record<string, unknown> = {}) =>
  mount(CategoryGuessHint, {
    props: { icon: '🎂', label: 'Birthday', word: 'birthday', ...props },
  });

describe('CategoryGuessHint', () => {
  it('renders nothing inside the live region without a label', () => {
    const wrapper = factory({ label: undefined });
    expect(wrapper.find('[aria-live]').exists()).toBe(true);
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  const pressAll = (wrapper: ReturnType<typeof factory>) =>
    wrapper.findAll('button').map((button) => {
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      button.element.dispatchEvent(press);
      return press.defaultPrevented;
    });

  it('with holdFocus a press on the chip or Change does not move the focus', () => {
    expect(pressAll(factory({ holdFocus: true }))).toEqual([true, true]);
  });

  it('without holdFocus a press is left alone', () => {
    expect(pressAll(factory())).toEqual([false, false]);
    expect(pressAll(factory({ holdFocus: false }))).toEqual([false, false]);
  });

  it('emits change from both the chip and Change', async () => {
    const wrapper = factory();
    const [chip, change] = wrapper.findAll('button');
    await chip!.trigger('click');
    await change!.trigger('click');
    expect(wrapper.emitted('change')).toHaveLength(2);
  });
});
