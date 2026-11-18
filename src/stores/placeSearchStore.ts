/**
 * Address suggestions (#150, ADR-049): NETWORK STATE ONLY, and the only caller of
 * `placeSearchApi`. Per-field state (the typed query, the list, the cache, the session cap)
 * lives in `usePlaceSearch`, one instance per field; this store answers "may we ask at all",
 * makes the one provider request, and owns the dev budget, the ranking hint, the language, the
 * quiet period and every piece of telemetry.
 *
 * WHO SEES A FAILURE: nobody, for a passive lookup. Every refusal, cap, timeout and outage
 * comes back as `{ ok: false, code }` and the field simply does not open its list (CLAUDE.md
 * "don't warn that a flow might fail"). Each still emits telemetry and one console line with
 * the typed error's `devHint`, deduplicated per code. Only a tapped suggestion whose address
 * fetch fails is shown (by the field, `location.pickFailed`).
 *
 * PRIVACY: never the typed text, a place id, a name or an address in any log or telemetry
 * call. Counts, outcomes, codes and timings only (a unit test asserts it).
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useOnline } from '@/composables/useOnline';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import {
  PlaceSearchApiError,
  fetchPlaceAddress,
  isPlaceSearchConfigured,
  suggestPlaces,
} from '@/services/placeSearch/placeSearchApi';
import { createChangeGate } from '@/services/telemetry/emitPolicy';
import { logEvent } from '@/services/telemetry/logEvent';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import type {
  PlaceBias,
  PlaceFieldKind,
  PlaceSearchErrorCode,
  PlaceSearchOutcome,
  PlaceSuggestion,
} from '@/types/placeSearch';
import { consumeAttempt } from '@/utils/attemptBudget';
import { reportError } from '@/utils/errorReporter';
import { locationLinksEnabled } from '@/utils/location/locationLinks';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';

const SURFACE = 'place-search';

/** Dev builds share the production cap, so a dev device stops at 30 provider requests a day. */
export const DEV_PLACE_SEARCH_BUDGET = Object.freeze({ max: 30, windowMs: 86_400_000 });
const DEV_BUDGET_KEY = 'place-search-dev';

/** The Lambda answers that mean "stop asking for a while". */
const QUIET_CODES: ReadonlySet<PlaceSearchErrorCode> = new Set([
  'budget_exhausted',
  'budget_unavailable',
  'rate_limited',
]);

/** Why the store will not ask right now (null = it will). Checked in this order. */
export type PlaceSearchUnavailableReason =
  'flag-off' | 'switch-off' | 'offline' | 'not-configured' | 'quiet';

type QuietDetail = 'budget' | 'rate' | 'session-cap' | 'dev-cap' | 'not-configured';

/** The next 00:00 UTC after `now`. */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Longest delay a browser `setTimeout` honours (about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

function readQuietUntil(): number {
  const read = readStoredJson(STORAGE_KEYS.PLACE_SEARCH_QUIET, SURFACE);
  if (read.kind !== 'ok') return 0;
  const until = (read.value as { until?: unknown } | null)?.until;
  return typeof until === 'number' && Number.isFinite(until) && until > Date.now() ? until : 0;
}

export const usePlaceSearchStore = defineStore('placeSearch', () => {
  const settingsStore = useSettingsStore();
  const translationStore = useTranslationStore();
  const { isOnline } = useOnline();

  // ── Quiet period ───────────────────────────────────────────────────────────
  /** Epoch ms until which no lookup is made (0 = none). Survives a reload. */
  const quietUntil = ref(0);
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  function armQuiet(until: number): void {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
    quietUntil.value = until;
    const wait = until - Date.now();
    if (wait <= 0) {
      quietUntil.value = 0;
      return;
    }
    quietTimer = setTimeout(
      () => {
        quietTimer = null;
        if (Date.now() >= quietUntil.value) quietUntil.value = 0;
        else armQuiet(quietUntil.value);
      },
      Math.min(wait, MAX_TIMER_MS)
    );
  }
  armQuiet(readQuietUntil());

  /**
   * End an expired quiet period BY THE CLOCK, in memory and in storage. The timer above does
   * not count time while a device sleeps or a Capacitor app is backgrounded, and `available`
   * stays false until something clears it, so `usePlaceSearch` calls this on every keystroke,
   * before deciding whether to ask. Cheap: one comparison when there is no quiet period.
   */
  function refreshQuiet(): void {
    if (quietUntil.value === 0 || Date.now() < quietUntil.value) return;
    armQuiet(0);
    removeStoredJson(STORAGE_KEYS.PLACE_SEARCH_QUIET, SURFACE);
  }

  // ── Availability ───────────────────────────────────────────────────────────
  const unavailableReason = computed<PlaceSearchUnavailableReason | null>(() => {
    if (!locationLinksEnabled()) return 'flag-off';
    if (!settingsStore.addressSuggestionsEnabled) return 'switch-off';
    if (!isOnline.value) return 'offline';
    if (!isPlaceSearchConfigured()) return 'not-configured';
    if (quietUntil.value > 0) return 'quiet';
    return null;
  });
  /** Whether a field may ask for suggestions at all right now. */
  const available = computed(() => unavailableReason.value === null);

  // ── Request inputs ─────────────────────────────────────────────────────────
  /** The family's home town (already rounded to 2 decimals), or none. Never device location. */
  function bias(): PlaceBias | undefined {
    const place = settingsStore.weatherPlace;
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return undefined;
    const countryCode = /^[A-Za-z]{2}$/.test(place.countryCode ?? '')
      ? place.countryCode.toUpperCase()
      : undefined;
    return { lat: place.lat, lon: place.lon, ...(countryCode ? { countryCode } : {}) };
  }
  const lang = () => translationStore.currentLanguage;

  // ── Logging ────────────────────────────────────────────────────────────────
  const failureGates = { suggest: createChangeGate(), resolve: createChangeGate() };
  const devCapGate = createChangeGate();
  let notConfiguredLogged = false;

  function logQuiet(detail: QuietDetail, fieldKind?: PlaceFieldKind): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_quiet',
      context: { action: 'quiet', detail, ...(fieldKind ? { stage: fieldKind } : {}) },
    });
  }

  /**
   * Lookups stopped for a reason the store did not see itself: the composable's per-field
   * session cap, or a build with no endpoint (logged once per session).
   */
  function noteQuiet(detail: 'session-cap' | 'not-configured', fieldKind: PlaceFieldKind): void {
    if (detail === 'not-configured') {
      if (notConfiguredLogged) return;
      notConfiguredLogged = true;
      console.warn(
        '[place-search] address suggestions are off in this build: set VITE_PLACE_SEARCH_URL and VITE_PLACE_SEARCH_API_KEY'
      );
    }
    logQuiet(detail, fieldKind);
  }

  function logFailure(action: 'suggest' | 'resolve', e: unknown, code: PlaceSearchErrorCode): void {
    // One console hint and one firehose event per code in a row (an outage cannot flood the
    // 50-per-surface-per-minute limit and starve `place_suggest`).
    if (!failureGates[action](code)) return;
    const typed = e instanceof PlaceSearchApiError ? e : null;
    console.warn(
      `[place-search] ${action} failed (${code}): ${typed?.devHint ?? 'unexpected error, see the report'}`
    );
    reportError({
      surface: SURFACE,
      severity: 'warning',
      message: action === 'suggest' ? 'place_suggest_failed' : 'place_resolve_failed',
      error: e,
      context: { action, error_code: code, http_status: typed?.httpStatus ?? 0 },
    });
  }

  /** A cap or rate-limit answer: go quiet until the server's `retryAfterSeconds`, else 00:00 UTC. */
  function enterQuiet(e: PlaceSearchApiError): void {
    const now = Date.now();
    const until = e.retryAfterSeconds ? now + e.retryAfterSeconds * 1000 : nextUtcMidnight(now);
    armQuiet(until);
    writeStoredJson(STORAGE_KEYS.PLACE_SEARCH_QUIET, { until }, SURFACE);
    logQuiet(e.code === 'rate_limited' ? 'rate' : 'budget');
  }

  /**
   * Dev builds only: spend one of the day's 30 provider requests, or refuse (logged once per
   * UTC day, on the console too). Production builds always pass.
   */
  function devBudgetAllows(): boolean {
    if (!import.meta.env.DEV) return true;
    const verdict = consumeAttempt(DEV_BUDGET_KEY, DEV_PLACE_SEARCH_BUDGET);
    if (verdict.ok) return true;
    if (devCapGate(new Date().toISOString().slice(0, 10))) {
      console.warn(
        `[place-search] dev build spent its ${DEV_PLACE_SEARCH_BUDGET.max} lookups for today; suggestions resume at ${new Date(verdict.resetsAt).toISOString()} (DEV_PLACE_SEARCH_BUDGET in placeSearchStore.ts)`
      );
      logQuiet('dev-cap');
    }
    return false;
  }

  /** The gate every request passes first: availability, then the dev budget. */
  function refusal(): PlaceSearchOutcome<object> | null {
    refreshQuiet();
    if (unavailableReason.value === 'not-configured') return { ok: false, code: 'not_configured' };
    if (!available.value) return { ok: false, code: 'unavailable' };
    if (!devBudgetAllows()) return { ok: false, code: 'dev_capped' };
    return null;
  }

  function codeOf(e: unknown): PlaceSearchErrorCode {
    return e instanceof PlaceSearchApiError ? e.code : 'parse';
  }

  // ── Requests ───────────────────────────────────────────────────────────────
  /**
   * One provider request for suggestions. Never throws. `attempt` is `typed` for what the
   * member typed and `retry` for the composable's one trimmed retry (telemetry `kind`).
   */
  async function requestSuggestions(
    q: string,
    opts: { signal?: AbortSignal; fieldKind: PlaceFieldKind; attempt?: 'typed' | 'retry' }
  ): Promise<PlaceSearchOutcome<{ suggestions: PlaceSuggestion[] }>> {
    const refused = refusal();
    if (refused) return refused as PlaceSearchOutcome<{ suggestions: PlaceSuggestion[] }>;
    const started = Date.now();
    try {
      const suggestions = await suggestPlaces({
        q,
        lang: lang(),
        bias: bias(),
        signal: opts.signal,
      });
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'place_suggest',
        context: {
          action: 'suggest',
          count: suggestions.length,
          kind: opts.attempt ?? 'typed',
          stage: opts.fieldKind,
          perf_duration_ms: Date.now() - started,
        },
      });
      return { ok: true, suggestions };
    } catch (e) {
      const code = codeOf(e);
      if (code === 'aborted') return { ok: false, code };
      if (e instanceof PlaceSearchApiError && QUIET_CODES.has(code)) enterQuiet(e);
      logFailure('suggest', e, code);
      return { ok: false, code };
    }
  }

  /** A suggestion answered from the field's own cache (no request): counted all the same. */
  function noteCachedSuggest(count: number, fieldKind: PlaceFieldKind): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_suggest',
      context: { action: 'suggest', count, kind: 'cached', stage: fieldKind },
    });
  }

  /**
   * The provider's formatted address for a tapped suggestion (one Geocoding call). Never
   * throws; a failure is the one member-visible state (the field's `location.pickFailed`).
   */
  async function requestAddress(
    placeId: string,
    opts: { signal?: AbortSignal; fieldKind: PlaceFieldKind }
  ): Promise<PlaceSearchOutcome<{ address: string }>> {
    const refused = refusal();
    if (refused) return refused as PlaceSearchOutcome<{ address: string }>;
    try {
      const { address } = await fetchPlaceAddress({ placeId, lang: lang(), signal: opts.signal });
      return { ok: true, address };
    } catch (e) {
      const code = codeOf(e);
      if (code === 'aborted') return { ok: false, code };
      if (e instanceof PlaceSearchApiError && QUIET_CODES.has(code)) enterQuiet(e);
      logFailure('resolve', e, code);
      return { ok: false, code };
    }
  }

  // ── Field outcomes (the field reports through usePlaceSearch; logged here only) ──
  function notePick(fieldKind: PlaceFieldKind, withDetail: boolean): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_pick',
      context: {
        action: 'pick',
        kind: fieldKind,
        detail: withDetail ? 'with-detail' : 'no-detail',
      },
    });
  }
  /** A pick whose address arrived after the member moved on: dropped, nothing applied. */
  function notePickSuperseded(fieldKind: PlaceFieldKind): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_pick_superseded',
      context: { action: 'pick', detail: 'superseded', kind: fieldKind },
    });
  }
  function notePickFailedShown(fieldKind: PlaceFieldKind): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_pick_failed_shown',
      context: { action: 'pick', detail: 'failed-shown', kind: fieldKind },
    });
  }
  function noteKeepTyped(fieldKind: PlaceFieldKind): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_keep_typed',
      context: { action: 'keep-typed', kind: fieldKind },
    });
  }
  function noteRemoved(fieldKind: PlaceFieldKind, restored: 'original' | 'composed'): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_removed',
      context: { action: 'remove', kind: fieldKind, detail: restored },
    });
  }
  /** A stored place that fails `validPlace` (an older build rewrote the string's start). */
  function noteStale(fieldKind: PlaceFieldKind): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'place_ref_stale',
      context: { action: 'stale', kind: fieldKind },
    });
  }

  return {
    available,
    unavailableReason,
    quietUntil,
    refreshQuiet,
    requestSuggestions,
    requestAddress,
    noteQuiet,
    noteCachedSuggest,
    notePick,
    notePickSuperseded,
    notePickFailedShown,
    noteKeepTyped,
    noteRemoved,
    noteStale,
  };
});
