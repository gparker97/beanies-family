/**
 * place-search Lambda (#150): address suggestions for location fields, through a capped proxy.
 *
 *   POST /place-search/suggest  { q, lang, bias? }  → { suggestions: [{ placeId, main, secondary }] }
 *   POST /place-search/resolve  { placeId, lang }   → { placeId, address }
 *
 * A thin, ANONYMOUS proxy in front of Google (Places API (New) Autocomplete, and Geocoding by
 * place id for the stored address line). The provider key never ships in a bundle, and the
 * Lambda builds both Google requests itself from validated fields: nothing the client sends is
 * relayed, so the endpoint cannot be used as a general Maps API.
 *
 * WHAT IS SENT TO GOOGLE: the typed text, an allowlisted language, and (when the family has a
 * home town) a point rounded to 2 decimals plus a country code. No family id, member id, token
 * or client IP. The query is refused (`bad_query`) when it holds a link (`://`), an email
 * (`@` + dotted host) or a line break, so neither can reach Google from any client.
 *
 * WHAT BOUNDS THE BILL. The soft x-api-key ships in the public bundle; the route throttle and the
 * reserved concurrency cap volume and parallelism; a per-IP hourly limit stops one address. None
 * of those bounds spend against a rotating-IP caller. The two GLOBAL DAILY CAPS do (suggest and
 * resolve, separate counters): the worst case is one day's cap and quiet fields until 00:00 UTC.
 * They fail CLOSED, including when the counter table is unset. Same posture as flight-status
 * (ADR-045), recorded for this proxy in ADR-049.
 *
 * ACCEPTED RESIDUAL RISK: a bundle-reader can spend the day's cap and quieten every family's
 * suggestions until midnight (fields keep working as plain text, and the cap alarms). Bounded
 * rather than solved, on purpose: do NOT "fix" it by sending a family id here.
 *
 * LOGGING: one JSON line per request (route, outcome, status, count, provider_ms, q_len, and a
 * fixed-vocabulary code/reason on failure). NEVER the query, a place id, an address, a header, a
 * key or the source IP.
 *
 * MODULE MAP:
 *   createHandler.mjs   validation, the limits, the dispatch, the answer caps, the logging
 *   http.mjs            responses, body reading, the code table (generic parts pinned to flight-status)
 *   store.mjs           per-IP + the two daily caps (ip fails OPEN, day caps fail CLOSED)
 *   ddb.mjs             DynamoDB primitives (pinned to flight-status)
 *   providers/google.mjs  the only vendor-aware code
 *
 * This file only wires the real adapter into the factory.
 */

import * as google from './providers/google.mjs';
import { createHandler } from './createHandler.mjs';

export { ALARMING_PREFIXES, ERROR_CODES, STATUS_FOR_CODE } from './createHandler.mjs';

export const handler = createHandler({ provider: google });
