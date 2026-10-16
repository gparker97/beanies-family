/**
 * Should the weather store call the provider NOW (#134, ADR-043)? Pure, the
 * `pickRateRefreshAction` pattern: the store evaluates it when a run starts, so a tick that
 * lands during a place-change fetch becomes a cheap skip.
 *
 * What a reading MEANS is `weatherReading.ts`; this file only decides when to ask, so a
 * change to the cadence never touches the display rules and the reverse.
 */
import type { WeatherErrorCode } from '@/types/weather';

const MINUTE_MS = 60_000;
/** A reading younger than this is not refetched: one combined call per half hour at most. */
export const REFRESH_AFTER_MS = 30 * MINUTE_MS;
/** The store's visible-tab poll. Each tick only asks; the decision below usually skips. */
export const WEATHER_POLL_MS = 5 * MINUTE_MS;
/** The failure backoff ladder: 5, 10, 20, 40, then 60 min. */
const BACKOFF_BASE_MS = 5 * MINUTE_MS;
const BACKOFF_MAX_MS = 60 * MINUTE_MS;

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

/**
 * How long to wait after the `failureCount`th failure in a row: 5, 10, 20, 40, then 60 min,
 * so a provider outage cannot multiply the call volume. A `rate_limited` answer waits the
 * full hour straight away (the quota resets on the hour at the earliest).
 */
export function nextBackoffMs(failureCount: number, code: WeatherErrorCode): number {
  if (code === 'rate_limited') return BACKOFF_MAX_MS;
  const steps = Math.max(0, Math.floor(failureCount) - 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(steps, 10));
}
