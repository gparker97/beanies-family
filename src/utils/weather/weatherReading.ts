/**
 * What a weather reading means NOW (#134, ADR-043): freshness, the home-zone day, the
 * formatted temperatures and the one view model every surface renders a cut of
 * (`buildWeatherAtom`). Pure: `t`, `lang`, `online` and the clock are passed in, so the
 * store's `atom` computed never logs and every rule is testable on its own.
 *
 * "Should the store call the provider now" is a different question and lives in
 * `weatherRefresh.ts`, so a change to the cadence never touches the display rules.
 *
 * The staleness thresholds are defined ONCE, here. Phase 2's widget snapshot carries them as
 * timestamps (`ageFrom`, `currentUntil`), so native never holds a copy.
 */
import type { LanguageCode, TemperatureUnit, WeatherPlace } from '@/types/models';
import type {
  WeatherAtom,
  WeatherDaily,
  WeatherErrorCode,
  WeatherFreshness,
  WeatherOutlookDay,
  WeatherReading,
} from '@/types/weather';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { wallClockInZone } from '@/utils/timeZone';
import { addDaysYmd, formatRelativeTime, toDateInputValue } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatUiDate, formatUiTime, uiLocale } from '@/utils/uiLocale';
import { glyphFor } from './weatherCodes';

const MINUTE_MS = 60_000;
/** Under this age a reading shows no age line. */
export const AGE_SHOW_MS = 60 * MINUTE_MS;
/** From this age the current temperature is hidden and today's high/low stay. */
export const CURRENT_MAX_MS = 12 * 60 * MINUTE_MS;
/** The cap on `weather_age_min` (a week), so the telemetry value stays a small integer. */
export const WEATHER_AGE_MIN_CAP = 7 * 24 * 60;

/** Countries whose default unit is Fahrenheit. Every other (or unset) country is Celsius. */
export const FAHRENHEIT_COUNTRIES: readonly string[] = ['US'];

/**
 * How old a reading is. `hasToday` false (no daily entry for the home-zone today, which only
 * happens after about 4 days without a refresh) or no reading at all is `none`. A clock that
 * went backwards reads as fresh rather than as an impossible negative age.
 */
export function freshnessOf(
  fetchedAt: number | null | undefined,
  now: number,
  hasToday = true
): WeatherFreshness {
  if (fetchedAt === null || fetchedAt === undefined || !hasToday) return 'none';
  const age = now - fetchedAt;
  if (age < AGE_SHOW_MS) return 'fresh';
  if (age < CURRENT_MAX_MS) return 'aged';
  return 'old';
}

/** The age in whole minutes for `weather_age_min`: -1 when there is no reading, capped at a week. */
export function weatherAgeMin(fetchedAt: number | null | undefined, now: number): number {
  if (fetchedAt === null || fetchedAt === undefined) return -1;
  const minutes = Math.floor((now - fetchedAt) / MINUTE_MS);
  return Math.min(WEATHER_AGE_MIN_CAP, Math.max(0, minutes));
}

/**
 * The family home zone's date at `now`. Falls back to this device's date when the engine does
 * not know the zone (`wallClockInZone` throws): the device day is the best guess left, and a
 * wall at home shares the zone anyway.
 */
export function homeYmdAt(now: number, zone: string): string {
  try {
    return wallClockInZone(new Date(now), zone).ymd;
  } catch {
    return toDateInputValue(new Date(now));
  }
}

/** The daily entry for `ymd`, by date, never by position (a cached reading rolls at midnight). */
export function todayEntry(daily: readonly WeatherDaily[], ymd: string): WeatherDaily | undefined {
  return daily.find((d) => d.ymd === ymd);
}

/** The first `n` daily entries AFTER `todayYmd`, in date order. */
export function outlook(daily: readonly WeatherDaily[], todayYmd: string, n = 3): WeatherDaily[] {
  return daily
    .filter((d) => d.ymd > todayYmd)
    .sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0))
    .slice(0, n);
}

/** "55°". Celsius is always fetched, so a unit switch needs no refetch. Never prints the unit. */
export function formatTemp(c: number, unit: TemperatureUnit): string {
  const value = Math.round(unit === 'F' ? (c * 9) / 5 + 32 : c);
  // `Math.round(-0.4)` is -0; a template literal already prints it as "0".
  return `${value}°`;
}

/** The family's default unit: Fahrenheit for `FAHRENHEIT_COUNTRIES`, Celsius otherwise. */
export function defaultUnitFor(country: string | null | undefined): TemperatureUnit {
  return country && FAHRENHEIT_COUNTRIES.includes(country.toUpperCase()) ? 'F' : 'C';
}

export interface WeatherAtomInput {
  /** The family's Show Weather switch. */
  enabled: boolean;
  /** The family doc is loaded for display (`isDocLoaded`), so the settings are real. */
  docReady: boolean;
  place: WeatherPlace | null;
  /** The reading for THIS place and family (the store only ever holds that one). */
  reading: WeatherReading | null;
  /** A forecast request is in flight right now. */
  fetching: boolean;
  failure: { code: WeatherErrorCode } | null;
  online: boolean;
  now: number;
  /** The family home time zone (IANA). */
  zone: string;
  unit: TemperatureUnit;
  lang: LanguageCode;
  t: (key: UIStringKey) => string;
}

/**
 * The atom, by an ordered rule list where the first match wins, so every input combination
 * has exactly one answer:
 *   1. `null`: weather off; the doc not ready (a booting wall never flashes the nudge).
 *   2. `nudge`: on, no place.
 *   3. `reading`: on, place set, freshness `fresh`, `aged` or `old`.
 *   4. `null`: no usable reading, a fetch in flight and no failure yet (the first attempt is
 *      a brief blank, never an error).
 *   5. `unavailable`: everything else (a failed fetch, a backoff, offline with no cache, a
 *      reading with no entry for today, or a retry in flight after a failure, which stays
 *      `unavailable` so the card does not blink out on every retry).
 */
export function buildWeatherAtom(input: WeatherAtomInput): WeatherAtom | null {
  if (!input.enabled || !input.docReady) return null;
  if (!input.place) return { state: 'nudge' };

  const { reading, now, zone, unit, t, lang } = input;
  const todayYmd = homeYmdAt(now, zone);
  const today = reading ? todayEntry(reading.daily, todayYmd) : undefined;
  const freshness = freshnessOf(reading?.fetchedAt, now, today !== undefined);

  if (reading && today && freshness !== 'none') {
    // An old reading's "current" conditions are half a day stale, so its glyph and word follow
    // today's daily code (the line it sits on is "Today H L"), not the stale observation.
    const glyph =
      freshness === 'old'
        ? glyphFor(today.code, true).glyph
        : glyphFor(reading.current.code, reading.current.isDay).glyph;
    const days = outlook(reading.daily, todayYmd, 3);
    const tonight = days[0]?.minC ?? today.minC;
    const age = ageLines(freshness, reading.fetchedAt, now, input.online, lang, t);
    return {
      state: 'reading',
      freshness,
      glyph,
      temp: freshness === 'old' ? null : formatTemp(reading.current.tempC, unit),
      condition: t(conditionKey(glyph)),
      high: formatTemp(today.maxC, unit),
      low: formatTemp(today.minC, unit),
      ageText: age.text,
      ageShort: age.short,
      soft: freshness === 'aged',
      tonightLow: formatTemp(tonight, unit),
      outlook: days.map((d): WeatherOutlookDay => ({
        ymd: d.ymd,
        weekday: formatUiDate(d.ymd, lang, { weekday: 'short' }),
        glyph: glyphFor(d.code, true).glyph,
        high: formatTemp(d.maxC, unit),
        low: formatTemp(d.minC, unit),
      })),
      placeName: input.place.name,
    };
  }

  if (input.fetching && input.failure === null) return null;
  return { state: 'unavailable', errorCode: input.failure?.code ?? null };
}

/** The translation key for a glyph's condition word. */
export function conditionKey(glyph: string): UIStringKey {
  return `weather.condition.${glyph}` as UIStringKey;
}

/**
 * The age lines, one whole-sentence key per case so no translated fragment is spliced into
 * another:
 *   - fresh: none;
 *   - aged and offline: "Offline, as of {time}" / "offline";
 *   - aged and online: "As of {ago}" / "{ago}" (`Intl.RelativeTimeFormat` wording);
 *   - old, whatever the connection, keyed on the reading's device-local day: the same day
 *     "As of {time}", yesterday "As of yesterday, {time}", earlier "As of {day}, {time}";
 *     the short form is "{ago}".
 */
function ageLines(
  freshness: Exclude<WeatherFreshness, 'none'>,
  fetchedAt: number,
  now: number,
  online: boolean,
  lang: LanguageCode,
  t: (key: UIStringKey) => string
): { text: string | null; short: string | null } {
  if (freshness === 'fresh') return { text: null, short: null };
  const time = formatUiTime(fetchedAt, lang);
  const ago = formatRelativeTime(new Date(fetchedAt).toISOString(), uiLocale(lang));
  const short = fillTemplate(t('weather.asOfShort'), { ago });
  if (freshness === 'aged') {
    if (!online) {
      return {
        text: fillTemplate(t('weather.offlineAsOf'), { time }),
        short: t('weather.offlineShort'),
      };
    }
    return { text: fillTemplate(t('weather.asOf'), { ago }), short };
  }
  const readingDay = toDateInputValue(new Date(fetchedAt));
  const todayLocal = toDateInputValue(new Date(now));
  if (readingDay === todayLocal) {
    return { text: fillTemplate(t('weather.asOfTime'), { time }), short };
  }
  if (readingDay === addDaysYmd(todayLocal, -1)) {
    return { text: fillTemplate(t('weather.asOfYesterday'), { time }), short };
  }
  const day = formatUiDate(readingDay, lang, { weekday: 'long' });
  return { text: fillTemplate(t('weather.asOfDayTime'), { day, time }), short };
}
