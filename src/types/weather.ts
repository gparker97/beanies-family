/**
 * Weather (#134, ADR-043): runtime-only types. Nothing here is persisted in the family doc;
 * the one persisted shape, `WeatherPlace`, lives in `models.ts` beside the settings that hold
 * it. Only types live here: the `WeatherFetchError` class has behaviour, so it is declared in
 * `services/weather/openMeteo.ts` beside the code that throws it.
 */
import type { WeatherPlace } from './models';

export type { WeatherPlace, TemperatureUnit, WallWeatherStyle } from './models';

/** The nine glyph kinds. `night` is a clear night; `nightPartly` a partly cloudy one. */
export type WeatherGlyph =
  'sunny' | 'partly' | 'cloudy' | 'rain' | 'thunder' | 'snow' | 'fog' | 'night' | 'nightPartly';

/** One home-zone day of the forecast, Celsius. */
export interface WeatherDaily {
  /** `YYYY-MM-DD` in the family's home time zone (the provider's `daily.time`). */
  ymd: string;
  /** WMO weather code. */
  code: number;
  maxC: number;
  minC: number;
}

/**
 * One forecast answer as the device caches it (`services/weather/weatherCache.ts`). The
 * service returns `fetchedAt`, `current` and `daily`; the store stamps `v`, `familyId` and
 * `placeKey`, so cache identity has one owner.
 */
export interface WeatherReading {
  v: 1;
  familyId: string;
  /** `"lat,lon|zone"` from `placeKeyOf`: a town or home-zone change is a cache miss. */
  placeKey: string;
  /** Epoch ms on this device's clock when the answer arrived. */
  fetchedAt: number;
  current: { tempC: number; code: number; isDay: boolean };
  /** Today plus the next days, indexed by `ymd`, never by position. */
  daily: WeatherDaily[];
}

/** The provider's observation, before the store stamps its identity. */
export type WeatherObservation = Pick<WeatherReading, 'fetchedAt' | 'current' | 'daily'>;

/**
 * How old a reading is: `fresh` under 1h, `aged` 1 to 12h, `old` over 12h (today's entry
 * still exists), `none` (no reading, or no daily entry for the home-zone today).
 */
export type WeatherFreshness = 'fresh' | 'aged' | 'old' | 'none';

/** Every way a provider call can fail. `aborted` = the caller moved on (never logged or shown). */
export type WeatherErrorCode =
  'aborted' | 'network' | 'timeout' | 'http_4xx' | 'http_5xx' | 'rate_limited' | 'parse';

/** A home-town search, as a value: the field renders its states from it with no try/catch. */
export type WeatherSearchResult =
  { ok: true; places: WeatherPlace[] } | { ok: false; code: WeatherErrorCode };

/** One day of the outlook, ready to render. */
export interface WeatherOutlookDay {
  ymd: string;
  /** `formatUiDate(ymd, lang, { weekday: 'short' })`. */
  weekday: string;
  glyph: WeatherGlyph;
  high: string;
  low: string;
}

/** The `reading` state of the atom: everything a surface draws, already formatted. */
export interface WeatherAtomReading {
  state: 'reading';
  freshness: Exclude<WeatherFreshness, 'none'>;
  glyph: WeatherGlyph;
  /** "55°", or null when the reading is `old` (the surface shows `weather.todayHighLow`). */
  temp: string | null;
  /** The translated condition word (`weather.condition.<glyph>`). */
  condition: string;
  /** Today's (home-zone) high and low. */
  high: string;
  low: string;
  /** The full age line (wall card, night screen, desktop pill), or null under 1h. */
  ageText: string | null;
  /** The clipped age (one-line card, strip cell), or null under 1h. */
  ageShort: string | null;
  /** True when the temperature is drawn in the softer ink (an `aged` reading). */
  soft: boolean;
  /** The next home-zone day's low (the overnight minimum); today's low when none is cached. */
  tonightLow: string;
  /** The days after today, at most three. */
  outlook: WeatherOutlookDay[];
  placeName: string;
}

/**
 * The one view model every surface renders a cut of. `null` (in the store's `atom`) means
 * "draw nothing": weather off, the doc not ready, or the first fetch still in flight.
 */
export type WeatherAtom =
  | WeatherAtomReading
  | { state: 'nudge' }
  /** A town is set but there is nothing to show. `errorCode` is for tests and devtools only. */
  | { state: 'unavailable'; errorCode: WeatherErrorCode | null };

/** The store's failure record: one assignment clears or resets it. */
export interface WeatherFailure {
  code: WeatherErrorCode;
  count: number;
  /** Epoch ms before which the store does not ask again (the backoff). */
  until: number;
}

/** What started a refresh. Rides the `kind` context key on `weather_fetch*`. */
export type WeatherRefreshKind = 'tick' | 'foreground' | 'settings' | 'online';
