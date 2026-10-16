/**
 * weatherStore (#134): the refresh cadence and its skips, the place-key watch (no refetch on
 * an equal settings reload), the cache hydrate per family, failure backoff, late answers
 * dropped rather than applied to a new question, the sign-out halt, the foreground trigger,
 * the once-per-code unknown-code event, and the search action that never throws.
 *
 * The real `weatherCache` runs against happy-dom's localStorage; only the provider calls are
 * mocked (the real `WeatherFetchError` is kept, so the store classifies real errors).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive, ref, watch } from 'vue';
import type { WeatherPlace } from '@/types/models';
import type { WeatherObservation } from '@/types/weather';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';

const MIN = 60_000;
const LA = 'America/Los_Angeles';

const h = vi.hoisted(() => ({
  logEvent: vi.fn(),
  reportError: vi.fn(),
  fetchForecast: vi.fn(),
  searchPlaces: vi.fn(),
  docLoaded: true,
  zone: 'America/Los_Angeles',
  poll: null as (() => unknown) | null,
}));

vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/weather/openMeteo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/weather/openMeteo')>()),
  fetchForecast: h.fetchForecast,
  searchPlaces: h.searchPlaces,
}));
vi.mock('@/services/automerge/docService', async () => {
  const { ref: vueRef } = await import('vue');
  return { docVersion: vueRef(0), isDocLoaded: () => h.docLoaded };
});
const online = ref(true);
vi.mock('@/composables/useOnline', () => ({ useOnline: () => ({ isOnline: online }) }));
const lastVisibleAt = ref(0);
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ lastVisibleAt }) }));
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: (cb: () => unknown) => {
    h.poll = cb;
    return { stop: () => {} };
  },
}));
const familyContext = reactive({ activeFamilyId: 'fam-1' as string | null });
vi.mock('@/stores/familyContextStore', () => ({ useFamilyContextStore: () => familyContext }));
const settings = reactive({
  settings: { id: 'app_settings' } as Record<string, unknown>,
  weatherEnabled: true,
  weatherPlace: null as WeatherPlace | null,
  temperatureUnit: 'F' as 'F' | 'C',
  familyCountry: 'US' as string | null,
  country: 'US' as string | null,
  resolveHomeTimeZoneNow: () => ({ zone: h.zone, source: 'stored' }),
});
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));
const translation = reactive({
  currentLanguage: 'en' as 'en' | 'zh',
  t: (k: UIStringKey) => UI_STRINGS[k],
});
vi.mock('@/stores/translationStore', () => ({ useTranslationStore: () => translation }));

import { docVersion } from '@/services/automerge/docService';
import { WeatherFetchError } from '@/services/weather/openMeteo';
import { placeKeyOf, readWeatherCache, writeWeatherCache } from '@/services/weather/weatherCache';
import { homeYmdAt } from '@/utils/weather/weatherReading';
import { addDaysYmd } from '@/utils/date';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { __resetWeatherStoreForTesting, useWeatherStore } from '../weatherStore';

const PORTLAND: WeatherPlace = {
  id: 5746545,
  name: 'Portland',
  admin1: 'Oregon',
  country: 'United States',
  countryCode: 'US',
  lat: 45.52,
  lon: -122.68,
};
const BANGOR: WeatherPlace = {
  id: 4957280,
  name: 'Bangor',
  admin1: 'Maine',
  country: 'United States',
  countryCode: 'US',
  lat: 44.8,
  lon: -68.77,
};

function obs(tempC = 12, codes: number[] = [3, 3, 61, 0, 2]): WeatherObservation {
  const today = homeYmdAt(Date.now(), h.zone);
  return {
    fetchedAt: Date.now(),
    current: { tempC, code: codes[0]!, isDay: true },
    daily: codes.map((code, i) => ({ ymd: addDaysYmd(today, i), code, maxC: 20 + i, minC: 5 + i })),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let the store's watchers and the single-flight's promise chains run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

const events = (message: string) =>
  h.logEvent.mock.calls.map((c) => c[0]).filter((e) => e.message === message);
const reports = (message: string) =>
  h.reportError.mock.calls.map((c) => c[0]).filter((e) => e.message === message);

let pinia: ReturnType<typeof createPinia> | null = null;
function disposeStores(): void {
  if (!pinia) return;
  for (const store of (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.values()) {
    store.$dispose();
  }
}

async function createStore() {
  disposeStores();
  pinia = createPinia();
  setActivePinia(pinia);
  const store = useWeatherStore();
  await settle();
  return store;
}

/** Simulate a doc reload: the mirror is rebuilt, so the place is a NEW but equal object. */
function reloadSettings(): void {
  settings.settings = { id: 'app_settings', reloaded: Math.random() };
  if (settings.weatherPlace) settings.weatherPlace = { ...settings.weatherPlace };
  docVersion.value += 1;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T19:00:00Z'));
  localStorage.clear();
  h.logEvent.mockReset();
  h.reportError.mockReset();
  h.fetchForecast.mockReset();
  h.searchPlaces.mockReset();
  h.fetchForecast.mockImplementation(async () => obs());
  h.docLoaded = true;
  h.zone = LA;
  h.poll = null;
  online.value = true;
  familyContext.activeFamilyId = 'fam-1';
  settings.weatherEnabled = true;
  settings.weatherPlace = PORTLAND;
  settings.temperatureUnit = 'F';
  translation.currentLanguage = 'en';
  __resetWeatherStoreForTesting();
});

afterEach(() => {
  disposeStores();
  vi.useRealTimers();
});

describe('when nothing should be fetched', () => {
  it('Show Weather off: no request, and the atom is null', async () => {
    settings.weatherEnabled = false;
    const store = await createStore();
    expect(h.fetchForecast).not.toHaveBeenCalled();
    expect(store.atom).toBeNull();
    expect(events('weather_skipped').at(-1)?.context.detail).toBe('disabled');
  });

  it('no home town: no request, and the atom is the nudge', async () => {
    settings.weatherPlace = null;
    const store = await createStore();
    expect(h.fetchForecast).not.toHaveBeenCalled();
    expect(store.atom).toEqual({ state: 'nudge' });
  });

  it('offline with no cache: no request, and the atom says unavailable', async () => {
    online.value = false;
    const store = await createStore();
    expect(h.fetchForecast).not.toHaveBeenCalled();
    expect(store.atom).toEqual({ state: 'unavailable', errorCode: null });
  });

  it('a fresh cached reading: painted from the cache, no request', async () => {
    const key = placeKeyOf(PORTLAND, LA);
    writeWeatherCache({ v: 1, familyId: 'fam-1', placeKey: key, ...obs(20) });
    vi.setSystemTime(Date.now() + 10 * MIN);
    const store = await createStore();
    expect(h.fetchForecast).not.toHaveBeenCalled();
    expect(store.atom).toMatchObject({ state: 'reading', freshness: 'fresh', temp: '68°' });
    expect(events('weather_skipped').at(-1)?.context.detail).toBe('fresh');
  });

  it('the doc not ready yet: no request until it is, then one', async () => {
    h.docLoaded = false;
    await createStore();
    expect(h.fetchForecast).not.toHaveBeenCalled();
    h.docLoaded = true;
    docVersion.value += 1;
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
  });
});

describe('fetching', () => {
  it('fetches once at boot with no cache, caches the answer and logs the success', async () => {
    const store = await createStore();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
    expect(h.fetchForecast.mock.calls[0]![0]).toEqual(PORTLAND);
    expect(h.fetchForecast.mock.calls[0]![1]).toBe(LA);
    expect(store.reading?.placeKey).toBe(placeKeyOf(PORTLAND, LA));
    expect(readWeatherCache('fam-1', placeKeyOf(PORTLAND, LA)).kind).toBe('ok');
    expect(events('weather_fetch')[0]).toMatchObject({
      level: 'info',
      surface: 'weather',
      context: { action: 'fetch', kind: 'settings', http_status: 200, weather_age_min: -1 },
    });
    expect(store.atom).toMatchObject({ state: 'reading', temp: '54°', placeName: 'Portland' });
  });

  it('a settings reload that rebuilds an equal place object fetches nothing', async () => {
    await createStore();
    vi.setSystemTime(Date.now() + 45 * MIN); // even with a stale reading
    reloadSettings();
    await settle();
    reloadSettings();
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('a place change fetches the new town', async () => {
    const store = await createStore();
    settings.weatherPlace = BANGOR;
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
    expect(h.fetchForecast.mock.calls[1]![0]).toEqual(BANGOR);
    expect(store.reading?.placeKey).toBe(placeKeyOf(BANGOR, LA));
  });

  it('a home-zone change fetches again (the day boundaries moved)', async () => {
    await createStore();
    h.zone = 'America/New_York';
    settings.settings = { id: 'app_settings', homeTimeZone: 'America/New_York' };
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
    expect(h.fetchForecast.mock.calls[1]![1]).toBe('America/New_York');
  });

  it('a tick during an in-flight fetch makes no second call', async () => {
    const d = deferred<WeatherObservation>();
    h.fetchForecast.mockImplementationOnce(() => d.promise);
    await createStore();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
    void h.poll!();
    void h.poll!();
    d.resolve(obs());
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('a tick refetches once the reading is 30 minutes old', async () => {
    await createStore();
    vi.setSystemTime(Date.now() + 29 * MIN);
    await h.poll!();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2 * MIN);
    await h.poll!();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
    expect(events('weather_fetch')[1]!.context).toMatchObject({
      kind: 'tick',
      weather_age_min: 31,
    });
  });

  it('a return to the foreground fetches with kind foreground', async () => {
    await createStore();
    vi.setSystemTime(Date.now() + 40 * MIN);
    lastVisibleAt.value = Date.now();
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
    expect(events('weather_fetch').at(-1)!.context.kind).toBe('foreground');
  });

  it('coming back online fetches with kind online', async () => {
    online.value = false;
    await createStore();
    online.value = true;
    await settle();
    expect(events('weather_fetch').at(-1)!.context.kind).toBe('online');
  });
});

describe('families', () => {
  it('hydrates the cache for the family that is active, and nothing for another', async () => {
    const key = placeKeyOf(PORTLAND, LA);
    writeWeatherCache({ v: 1, familyId: 'fam-2', placeKey: key, ...obs(30) });
    h.fetchForecast.mockImplementation(() => new Promise(() => {}));
    const store = await createStore();
    expect(store.reading).toBeNull(); // fam-1 never sees fam-2's town
    familyContext.activeFamilyId = 'fam-2';
    await settle();
    expect(store.reading?.familyId).toBe('fam-2');
    expect(store.reading?.current.tempC).toBe(30);
  });

  it('the reading is null with no active family', async () => {
    const store = await createStore();
    expect(store.reading).not.toBeNull();
    familyContext.activeFamilyId = null;
    await settle();
    expect(store.reading).toBeNull();
  });
});

describe('failures and backoff', () => {
  const fail = (code: ConstructorParameters<typeof WeatherFetchError>[0], status?: number) =>
    new WeatherFetchError(code, `hint for ${code}`, status);

  it('a 429 backs off for an hour and is reported with its status and the backoff', async () => {
    h.fetchForecast.mockRejectedValueOnce(fail('rate_limited', 429));
    const store = await createStore();
    expect(store.failure).toMatchObject({ code: 'rate_limited', count: 1 });
    expect(store.failure!.until - Date.now()).toBe(60 * MIN);
    expect(reports('weather_fetch_failed')[0]).toMatchObject({
      surface: 'weather',
      severity: 'warning',
      context: { error_code: 'rate_limited', http_status: 429, detail: 'backoff=60' },
    });
    vi.setSystemTime(Date.now() + 59 * MIN);
    await h.poll!();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
    expect(store.atom).toEqual({ state: 'unavailable', errorCode: 'rate_limited' });
  });

  it('repeated 5xx back off 5 then 10 minutes, and a success clears the failure', async () => {
    h.fetchForecast
      .mockRejectedValueOnce(fail('http_5xx', 500))
      .mockRejectedValueOnce(fail('http_5xx', 503));
    const store = await createStore();
    expect(store.failure!.until - Date.now()).toBe(5 * MIN);
    vi.setSystemTime(Date.now() + 5 * MIN);
    await h.poll!();
    expect(store.failure).toMatchObject({ count: 2 });
    expect(store.failure!.until - Date.now()).toBe(10 * MIN);
    vi.setSystemTime(Date.now() + 10 * MIN);
    await h.poll!();
    expect(h.fetchForecast).toHaveBeenCalledTimes(3);
    expect(store.failure).toBeNull();
    expect(store.atom?.state).toBe('reading');
  });

  it('a place change clears the failure (a new question gets a fresh backoff)', async () => {
    h.fetchForecast.mockRejectedValueOnce(fail('http_5xx', 500));
    const store = await createStore();
    expect(store.failure).not.toBeNull();
    settings.weatherPlace = BANGOR;
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
    expect(store.failure).toBeNull();
  });

  it('an aborted request is never stored as a failure or reported', async () => {
    h.fetchForecast.mockRejectedValueOnce(fail('aborted'));
    const store = await createStore();
    expect(store.failure).toBeNull();
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('the first attempt is a blank, a retry after a failure stays unavailable', async () => {
    const first = deferred<WeatherObservation>();
    h.fetchForecast.mockImplementationOnce(() => first.promise);
    const store = await createStore();
    expect(store.fetching).toBe(true);
    expect(store.atom).toBeNull();
    first.reject(fail('network'));
    await settle();
    expect(store.atom).toEqual({ state: 'unavailable', errorCode: 'network' });
    const retry = deferred<WeatherObservation>();
    h.fetchForecast.mockImplementationOnce(() => retry.promise);
    vi.setSystemTime(Date.now() + 5 * MIN);
    void h.poll!();
    await settle();
    expect(store.fetching).toBe(true);
    expect(store.atom).toEqual({ state: 'unavailable', errorCode: 'network' });
    retry.resolve(obs());
    await settle();
    expect(store.atom?.state).toBe('reading');
  });
});

describe('late answers are dropped, never applied to the new question', () => {
  it("an old town's forecast that lands after a town change is not cached under the new key", async () => {
    const old = deferred<WeatherObservation>();
    h.fetchForecast.mockImplementationOnce(() => old.promise);
    h.fetchForecast.mockImplementationOnce(async () => obs(-5));
    const store = await createStore();
    settings.weatherPlace = BANGOR;
    await settle();
    old.resolve(obs(35)); // Portland's answer, after the abort lost the race
    await settle();
    expect(events('weather_fetch_dropped')[0]!.context).toMatchObject({ detail: 'superseded' });
    const cached = readWeatherCache('fam-1', placeKeyOf(BANGOR, LA));
    expect(cached.kind === 'ok' && cached.value.current.tempC).toBe(-5);
    expect(store.reading?.current.tempC).toBe(-5);
  });

  it('one that lands after a family switch is not written under the other family', async () => {
    const old = deferred<WeatherObservation>();
    h.fetchForecast.mockImplementationOnce(() => old.promise);
    h.fetchForecast.mockImplementationOnce(() => new Promise(() => {}));
    const store = await createStore();
    familyContext.activeFamilyId = 'fam-2';
    await settle();
    old.resolve(obs(35));
    await settle();
    expect(events('weather_fetch_dropped')).toHaveLength(1);
    expect(store.reading).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.WEATHER)).toBeNull();
  });
});

describe('a question change mid-fetch hands over without a gap', () => {
  it('never shows (or logs) unavailable between the aborted run and the trailing one', async () => {
    // The first fetch rejects the way a real one does when its signal aborts.
    h.fetchForecast.mockImplementationOnce(
      (_place: WeatherPlace, _zone: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new WeatherFetchError('aborted', 'caller moved on'))
          );
        })
    );
    const next = deferred<WeatherObservation>();
    h.fetchForecast.mockImplementationOnce(() => next.promise);
    const store = await createStore();
    expect(store.fetching).toBe(true);

    const states: Array<string | null> = [];
    const stop = watch(
      () => store.atom?.state ?? null,
      (state) => states.push(state),
      { flush: 'sync' }
    );
    const fetchingSeen: boolean[] = [];
    const stopFetching = watch(
      () => store.fetching,
      (f) => fetchingSeen.push(f),
      { flush: 'sync' }
    );
    settings.weatherPlace = BANGOR;
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
    expect(store.fetching).toBe(true);
    expect(fetchingSeen).not.toContain(false);
    expect(states).not.toContain('unavailable');

    next.resolve(obs(-5));
    await settle();
    stop();
    stopFetching();
    expect(store.fetching).toBe(false);
    expect(store.atom?.state).toBe('reading');
    expect(events('weather_staleness').map((e) => e.context.stage)).not.toContain('unavailable');
  });

  it('a trailing run that skips (offline) clears fetching, so the card says unavailable', async () => {
    h.fetchForecast.mockImplementationOnce(
      (_place: WeatherPlace, _zone: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new WeatherFetchError('aborted', 'caller moved on'))
          );
        })
    );
    const store = await createStore();
    online.value = false;
    settings.weatherPlace = BANGOR;
    await settle();
    expect(store.fetching).toBe(false);
    expect(store.atom).toMatchObject({ state: 'unavailable' });
  });
});

describe('Show Weather switched off mid-fetch', () => {
  it('aborts the request, and an answer that lands anyway is dropped, never cached', async () => {
    const inFlight = deferred<WeatherObservation>();
    let signal: AbortSignal | undefined;
    // Ignores its signal, so the answer lands after the switch (the abort lost the race).
    h.fetchForecast.mockImplementationOnce((_p: WeatherPlace, _z: string, s: AbortSignal) => {
      signal = s;
      return inFlight.promise;
    });
    const store = await createStore();
    expect(store.fetching).toBe(true);

    settings.weatherEnabled = false;
    await settle();
    expect(signal?.aborted).toBe(true);

    inFlight.resolve(obs(30));
    await settle();
    expect(events('weather_fetch_dropped')[0]!.context).toMatchObject({ detail: 'disabled' });
    expect(events('weather_fetch')).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEYS.WEATHER)).toBeNull();
    expect(store.reading).toBeNull();
    expect(store.fetching).toBe(false);
  });
});

describe('haltForSignOut', () => {
  it('mid-fetch: the answer is dropped, no cache key is left, and nothing starts until the next session', async () => {
    const key = placeKeyOf(PORTLAND, LA);
    writeWeatherCache({ v: 1, familyId: 'fam-1', placeKey: key, ...obs(10) });
    vi.setSystemTime(Date.now() + 45 * MIN);
    const inFlight = deferred<WeatherObservation>();
    h.fetchForecast.mockImplementationOnce(() => inFlight.promise);
    const store = await createStore();
    expect(store.fetching).toBe(true);

    const halting = store.haltForSignOut();
    inFlight.resolve(obs(99));
    await halting;
    await settle();
    expect(events('weather_fetch_dropped')[0]!.context).toMatchObject({ detail: 'halted' });
    expect(localStorage.getItem(STORAGE_KEYS.WEATHER)).toBeNull();
    expect(store.reading).toBeNull();

    await h.poll!();
    lastVisibleAt.value = Date.now();
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);

    // The session boundary: the old session goes, a new one starts.
    familyContext.activeFamilyId = null;
    await settle();
    familyContext.activeFamilyId = 'fam-1';
    await settle();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
  });
});

describe('weather_unknown_code', () => {
  it('is emitted once per code per session', async () => {
    h.fetchForecast.mockImplementation(async () => obs(10, [42, 3, 42, 43, 0]));
    await createStore();
    vi.setSystemTime(Date.now() + 31 * MIN);
    await h.poll!();
    expect(h.fetchForecast).toHaveBeenCalledTimes(2);
    const codes = events('weather_unknown_code').map((e) => e.context.count);
    expect(codes).toEqual([42, 43]);
    expect(events('weather_unknown_code')[0]).toMatchObject({
      level: 'warn',
      context: { error_code: 'unknown_code' },
    });
  });
});

describe('weather_staleness', () => {
  it('emits on each stage transition, including back to fresh', async () => {
    const store = await createStore();
    expect(events('weather_staleness').map((e) => e.context.stage)).toEqual(['fresh']);
    h.fetchForecast.mockRejectedValue(new WeatherFetchError('network', 'hint'));
    vi.setSystemTime(Date.now() + 61 * MIN);
    await h.poll!();
    await settle();
    expect(store.atom).toMatchObject({ state: 'reading', freshness: 'aged' });
    h.fetchForecast.mockImplementation(async () => obs());
    vi.setSystemTime(Date.now() + 5 * MIN);
    await h.poll!();
    await settle();
    expect(events('weather_staleness').map((e) => e.context.stage)).toEqual([
      'fresh',
      'aged',
      'fresh',
    ]);
  });
});

describe('searchPlaces', () => {
  it('returns the places, adds the language and family country, and logs no query text', async () => {
    h.searchPlaces.mockResolvedValue([PORTLAND]);
    translation.currentLanguage = 'zh';
    const store = await createStore();
    const signal = new AbortController().signal;
    expect(await store.searchPlaces('97201', signal)).toEqual({ ok: true, places: [PORTLAND] });
    expect(h.searchPlaces).toHaveBeenCalledWith('97201', 'zh', 'US', signal);
    const event = events('weather_geocode')[0]!;
    expect(event.context).toMatchObject({ action: 'geocode', count: 1, kind: 'zip' });
    expect(JSON.stringify(event)).not.toContain('97201');
  });

  it.each(['network', 'timeout', 'http_4xx', 'http_5xx', 'rate_limited', 'parse'] as const)(
    'a %s failure is a value, reported as a warning, never thrown',
    async (code) => {
      h.searchPlaces.mockRejectedValue(new WeatherFetchError(code, 'hint', 503));
      const store = await createStore();
      await expect(store.searchPlaces('Portland')).resolves.toEqual({ ok: false, code });
      expect(reports('weather_geocode_failed')[0]).toMatchObject({
        severity: 'warning',
        context: { action: 'geocode', error_code: code },
      });
    }
  );

  it('an aborted search is a value and is not reported (the person kept typing)', async () => {
    h.searchPlaces.mockRejectedValue(new WeatherFetchError('aborted', 'hint'));
    const store = await createStore();
    expect(await store.searchPlaces('Port')).toEqual({ ok: false, code: 'aborted' });
    expect(reports('weather_geocode_failed')).toHaveLength(0);
  });

  it('an unexpected error is reported and returned as parse', async () => {
    h.searchPlaces.mockRejectedValue(new Error('boom'));
    const store = await createStore();
    expect(await store.searchPlaces('Portland')).toEqual({ ok: false, code: 'parse' });
    expect(reports('weather_geocode_failed')).toHaveLength(1);
  });

  it('with Show Weather off it looks nothing up', async () => {
    settings.weatherEnabled = false;
    const store = await createStore();
    expect(await store.searchPlaces('Portland')).toEqual({ ok: true, places: [] });
    expect(h.searchPlaces).not.toHaveBeenCalled();
  });
});

describe('atom', () => {
  it('follows a unit switch with no refetch', async () => {
    const store = await createStore();
    expect(store.atom).toMatchObject({ temp: '54°' });
    settings.temperatureUnit = 'C';
    expect(store.atom).toMatchObject({ temp: '12°' });
    expect(h.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('is null before the doc is ready, even with a town', async () => {
    h.docLoaded = false;
    const store = await createStore();
    expect(store.atom).toBeNull();
  });
});
