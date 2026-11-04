/**
 * `ViewToggle` (#141): the compact M pill carries the phone month mode as a glyph, and a
 * second tap on it flips that mode instead of re-selecting Month.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'planner.view.month': 'Month',
        'planner.view.week': 'Week',
        'planner.view.day': 'Day',
        'planner.monthMode.showList': 'Show list',
        'planner.monthMode.showGrid': 'Show grid',
      };
      return map[key] ?? key;
    },
  }),
}));

import ViewToggle from '../ViewToggle.vue';

describe('ViewToggle month mode glyph', () => {
  it('shows the glyph only on the active month pill when monthMode is set', () => {
    const w = mount(ViewToggle, {
      props: { activeView: 'month', compact: true, monthMode: 'grid' },
    });
    expect(w.find('[data-testid="view-toggle-month"] svg').attributes('data-mode')).toBe('grid');
    expect(w.find('[data-testid="view-toggle-week"] svg').exists()).toBe(false);
    expect(w.find('[data-testid="view-toggle-day"] svg').exists()).toBe(false);
  });

  it('shows no glyph without monthMode, when not compact, or when month is not active', () => {
    expect(
      mount(ViewToggle, { props: { activeView: 'month', compact: true } })
        .find('svg')
        .exists()
    ).toBe(false);
    expect(
      mount(ViewToggle, { props: { activeView: 'month', monthMode: 'list' } })
        .find('svg')
        .exists()
    ).toBe(false);
    expect(
      mount(ViewToggle, { props: { activeView: 'week', compact: true, monthMode: 'list' } })
        .find('svg')
        .exists()
    ).toBe(false);
  });

  it('labels the active M with the mode it would switch to', () => {
    const grid = mount(ViewToggle, {
      props: { activeView: 'month', compact: true, monthMode: 'grid' },
    });
    expect(grid.get('[data-testid="view-toggle-month"]').attributes('aria-label')).toBe(
      'Show list'
    );
    const list = mount(ViewToggle, {
      props: { activeView: 'month', compact: true, monthMode: 'list' },
    });
    expect(list.get('[data-testid="view-toggle-month"]').attributes('aria-label')).toBe(
      'Show grid'
    );
  });
});

describe('ViewToggle taps', () => {
  it('a second tap on the active month pill emits toggle-month-mode only', async () => {
    const w = mount(ViewToggle, {
      props: { activeView: 'month', compact: true, monthMode: 'grid' },
    });
    await w.get('[data-testid="view-toggle-month"]').trigger('click');
    expect(w.emitted('toggle-month-mode')).toHaveLength(1);
    expect(w.emitted('update:activeView')).toBeUndefined();
  });

  it('a tap from week emits update:activeView', async () => {
    const w = mount(ViewToggle, {
      props: { activeView: 'week', compact: true, monthMode: 'grid' },
    });
    await w.get('[data-testid="view-toggle-month"]').trigger('click');
    expect(w.emitted('update:activeView')).toEqual([['month']]);
    expect(w.emitted('toggle-month-mode')).toBeUndefined();
  });

  it('without monthMode a tap on the active month pill re-emits the view', async () => {
    const w = mount(ViewToggle, { props: { activeView: 'month' } });
    await w.get('[data-testid="view-toggle-month"]').trigger('click');
    expect(w.emitted('update:activeView')).toEqual([['month']]);
    expect(w.emitted('toggle-month-mode')).toBeUndefined();
  });
});
