/**
 * The failure backoff ladder shared by every device-side remote fetch (weather, live flight
 * checks): 5, 10, 20, 40, then 60 min, so a provider outage cannot multiply the call volume.
 * Moved from `utils/weather/weatherRefresh.ts` (which re-exports it) so the two stores share
 * one ladder instead of two copies drifting apart.
 */
import type { RemoteFetchErrorCode } from '@/types/remoteFetch';

const MINUTE_MS = 60_000;
const BACKOFF_BASE_MS = 5 * MINUTE_MS;
/** The ladder's ceiling, and a `rate_limited` answer's wait. */
export const BACKOFF_MAX_MS = 60 * MINUTE_MS;

/**
 * How long to wait after the `failureCount`th failure in a row: 5, 10, 20, 40, then 60 min.
 * A `rate_limited` answer waits the full hour straight away (a quota resets on the hour at the
 * earliest). With no `code` (a failed pod write, which has no remote error code) it is the
 * plain ladder. Typed on the shared vocabulary: a service-only code such as flight checks'
 * `not_configured` never enters the ladder (it is a refresh skip reason).
 */
export function nextBackoffMs(failureCount: number, code?: RemoteFetchErrorCode): number {
  if (code === 'rate_limited') return BACKOFF_MAX_MS;
  const steps = Math.max(0, Math.floor(failureCount) - 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(steps, 10));
}

/**
 * A load that fails in EPISODES (a sound file, a code chunk): after each failure in a row the
 * next attempt waits the ladder above (5 min, doubling to an hour), so a screen that stays open
 * for weeks (the beanie wall) neither hammers a broken load nor gives up on it for good. `fail`
 * answers true only for the failure that STARTS an episode, so it is reported once per episode,
 * never once per attempt; `succeed` ends the episode.
 */
export interface FailureBackoff {
  /** May a new attempt start now? */
  ready(now?: number): boolean;
  /** Record a failure; true when it starts a new episode (report it). */
  fail(now?: number): boolean;
  succeed(): void;
}

export function failureBackoff(): FailureBackoff {
  let failures = 0;
  let retryAt = 0;
  return {
    ready: (now = Date.now()) => now >= retryAt,
    fail(now = Date.now()) {
      failures++;
      retryAt = now + nextBackoffMs(failures);
      return failures === 1;
    },
    succeed() {
      failures = 0;
      retryAt = 0;
    },
  };
}
