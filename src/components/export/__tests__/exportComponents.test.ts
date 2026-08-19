import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ExportSheet from '@/components/export/ExportSheet.vue';
import MealPlanExportBody from '@/components/export/MealPlanExportBody.vue';
import MealExportLegend from '@/components/export/MealExportLegend.vue';
import type { MealExportRows } from '@/utils/mealExportModel';

describe('ExportSheet', () => {
  it('renders the heading, accent, week label + range, tagline, body and legend slots', () => {
    const wrapper = mount(ExportSheet, {
      props: {
        heading: "This Week's Meals",
        accent: "what's cooking? 🌱",
        dateLabel: 'week of',
        dateRange: '17 – 23 Aug 2026',
        tagline: 'every bean counts',
      },
      slots: {
        default: '<div class="slotted">BODY</div>',
        legend: '<div class="leg">LEGEND</div>',
      },
    });
    expect(wrapper.find('.export-heading').text()).toBe("This Week's Meals");
    expect(wrapper.find('.export-accent').text()).toBe("what's cooking? 🌱");
    expect(wrapper.find('.export-dates-label').text()).toBe('week of');
    expect(wrapper.find('.export-dates-range').text()).toBe('17 – 23 Aug 2026');
    expect(wrapper.find('.export-tagline').text()).toBe('every bean counts');
    expect(wrapper.find('.slotted').text()).toBe('BODY');
    expect(wrapper.find('.leg').text()).toBe('LEGEND');
    // The Pod — four beans, always present.
    expect(wrapper.findAll('.export-bean')).toHaveLength(4);
  });

  it('omits the accent when not provided', () => {
    const wrapper = mount(ExportSheet, {
      props: { heading: 'x', dateLabel: 'week of', dateRange: 'y' },
    });
    expect(wrapper.find('.export-accent').exists()).toBe(false);
  });
});

const ROWS: MealExportRows = {
  dayColumns: [
    { dateISO: '2026-08-17', weekday: 'Mon', dayNum: '17' },
    { dateISO: '2026-08-18', weekday: 'Tue', dayNum: '18' },
  ],
  cooks: [{ initial: 'A', name: 'Alice', color: '#F15D22' }],
  rows: [
    { slot: 'breakfast', slotLabel: 'Breakfast', cells: [[], []] },
    {
      slot: 'lunch',
      slotLabel: 'Lunch',
      cells: [
        [
          {
            id: 'a',
            name: 'Soup',
            isType: false,
            cook: { name: 'Alice', initial: 'A', color: '#F15D22' },
            serveTime: '12:30',
            guestCount: 2,
          },
          { id: 'b', name: 'Eat out', isType: true, guestCount: 0 },
        ],
        [],
      ],
    },
    { slot: 'dinner', slotLabel: 'Dinner', cells: [[], []] },
    { slot: 'snack', slotLabel: 'Snack', cells: [[], []] },
  ],
};

describe('MealPlanExportBody', () => {
  it('renders weekday+dayNum headings, slot rows with icons, and a multi-dish cell', () => {
    const wrapper = mount(MealPlanExportBody, { props: { rows: ROWS } });

    const heads = wrapper.findAll('.day-head');
    expect(heads[0].text()).toContain('Mon');
    expect(heads[0].find('.day-num').text()).toBe('17');
    const slotHeads = wrapper.findAll('.slot-head');
    expect(slotHeads).toHaveLength(4);
    expect(slotHeads[0].find('.slot-ic').exists()).toBe(true);
    expect(slotHeads.map((n) => n.text())).toEqual([
      expect.stringContaining('Breakfast'),
      expect.stringContaining('Lunch'),
      expect.stringContaining('Dinner'),
      expect.stringContaining('Snack'),
    ]);
    // Multi-dish lunch cell stacks both meals; second gets the divider class.
    const dishes = wrapper.findAll('.dish');
    expect(dishes).toHaveLength(2);
    expect(dishes[0].find('.dish-name').text()).toBe('Soup');
    expect(dishes[1].classes()).toContain('divided');
    // The type entry is flagged for muted/italic styling.
    expect(dishes[1].classes()).toContain('type');
    // Meta: serve time + guest COUNT ("+2"), not names.
    expect(wrapper.text()).toContain('12:30');
    expect(wrapper.text()).toContain('+2');
    expect(wrapper.find('.cook-dot').text()).toBe('A');
  });

  it('marks empty cells and shows no cooked/today markers', () => {
    const wrapper = mount(MealPlanExportBody, { props: { rows: ROWS } });
    expect(wrapper.findAll('.cell.empty').length).toBeGreaterThan(0);
    expect(wrapper.html()).not.toContain('today');
    expect(wrapper.html()).not.toContain('✓');
  });
});

describe('MealExportLegend', () => {
  it('renders the cooks label, each cook chip, and the hint', () => {
    const wrapper = mount(MealExportLegend, {
      props: {
        cooksLabel: 'Cooks',
        cooks: [
          { initial: 'A', name: 'Alice', color: '#F15D22' },
          { initial: 'B', name: 'ben' },
        ],
        hint: '⏰ serve time · 👥 guests',
      },
    });
    expect(wrapper.find('.cooks-label').text()).toBe('Cooks');
    expect(wrapper.findAll('.chip')).toHaveLength(2);
    expect(wrapper.findAll('.dot').map((n) => n.text())).toEqual(['A', 'B']);
    expect(wrapper.find('.hint').text()).toBe('⏰ serve time · 👥 guests');
  });

  it('hides the cooks group when there are none but still shows the hint', () => {
    const wrapper = mount(MealExportLegend, {
      props: { cooksLabel: 'Cooks', cooks: [], hint: 'H' },
    });
    expect(wrapper.find('.cooks').exists()).toBe(false);
    expect(wrapper.find('.hint').text()).toBe('H');
  });
});
