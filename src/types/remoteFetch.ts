/**
 * Failure vocabulary shared by every device-side remote fetch with a backoff ladder (weather,
 * live flight checks). One union and one record shape, so `nextBackoffMs` and the stores'
 * failure handling are written once. Type-only module.
 */

/** Every way a remote call can fail. `aborted` = the caller moved on (never logged or shown). */
export type RemoteFetchErrorCode =
  'aborted' | 'network' | 'timeout' | 'http_4xx' | 'http_5xx' | 'rate_limited' | 'parse';

/** A store's failure record for one fetch target: one assignment clears or resets it. */
export interface RemoteFetchFailure<C extends string = RemoteFetchErrorCode> {
  code: C;
  count: number;
  /** Epoch ms before which the store does not ask again (the backoff). */
  until: number;
}
