/**
 * flight-status Lambda (#143): `POST /flight-status { flight, date }` → `{ legs, fetchedAt, cached }`.
 *
 * A thin, ANONYMOUS proxy in front of the flight-data provider (AeroDataBox). The device does all
 * the thinking (matching, diffing, applying a schedule change to the pod); this function only turns
 * a public flight number and date into a normalised `FlightLeg[]`, so the provider key never ships
 * in a bundle and a provider swap is a change here plus terraform variables.
 *
 * WHY ANONYMOUS: the request carries the flight number and date and nothing else. No family id, no
 * route, no names, so the Settings sentence "beanies sends only the flight number and date" is
 * literally true and the zero-knowledge posture (ADR-011/029) is untouched. Entitlement (magic
 * beans) is therefore enforced on the CLIENT; this function cannot tell who is asking, and does
 * not try.
 *
 * WHAT BOUNDS THE SPEND. The soft x-api-key ships in the public bundle, the route throttle and
 * reserved concurrency cap volume and parallelism, and a per-IP hourly limit and a result cache
 * absorb ordinary use. None of those bounds paid units: the Starter plan is 40,000 units a month
 * with no overage, so at the route's 5 req/s an attacker rotating IPs and flight#date keys would
 * spend the month in about an hour and every family would lose live checks until the next cycle.
 * The GLOBAL DAILY PROVIDER-CALL CAP is the control that bounds it: the worst case is one day's
 * budget and a cache-only Lambda until UTC midnight. Recorded in ADR-045.
 *
 * ACCEPTED RESIDUAL RISK: a bundle-reader can spend the day's cap and deny fresh checks to every
 * family until midnight (cached answers are still served, and the cap alarms). Bounded rather than
 * solved, on purpose. Do NOT "fix" it by sending a family id here: that trades the privacy promise
 * for a metering problem Phase 1 does not have. Per-family metering, if ever needed, is a Phase 2
 * question.
 *
 * PHASE 2 (flight change push, ADR-046): the same function also holds anonymous alert
 * subscriptions (flight number, date, provider leg codes, an opaque push address) in a second
 * table, receives the provider's webhooks and pushes a nameless notice through APNs/FCM. Still no
 * family id: the entitlement proof is an hour-rounded signed token that names nobody.
 *
 * MODULE MAP (one job per module; find a job by name):
 *   createHandler.mjs  the Phase 1 proxy (`POST /flight-status`) + the dispatch
 *   http.mjs           responses, body reading, the code table, logLine, safeEqual
 *   store.mjs          Phase 1 cache + per-IP + global daily cap (fails OPEN)
 *   alerts.mjs         `POST /flight-status/subscribe` + `/unsubscribe`
 *   webhook.mjs        `POST /flight-status/webhook/{secret}` (the provider's callback)
 *   cleanup.mjs        the 6-hourly sweep (`{ task: 'cleanup' }`), the only provider canceller
 *   credits.mjs        keeps the provider's alert credit balance above the floor
 *   alertsStore.mjs    the alerts table grammar (fails CLOSED)
 *   alertToken.mjs     verifies the registry-minted entitlement token
 *   schedule.mjs       the restated revision contract + the webhook's per-device push plan
 *   copy.mjs           the push sentences, en + zh
 *   push/              the APNs and FCM senders behind `senderFor(platform)`
 *   providers/         the only vendor-aware code (AeroDataBox)
 *   ddb.mjs            DynamoDB primitives
 *
 * This file only wires the real adapter into the factory; the dispatcher is `createHandler.mjs`.
 */

import * as aerodatabox from './providers/aerodatabox.mjs';
import { createHandler } from './createHandler.mjs';

export {
  ALARMING_PREFIXES,
  CLEANUP_HEARTBEAT_PREFIX,
  ERROR_CODES,
  STATUS_FOR_CODE,
} from './createHandler.mjs';

export const handler = createHandler({ provider: aerodatabox });
