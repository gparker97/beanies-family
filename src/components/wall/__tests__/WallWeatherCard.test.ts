/**
 * The wall weather card (#134): every layout against every atom state, so no combination
 * renders blank or draws a state another layout owns.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import WallWeatherCard, { type WallWeatherCardLayout } from '../WallWeatherCard.vue';
import { ATOMS, ATOM_CASES } from './wallWeatherFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const LAYOUTS: WallWeatherCardLayout[] = ['line', 'now', 'full'];

function mountCard(state: keyof typeof ATOMS, layout: WallWeatherCardLayout) {
  return mount(WallWeatherCard, {
    props: { atom: ATOMS[state], layout },
    global: { stubs: { BeanieIcon: { template: '<i class="pin" />' } } },
  });
}

describe('WallWeatherCard', () => {
  describe.each(LAYOUTS)('%s', (layout) => {
    it.each(ATOM_CASES)('%s renders something, and is never interactive', (state) => {
      const wrapper = mountCard(state, layout);
      const root = wrapper.get('.wall-weather-card');
      expect(root.element.tagName).toBe('DIV');
      expect(root.attributes('data-layout')).toBe(layout);
      expect(root.attributes('data-state')).toBe(ATOMS[state].state);
      expect(root.text().trim()).not.toBe('');
      expect(root.text()).not.toContain('›');
    });

    it('titles the card except on one line', () => {
      const title = mountCard('fresh', layout).find('.wall-card-title');
      expect(title.exists()).toBe(layout !== 'line');
      if (layout !== 'line') {
        expect(title.text()).toContain('weather.title');
        expect(title.text()).toContain('Portland');
      }
    });

    it('fresh: glyph, temperature and condition, no age', () => {
      const wrapper = mountCard('fresh', layout);
      expect(wrapper.find('svg.wall-weather-glyph').exists()).toBe(true);
      expect(wrapper.get('.wall-weather-temp').text()).toBe('66°');
      expect(wrapper.get('.wall-weather-temp').classes()).toContain('dark:text-ink');
      expect(wrapper.text()).toContain('Partly cloudy');
      expect(wrapper.text()).not.toContain('3 hours ago');
    });

    it('aged: the softer temperature and the age', () => {
      const wrapper = mountCard('aged', layout);
      expect(wrapper.get('.wall-weather-temp').classes()).toEqual(
        expect.arrayContaining(['text-secondary-400', 'dark:text-ink-soft'])
      );
      expect(wrapper.text()).toContain(layout === 'line' ? '3 hours ago' : 'As of 3 hours ago');
      if (layout === 'line') expect(wrapper.text()).not.toContain('As of 3 hours ago');
    });

    it("old: no temperature, today's high and low, and the age", () => {
      const wrapper = mountCard('old', layout);
      expect(wrapper.find('.wall-weather-temp').exists()).toBe(false);
      expect(wrapper.text()).toContain('Today H 68° L 51°');
      expect(wrapper.text()).toContain(
        layout === 'line' ? 'yesterday' : 'As of yesterday, 6:10 PM'
      );
    });

    it('nudge: the pin and the nudge for this layout', () => {
      const wrapper = mountCard('nudge', layout);
      expect(wrapper.find('.pin').exists()).toBe(true);
      expect(wrapper.text()).toContain(layout === 'line' ? 'weather.nudgeShort' : 'weather.nudge');
      expect(wrapper.find('svg.weather-glyph').exists()).toBe(false);
    });

    it('unavailable: the glyph-less unavailable line', () => {
      const wrapper = mountCard('unavailable', layout);
      expect(wrapper.text()).toContain(
        layout === 'line' ? 'weather.unavailableShort' : 'weather.unavailable'
      );
      if (layout !== 'line') expect(wrapper.text()).not.toContain('weather.unavailableShort');
      expect(wrapper.find('svg.weather-glyph').exists()).toBe(false);
    });
  });

  it('only the full card carries the three days and the high and low', () => {
    const full = mountCard('fresh', 'full');
    expect(full.find('.weather-outlook[data-variant="inline"]').exists()).toBe(true);
    expect(full.text()).toContain('H 68° L 51°');
    for (const layout of ['now', 'line'] as const) {
      const wrapper = mountCard('fresh', layout);
      expect(wrapper.find('.weather-outlook').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('H 68° L 51°');
    }
  });
});
