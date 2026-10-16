/**
 * WeatherGlyph renders the shared geometry with a colour role per part. jsdom applies no
 * stylesheet, so the mono and dark rules are checked against the component's own style block:
 * the point is that no `--wx-*` token can be added to the light set and forgotten in the dark
 * or mono sets.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import WeatherGlyph from '../WeatherGlyph.vue';
import source from '../WeatherGlyph.vue?raw';
import { WEATHER_GLYPH_PARTS } from '@/constants/weatherGlyphs';
import { WEATHER_GLYPHS } from '@/utils/weather/weatherCodes';

/** The `--wx-*` names and values declared in the first rule whose selector matches. */
const STYLE = source.slice(source.indexOf('<style'));

function tokensOf(selector: string): Map<string, string> {
  const at = STYLE.indexOf(`\n${selector} {`);
  expect(at).toBeGreaterThan(-1);
  const body = STYLE.slice(at, STYLE.indexOf('}', at));
  return new Map([...body.matchAll(/(--wx-[a-z]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
}

describe('WeatherGlyph', () => {
  it.each(WEATHER_GLYPHS)('renders %s with one role-classed shape per part', (kind) => {
    const wrapper = mount(WeatherGlyph, { props: { kind } });
    const svg = wrapper.get('svg');
    expect(svg.attributes('data-kind')).toBe(kind);
    expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    const shapes = wrapper.findAll('path, circle');
    expect(shapes).toHaveLength(WEATHER_GLYPH_PARTS[kind].length);
    for (const shape of shapes) expect(shape.classes().some((c) => c.startsWith('wx-'))).toBe(true);
  });

  it('is decorative', () => {
    const svg = mount(WeatherGlyph, { props: { kind: 'rain' } }).get('svg');
    expect(svg.attributes('aria-hidden')).toBe('true');
    expect(svg.attributes('focusable')).toBe('false');
  });

  it('sizes in rem from the nominal px size', () => {
    const svg = mount(WeatherGlyph, { props: { kind: 'sunny', size: 40 } }).get('svg');
    expect(svg.attributes('width')).toBe('2.5rem');
    expect(svg.attributes('height')).toBe('2.5rem');
  });

  it.each([
    [18, '2.1'],
    [22, '1.9'],
    [26, '1.9'],
    [40, '1.75'],
  ])('steps the root stroke at size %i to %s', (size, width) => {
    const svg = mount(WeatherGlyph, { props: { kind: 'cloudy', size } }).get('svg');
    expect(svg.attributes('stroke-width')).toBe(width);
  });

  it('keeps a part stroke override (the bolt outline)', () => {
    const bolt = mount(WeatherGlyph, { props: { kind: 'thunder' } }).get('path.wx-bolt');
    expect(bolt.attributes('stroke-width')).toBe('1.2');
  });

  it('adds the mono class only when asked', () => {
    expect(mount(WeatherGlyph, { props: { kind: 'snow' } }).classes()).not.toContain(
      'weather-glyph-mono'
    );
    expect(mount(WeatherGlyph, { props: { kind: 'snow', mono: true } }).classes()).toContain(
      'weather-glyph-mono'
    );
  });

  it('mono strips every fill and paints every stroke in currentColor', () => {
    const light = tokensOf('.weather-glyph');
    const mono = tokensOf('.weather-glyph-mono,\nhtml.dark .weather-glyph-mono');
    expect([...mono.keys()].sort()).toEqual([...light.keys()].sort());
    for (const [name, value] of mono) {
      const isFill = name === '--wx-fill' || name.endsWith('fill') || name === '--wx-bolt';
      expect(value).toBe(isFill ? 'transparent' : 'currentcolor');
    }
  });

  it('gives every light token a dark partner from the theme', () => {
    const light = tokensOf('.weather-glyph');
    const dark = tokensOf('html.dark .weather-glyph');
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
    for (const value of dark.values()) expect(value).toContain('var(--color-');
  });
});
