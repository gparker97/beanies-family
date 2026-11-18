/**
 * Place search (#150): address suggestions from the `place-search` proxy Lambda (ADR-049). The
 * client only ever sees these beanies shapes, never the provider's.
 */

/** One suggestion row. `main` + `secondary` are Google's text (shown, never stored). */
export interface PlaceSuggestion {
  placeId: string;
  main: string;
  secondary: string;
}

/** The ranking hint sent with a lookup: the family's home town, already rounded to 2 decimals. */
export interface PlaceBias {
  lat: number;
  lon: number;
  countryCode?: string;
}

/**
 * Every `code` the `place-search` Lambda documents (`STATUS_FOR_CODE` in
 * `infrastructure/lambda/place-search/http.mjs`); a parity test pins the list.
 */
export const PLACE_SEARCH_LAMBDA_CODES = [
  'method_not_allowed',
  'unauthorized',
  'not_found',
  'too_large',
  'bad_request',
  'bad_query',
  'bad_bias',
  'bad_place_id',
  'rate_limited',
  'budget_exhausted',
  'budget_unavailable',
  'upstream_timeout',
  'upstream_network',
  'upstream_auth',
  'upstream_rate_limited',
  'upstream_unavailable',
  'upstream_http',
  'internal_error',
] as const;
export type PlaceSearchLambdaCode = (typeof PLACE_SEARCH_LAMBDA_CODES)[number];

/**
 * A failed lookup, classified. The Lambda's own code when it sent one; otherwise the client's:
 * `not_configured` (env unset, a skip), `aborted` (the caller cancelled: never a failure),
 * `timeout` (this client's 10 s deadline), `network`, `parse` (a body that is not the expected
 * shape), and `http_4xx` / `http_5xx` for a status with no recognised code.
 */
export type PlaceSearchErrorCode =
  | PlaceSearchLambdaCode
  | 'not_configured'
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'parse'
  | 'http_4xx'
  | 'http_5xx';

/**
 * Which kind of field a lookup came from (telemetry only: a closed vocabulary, never text).
 * `activity` = activity location; `segment` = travel segment location; `idea` = trip idea;
 * `stay` = accommodation address; `agency` = transport agency address; `contact` = emergency
 * contact address.
 */
export type PlaceFieldKind = 'activity' | 'segment' | 'idea' | 'stay' | 'agency' | 'contact';

/** A store answer: never thrown. `unavailable` = the store refused before any request. */
export type PlaceSearchOutcome<T> =
  ({ ok: true } & T) | { ok: false; code: PlaceSearchErrorCode | 'unavailable' | 'dev_capped' };
