/**
 * The night screen (#134): the weather block is the full treatment in the night's one dim
 * ink, and the hint now clears AA (it was `#63798f`, 3.65:1 on `#16202C`).
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import WallNightScreen from '../WallNightScreen.vue';
import type { WeatherAtom } from '@/types/weather';
import { ATOMS } from './wallWeatherFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const DIM = 'text-[#8ea3b8]';

function mountNight(weather?: WeatherAtom | null) {
  return mount(WallNightScreen, {
    props: { time: '10:48 PM', date: 'Friday, October 16', tomorrowCount: 3, weather },
    global: { stubs: { BeanieIcon: { template: '<i class="pin" />' } } },
  });
}

describe('WallNightScreen weather', () => {
  it('draws now, tonight, and the next three days with Tomorrow first', () => {
    const wrapper = mountNight(ATOMS.fresh);
    const block = wrapper.get('.wall-night-weather');
    expect(block.classes()).toContain(DIM);
    expect(block.get('.wall-night-wx-temp').text()).toBe('66°');
    expect(block.text()).toContain('weather.night.nowLine');
    const outlook = block.get('.weather-outlook[data-variant="night"]');
    expect(outlook.text().indexOf('date.tomorrow')).toBe(0);
    expect(outlook.text()).not.toContain('Sat');
  });

  it('draws every glyph mono, so all of it takes the dim ink', () => {
    const glyphs = mountNight(ATOMS.fresh).findAll('.wall-night-weather svg.weather-glyph');
    expect(glyphs.length).toBe(4);
    for (const glyph of glyphs) expect(glyph.classes()).toContain('weather-glyph-mono');
  });

  it('places the block between the date and the hint', () => {
    const html = mountNight(ATOMS.fresh).html();
    const date = html.indexOf('wall-night-date');
    const weather = html.indexOf('wall-night-weather');
    const hint = html.indexOf('wall-night-hint');
    expect(date).toBeLessThan(weather);
    expect(weather).toBeLessThan(hint);
  });

  it('shows the age when stale, and today\'s high/low in place of "now" once the reading is old', () => {
    expect(mountNight(ATOMS.aged).text()).toContain('As of 3 hours ago');
    const old = mountNight(ATOMS.old);
    expect(old.find('.wall-night-wx-temp').exists()).toBe(false);
    expect(old.get('.wall-night-wx-cond').text()).toBe('Today H 68° L 51°');
    expect(old.text()).not.toContain('weather.night.nowLine');
    expect(old.text()).toContain('As of yesterday, 6:10 PM');
    expect(old.find('.weather-outlook').exists()).toBe(true);
  });

  it('says so when weather is unavailable, in the same ink', () => {
    const block = mountNight(ATOMS.unavailable).get('.wall-night-weather');
    expect(block.classes()).toContain(DIM);
    expect(block.text()).toContain('weather.unavailable');
    expect(block.find('svg.weather-glyph').exists()).toBe(false);
  });

  it('nudges with the pin when no home town is set', () => {
    const block = mountNight(ATOMS.nudge).get('.wall-night-weather');
    expect(block.text()).toContain('weather.nudge');
    expect(block.find('.pin').exists()).toBe(true);
  });

  it.each([null, undefined])('draws no weather for %s (wall Off, or the family switch)', (w) => {
    const wrapper = mountNight(w);
    expect(wrapper.find('.wall-night-weather').exists()).toBe(false);
    expect(wrapper.text()).toContain('wall.night.wake');
  });

  it('draws the hint in the dim ink that clears AA, not the old #63798f', () => {
    const wrapper = mountNight(null);
    expect(wrapper.get('.wall-night-hint').classes()).toContain(DIM);
    expect(wrapper.html()).not.toContain('63798f');
  });
});
