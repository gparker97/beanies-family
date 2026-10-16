/**
 * Weather atoms for the wall's component tests (#134): one per state the wall draws, already
 * formatted the way `buildWeatherAtom` formats them, so the tests read the rendering and not
 * the reading rules (those are pinned in `weatherReading.test.ts`).
 */
import type { WeatherAtom, WeatherAtomReading } from '@/types/weather';

const OUTLOOK: WeatherAtomReading['outlook'] = [
  { ymd: '2026-10-17', weekday: 'Sat', glyph: 'rain', high: '58°', low: '47°' },
  { ymd: '2026-10-18', weekday: 'Sun', glyph: 'partly', high: '61°', low: '45°' },
  { ymd: '2026-10-19', weekday: 'Mon', glyph: 'sunny', high: '64°', low: '44°' },
];

const BASE: WeatherAtomReading = {
  state: 'reading',
  freshness: 'fresh',
  glyph: 'partly',
  temp: '66°',
  condition: 'Partly cloudy',
  high: '68°',
  low: '51°',
  highLow: 'H 68° L 51°',
  todayHighLow: 'Today H 68° L 51°',
  ageText: null,
  ageShort: null,
  soft: false,
  tonightLow: '47°',
  outlook: OUTLOOK,
  placeName: 'Portland',
};

export const ATOMS = {
  fresh: BASE,
  aged: {
    ...BASE,
    freshness: 'aged',
    ageText: 'As of 3 hours ago',
    ageShort: '3 hours ago',
    soft: true,
  },
  old: {
    ...BASE,
    freshness: 'old',
    temp: null,
    ageText: 'As of yesterday, 6:10 PM',
    ageShort: 'yesterday',
  },
  nudge: { state: 'nudge' },
  unavailable: { state: 'unavailable', errorCode: 'network' },
} satisfies Record<string, WeatherAtom>;

export type AtomCase = keyof typeof ATOMS;
export const ATOM_CASES = Object.keys(ATOMS) as AtomCase[];
