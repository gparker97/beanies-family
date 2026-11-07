/**
 * Should the weather store call the provider NOW (#134, ADR-043)? Pure, the
 * `pickRateRefreshAction` pattern: the store evaluates it when a run starts, so a tick that
 * lands during a place-change fetch becomes a cheap skip.
 *
 * What a reading MEANS is `weatherReading.ts`; this file only decides when to ask, so a
 * change to the cadence never touches the display rules and the reverse.
 */
const MINUTE_MS = 60_000;
/** A reading younger than this is not refetched: one combined call per half hour at most. */
export const REFRESH_AFTER_MS = 30 * MINUTE_MS;
/** The store's visible-tab poll. Each tick only asks; the decision below usually skips. */
export const WEATHER_POLL_MS = 5 * MINUTE_MS;

/** Why a refresh did not run, checked in this order. Rides `detail` on `weather_skipped`. */
export type WeatherSkipReason =
  'halted' | 'pre-hydration' | 'disabled' | 'no-place' | 'offline' | 'backoff' | 'fresh';

export type WeatherRefreshDecision =
  | { action: 'skip'; reason: WeatherSkipReason }
  | { action: 'fetch'; reason: 'no-reading' | 'stale' };

export interface WeatherRefreshInput {
  /** Sign-out is under way (`haltForSignOut`); lifts at the next session boundary. */
  halted: boolean;
  /** The family doc is loaded for display. */
  docReady: boolean;
  /** An active family exists. */
  hasFamily: boolean;
  /** The family's Show Weather switch. */
  enabled: boolean;
  /** A home town is set. */
  hasPlace: boolean;
  online: boolean;
  /** Age of the reading on hand for this place, or null when there is none. */
  ageMs: number | null;
  now: number;
  /** Epoch ms before which a failure's backoff holds (0 when none). */
  backoffUntil: number;
}

/** The refresh decision. Skip reasons are checked in the order of `WeatherSkipReason`. */
export function pickWeatherRefresh(input: WeatherRefreshInput): WeatherRefreshDecision {
  if (input.halted) return { action: 'skip', reason: 'halted' };
  if (!input.docReady || !input.hasFamily) return { action: 'skip', reason: 'pre-hydration' };
  if (!input.enabled) return { action: 'skip', reason: 'disabled' };
  if (!input.hasPlace) return { action: 'skip', reason: 'no-place' };
  if (!input.online) return { action: 'skip', reason: 'offline' };
  if (input.now < input.backoffUntil) return { action: 'skip', reason: 'backoff' };
  if (input.ageMs === null) return { action: 'fetch', reason: 'no-reading' };
  if (input.ageMs < REFRESH_AFTER_MS) return { action: 'skip', reason: 'fresh' };
  return { action: 'fetch', reason: 'stale' };
}

/** The shared ladder (`utils/backoff.ts`), re-exported so weather callers are unchanged. */
export { nextBackoffMs } from '@/utils/backoff';
