import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import WeatherOutlook from '../WeatherOutlook.vue';
import type { WeatherOutlookDay } from '@/types/weather';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const DAYS: WeatherOutlookDay[] = [
  { ymd: '2026-10-17', weekday: 'Sat', glyph: 'rain', high: '58°', low: '47°' },
  { ymd: '2026-10-18', weekday: 'Sun', glyph: 'partly', high: '61°', low: '45°' },
  { ymd: '2026-10-19', weekday: 'Mon', glyph: 'sunny', high: '64°', low: '44°' },
];

describe('WeatherOutlook', () => {
  it.each(['tiles', 'inline', 'night'] as const)('%s renders every day', (variant) => {
    const wrapper = mount(WeatherOutlook, { props: { days: DAYS, variant } });
    expect(wrapper.get('.weather-outlook').attributes('data-variant')).toBe(variant);
    expect(wrapper.findAll('svg.weather-glyph')).toHaveLength(3);
    for (const day of DAYS) {
      expect(wrapper.text()).toContain(day.high);
      expect(wrapper.text()).toContain(day.low);
    }
  });

  it('labels days by weekday on the tiles and the card', () => {
    for (const variant of ['tiles', 'inline'] as const) {
      const text = mount(WeatherOutlook, { props: { days: DAYS, variant } }).text();
      expect(text).toContain('Sat');
      expect(text).not.toContain('date.tomorrow');
    }
  });

  it('night names the first day Tomorrow and draws mono glyphs', () => {
    const wrapper = mount(WeatherOutlook, { props: { days: DAYS, variant: 'night' } });
    expect(wrapper.text()).toContain('date.tomorrow');
    expect(wrapper.text()).not.toContain('Sat');
    expect(wrapper.text()).toContain('Sun');
    for (const svg of wrapper.findAll('svg.weather-glyph')) {
      expect(svg.classes()).toContain('weather-glyph-mono');
    }
  });

  it('divides the card columns, not the first', () => {
    const cols = mount(WeatherOutlook, { props: { days: DAYS, variant: 'inline' } }).findAll(
      '.weather-outlook > div'
    );
    expect(cols[0]!.classes()).not.toContain('border-l');
    expect(cols[1]!.classes()).toContain('border-l');
    expect(cols[2]!.classes()).toContain('border-l');
  });

  it('tiles is one line per day with no painted tile', () => {
    const wrapper = mount(WeatherOutlook, { props: { days: DAYS, variant: 'tiles' } });
    const rows = wrapper.findAll('.weather-outlook > div');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.classes()).toEqual(expect.arrayContaining(['flex', 'items-center']));
      expect(r.classes()).not.toContain('flex-col');
      expect(r.classes().some((c) => c.startsWith('bg-') || c.includes(':bg-'))).toBe(false);
    }
    for (const svg of wrapper.findAll('svg.weather-glyph')) {
      expect(svg.classes()).not.toContain('weather-glyph-mono');
    }
  });

  it('renders nothing for an empty outlook', () => {
    const wrapper = mount(WeatherOutlook, { props: { days: [], variant: 'tiles' } });
    expect(wrapper.find('.weather-outlook').exists()).toBe(false);
  });
});
