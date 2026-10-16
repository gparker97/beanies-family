import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGE_SHOW_MS,
  CURRENT_MAX_MS,
  buildWeatherAtom,
  defaultUnitFor,
  formatTemp,
  freshnessOf,
  homeYmdAt,
  outlook,
  todayEntry,
  weatherAgeMin,
  type WeatherAtomInput,
} from '../weatherReading';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';
import { ZH_STRINGS } from '@/services/translation/zh';
import { addDaysYmd } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatUiTime } from '@/utils/uiLocale';
import type { WeatherPlace } from '@/types/models';
import type { WeatherAtomReading, WeatherDaily, WeatherReading } from '@/types/weather';
import portlandForecast from './fixtures/forecast-portland-or.json';

const MIN = 60_000;
const HOUR = 60 * MIN;
const LA = 'America/Los_Angeles';
const AKL = 'Pacific/Auckland';
const tEn = (k: UIStringKey) => UI_STRINGS[k];
const tZh = (k: UIStringKey) => ZH_STRINGS[k];
/** `Intl` may use a narrow no-break space before AM/PM; compare on plain spaces. */
const norm = (s: string | null) => (s === null ? null : s.replace(/\s/g, ' '));

const PORTLAND: WeatherPlace = {
  id: 5746545,
  name: 'Portland',
  admin1: 'Oregon',
  country: 'United States',
  countryCode: 'US',
  lat: 45.52,
  lon: -122.68,
};

/** The fixture as the store would cache it (fetched at LA 23:00 on Oct 15). */
function portlandReading(fetchedAt: number): WeatherReading {
  const d = portlandForecast.daily;
  return {
    v: 1,
    familyId: 'fam',
    placeKey: 'k',
    fetchedAt,
    current: {
      tempC: portlandForecast.current.temperature_2m,
      code: portlandForecast.current.weather_code,
      isDay: portlandForecast.current.is_day === 1,
    },
    daily: d.time.map((ymd, i) => ({
      ymd,
      code: d.weather_code[i]!,
      maxC: d.temperature_2m_max[i]!,
      minC: d.temperature_2m_min[i]!,
    })),
  };
}

/** A reading whose daily entries surround the home-zone day of `now`, whatever the host TZ. */
function readingAround(now: number, fetchedAt: number, zone = LA): WeatherReading {
  const today = homeYmdAt(now, zone);
  const daily: WeatherDaily[] = [-3, -2, -1, 0, 1, 2, 3, 4].map((offset, i) => ({
    ymd: addDaysYmd(today, offset),
    code: [61, 3, 2, 0, 3, 61, 71, 95][i]!,
    maxC: 10 + i,
    minC: i,
  }));
  return {
    v: 1,
    familyId: 'fam',
    placeKey: 'k',
    fetchedAt,
    current: { tempC: 12.6, code: 61, isDay: true },
    daily,
  };
}

function input(over: Partial<WeatherAtomInput>): WeatherAtomInput {
  return {
    enabled: true,
    docReady: true,
    place: PORTLAND,
    reading: null,
    fetching: false,
    failure: null,
    online: true,
    now: Date.now(),
    zone: LA,
    unit: 'C',
    lang: 'en',
    t: tEn,
    ...over,
  };
}

function asReading(atom: ReturnType<typeof buildWeatherAtom>): WeatherAtomReading {
  expect(atom?.state).toBe('reading');
  return atom as WeatherAtomReading;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('freshnessOf', () => {
  const now = 1_800_000_000_000;
  it('is fresh under an hour and aged from the hour (59/60 min)', () => {
    expect(freshnessOf(now - 59 * MIN, now)).toBe('fresh');
    expect(freshnessOf(now - AGE_SHOW_MS, now)).toBe('aged');
  });

  it('is aged under 12 hours and old from 12 hours', () => {
    expect(freshnessOf(now - CURRENT_MAX_MS + 1, now)).toBe('aged');
    expect(freshnessOf(now - CURRENT_MAX_MS, now)).toBe('old');
  });

  it('is none with no reading or no entry for today', () => {
    expect(freshnessOf(null, now)).toBe('none');
    expect(freshnessOf(undefined, now)).toBe('none');
    expect(freshnessOf(now, now, false)).toBe('none');
  });

  it('reads a clock that went backwards as fresh', () => {
    expect(freshnessOf(now + HOUR, now)).toBe('fresh');
  });
});

describe('weatherAgeMin', () => {
  it('is whole minutes, -1 without a reading, capped at a week', () => {
    const now = 1_800_000_000_000;
    expect(weatherAgeMin(null, now)).toBe(-1);
    expect(weatherAgeMin(now - 90.5 * MIN, now)).toBe(90);
    expect(weatherAgeMin(now - 30 * 24 * HOUR, now)).toBe(10080);
    expect(weatherAgeMin(now + MIN, now)).toBe(0);
  });
});

describe('the home-zone day and the midnight roll', () => {
  it('rolls at midnight in America/Los_Angeles', () => {
    expect(homeYmdAt(Date.UTC(2026, 9, 16, 6, 59), LA)).toBe('2026-10-15');
    expect(homeYmdAt(Date.UTC(2026, 9, 16, 7, 0), LA)).toBe('2026-10-16');
  });

  it('rolls at midnight in Pacific/Auckland', () => {
    // NZDT is UTC+13 in October.
    expect(homeYmdAt(Date.UTC(2026, 9, 16, 10, 59), AKL)).toBe('2026-10-16');
    expect(homeYmdAt(Date.UTC(2026, 9, 16, 11, 0), AKL)).toBe('2026-10-17');
  });

  it('falls back to the device day for a zone the engine does not know', () => {
    expect(homeYmdAt(Date.now(), 'Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('indexes the daily entries by date, never by position', () => {
    const r = portlandReading(0);
    const shuffled = [...r.daily].reverse();
    expect(todayEntry(shuffled, '2026-10-16')?.maxC).toBe(25.1);
    expect(outlook(shuffled, '2026-10-16').map((d) => d.ymd)).toEqual([
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ]);
    expect(todayEntry(shuffled, '2026-10-20')).toBeUndefined();
  });

  it('a cached reading taken before midnight shows the new day after it', () => {
    const fetchedAt = Date.UTC(2026, 9, 16, 6, 0); // LA 23:00 Oct 15
    const before = asReading(
      buildWeatherAtom(input({ reading: portlandReading(fetchedAt), now: fetchedAt + 30 * MIN }))
    );
    expect(before.high).toBe('23°'); // Oct 15 max 22.7
    expect(before.outlook.map((d) => d.ymd)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18']);
    const after = asReading(
      buildWeatherAtom(input({ reading: portlandReading(fetchedAt), now: fetchedAt + 90 * MIN }))
    );
    expect(after.high).toBe('25°'); // Oct 16 max 25.1
    expect(after.low).toBe('13°');
    expect(after.outlook.map((d) => d.ymd)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    expect(after.tonightLow).toBe('11°'); // Oct 17 min 10.9
  });

  it('runs out of days after about four days without a refresh: unavailable', () => {
    const fetchedAt = Date.UTC(2026, 9, 16, 6, 0);
    const atom = buildWeatherAtom(
      input({ reading: portlandReading(fetchedAt), now: Date.UTC(2026, 9, 20, 8, 0) })
    );
    expect(atom).toEqual({ state: 'unavailable', errorCode: null });
  });
});

describe('formatTemp and defaultUnitFor', () => {
  it('rounds in both units and never prints the unit', () => {
    expect(formatTemp(16.9, 'C')).toBe('17°');
    expect(formatTemp(16.9, 'F')).toBe('62°'); // 62.42
    expect(formatTemp(12.5, 'C')).toBe('13°');
    expect(formatTemp(-0.4, 'C')).toBe('0°');
    expect(formatTemp(-2.5, 'C')).toBe('-2°');
    expect(formatTemp(-40, 'F')).toBe('-40°');
    expect(formatTemp(0, 'F')).toBe('32°');
  });

  it('is F for the US only', () => {
    expect(defaultUnitFor('US')).toBe('F');
    expect(defaultUnitFor('us')).toBe('F');
    expect(defaultUnitFor('GB')).toBe('C');
    expect(defaultUnitFor('PR')).toBe('C');
    expect(defaultUnitFor(null)).toBe('C');
    expect(defaultUnitFor(undefined)).toBe('C');
  });
});

describe('buildWeatherAtom: states', () => {
  const now = Date.UTC(2026, 9, 16, 19, 0);

  it('is null when Show Weather is off, whatever else holds', () => {
    expect(buildWeatherAtom(input({ enabled: false, reading: readingAround(now, now), now }))).toBe(
      null
    );
  });

  it('is null before the doc is ready (a booting wall never flashes the nudge)', () => {
    expect(buildWeatherAtom(input({ docReady: false, place: null }))).toBeNull();
  });

  it('is the nudge with no home town', () => {
    expect(buildWeatherAtom(input({ place: null }))).toEqual({ state: 'nudge' });
  });

  it('is a fresh reading with the temperature, no age, and the night glyph at night', () => {
    const r = portlandReading(Date.UTC(2026, 9, 16, 6, 0));
    const atom = asReading(buildWeatherAtom(input({ reading: r, now: r.fetchedAt + 10 * MIN })));
    expect(atom).toMatchObject({
      freshness: 'fresh',
      glyph: 'night', // code 0, is_day 0
      temp: '17°',
      condition: 'Clear',
      high: '23°',
      low: '11°',
      ageText: null,
      ageShort: null,
      soft: false,
      placeName: 'Portland',
    });
    expect(atom.outlook[0]).toEqual({
      ymd: '2026-10-16',
      weekday: 'Fri',
      glyph: 'cloudy',
      high: '25°',
      low: '13°',
    });
  });

  it('converts every temperature for F with no other change', () => {
    const r = portlandReading(Date.UTC(2026, 9, 16, 6, 0));
    const atom = asReading(
      buildWeatherAtom(input({ reading: r, now: r.fetchedAt + MIN, unit: 'F' }))
    );
    expect([atom.temp, atom.high, atom.low]).toEqual(['62°', '73°', '51°']);
  });

  it('is unavailable offline with no cache and no attempt yet (never a silent blank)', () => {
    expect(buildWeatherAtom(input({ online: false }))).toEqual({
      state: 'unavailable',
      errorCode: null,
    });
  });

  it('is a brief blank while the first fetch is in flight', () => {
    expect(buildWeatherAtom(input({ fetching: true }))).toBeNull();
  });

  it('stays unavailable while a retry is in flight after a failure', () => {
    expect(buildWeatherAtom(input({ fetching: true, failure: { code: 'network' } }))).toEqual({
      state: 'unavailable',
      errorCode: 'network',
    });
  });

  it('is unavailable after a failure with nothing cached', () => {
    expect(buildWeatherAtom(input({ failure: { code: 'http_5xx' } }))).toEqual({
      state: 'unavailable',
      errorCode: 'http_5xx',
    });
  });

  it('a failure does not hide a reading that is still usable', () => {
    const atom = buildWeatherAtom(
      input({ reading: readingAround(now, now - 2 * HOUR), now, failure: { code: 'timeout' } })
    );
    expect(atom?.state).toBe('reading');
  });
});

describe('buildWeatherAtom: age lines', () => {
  function at(nowLocal: Date, fetchedLocal: Date, over: Partial<WeatherAtomInput> = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(nowLocal);
    const now = nowLocal.getTime();
    return asReading(
      buildWeatherAtom(input({ reading: readingAround(now, fetchedLocal.getTime()), now, ...over }))
    );
  }

  it('aged and online: "As of 3 hours ago" in the softer ink', () => {
    const atom = at(new Date(2026, 9, 16, 21, 10), new Date(2026, 9, 16, 18, 10));
    expect(atom.freshness).toBe('aged');
    expect(atom.ageText).toBe('As of 3 hours ago');
    expect(atom.ageShort).toBe('3 hours ago');
    expect(atom.soft).toBe(true);
    expect(atom.temp).toBe('13°');
  });

  it('aged and offline: "Offline, as of 6:10 PM" / "offline"', () => {
    const atom = at(new Date(2026, 9, 16, 21, 10), new Date(2026, 9, 16, 18, 10), {
      online: false,
    });
    expect(norm(atom.ageText)).toBe('Offline, as of 6:10 PM');
    expect(atom.ageShort).toBe('offline');
  });

  it('old the same day: "As of {time}", no current temperature, today\'s glyph', () => {
    const atom = at(new Date(2026, 9, 16, 23, 30), new Date(2026, 9, 16, 10, 10));
    expect(atom.freshness).toBe('old');
    expect(norm(atom.ageText)).toBe('As of 10:10 AM');
    expect(atom.ageShort).toBe('13 hours ago');
    expect(atom.temp).toBeNull();
    expect(atom.soft).toBe(false);
    expect(atom.glyph).toBe('sunny'); // today's daily code 0 (day mapping), not current rain
    expect(atom.condition).toBe('Sunny');
  });

  it('old from yesterday at 13h: "As of yesterday, 6:10 PM"', () => {
    const atom = at(new Date(2026, 9, 16, 7, 10), new Date(2026, 9, 15, 18, 10));
    expect(norm(atom.ageText)).toBe('As of yesterday, 6:10 PM');
  });

  it('old from yesterday at 30h: still "yesterday", whatever the connection', () => {
    const atom = at(new Date(2026, 9, 16, 23, 30), new Date(2026, 9, 15, 17, 30), {
      online: false,
    });
    expect(norm(atom.ageText)).toBe('As of yesterday, 5:30 PM');
    expect(atom.ageShort).toBe('yesterday');
  });

  it('old from three days back: "As of Tuesday, 12:00 PM"', () => {
    const atom = at(new Date(2026, 9, 16, 12, 0), new Date(2026, 9, 13, 12, 0));
    expect(norm(atom.ageText)).toBe('As of Tuesday, 12:00 PM');
    expect(atom.ageShort).toBe('3 days ago');
  });

  it('in zh: whole Chinese sentences with the localized time and weekday', () => {
    const zh = { lang: 'zh' as const, t: tZh };
    const aged = at(new Date(2026, 9, 16, 21, 10), new Date(2026, 9, 16, 18, 10), zh);
    expect(aged.ageText).toBe('3小时前更新');
    expect(aged.ageShort).toBe('3小时前');
    expect(aged.condition).toBe('雨');

    const offline = at(new Date(2026, 9, 16, 21, 10), new Date(2026, 9, 16, 18, 10), {
      ...zh,
      online: false,
    });
    const t1810 = formatUiTime(new Date(2026, 9, 16, 18, 10).getTime(), 'zh');
    expect(offline.ageText).toBe(fillTemplate(ZH_STRINGS['weather.offlineAsOf'], { time: t1810 }));
    expect(offline.ageShort).toBe('离线');

    const yesterday = at(new Date(2026, 9, 16, 7, 10), new Date(2026, 9, 15, 18, 10), zh);
    expect(yesterday.ageText).toBe(
      `截至昨天 ${formatUiTime(new Date(2026, 9, 15, 18, 10).getTime(), 'zh')}`
    );

    const earlier = at(new Date(2026, 9, 16, 12, 0), new Date(2026, 9, 13, 12, 0), zh);
    expect(earlier.ageText).toContain('星期二');
    expect(earlier.outlook[0]!.weekday).toMatch(/^周/);
  });
});
