/**
 * WMO weather code to glyph (#134, ADR-043). Pure: an unknown code returns `known: false`
 * and the store (the only caller with a logger) emits `weather_unknown_code`, so this util
 * never imports telemetry.
 *
 * Night variants apply to the CURRENT reading only (`is_day` = 0). Daily outlook glyphs
 * always use the day mapping.
 */
import type { WeatherGlyph } from '@/types/weather';

/** Every glyph kind, in display order. The single runtime list (geometry tests, generators). */
export const WEATHER_GLYPHS: readonly WeatherGlyph[] = [
  'sunny',
  'partly',
  'cloudy',
  'rain',
  'thunder',
  'snow',
  'fog',
  'night',
  'nightPartly',
];

/** WMO code to the DAY glyph. Codes not listed here are unknown. */
export const WMO_TO_GLYPH: Readonly<Record<number, WeatherGlyph>> = Object.freeze({
  0: 'sunny', // clear
  1: 'sunny', // mainly clear
  2: 'partly', // partly cloudy
  3: 'cloudy', // overcast
  45: 'fog', // fog
  48: 'fog', // depositing rime fog
  51: 'rain', // drizzle: light, moderate, dense
  53: 'rain',
  55: 'rain',
  56: 'rain', // freezing drizzle
  57: 'rain',
  61: 'rain', // rain: slight, moderate, heavy
  63: 'rain',
  65: 'rain',
  66: 'rain', // freezing rain
  67: 'rain',
  80: 'rain', // rain showers
  81: 'rain',
  82: 'rain',
  71: 'snow', // snow fall
  73: 'snow',
  75: 'snow',
  77: 'snow', // snow grains
  85: 'snow', // snow showers
  86: 'snow',
  95: 'thunder', // thunderstorm
  96: 'thunder', // thunderstorm with hail
  99: 'thunder',
});

/** The glyphs that change at night, and what they become. Everything else stays. */
const NIGHT_GLYPH: Partial<Record<WeatherGlyph, WeatherGlyph>> = {
  sunny: 'night',
  partly: 'nightPartly',
};

/** The glyph for an unknown code: a neutral cloud rather than a guess at sun or rain. */
const UNKNOWN_GLYPH: WeatherGlyph = 'cloudy';

/**
 * The glyph for a WMO code. `isDay` false picks the night variant (clear night, partly
 * cloudy night); pass `true` for daily outlook entries.
 */
export function glyphFor(code: number, isDay: boolean): { glyph: WeatherGlyph; known: boolean } {
  const day = Object.prototype.hasOwnProperty.call(WMO_TO_GLYPH, code)
    ? WMO_TO_GLYPH[code]
    : undefined;
  if (!day) return { glyph: UNKNOWN_GLYPH, known: false };
  return { glyph: (!isDay && NIGHT_GLYPH[day]) || day, known: true };
}
