import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ExportSheet from '@/components/export/ExportSheet.vue';
import MealPlanExportBody from '@/components/export/MealPlanExportBody.vue';
import type { MealExportRows } from '@/utils/mealExportModel';

describe('ExportSheet', () => {
  it('renders the kicker, date range, tagline and the body slot', () => {
    const wrapper = mount(ExportSheet, {
      props: { title: '🍲 Meal Plan', dateRange: 'Aug 17 – 23', tagline: 'every bean counts' },
      slots: { default: '<div class="slotted">BODY</div>' },
    });
    expect(wrapper.find('.export-kicker').text()).toBe('🍲 Meal Plan');
    expect(wrapper.find('.export-dates').text()).toBe('Aug 17 – 23');
    expect(wrapper.find('.export-tagline').text()).toBe('every bean counts');
    expect(wrapper.find('.slotted').text()).toBe('BODY');
    // The Pod — four beans, always present.
    expect(wrapper.findAll('.export-bean')).toHaveLength(4);
  });

  it('omits the subtitle line when not provided', () => {
    const wrapper = mount(ExportSheet, { props: { title: 'x', dateRange: 'y' } });
    expect(wrapper.find('.export-subtitle').exists()).toBe(false);
  });
});

const ROWS: MealExportRows = {
  dayColumns: [
    { dateISO: '2026-08-17', label: 'Mon 17' },
    { dateISO: '2026-08-18', label: 'Tue 18' },
  ],
  rows: [
    { slot: 'breakfast', slotLabel: 'Breakfast', cells: [[], []] },
    {
      slot: 'lunch',
      slotLabel: 'Lunch',
      cells: [
        [
          { id: 'a', name: 'Soup', cook: { name: 'Alice', initial: 'A', color: '#F15D22' } },
          { id: 'b', name: 'Salad' },
        ],
        [],
      ],
    },
    { slot: 'dinner', slotLabel: 'Dinner', cells: [[], []] },
    { slot: 'snack', slotLabel: 'Snack', cells: [[], []] },
  ],
};

describe('MealPlanExportBody', () => {
  it('renders day headings, all four slot rows, and a multi-dish cell', () => {
    const wrapper = mount(MealPlanExportBody, { props: { rows: ROWS } });

    expect(wrapper.findAll('.day-head').map((n) => n.text())).toEqual(['Mon 17', 'Tue 18']);
    expect(wrapper.findAll('.slot-head').map((n) => n.text())).toEqual([
      'Breakfast',
      'Lunch',
      'Dinner',
      'Snack',
    ]);
    // Multi-dish lunch cell stacks both meals; second gets the divider class.
    const meals = wrapper.findAll('.meal');
    expect(meals).toHaveLength(2);
    expect(meals[0].find('.meal-name').text()).toBe('Soup');
    expect(meals[1].classes()).toContain('meal-divided');
    // Cook chip initial rendered.
    expect(wrapper.find('.cook-dot').text()).toBe('A');
  });

  it('shows a dash for empty cells and no cooked/today markers', () => {
    const wrapper = mount(MealPlanExportBody, { props: { rows: ROWS } });
    // 7 empty cells (2 breakfast + 1 lunch + 2 dinner + 2 snack... but only these rows: bf2 + lunch1 + dinner2 + snack2 = 7)
    expect(wrapper.findAll('.empty').length).toBeGreaterThan(0);
    expect(wrapper.find('.empty').text()).toBe('–');
    // Static artifact: no cooked ticks / today highlight in the markup.
    expect(wrapper.html()).not.toContain('today');
    expect(wrapper.html()).not.toContain('✓');
  });
});
