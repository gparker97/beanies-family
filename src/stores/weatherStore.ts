/**
 * Weather for the family's home town (#134, ADR-043): the orchestrator between the family
 * settings, the device cache and Open-Meteo. Components read `atom` (one view model, drawn
 * in cuts on the wall, the night screen, the Nook and later the widgets) and call
 * `searchPlaces`; only this store calls the service; settings writes go through
 * `settingsStore`.
 *
 * WIRED IN SETUP (the `entitlementStore` pattern), instantiated once from `App.vue`, so there
 * is no `start()` to forget or double-call. Four triggers feed ONE entry point, `request`:
 *   - `settings`: the watch on doc readiness, the Show Weather switch, the place key and the
 *     active family. It watches the derived place-key STRING, never the `weatherPlace`
 *     object: the Pinia settings mirror is rebuilt on every doc reload, so an object watch
 *     would refetch on every sync;
 *   - `online`: back online;
 *   - `foreground`: `useToday().lastVisibleAt` (a tab shown again);
 *   - `tick`: every 5 minutes while visible (no `fireImmediatelyOnVisible`, which could not
 *     tell a tick from a foreground).
 * `request` goes through a trailing single-flight, and each run first asks
 * `pickWeatherRefresh`, so most requests are cheap skips (`fresh` is the commonest).
 *
 * A LATE ANSWER IS DROPPED, NEVER APPLIED TO THE NEW QUESTION. Every run captures what it
 * asked (`familyId`, `placeKey`); an answer that lands after the town, the home zone or the
 * family changed, after Show Weather was switched off, or after sign-out began, is discarded
 * (`weather_fetch_dropped`) and the trailing run asks the new question. The watch also aborts
 * the stale request, which makes the common case fast; the comparison makes it correct when
 * the abort loses the race.
 *
 * SIGN-OUT HALTS FIRST, THEN DELETES (`haltForSignOut`, the `clearWidgetSnapshot` precedent):
 * a forecast that resolved between the removal and the reset would otherwise write the
 * departing family's town-derived reading back to the device.
 *
 * `atom` is a pure computed and never logs. The events that depend on it are emitted from a
 * `watch` (`weather_staleness`) and from `onFetchSuccess` (`weather_unknown_code`).
 * Display readiness (`isDocLoaded`) is the gate, not the authoritative doc: a forecast is a
 * read, and `docService.ts` reserves the authoritative gate for writes.
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { WeatherPlace } from '@/types/models';
import type {
  WeatherAtom,
  WeatherErrorCode,
  WeatherFailure,
  WeatherObservation,
  WeatherReading,
  WeatherRefreshKind,
  WeatherSearchResult,
} from '@/types/weather';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import {
  WeatherFetchError,
  SEARCH_MIN_CHARS,
  fetchForecast,
  searchPlaces as searchPlacesService,
} from '@/services/weather/openMeteo';
import {
  clearWeatherCache,
  placeKeyOf,
  readWeatherCache,
  writeWeatherCache,
} from '@/services/weather/weatherCache';
import { logEvent } from '@/services/telemetry';
import { createChangeGate } from '@/services/telemetry/emitPolicy';
import { reportError } from '@/utils/errorReporter';
import { createTrailingSingleFlight } from '@/utils/trailingSingleFlight';
import { glyphFor } from '@/utils/weather/weatherCodes';
import { buildWeatherAtom, weatherAgeMin } from '@/utils/weather/weatherReading';
import {
  WEATHER_POLL_MS,
  nextBackoffMs,
  pickWeatherRefresh,
  type WeatherSkipReason,
} from '@/utils/weather/weatherRefresh';
import { useOnline } from '@/composables/useOnline';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { useToday } from '@/composables/useToday';
import { useFamilyContextStore } from './familyContextStore';
import { useSettingsStore } from './settingsStore';
import { useTranslationStore } from './translationStore';

const SURFACE = 'weather';

/** WMO codes already reported as unknown this session (once per code per session). */
const unknownCodesLogged = new Set<number>();

/** Test-only: forget which unknown codes were reported. */
export function __resetWeatherStoreForTesting(): void {
  unknownCodesLogged.clear();
}

interface Asked {
  familyId: string;
  placeKey: string;
}

/** Why a late answer was dropped (`weather_fetch_dropped`'s `detail`). */
type DropReason = 'superseded' | 'halted' | 'disabled';

export const useWeatherStore = defineStore('weather', () => {
  const settingsStore = useSettingsStore();
  const familyContextStore = useFamilyContextStore();
  const translationStore = useTranslationStore();
  const { isOnline } = useOnline();
  const { lastVisibleAt } = useToday();

  // ── State ──────────────────────────────────────────────────────────────────
  /** The reading for the active family and place: hydrated from the cache, then refreshed. */
  const reading = ref<WeatherReading | null>(null);
  /** One record, so success clears it and a new question resets it in one assignment. */
  const failure = ref<WeatherFailure | null>(null);
  /** True only while a forecast request is in flight (the atom's "first attempt" input). */
  const fetching = ref(false);
  /** The clock the atom reads: bumped by every request and answer, and on foreground. */
  const nowMs = ref(Date.now());
  /** The running forecast's controller (not reactive). */
  let inflight: AbortController | null = null;
  /** Set by `haltForSignOut`; lifted at the next session boundary the watch sees. */
  let halted = false;
  /** Whether the watch last saw a session (doc ready + an active family). */
  let lastSessionPresent = false;

  // ── Derived ────────────────────────────────────────────────────────────────
  const docReady = computed(() => {
    void docVersion.value;
    return isDocLoaded();
  });
  /**
   * The family home zone, re-read when the settings change and on foreground (the device
   * zone is not reactive, and a device may have crossed zones while backgrounded).
   */
  const homeZone = computed(() => {
    void settingsStore.settings;
    void lastVisibleAt.value;
    return settingsStore.resolveHomeTimeZoneNow().zone;
  });
  const placeKey = computed<string | null>(() => {
    const place = settingsStore.weatherPlace;
    return place ? placeKeyOf(place, homeZone.value) : null;
  });
  /** Weather is on and has a town: the surfaces have something to show or say. */
  const isActive = computed(() => settingsStore.weatherEnabled && placeKey.value !== null);

  const atom = computed<WeatherAtom | null>(() =>
    buildWeatherAtom({
      enabled: settingsStore.weatherEnabled,
      docReady: docReady.value,
      place: settingsStore.weatherPlace,
      reading: reading.value,
      fetching: fetching.value,
      failure: failure.value,
      online: isOnline.value,
      now: nowMs.value,
      zone: homeZone.value,
      unit: settingsStore.temperatureUnit,
      lang: translationStore.currentLanguage,
      t: translationStore.t,
    })
  );
  /** The atom's stage, a string, so the staleness watch fires on transitions only. */
  const atomStage = computed<string | null>(() => {
    const a = atom.value;
    if (!a || a.state === 'nudge') return null;
    return a.state === 'reading' ? a.freshness : a.state;
  });

  // ── Logging ────────────────────────────────────────────────────────────────
  const skipGate = createChangeGate();
  const stalenessGate = createChangeGate();

  function logSkip(reason: WeatherSkipReason): void {
    if (!skipGate(reason)) return;
    logEvent({
      level: 'debug',
      surface: SURFACE,
      message: 'weather_skipped',
      context: { action: 'skip', detail: reason },
    });
  }

  function logDropped(kind: WeatherRefreshKind, detail: DropReason): void {
    logEvent({
      level: 'debug',
      surface: SURFACE,
      message: 'weather_fetch_dropped',
      context: { action: 'fetch', kind, detail },
    });
  }

  function logUnknownCodes(observation: WeatherObservation): void {
    const codes = [observation.current.code, ...observation.daily.map((d) => d.code)];
    for (const code of codes) {
      if (glyphFor(code, true).known || unknownCodesLogged.has(code)) continue;
      unknownCodesLogged.add(code);
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'weather_unknown_code',
        context: { error_code: 'unknown_code', count: code },
      });
    }
  }

  // ── Fetching ───────────────────────────────────────────────────────────────
  /** Why an answer for `asked` no longer applies, or null when it still does. */
  function supersededBy(asked: Asked): DropReason | null {
    if (halted) return 'halted';
    // Show Weather went off mid-flight: the answer is neither cached nor shown.
    if (!settingsStore.weatherEnabled) return 'disabled';
    if (asked.familyId !== familyContextStore.activeFamilyId) return 'superseded';
    if (asked.placeKey !== placeKey.value) return 'superseded';
    return null;
  }

  function onFetchSuccess(
    asked: Asked,
    observation: WeatherObservation,
    kind: WeatherRefreshKind,
    previousAgeMin: number,
    durationMs: number
  ): void {
    const dropped = supersededBy(asked);
    if (dropped) return logDropped(kind, dropped);
    const next: WeatherReading = {
      v: 1,
      familyId: asked.familyId,
      placeKey: asked.placeKey,
      ...observation,
    };
    const written = writeWeatherCache(next);
    if (!written.ok) {
      // The in-memory reading still shows; only the next cold start loses it.
      reportError({
        surface: SURFACE,
        severity: 'warning',
        message: 'weather_cache',
        error: written.error,
        context: { action: 'cache', error_code: 'cache_write_failed' },
      });
    }
    reading.value = next;
    failure.value = null;
    nowMs.value = Date.now();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'weather_fetch',
      context: {
        action: 'fetch',
        kind,
        http_status: 200,
        weather_age_min: previousAgeMin,
        perf_duration_ms: durationMs,
      },
    });
    logUnknownCodes(observation);
  }

  function onFetchFailure(asked: Asked, error: unknown, kind: WeatherRefreshKind): void {
    const typed = error instanceof WeatherFetchError ? error : null;
    // The caller moved on (a new place, a family switch, sign-out): never stored or shown.
    if (typed?.code === 'aborted') return;
    const dropped = supersededBy(asked);
    if (dropped) return logDropped(kind, dropped);
    const code: WeatherErrorCode = typed?.code ?? 'parse';
    const count = (failure.value?.count ?? 0) + 1;
    const backoffMs = nextBackoffMs(count, code);
    const now = Date.now();
    failure.value = { code, count, until: now + backoffMs };
    nowMs.value = now;
    console.warn(
      `[weather] forecast failed (${code}): ${typed?.devHint ?? 'unexpected error, see the report'}`
    );
    reportError({
      surface: SURFACE,
      severity: 'warning',
      message: 'weather_fetch_failed',
      error,
      context: {
        action: 'fetch',
        kind,
        error_code: code,
        http_status: typed?.httpStatus ?? 0,
        weather_age_min: weatherAgeMin(reading.value?.fetchedAt, now),
        detail: `backoff=${Math.round(backoffMs / 60_000)}`,
      },
    });
  }

  /**
   * Abandon the running forecast: its answer is no longer wanted. The caller must queue a
   * `request` straight after (the trailing run takes over `fetching`).
   */
  function abortInflight(): void {
    inflight?.abort();
    inflight = null;
  }

  /** One refresh attempt: decide, then ask, then apply or drop. Never calls `request`. */
  async function run(kind: WeatherRefreshKind): Promise<void> {
    const now = Date.now();
    nowMs.value = now;
    const familyId = familyContextStore.activeFamilyId;
    const key = placeKey.value;
    const place: WeatherPlace | null = settingsStore.weatherPlace;
    const decision = pickWeatherRefresh({
      halted,
      docReady: docReady.value,
      hasFamily: familyId !== null,
      enabled: settingsStore.weatherEnabled,
      hasPlace: key !== null && place !== null,
      online: isOnline.value,
      ageMs: reading.value ? now - reading.value.fetchedAt : null,
      now,
      backoffUntil: failure.value?.until ?? 0,
    });
    if (decision.action === 'skip' || !familyId || !key || !place) {
      // Nothing in flight now; this also ends a hand-off from an aborted run (below).
      fetching.value = false;
      logSkip(decision.action === 'skip' ? decision.reason : 'pre-hydration');
      return;
    }
    const asked: Asked = { familyId, placeKey: key };
    const previousAgeMin = weatherAgeMin(reading.value?.fetchedAt, now);
    const controller = new AbortController();
    inflight = controller;
    fetching.value = true;
    try {
      const observation = await fetchForecast(place, homeZone.value, controller.signal);
      onFetchSuccess(asked, observation, kind, previousAgeMin, Date.now() - now);
    } catch (e) {
      onFetchFailure(asked, e, kind);
    } finally {
      // A run the watch abandoned (`abortInflight`) leaves `fetching` set: the watch queued the
      // trailing run in the same breath, and that run either fetches or clears the flag when it
      // skips. Clearing it here would show `unavailable` (and log the stage) for the microtasks
      // between this run settling and the trailing run starting.
      if (inflight === controller) {
        inflight = null;
        fetching.value = false;
      }
    }
  }

  // The latest trigger's kind wins: it is the one the trailing run answers.
  const flight = createTrailingSingleFlight<WeatherRefreshKind, void>(
    run,
    (_q, incoming) => incoming
  );

  function request(kind: WeatherRefreshKind): Promise<void> {
    nowMs.value = Date.now();
    return flight.call(kind).catch((e: unknown) => {
      // `run` catches its own failures; anything here is a bug in the store itself.
      reportError({
        surface: SURFACE,
        severity: 'warning',
        message: 'weather refresh run threw',
        error: e,
        context: { action: 'fetch', kind },
      });
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  /**
   * Search for a home town, as a value: expected failures come back as `{ ok: false, code }`
   * (with the developer hint on the console), so the field needs no try/catch. Adds the app
   * language and the family country (which narrows a ZIP query). Never throws.
   */
  async function searchPlaces(query: string, signal?: AbortSignal): Promise<WeatherSearchResult> {
    // Off means no lookups at all, geocoding included.
    if (!settingsStore.weatherEnabled) return { ok: true, places: [] };
    const q = query.trim();
    const kind = /^\d+$/.test(q) ? 'zip' : 'name';
    const started = Date.now();
    try {
      const places = await searchPlacesService(
        q,
        translationStore.currentLanguage,
        settingsStore.familyCountry ?? settingsStore.country,
        signal
      );
      if (q.length >= SEARCH_MIN_CHARS) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'weather_geocode',
          // Never the query text: only how many results, and whether it looked like a ZIP.
          context: {
            action: 'geocode',
            count: places.length,
            kind,
            perf_duration_ms: Date.now() - started,
          },
        });
      }
      return { ok: true, places };
    } catch (e) {
      const typed = e instanceof WeatherFetchError ? e : null;
      if (typed?.code === 'aborted') return { ok: false, code: 'aborted' };
      const code: WeatherErrorCode = typed?.code ?? 'parse';
      console.warn(
        `[weather] home-town search failed (${code}): ${typed?.devHint ?? 'unexpected error, see the report'}`
      );
      reportError({
        surface: SURFACE,
        severity: 'warning',
        message: 'weather_geocode_failed',
        error: e,
        context: { action: 'geocode', error_code: code, http_status: typed?.httpStatus ?? 0 },
      });
      return { ok: false, code };
    }
  }

  /**
   * Sign-out, BEFORE the session ends: stop asking, abort the running forecast, wait for it
   * to settle, drop the reading and only then delete the device cache, so no answer can write
   * the departing family's reading back. Never throws.
   */
  async function haltForSignOut(): Promise<void> {
    halted = true;
    inflight?.abort();
    const pending = flight.pending();
    if (pending) await pending.catch(() => undefined);
    reading.value = null;
    failure.value = null;
    clearWeatherCache();
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  watch(
    [
      docReady,
      () => settingsStore.weatherEnabled,
      placeKey,
      () => familyContextStore.activeFamilyId,
    ],
    ([ready, enabled, key, familyId], previous) => {
      const [, , prevKey, prevFamilyId] = previous ?? [];
      // A session boundary lifts the sign-out latch: the session going away, or one starting.
      const present = ready && familyId !== null;
      if (!present || !lastSessionPresent) halted = false;
      lastSessionPresent = present;

      const questionChanged =
        previous === undefined || key !== prevKey || familyId !== prevFamilyId;
      // The old question's answer is no longer wanted, nor any answer once weather is off.
      if (questionChanged || !enabled) abortInflight();
      if (questionChanged) {
        // A new question gets a fresh backoff.
        failure.value = null;
        reading.value = hydrate(familyId, key);
      }
      void request('settings');
    },
    { immediate: true }
  );

  /** The cached reading for this family and place, or null (no family, no place, a miss). */
  function hydrate(familyId: string | null, key: string | null): WeatherReading | null {
    if (!familyId || !key) return null;
    const cached = readWeatherCache(familyId, key);
    return cached.kind === 'ok' ? cached.value : null;
  }

  watch(isOnline, (online) => {
    if (online) void request('online');
  });

  watch(lastVisibleAt, () => {
    nowMs.value = Date.now();
    void request('foreground');
  });

  usePollWhileVisible(() => request('tick'), WEATHER_POLL_MS, { surface: SURFACE });

  watch(atomStage, (stage) => {
    if (stage === null || !stalenessGate(stage)) return;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'weather_staleness',
      context: {
        action: 'staleness',
        stage,
        weather_age_min: weatherAgeMin(reading.value?.fetchedAt, nowMs.value),
      },
    });
  });

  return {
    reading,
    failure,
    fetching,
    docReady,
    homeZone,
    placeKey,
    isActive,
    atom,
    /** The shortest query `searchPlaces` sends (the service's floor), for the home-town field. */
    searchMinChars: SEARCH_MIN_CHARS,
    searchPlaces,
    haltForSignOut,
  };
});
