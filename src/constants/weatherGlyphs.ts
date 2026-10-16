/**
 * Weather glyph geometry (#134, ADR-043), typed. The data lives in `weatherGlyphs.json` so the
 * Phase 2 native asset generator (plain Node, no TS loader, no `@/` alias) reads the very same
 * file; this module only gives it types. `WeatherGlyph.vue` is the web renderer.
 *
 * A glyph is a list of parts drawn in order on a 24 x 24 box. Each part has a colour ROLE, never
 * a colour: the renderer maps a role to a `--wx-*` custom property (light and dark), and the
 * native generator maps it to its own palette.
 */
import type { WeatherGlyph } from '@/types/weather';
import data from './weatherGlyphs.json';

/** Every colour role a part can carry. The renderer has one CSS rule per role. */
export const WEATHER_GLYPH_ROLES = [
  'ink',
  'sun',
  'sunRays',
  'water',
  'bolt',
  'snow',
  'fog',
  'moon',
  'star',
] as const;

export type WeatherGlyphRole = (typeof WEATHER_GLYPH_ROLES)[number];

/** One drawn part: a path (`d`) or a circle, in the 24 x 24 box. */
export interface WeatherGlyphPart {
  role: WeatherGlyphRole;
  d?: string;
  circle?: { cx: number; cy: number; r: number };
  /** SVG transform applied to this part only. */
  transform?: string;
  /** Overrides the size-stepped root stroke width for this part (user units). */
  strokeWidth?: number;
}

/** Root stroke width by rendered size: the first step whose `maxSize` (px) is not exceeded. */
export interface WeatherGlyphStrokeStep {
  /** Inclusive upper bound in px; `null` = no bound (the last step). */
  maxSize: number | null;
  width: number;
}

interface WeatherGlyphData {
  viewBox: string;
  strokeSteps: WeatherGlyphStrokeStep[];
  glyphs: Record<WeatherGlyph, WeatherGlyphPart[]>;
}

const typed = data as WeatherGlyphData;

export const WEATHER_GLYPH_VIEWBOX: string = typed.viewBox;
export const WEATHER_GLYPH_STROKE_STEPS: readonly WeatherGlyphStrokeStep[] = typed.strokeSteps;
export const WEATHER_GLYPH_PARTS: Readonly<Record<WeatherGlyph, readonly WeatherGlyphPart[]>> =
  typed.glyphs;

/** The root stroke width for a glyph drawn at `sizePx` (thinner as it grows, like the mockup). */
export function weatherGlyphStrokeWidth(sizePx: number): number {
  const step = WEATHER_GLYPH_STROKE_STEPS.find((s) => s.maxSize === null || sizePx <= s.maxSize);
  return step?.width ?? 1.75;
}
