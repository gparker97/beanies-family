/**
 * The period navigator's three optional props (#148, the chore week stepper). Absent, both forms
 * render exactly as the calendar and the wall have them.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import CalendarPeriodNav from '../CalendarPeriodNav.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const ON =
  'flex h-8 w-8 items-center justify-center rounded-lg transition-colors text-secondary-500/50 dark:text-ink-soft dark:hover:bg-surface-hover cursor-pointer hover:bg-gray-100';
const arrows = (w: ReturnType<typeof mount>) => {
  const all = w.findAll('button');
  return { prev: all[0]!, next: all[all.length - 1]! };
};

describe('CalendarPeriodNav', () => {
  it.each([false, true])(
    'without the new props (compact %s): today’s navigator',
    async (compact) => {
      const w = mount(CalendarPeriodNav, { props: { compact } });
      const { prev, next } = arrows(w);
      for (const b of [prev, next]) {
        expect(b.attributes('disabled')).toBeUndefined();
        expect(b.classes().sort()).toEqual(ON.split(' ').sort());
      }
      const today = w.get('[data-testid="calendar-today"]');
      if (compact) {
        expect(today.attributes('aria-label')).toBe('planner.today');
        expect(today.attributes('title')).toBe('planner.today');
      } else {
        expect(today.text()).toBe('planner.today');
      }
      await prev.trigger('click');
      await today.trigger('click');
      await next.trigger('click');
      for (const e of ['prev', 'today', 'next']) expect(w.emitted(e)).toHaveLength(1);
    }
  );

  it('a disabled arrow is a real disabled button, drawn faint, with no hover', async () => {
    const w = mount(CalendarPeriodNav, { props: { prevDisabled: true, nextDisabled: false } });
    const { prev, next } = arrows(w);
    expect(prev.attributes('disabled')).toBeDefined();
    expect(prev.classes()).toEqual(
      expect.arrayContaining(['text-secondary-400', 'dark:text-ink-faint', 'cursor-default'])
    );
    expect(prev.classes()).not.toContain('hover:bg-gray-100');
    expect(next.attributes('disabled')).toBeUndefined();
    await prev.trigger('click');
    expect(w.emitted('prev')).toBeUndefined();
  });

  it.each([false, true])('todayLabel replaces the middle text (compact %s)', (compact) => {
    const w = mount(CalendarPeriodNav, { props: { compact, todayLabel: 'Back to This Week' } });
    const today = w.get('[data-testid="calendar-today"]');
    if (compact) {
      expect(today.attributes('aria-label')).toBe('Back to This Week');
      expect(today.attributes('title')).toBe('Back to This Week');
    } else {
      expect(today.text()).toBe('Back to This Week');
    }
  });

  it.each([false, true])('todayLabel null hides the middle button (compact %s)', (compact) => {
    const w = mount(CalendarPeriodNav, { props: { compact, todayLabel: null } });
    expect(w.find('[data-testid="calendar-today"]').exists()).toBe(false);
    expect(w.findAll('button')).toHaveLength(2);
  });
});
