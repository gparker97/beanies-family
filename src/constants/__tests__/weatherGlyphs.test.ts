/**
 * The glyph geometry is plain JSON (shared with the Phase 2 native generator), so nothing at
 * compile time stops a glyph going missing or a part carrying a role the renderer has no rule
 * for. These cases are that guard.
 */
import { describe, it, expect } from 'vitest';
import raw from '../weatherGlyphs.json';
import {
  WEATHER_GLYPH_PARTS,
  WEATHER_GLYPH_ROLES,
  WEATHER_GLYPH_VIEWBOX,
  weatherGlyphStrokeWidth,
} from '../weatherGlyphs';
import { WEATHER_GLYPHS } from '@/utils/weather/weatherCodes';

describe('weatherGlyphs geometry', () => {
  it('has geometry for every WeatherGlyph and nothing else', () => {
    expect(Object.keys(raw.glyphs).sort()).toEqual([...WEATHER_GLYPHS].sort());
    for (const kind of WEATHER_GLYPHS) {
      expect(WEATHER_GLYPH_PARTS[kind].length).toBeGreaterThan(0);
    }
  });

  it('uses only known roles, and every part draws exactly one shape', () => {
    const roles = new Set<string>(WEATHER_GLYPH_ROLES);
    for (const kind of WEATHER_GLYPHS) {
      for (const part of WEATHER_GLYPH_PARTS[kind]) {
        expect(roles.has(part.role)).toBe(true);
        expect(Boolean(part.d) !== Boolean(part.circle)).toBe(true);
        if (part.d) expect(part.d).toMatch(/^M[\d.\sMLHVAZlhvz-]+$/i);
        if (part.circle) {
          expect(Number.isFinite(part.circle.cx)).toBe(true);
          expect(Number.isFinite(part.circle.cy)).toBe(true);
          expect(part.circle.r).toBeGreaterThan(0);
        }
        if (part.strokeWidth !== undefined) expect(part.strokeWidth).toBeGreaterThan(0);
      }
    }
  });

  it('draws on the 24 x 24 box', () => {
    expect(WEATHER_GLYPH_VIEWBOX).toBe('0 0 24 24');
  });

  it('steps the stroke thinner as the glyph grows (the mockup rule)', () => {
    expect(weatherGlyphStrokeWidth(14)).toBe(2.1);
    expect(weatherGlyphStrokeWidth(18)).toBe(2.1);
    expect(weatherGlyphStrokeWidth(19)).toBe(1.9);
    expect(weatherGlyphStrokeWidth(26)).toBe(1.9);
    expect(weatherGlyphStrokeWidth(27)).toBe(1.75);
    expect(weatherGlyphStrokeWidth(80)).toBe(1.75);
  });
});
