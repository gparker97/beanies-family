/**
 * placeSearchStore (#150): when it may ask, the one request it makes, the quiet period, the
 * dev budget and its telemetry. The service is mocked; the error class is the real one.
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

const h = vi.hoisted(() => ({
  logEvent: vi.fn(),
  reportError: vi.fn(),
  suggestPlaces: vi.fn(),
  fetchPlaceAddress: vi.fn(),
  configured: { value: true },
  flagOn: { value: true },
  consumeAttempt: vi.fn((): { ok: true } | { ok: false; reason: 'quota'; resetsAt: number } => ({
    ok: true,
  })),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/utils/attemptBudget', () => ({ consumeAttempt: h.consumeAttempt }));
vi.mock('@/utils/location/locationLinks', () => ({ locationLinksEnabled: () => h.flagOn.value }));
vi.mock('@/services/placeSearch/placeSearchApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/placeSearch/placeSearchApi')>();
  return {
    ...real,
    suggestPlaces: h.suggestPlaces,
    fetchPlaceAddress: h.fetchPlaceAddress,
    isPlaceSearchConfigured: () => h.configured.value,
  };
});
const online = ref(true);
vi.mock('@/composables/useOnline', () => ({ useOnline: () => ({ isOnline: online }) }));
const settings = reactive({
  addressSuggestionsEnabled: true,
  weatherPlace: null as null | Record<string, unknown>,
});
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ currentLanguage: 'en' }),
}));

import { PlaceSearchApiError } from '@/services/placeSearch/placeSearchApi';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { nextUtcMidnight, usePlaceSearchStore } from '@/stores/placeSearchStore';

const ROW = { placeId: 'ChIJsecret_place', main: '127 Secret Road', secondary: 'Hidden City' };
const TYPED = '127 secret road unit 9';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  localStorage.clear();
  online.value = true;
  settings.addressSuggestionsEnabled = true;
  settings.weatherPlace = null;
  h.configured.value = true;
  h.flagOn.value = true;
  h.consumeAttempt.mockReturnValue({ ok: true });
  h.suggestPlaces.mockResolvedValue([ROW]);
  h.fetchPlaceAddress.mockResolvedValue({ placeId: ROW.placeId, address: '127 Secret Rd, 0001' });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

const ask = (attempt?: 'typed' | 'retry') =>
  usePlaceSearchStore().requestSuggestions(TYPED, { fieldKind: 'activity', attempt });

describe('available', () => {
  it('is true with the flag on, the switch on, online, configured and not quiet', () => {
    expect(usePlaceSearchStore().available).toBe(true);
  });

  it.each([
    ['flag off', () => (h.flagOn.value = false), 'flag-off'],
    ['switch off', () => (settings.addressSuggestionsEnabled = false), 'switch-off'],
    ['offline', () => (online.value = false), 'offline'],
    ['unconfigured', () => (h.configured.value = false), 'not-configured'],
  ])('is false when %s', async (_label, set, reason) => {
    set();
    const store = usePlaceSearchStore();
    expect(store.available).toBe(false);
    expect(store.unavailableReason).toBe(reason);
    expect((await ask()).ok).toBe(false);
    expect(h.suggestPlaces).not.toHaveBeenCalled();
  });

  it('is false in a quiet period, and the quiet period survives a reload', async () => {
    h.suggestPlaces.mockRejectedValueOnce(
      new PlaceSearchApiError('budget_exhausted', 'hint', 503, 3600)
    );
    await ask();
    expect(usePlaceSearchStore().available).toBe(false);
    expect(usePlaceSearchStore().unavailableReason).toBe('quiet');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.PLACE_SEARCH_QUIET)!);
    expect(stored.until).toBeGreaterThan(Date.now() + 3_500_000);

    // A reload: a fresh store reads the quiet period back.
    setActivePinia(createPinia());
    const reloaded = usePlaceSearchStore();
    expect(reloaded.available).toBe(false);
    expect((await ask()).ok).toBe(false);
    expect(h.suggestPlaces).toHaveBeenCalledTimes(1);
  });

  it('an expired stored quiet period is ignored', () => {
    localStorage.setItem(
      STORAGE_KEYS.PLACE_SEARCH_QUIET,
      JSON.stringify({ until: Date.now() - 1 })
    );
    expect(usePlaceSearchStore().available).toBe(true);
  });

  it('the quiet period ends on its own', async () => {
    vi.useFakeTimers();
    h.suggestPlaces.mockRejectedValueOnce(new PlaceSearchApiError('rate_limited', 'hint', 429, 60));
    const store = usePlaceSearchStore();
    await ask();
    expect(store.available).toBe(false);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(store.available).toBe(true);
  });

  it('the quiet period ends by the clock when the timer never fired (device asleep)', async () => {
    vi.useFakeTimers();
    h.suggestPlaces.mockRejectedValueOnce(new PlaceSearchApiError('rate_limited', 'hint', 429, 60));
    const store = usePlaceSearchStore();
    await ask();
    expect(store.available).toBe(false);
    // The wall clock jumps past `until` while the device sleeps: no timer runs.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(store.available).toBe(false);
    store.refreshQuiet();
    expect(store.available).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.PLACE_SEARCH_QUIET)).toBeNull();
    expect((await ask()).ok).toBe(true);
  });

  it('refreshQuiet leaves a quiet period that has not ended', async () => {
    vi.useFakeTimers();
    h.suggestPlaces.mockRejectedValueOnce(new PlaceSearchApiError('rate_limited', 'hint', 429, 60));
    const store = usePlaceSearchStore();
    await ask();
    vi.setSystemTime(Date.now() + 30_000);
    store.refreshQuiet();
    expect(store.available).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.PLACE_SEARCH_QUIET)).not.toBeNull();
  });

  it('without retryAfterSeconds the quiet period lasts until 00:00 UTC', async () => {
    h.suggestPlaces.mockRejectedValueOnce(new PlaceSearchApiError('budget_unavailable', 'h', 503));
    await ask();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.PLACE_SEARCH_QUIET)!);
    expect(stored.until).toBe(nextUtcMidnight(Date.now()));
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'place_quiet',
        context: { action: 'quiet', detail: 'budget' },
      })
    );
  });
});

describe('requestSuggestions', () => {
  it('sends the language and the home-town bias, and counts the answer', async () => {
    settings.weatherPlace = { lat: 1.29, lon: 103.85, countryCode: 'sg', name: 'Singapore' };
    const result = await ask('retry');
    expect(result).toEqual({ ok: true, suggestions: [ROW] });
    expect(h.suggestPlaces).toHaveBeenCalledWith(
      expect.objectContaining({
        q: TYPED,
        lang: 'en',
        bias: { lat: 1.29, lon: 103.85, countryCode: 'SG' },
      })
    );
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'place-search',
        message: 'place_suggest',
        context: expect.objectContaining({
          action: 'suggest',
          count: 1,
          kind: 'retry',
          stage: 'activity',
        }),
      })
    );
  });

  it('sends no bias without a home town, and drops a malformed country', async () => {
    await ask();
    expect(h.suggestPlaces.mock.calls[0]![0].bias).toBeUndefined();
    settings.weatherPlace = { lat: 1, lon: 2, countryCode: 'XYZ' };
    await ask();
    expect(h.suggestPlaces.mock.calls[1]![0].bias).toEqual({ lat: 1, lon: 2 });
  });

  it('an aborted request is not a failure: nothing logged', async () => {
    h.suggestPlaces.mockRejectedValueOnce(new PlaceSearchApiError('aborted', 'x'));
    expect(await ask()).toEqual({ ok: false, code: 'aborted' });
    expect(h.reportError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('prints one console hint per code, with its devHint, and reports it once', async () => {
    const err = () => new PlaceSearchApiError('upstream_auth', 'the provider key is wrong', 502);
    h.suggestPlaces.mockRejectedValue(err());
    await ask();
    await ask();
    await ask();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      '[place-search] suggest failed (upstream_auth): the provider key is wrong'
    );
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'place-search',
        severity: 'warning',
        message: 'place_suggest_failed',
        context: { action: 'suggest', error_code: 'upstream_auth', http_status: 502 },
      })
    );
    h.suggestPlaces.mockRejectedValue(new PlaceSearchApiError('upstream_timeout', 'slow', 504));
    await ask();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('unconfigured: not_configured, no request; noteQuiet logs it once per session', async () => {
    h.configured.value = false;
    const store = usePlaceSearchStore();
    expect(await ask()).toEqual({ ok: false, code: 'not_configured' });
    store.noteQuiet('not-configured', 'activity');
    store.noteQuiet('not-configured', 'contact');
    const quiet = h.logEvent.mock.calls.filter((c) => c[0].message === 'place_quiet');
    expect(quiet).toHaveLength(1);
    expect(warn.mock.calls[0]![0]).toContain('VITE_PLACE_SEARCH_URL');
  });

  it('a dev build stops at its daily budget and says so once', async () => {
    h.consumeAttempt.mockReturnValue({ ok: false, reason: 'quota', resetsAt: Date.now() + 1000 });
    expect(await ask()).toEqual({ ok: false, code: 'dev_capped' });
    expect(await ask()).toEqual({ ok: false, code: 'dev_capped' });
    expect(h.suggestPlaces).not.toHaveBeenCalled();
    expect(h.consumeAttempt).toHaveBeenCalledWith('place-search-dev', {
      max: 200,
      windowMs: 86_400_000,
    });
    const devCap = h.logEvent.mock.calls.filter(
      (c) => c[0].message === 'place_quiet' && c[0].context.detail === 'dev-cap'
    );
    expect(devCap).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('requestAddress', () => {
  it('returns the formatted address', async () => {
    const r = await usePlaceSearchStore().requestAddress(ROW.placeId, { fieldKind: 'stay' });
    expect(r).toEqual({ ok: true, address: '127 Secret Rd, 0001' });
    expect(h.fetchPlaceAddress).toHaveBeenCalledWith(
      expect.objectContaining({ placeId: ROW.placeId, lang: 'en' })
    );
  });

  it('a failure is place_resolve_failed with the dev hint', async () => {
    h.fetchPlaceAddress.mockRejectedValue(new PlaceSearchApiError('upstream_http', 'hint', 502));
    const r = await usePlaceSearchStore().requestAddress(ROW.placeId, { fieldKind: 'stay' });
    expect(r).toEqual({ ok: false, code: 'upstream_http' });
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'place_resolve_failed',
        context: { action: 'resolve', error_code: 'upstream_http', http_status: 502 },
      })
    );
  });
});

describe('privacy', () => {
  it('no log or telemetry call ever carries the typed text, a place id, a name or an address', async () => {
    settings.weatherPlace = { lat: 1.29, lon: 103.85, countryCode: 'SG', name: 'Secretville' };
    const store = usePlaceSearchStore();
    await ask();
    h.suggestPlaces.mockRejectedValueOnce(new PlaceSearchApiError('upstream_auth', 'h', 502));
    await ask();
    await store.requestAddress(ROW.placeId, { fieldKind: 'contact' });
    h.fetchPlaceAddress.mockRejectedValueOnce(new PlaceSearchApiError('parse', 'h', 200));
    await store.requestAddress(ROW.placeId, { fieldKind: 'contact' });
    store.noteCachedSuggest(1, 'activity');
    store.notePick('activity', true);
    store.notePickFailedShown('activity');
    store.notePickSuperseded('activity');
    store.noteKeepTyped('activity');
    store.noteRemoved('activity', 'original');
    store.noteStale('activity');
    store.noteQuiet('session-cap', 'activity');

    const logged = JSON.stringify([
      h.logEvent.mock.calls,
      h.reportError.mock.calls.map((c) => ({ ...c[0], error: String(c[0].error?.message) })),
      warn.mock.calls,
    ]);
    for (const secret of [
      TYPED,
      'secret',
      ROW.placeId,
      ROW.main,
      ROW.secondary,
      '127 Secret Rd',
      'Secretville',
    ]) {
      expect(logged.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(h.logEvent.mock.calls.length).toBeGreaterThanOrEqual(8);
  });

  it('a pick is noted with closed words only: whether it kept detail and stored a title', () => {
    const store = usePlaceSearchStore();
    store.notePick('activity', true, true);
    expect(h.logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'place_pick',
        context: { action: 'pick', kind: 'activity', detail: 'with-detail', format: 'titled' },
      })
    );
    store.notePick('stay', false);
    expect(h.logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: { action: 'pick', kind: 'stay', detail: 'no-detail', format: 'address' },
      })
    );
  });

  it('a superseded pick is noted with its field kind and a closed detail only', () => {
    usePlaceSearchStore().notePickSuperseded('stay');
    expect(h.logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'place_pick_superseded',
        context: { action: 'pick', detail: 'superseded', kind: 'stay' },
      })
    );
  });
});
