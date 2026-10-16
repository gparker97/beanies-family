import { mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import NookWeatherPill from '../NookWeatherPill.vue';
import { REGION_HOLIDAYS_OPEN } from '@/constants/settingsDeepLinks';
import { useTranslationStore } from '@/stores/translationStore';
import type { WeatherAtom, WeatherAtomReading } from '@/types/weather';

function reading(overrides: Partial<WeatherAtomReading> = {}): WeatherAtomReading {
  return {
    state: 'reading',
    freshness: 'fresh',
    glyph: 'partly',
    temp: '66°',
    condition: 'Partly cloudy',
    high: '68°',
    low: '51°',
    ageText: null,
    ageShort: null,
    soft: false,
    tonightLow: '50°',
    outlook: [
      { ymd: '2026-10-17', weekday: 'Sat', glyph: 'rain', high: '58°', low: '47°' },
      { ymd: '2026-10-18', weekday: 'Sun', glyph: 'sunny', high: '61°', low: '45°' },
      { ymd: '2026-10-19', weekday: 'Mon', glyph: 'cloudy', high: '60°', low: '44°' },
    ],
    placeName: 'Portland',
    ...overrides,
  };
}

function mountPill(atom: WeatherAtom) {
  return mount(NookWeatherPill, {
    props: { atom },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

describe('NookWeatherPill', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useTranslationStore().setBeanieMode(false);
  });

  it('shows a fresh reading: temperature, condition, high/low and the three days', () => {
    const wrapper = mountPill(reading());
    const temp = wrapper.get('[data-testid="nook-weather-temp"]');
    expect(temp.text()).toBe('66°');
    expect(temp.classes()).toEqual(expect.arrayContaining(['text-secondary-500', 'dark:text-ink']));
    expect(wrapper.text()).toContain('Partly cloudy');
    expect(wrapper.get('[data-testid="nook-weather-sub"]').text()).toBe('H 68° L 51°');
    expect(wrapper.findAll('.weather-outlook > div')).toHaveLength(3);
    expect(wrapper.text()).toContain('Sat');
  });

  it('draws an aged temperature in the soft ink with its age under the condition', () => {
    const wrapper = mountPill(
      reading({ freshness: 'aged', soft: true, ageText: 'As of 3 hours ago' })
    );
    expect(wrapper.get('[data-testid="nook-weather-temp"]').classes()).toEqual(
      expect.arrayContaining(['text-secondary-400', 'dark:text-ink-soft'])
    );
    const sub = wrapper.get('[data-testid="nook-weather-sub"]');
    expect(sub.text()).toBe('As of 3 hours ago');
    expect(sub.classes()).toContain('dark:text-ink-faint');
  });

  it("hides an old reading's temperature and leads with today's high and low", () => {
    const wrapper = mountPill(
      reading({ freshness: 'old', temp: null, ageText: 'As of yesterday, 6:10 PM' })
    );
    expect(wrapper.find('[data-testid="nook-weather-temp"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Today H 68° L 51°');
    expect(wrapper.get('[data-testid="nook-weather-sub"]').text()).toBe('As of yesterday, 6:10 PM');
  });

  it('hides the outlook first on a narrow greeting row', () => {
    const outlook = mountPill(reading()).get('[data-testid="nook-weather-outlook"]');
    expect(outlook.classes()).toEqual(expect.arrayContaining(['hidden', '@3xl:block']));
  });

  it('never wraps and paints a dark partner for its background', () => {
    const pill = mountPill(reading()).get('[data-testid="nook-weather-pill"]');
    expect(pill.classes()).toEqual(
      expect.arrayContaining([
        'flex-none',
        'whitespace-nowrap',
        'bg-white',
        'dark:bg-surface-raised',
      ])
    );
  });

  it('nudges to Region & Holidays with no home town', () => {
    const wrapper = mountPill({ state: 'nudge' });
    expect(wrapper.text()).toBe('Weather: set your home town');
    const link = wrapper.getComponent(RouterLinkStub);
    expect(link.props('to')).toEqual({
      path: '/settings',
      query: { open: REGION_HOLIDAYS_OPEN },
    });
    expect(link.text()).toBe('set your home town');
    expect(link.classes()).toEqual(
      expect.arrayContaining(['text-primary-500', 'dark:text-accent-lift'])
    );
  });

  it('says so when a town is set but there is nothing to show', () => {
    const wrapper = mountPill({ state: 'unavailable', errorCode: 'http_5xx' });
    expect(wrapper.text()).toBe("Weather is unavailable right now. We'll keep trying.");
    expect(wrapper.find('[data-testid="nook-weather-temp"]').exists()).toBe(false);
  });
});
