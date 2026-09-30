import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      ({
        'mealPlanner.shopping.cook.once': 'Cook Once',
        'mealPlanner.shopping.cook.onceAria': 'Cook once',
        'mealPlanner.shopping.cook.times': 'Cook ×{n}',
        'mealPlanner.shopping.cook.timesAria': 'Cook {n} times',
      })[k] ?? k,
  }),
}));

import CookCountPill from '../CookCountPill.vue';

describe('CookCountPill', () => {
  it('a strong green "Cook ×N" (white on #1E8449 in both modes), spoken as "Cook N times"', () => {
    const w = mount(CookCountPill, { props: { count: 3 } });
    const pill = w.find('[data-testid="cook-count-pill"]');
    expect(pill.find('[aria-hidden="true"]').text()).toBe('Cook ×3');
    expect(pill.find('.sr-only').text()).toBe('Cook 3 times');
    expect(pill.classes()).toEqual(
      expect.arrayContaining(['bg-[#1e8449]', 'text-white', 'dark:bg-[#1e8449]', 'dark:text-white'])
    );
  });

  it('a quiet "Cook Once" at 1, with a dark partner', () => {
    const w = mount(CookCountPill, { props: { count: 1 } });
    const pill = w.find('[data-testid="cook-count-pill"]');
    expect(pill.find('[aria-hidden="true"]').text()).toBe('Cook Once');
    expect(pill.find('.sr-only').text()).toBe('Cook once');
    expect(pill.classes()).toEqual(
      expect.arrayContaining(['dark:bg-surface-hover', 'dark:text-ink-soft'])
    );
  });
});
