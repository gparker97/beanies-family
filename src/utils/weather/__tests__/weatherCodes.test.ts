import { describe, expect, it } from 'vitest';
import { WEATHER_GLYPHS, WMO_TO_GLYPH, glyphFor } from '../weatherCodes';
import type { WeatherGlyph } from '@/types/weather';

/** The plan's table, row by row (2026-10-16), so a change to the mapping is deliberate. */
const TABLE: Array<[number[], WeatherGlyph, WeatherGlyph]> = [
  [[0, 1], 'sunny', 'night'],
  [[2], 'partly', 'nightPartly'],
  [[3], 'cloudy', 'cloudy'],
  [[45, 48], 'fog', 'fog'],
  [[51, 53, 55, 56, 57], 'rain', 'rain'],
  [[61, 63, 65, 66, 67], 'rain', 'rain'],
  [[80, 81, 82], 'rain', 'rain'],
  [[71, 73, 75, 77], 'snow', 'snow'],
  [[85, 86], 'snow', 'snow'],
  [[95, 96, 99], 'thunder', 'thunder'],
];

describe('glyphFor', () => {
  for (const [codes, day, night] of TABLE) {
    for (const code of codes) {
      it(`WMO ${code}: ${day} by day, ${night} at night`, () => {
        expect(glyphFor(code, true)).toEqual({ glyph: day, known: true });
        expect(glyphFor(code, false)).toEqual({ glyph: night, known: true });
      });
    }
  }

  it('maps exactly the codes in the table and nothing else', () => {
    const tableCodes = TABLE.flatMap(([codes]) => codes).sort((a, b) => a - b);
    const mapped = Object.keys(WMO_TO_GLYPH)
      .map(Number)
      .sort((a, b) => a - b);
    expect(mapped).toEqual(tableCodes);
  });

  it.each([4, 50, 100, -1, 2.5, Number.NaN])(
    'an unknown code (%s) is a neutral cloud, flagged unknown, day or night',
    (code) => {
      expect(glyphFor(code, true)).toEqual({ glyph: 'cloudy', known: false });
      expect(glyphFor(code, false)).toEqual({ glyph: 'cloudy', known: false });
    }
  );

  it('every glyph the table can produce is one of the nine kinds', () => {
    const produced = new Set(TABLE.flatMap(([, d, n]) => [d, n]));
    for (const g of produced) expect(WEATHER_GLYPHS).toContain(g);
    expect(WEATHER_GLYPHS).toHaveLength(9);
  });
});
