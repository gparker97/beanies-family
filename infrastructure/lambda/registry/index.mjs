/* global process */
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { computeEntitlement, isNeverFinishedRow, isValidInstant } from './entitlement.mjs';
import {
  EVENT_KINDS,
  MAX_BODY_BYTES,
  PLATFORMS,
  buildItem,
  reduceOrigin,
  reduceUserAgent,
  validateEvent,
} from './events.mjs';
import {
  UUID_RE,
  normEmail,
  onCanonicalPointer,
  ownerVersionCondition,
  realEmail,
  resolveOwnerFields,
} from './owner.mjs';
import { SCORING, applyHeardVia, scoreFamily, wantsCreateInference } from './inference.mjs';
import { countryForTimeZone } from './timeZoneCountry.mjs';

const client = new DynamoDBClient({});
// Each table pair falls back to prod when no dev table is configured (safe fallback).
const REGISTRY_TABLES = {
  prod: process.env.TABLE_NAME,
  dev: process.env.DEV_TABLE_NAME || process.env.TABLE_NAME,
};
// Marketing-events ledger (#121). Same dev/prod split, picked by the same `tableForOrigin`.
const EVENTS_TABLES = {
  prod: process.env.EVENTS_TABLE_NAME,
  dev: process.env.EVENTS_DEV_TABLE_NAME || process.env.EVENTS_TABLE_NAME,
};
const API_KEY = process.env.REGISTRY_API_KEY;
// The served Counter-write policy (#117 writer flip). Terraform `counter_writes_enabled` sets it;
// only the exact string "true" turns writes on, so an unset or mistyped value stays off.
const COUNTER_WRITES = process.env.COUNTER_WRITES_ENABLED === 'true';
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim());
const DEV_ORIGINS = new Set(
  (process.env.DEV_ORIGINS || 'http://localhost:5173,http://localhost:4173,http://localhost:4321')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);

/**
 * Pick a table from a `{ dev, prod }` pair based on the request Origin. Localhost
 * origins use the dev table; everything else uses prod. Unknown origins
 * default to prod for safety — but they would also fail CORS upstream so
 * in practice only allowlisted origins ever reach the Lambda body.
 */
function tableForOrigin(origin, { dev, prod }) {
  return tableLabel(origin) === 'dev' ? dev : prod;
}

/**
 * Which table pair a request's Origin selects, as a log field (#128): `'dev'` for a localhost
 * origin, `'prod'` otherwise. The one statement of the split, so a log line can never name a
 * different table from the one `tableForOrigin` wrote to, and a CloudWatch filter on
 * `table = "prod"` drops local test runs from the funnel.
 */
function tableLabel(origin) {
  return origin && DEV_ORIGINS.has(origin) ? 'dev' : 'prod';
}

function getHeaders(event) {
  const origin = event?.headers?.origin || ALLOWED_ORIGINS[0];
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  };
}

function response(statusCode, body, event) {
  return { statusCode, headers: getHeaders(event), body: JSON.stringify(body) };
}

/**
 * The only accepted `signupPlatform` values — the `getPlatform()` vocabulary the
 * client and Plausible both use (`src/services/sync/capabilities.ts`), NOT the
 * coarse `'app' | 'pwa' | 'web'` bucket in `src/utils/platformLabel.ts`.
 *
 * Guarded because this field is client-supplied AND permanent: an unvalidated
 * value is stamped once and then preserved forever by the write-once merge
 * below, so no later write could correct it.
 */
const SIGNUP_PLATFORMS = new Set(['web', 'ios', 'android']);

const validPlatform = (v) => (SIGNUP_PLATFORMS.has(v) ? v : null);

/**
 * Campaign attribution (#118): the tag from the link that first brought the family to
 * beanies.family. Client-supplied AND write-once (stamped on the signup write, then preserved
 * forever by the merge below), so it is validated here, field by field.
 *
 * ⚠️ TWIN of `packages/brand/attribution.ts` (`ATTRIBUTION_KEYS`, `ATTRIBUTION_VALUE_RE`,
 * `sanitiseAttribution`). It cannot be imported: every Lambda here is its own zip. Change the key
 * list or the value rule there AND here; `src/utils/__tests__/attribution.test.ts` and
 * `index.test.mjs` share the fixture strings so a rule change on one side fails the other.
 */
export const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'campaign_id',
  'ad_group_id',
  'ad_id',
  'oppref',
];
/** After `trim()`, 1-100 chars from this set; anything else drops THAT FIELD. */
export const ATTRIBUTION_VALUE_RE = /^[A-Za-z0-9._~:-]{1,100}$/;
// Derived from the rule, so the drop reason cannot drift from the bound the twin test pins.
const ATTRIBUTION_MAX_LEN = Number(/\{1,(\d+)\}/.exec(ATTRIBUTION_VALUE_RE.source)[1]);

function logAttributionDropped(familyId, fields) {
  // Drop branches only: a healthy stamp is visible in the row itself. Hash only, and never
  // the rejected value (it is arbitrary client input). No family on the `POST /events` path
  // (#121), so the hash is omitted there rather than hashing a null.
  // eslint-disable-next-line no-console -- structured drop line, read by CloudWatch
  console.log(
    JSON.stringify({
      msg: 'attribution_dropped',
      ...(familyId ? { family_id_hash: familyIdHash(familyId) } : {}),
      ...fields,
    })
  );
}

/**
 * Keep each allowlisted key whose value passes the rule; returns a fresh plain object, or null
 * when nothing valid remains. Unknown keys are dropped SILENTLY (a newer client with an added
 * key must not be nulled, or flood the log, on an older Lambda); an invalid value drops its own
 * field with one `attribution_dropped` line.
 *
 * An omitted or `null` record is the normal case (every legacy client) and stores null with no
 * log; only a present, non-null, non-object record logs `not-object`.
 */
function validAttribution(value, familyId) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    logAttributionDropped(familyId, { reason: 'not-object' });
    return null;
  }
  const out = {};
  /* eslint-disable security/detect-object-injection -- `key` comes from the constant allowlist */
  for (const key of ATTRIBUTION_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const raw = value[key];
    if (typeof raw !== 'string') {
      logAttributionDropped(familyId, { key, reason: 'not-string' });
      continue;
    }
    const v = raw.trim();
    if (ATTRIBUTION_VALUE_RE.test(v)) {
      out[key] = v;
    } else {
      // Empty-after-trim lands in `bad-charset`: it fails the same {1,100} set rule.
      logAttributionDropped(familyId, {
        key,
        reason: v.length > ATTRIBUTION_MAX_LEN ? 'too-long' : 'bad-charset',
      });
    }
  }
  /* eslint-enable security/detect-object-injection */
  return Object.keys(out).length ? out : null;
}

/**
 * The "how did you hear about us?" survey answer (#121): the stable option id only. The label and
 * the free text of `other` stay Slack-only. Client-supplied AND write-once (stamped on the signup
 * write, gated on `isSignupEvent` exactly like `attribution`), so it is allowlisted here.
 *
 * ⚠️ TWIN of `packages/brand/heardVia.ts` (`HEARD_VIA_IDS`). It cannot be imported: every Lambda
 * here is its own zip. Change the list there AND here, in the same order;
 * `src/utils/__tests__/attributionTwinDrift.test.ts` fails if they drift.
 */
export const HEARD_VIA_IDS = [
  'reddit',
  'product_hunt',
  'substack',
  'google',
  'app_store',
  'chatgpt_ad',
  'ai',
  'friend',
  'other',
];

/**
 * An allowlisted id, or null. Omitted / null is the normal case (a skipped survey, every legacy
 * client) and logs nothing; anything else that is not an allowlisted id logs one
 * `heard_via_dropped` line (hash only, never the rejected value) and stores null.
 */
function validHeardVia(value, familyId) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && HEARD_VIA_IDS.includes(value)) return value;
  // eslint-disable-next-line no-console -- structured drop line, read by CloudWatch
  console.log(
    JSON.stringify({
      msg: 'heard_via_dropped',
      family_id_hash: familyIdHash(familyId),
      reason: typeof value === 'string' ? 'unknown-id' : 'not-string',
    })
  );
  return null;
}

/**
 * The create-attempt id (#128): the random UUID the client mints when the person taps Create, so
 * one attempt's firehose events join to its registry row. Client-supplied AND write-once
 * (stamped by the step-1 write, or by the pod-creation write on a row without one), so it is
 * validated here.
 *
 * Omitted / null is the normal case (every client older than #128, and a create with no open
 * attempt) and logs nothing; anything else that is not a UUID logs one `create_attempt_id_dropped`
 * line (hash only, never the rejected value) and stores null.
 */
function validAttemptId(value, familyId) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && UUID_RE.test(value)) return value;
  // eslint-disable-next-line no-console -- structured drop line, read by CloudWatch
  console.log(
    JSON.stringify({
      msg: 'create_attempt_id_dropped',
      family_id_hash: familyIdHash(familyId),
      reason: typeof value === 'string' ? 'not-uuid' : 'not-string',
    })
  );
  return null;
}

/**
 * sha256 hex of a family id, for log lines. Deliberately the SAME function as
 * `ai-extract/ddb.mjs` `hash()`, so an `entitlement_computed` line joins against the usage table
 * and the metrics skill without a second derivation. (It cannot be imported: every Lambda here is
 * its own zip.)
 */
function familyIdHash(familyId) {
  return createHash('sha256').update(String(familyId)).digest('hex');
}

/**
 * The #125 step-1 item: who started signing up, before any pod exists. A pure build from the
 * request, using the same validators as the ordinary item.
 *
 * ⚠️ NO POINTER AND NO `createdAt`, AND THE OMISSIONS ARE THE POINT. `provider` / `fileId` /
 * `displayPath` are left out entirely, never `'local'`: every pointer reader (the canonical check,
 * resume-from-registry, the join lookup) keys on their presence and falls through without them,
 * whereas a stored `'local'` would warn `canonical-provider-mismatch` on a Drive family's first
 * boot. `createdAt` starts the trial clock (entitlement.mjs) and is stamped only by the
 * pod-creation write, so its absence is what makes this row never-finished (`isNeverFinishedRow`).
 * No `lastLoginAt` (nobody has logged in to a pod) and no country, member count or size (no pod).
 */
function buildSignupStartItem({ familyId, body, now, deviceCountry }) {
  return {
    familyId,
    familyName: body.familyName || null,
    // `realEmail`, as the ordinary owner stamp does: a placeholder address never latches.
    ownerEmail: realEmail(body.ownerEmail),
    // The caller has already checked that the writer is this owner.
    ownerMemberId: body.ownerMemberId,
    subscribeNewsletter:
      typeof body.subscribeNewsletter === 'boolean' ? body.subscribeNewsletter : null,
    signupPlatform: validPlatform(body.signupPlatform),
    attribution: validAttribution(body.attribution, familyId),
    // The attempt that started this signup (#128); the pod-creation write carries it forward.
    createAttemptId: validAttemptId(body.createAttemptId, familyId),
    // The survey comes later (after the pod is written, #128); the owner write that carries the
    // answer stamps it (`null ?? x`).
    heardVia: null,
    attributionInferred: null,
    signupStartedAt: now,
    deviceCountry,
    updatedAt: now,
  };
}

/**
 * The GET arm's billing read (#95), issued CONCURRENTLY with the registry read so the pointer
 * lookup pays no extra round trip. It NEVER rejects: the result is `{ configured, billing }` or
 * `{ configured, error }`, and `entitlementFor` decides what to log only once the registry row is
 * known to be live. On a 404 or a tombstone the result is simply discarded, unlogged.
 *
 * ITS OWN TRY/CATCH, AND THAT IS THE POINT. The handler's outer try turns any throw into a 500,
 * and the GET is the pointer lookup that recovery-from-registry depends on. A blip on a table
 * that only decides plan state must not take the family's file location down with it, so a
 * billing read failure degrades to `entitlement: null` and the row still goes back with a 200.
 *
 * ONE BILLING TABLE, WHATEVER THE ORIGIN. The registry picks its own table by Origin
 * (`tableForOrigin`), and that split is deliberately NOT extended here. Billing rows are written
 * only by the prod billing Lambda (a Stripe webhook carries no Origin, and checkout refuses
 * DEV_ORIGINS), so a localhost family simply has no billing row and computes `trial`/`beta`,
 * which is the right answer for a dev family.
 *
 * Env is read at CALL time, not module load, so one test process can exercise launch set/unset
 * and enforce on/off without module-cache games (the `countUsage.mjs` convention).
 */
async function readBilling(familyId) {
  const billingTable = process.env.BILLING_TABLE_NAME;
  if (!billingTable) return { configured: false, billing: null };
  try {
    const { Item } = await client.send(
      new GetItemCommand({
        TableName: billingTable,
        Key: marshall({ familyId }),
        // Strongly consistent, for the same reason as the registry read: the client refreshes
        // straight after a checkout claim, and an eventually-consistent miss would show a
        // family that has just paid its trial (or read-only) state.
        ConsistentRead: true,
      })
    );
    return { configured: true, billing: Item ? unmarshall(Item) : null };
  } catch (error) {
    return { configured: true, error };
  }
}

/**
 * The GET arm's entitlement block (#95): apply `computeEntitlement` to the live registry row and
 * the billing read, log the outcome. Returns null when the answer cannot be computed; NEVER
 * throws.
 */
function entitlementFor(familyId, row, billingRead) {
  const launchAt = process.env.V1_LAUNCH_AT || '';
  const enforce = process.env.BILLING_ENFORCE === 'true';
  const launchSet = isValidInstant(launchAt);

  if (launchAt && !launchSet) {
    // Not fatal: an unparseable launch date computes `beta` for everyone, the pre-launch state.
    // But it is a launch that silently did not happen, so say so on every GET until fixed.
    console.error(
      '[registry] entitlement_launch_invalid: V1_LAUNCH_AT does not parse as an ISO-8601 date, ' +
        'so the launch-based trial clock never starts (subscriptions and overrides still count). Fix var.v1_launch_at and re-apply modules/registry.'
    );
  }

  if (billingRead.error) {
    console.error(
      '[registry] entitlement_unavailable: check BILLING_TABLE_NAME and dynamodb:GetItem on the billing table',
      billingRead.error
    );
    return null;
  }
  if (!billingRead.configured && launchSet) {
    // Unset table with no launch is a supported configuration (self-hosters, and every
    // environment before #95 ships): a self-host has no billing rows, so `beta` is exact there.
    // (A subscription or a trial override would count before launch too, but neither can exist
    // without the table that holds it.) Unset table AFTER launch is not supported: a paying
    // family would read as trial or read-only. Refuse to guess.
    console.error(
      '[registry] entitlement_unavailable: BILLING_TABLE_NAME is unset while V1_LAUNCH_AT is set. ' +
        'Wire billing_table_name into modules/registry and re-apply.'
    );
    return null;
  }

  const entitlement = computeEntitlement({
    createdAt: row.createdAt,
    billing: billingRead.billing,
    launchAt,
    now: Date.now(),
    enforce,
  });

  // Warn only when createdAt actually decided the answer: a trial-clock outcome with no per-family
  // override. A subscribed family, a beta family and an overridden trial never read it.
  const createdAtUsed =
    (entitlement.reason === 'in_trial' || entitlement.reason === 'trial_ended') &&
    !isValidInstant(billingRead.billing?.trialEndsAt);
  // A #125 step-1 row has no `createdAt` BY DESIGN (no pod yet, so a full trial from now is the
  // right answer), and `createNewFile` / the entitlement store GET it before the pod exists. The
  // warn means "a row edited by hand", so it skips those rows rather than crying wolf on every
  // sign-up in progress.
  if (createdAtUsed && !isValidInstant(row.createdAt) && !isNeverFinishedRow(row)) {
    // `computeEntitlement` treated the missing createdAt as now (a full trial, the generous
    // failure). Every pod-creation PUT stamps `createdAt` and tombstones keep it, so this means
    // a row that was edited by hand: fix the row, or pin the trial with
    // `scripts/billing-cohort.mjs --trial-ends-at`.
    console.warn(
      '[registry] entitlement_created_at_invalid: trial computed from now. Fix createdAt on the ' +
        'registry row or set an override with scripts/billing-cohort.mjs --trial-ends-at',
      familyIdHash(familyId)
    );
  }

  // The soak signal: one JSON line per answered GET, success path included, so the rate of each
  // state is measurable before anything is enforced. Hash only; the raw id never goes here.
  // eslint-disable-next-line no-console -- structured success-path soak line, read by CloudWatch
  console.log(
    JSON.stringify({
      msg: 'entitlement_computed',
      family_id_hash: familyIdHash(familyId),
      state: entitlement.state,
      reason: entitlement.reason,
      enforced: entitlement.enforced,
      launch_set: launchSet,
    })
  );

  return entitlement;
}

/**
 * One structured line per `POST /events` request, success path included, so the acceptance rate
 * per kind is a CloudWatch count. `kind` / `platform` are logged only when they are allowlisted
 * values: a rejected body's raw values are arbitrary client input and never reach the log.
 *
 * `origin` and `device` appear on `rejected` lines only, and only in reduced form (`reduceOrigin`
 * / `reduceUserAgent`), so a rejection can be told apart as a bot, a non-browser client or a real
 * origin missing from the allowlist. Stored and error calls never pass them, and `JSON.stringify`
 * drops `undefined`, so those lines keep their exact shape (pinned by tests).
 */
function logMarketingEvent({
  kind = null,
  platform = null,
  tagged = null,
  outcome,
  reason = null,
  origin,
  device,
}) {
  // eslint-disable-next-line no-console -- structured outcome line, read by CloudWatch
  console.log(
    JSON.stringify({
      msg: 'marketing_event',
      kind: EVENT_KINDS.includes(kind) ? kind : null,
      platform: PLATFORMS.includes(platform) ? platform : null,
      tagged,
      outcome,
      reason,
      origin,
      device,
    })
  );
}

/**
 * `POST /events` (#121): the marketing site's first-party ledger beacon. KEYLESS by design (the
 * site has no API key, and shipping the app's public soft key in a second bundle buys nothing).
 * Its protections, in order: an `Origin` that must be present AND allowlisted (403, not the
 * fallback echo the other routes do; browsers always send Origin on a POST, so an absent one is a
 * non-browser client); a 2 KB cap on the decoded body; strict validation; the stage's per-route
 * throttle. A polluted event can only ever attach to a pod that really was created, so the worst
 * outcome is a mis-scored dashboard, never data exposure.
 *
 * The body arrives as `text/plain` (a `sendBeacon` string, so there is no CORS preflight) and is
 * parsed as JSON whatever the content type says. Fire-and-forget: the site never retries.
 */
async function handleEvents(event) {
  const origin = event.headers?.origin;
  const device = reduceUserAgent(event.headers?.['user-agent']);
  /** Log one rejection with its diagnostic origin/device and answer `status { error: reason }`. */
  const reject = (status, reason, parsed) => {
    // Keep the `?.`: a JSON `null` body reaches validation, and destructuring null would throw.
    logMarketingEvent({
      kind: parsed?.kind,
      platform: parsed?.platform,
      outcome: 'rejected',
      reason,
      origin: reduceOrigin(origin),
      device,
    });
    return response(status, { error: reason }, event);
  };

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return reject(403, 'origin_not_allowed');

  // API Gateway v2 may base64-encode a body (the billing Lambda's `rawBodyOf` idiom). The size
  // check runs on the decoded bytes, before any parsing.
  const raw =
    typeof event.body !== 'string'
      ? Buffer.alloc(0)
      : event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'utf8');
  if (raw.length > MAX_BODY_BYTES) return reject(400, 'body_too_large');

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return reject(400, 'bad_json');
  }

  const verdict = validateEvent(body, (fields) => validAttribution(fields, null));
  if (!verdict.ok) return reject(400, verdict.reason, body);

  const { kind, platform, tagged } = verdict.event;
  const item = buildItem(verdict.event, {
    now: Date.now(),
    origin,
    device,
    eventId: randomUUID(),
  });
  const tableName = tableForOrigin(origin, EVENTS_TABLES);

  try {
    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      })
    );
  } catch (err) {
    console.error(
      '[registry] marketing_event write failed: check EVENTS_TABLE_NAME / EVENTS_DEV_TABLE_NAME and dynamodb:PutItem on the events tables',
      err
    );
    logMarketingEvent({ kind, platform, tagged, outcome: 'error', reason: 'ddb_error' });
    return response(500, { error: 'Internal server error' }, event);
  }

  logMarketingEvent({ kind, platform, tagged, outcome: 'stored' });
  return { statusCode: 204, headers: getHeaders(event) };
}

/**
 * Extra read-merge-write rounds a PUT gets when the owner version moved between its read and its
 * write (see `handlePut`). Three attempts in all.
 */
const OWNER_VERSION_RETRIES = 2;

/**
 * The PUT arm: one read-merge-write (`putOnce`), re-run from the read when the row's owner version
 * moved underneath it.
 *
 * ⚠️ EVERY PUT IS OPTIMISTIC ON THE OWNER VERSION, ambient and `ownerSync` alike. The item below is
 * rebuilt from a read and written with a whole-item `PutItem`, so a PUT that read the row BEFORE a
 * handover and landed AFTER it would write the old `ownerMemberId` / `ownerEmail` /
 * `ownerHandoverAt` straight back: an ordinary login undoing a transfer. `putOnce` therefore
 * conditions its write on the `ownerHandoverAt` it read (owner.mjs `ownerVersionCondition`; every
 * handover stamps a new one), and a `ConditionalCheckFailedException` re-runs the whole round
 * against the new row. After `OWNER_VERSION_RETRIES` more conflicts it answers exactly like any
 * other failed write (500), so a caller's existing failure handling applies unchanged.
 *
 * The `registry_owner_sync` line is logged here, once per request (not once per round), from the
 * last round's decision, with `conflict_retries` / `conflict_exhausted` when a retry happened.
 */
async function handlePut(event, familyId, tableName) {
  const body = JSON.parse(event.body || '{}');
  const now = new Date().toISOString();
  const today = now.slice(0, 10); // YYYY-MM-DD — date-only login stamp

  let sync = null;
  let retries = 0;
  let exhausted = false;
  try {
    for (;;) {
      const round = await putOnce({
        event,
        familyId,
        tableName,
        body,
        now,
        today,
        noteSync: (s) => {
          sync = s;
        },
      });
      if (!round.conflict) return round.res;
      // A step-1 write (#125) conflicts only on `attribute_not_exists`, a create race, which is
      // not the handover race this loop was written for; name it so a filter on the handover
      // string does not count sign-up races.
      const race =
        body.signupStart === true ? 'signup-start create race' : 'owner-version conflict';
      if (retries === OWNER_VERSION_RETRIES) {
        exhausted = true;
        console.error(`[registry] ${race}: giving up`, familyId, `${retries + 1} attempts`);
        return response(500, { error: 'Internal server error' }, event);
      }
      retries += 1;
      console.warn(`[registry] ${race}: retrying`, familyId, `retry ${retries}`);
    }
  } finally {
    if (sync) {
      // eslint-disable-next-line no-console -- structured owner-sync line, read by CloudWatch
      console.log(
        JSON.stringify({
          msg: 'registry_owner_sync',
          family_id_hash: familyIdHash(familyId),
          outcome: sync.outcome,
          from_tail: sync.fromTail,
          to_tail: sync.toTail,
          // Only when the owner version moved mid-request: the outcome above is the LAST round's.
          ...(retries > 0 ? { conflict_retries: retries } : {}),
          ...(exhausted ? { conflict_exhausted: true } : {}),
        })
      );
    }
  }
}

/**
 * One read-merge-write round of the PUT arm. Resolves `{ res }` with the response, or
 * `{ conflict: true }` when the conditional `PutItem` found the owner version moved since the read
 * (`handlePut` re-runs the round). Any other failure throws to the handler's catch, as before.
 * `noteSync` receives the owner-sync decision (null for an ordinary PUT) for `handlePut`'s log.
 *
 * THREE MUTUALLY EXCLUSIVE MODES, decided in this order (the README states the same order):
 *   1. `signupStart: true` (#125): the create-only step-1 write, `signupStartRound`. Its
 *      `isLoginEvent` / `isSignupEvent` / `ownerSync` flags are ignored.
 *   2. `ownerSync: true`: ownership-only (owner.mjs); may return before any write.
 *   3. Everything else: the ordinary whole-item merge below.
 * A new flag on this endpoint takes a place in this order rather than a special case inside one.
 */
async function putOnce({ event, familyId, tableName, body, now, today, noteSync }) {
  // Read existing row to preserve write-once fields (createdAt, ownerEmail,
  // subscribeNewsletter). registerFamily() fires on every sync-config change,
  // so only the first write should stamp these.
  const { Item: existingRaw } = await client.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall({ familyId }),
      // Strongly consistent, and this one is load-bearing: the result feeds a
      // full-row PutItem, so a stale miss does not merely read wrong — it
      // CLOBBERS every write-once field (createdAt, ownerMemberId,
      // ownerEmail, signupPlatform) with the defaults below.
      ConsistentRead: true,
    })
  );
  const existing = existingRaw ? unmarshall(existingRaw) : {};

  // Mode 1, the #125 step-1 write: create-only, so it is judged before any writer/owner logic.
  if (body.signupStart === true) {
    noteSync(null);
    return signupStartRound({ event, existingRaw, body, familyId, tableName, now });
  }

  // ─── Canonical-pointer guard (2026-08-10) ────────────────────────────
  //
  // Only the family's registered owner may move the canonical pointer
  // (provider / fileId / displayPath). Members still write activity and
  // metadata (lastLoginAt, country, beanpodSizeKb, familyName) — those are
  // per-family facts any device can report. The pointer is not.
  //
  // This lives here, not in the client, because the client cannot close the
  // hole: the propagation vector is ALREADY DEPLOYED. Native and cached web
  // builds running the pre-fix code keep sending pointer writes for as long
  // as they run, and a client-side guard protects only devices that already
  // took the fix — i.e. not the ones causing the damage. A curl gets the same
  // answer here too. See docs/plans/2026-08-10-never-fork-a-family-pod.md §5.
  //
  // AUTHORITY IS `ownerMemberId`, NOT `ownerEmail`.
  //
  // `ownerEmail` was added (2026-04-12) as an ops/contact capture, alongside
  // the newsletter opt-in — "who do we email about this family". It is the
  // signed-in member's PROFILE email, which the user can edit in the app. Using
  // it as the permission check would mean an owner who edits their own email
  // sends a new address on their next write, gets refused, and — because the
  // field is write-once — has no way back. `memberId` is a stable UUID from the
  // family document and survives any profile edit, so it is the real identity.
  //
  // Three tiers, in order:
  //   1. Row has ownerMemberId  -> compare memberId. The normal path.
  //   2. Row has only ownerEmail (registered between 2026-04-12 and this
  //      change) -> compare email, and stamp ownerMemberId on the way through
  //      so the row upgrades itself the first time its owner writes.
  //   3. Row has neither (pre-2026-04-12, dormant since) -> fall open, exactly
  //      as today, and stamp both.
  // (`normEmail` is imported from owner.mjs, the one definition.)

  // ─── WHO IS WRITING, vs who the row says OWNS the family ───────────────
  //
  // Until 2026-09-09 these were one field. The client sent the signed-in
  // member's id AS `ownerMemberId`, so "the owner is whoever is writing" was
  // baked into the wire format, and a member device writing to a row the
  // registry had just lost stamped itself owner. `ownerMemberId` now means
  // the OWNER FROM THE POD ROSTER and `writerMemberId` means this device's
  // signed-in member; the guard asks the second and protects the first.
  //
  // The fallback is presence-based, NOT `??`, and the distinction is the
  // whole point:
  //
  //   - Field ABSENT  => a client that predates the split. It is sending its
  //     own session id as `ownerMemberId`, which is exactly the value the
  //     old guard compared, so judging it on that keeps it working. Without
  //     this, deploying the guard refuses the pointer for the whole fleet at
  //     once.
  //   - Field PRESENT but null => a current client with NO signed-in member.
  //     `??` would fall back to `ownerMemberId` — the roster owner, a value
  //     any device holding the decrypted pod can compute — and hand the
  //     guard's own answer to an unauthenticated writer. Presence keeps that
  //     shut: no writer id, no pointer move.
  //
  // Remove the fallback only once no pre-split client is in the field.
  const writerMemberId = 'writerMemberId' in body ? body.writerMemberId : body.ownerMemberId;

  // ⚠️ TIER 2 NEEDS THE SAME SPLIT, and missing it opened a hole rather than
  // closing one. The email arm below is the LEGACY authority for rows
  // registered between 2026-04-12 and 2026-08-10, which have `ownerEmail` and
  // no `ownerMemberId`. It used to compare the SIGNED-IN member's email,
  // because that is what the client sent — so a member device sent its own
  // address and was refused.
  //
  // Once `ownerEmail` started coming from the pod roster, every device sent
  // the OWNER'S address, which of course matches: the arm would have accepted
  // a pointer move from any member on every legacy row, which is the exact
  // family-fork the guard exists to prevent, reported as `pointerAccepted:
  // true` so nothing pages. Same presence rule as the id above.
  const writerEmail = 'writerEmail' in body ? body.writerEmail : body.ownerEmail;

  const isOwner = existing.ownerMemberId
    ? writerMemberId === existing.ownerMemberId
    : !existing.ownerEmail ||
      (!!normEmail(writerEmail) && normEmail(writerEmail) === normEmail(existing.ownerEmail));

  // ─── WHO OWNS THE FAMILY: write-once, or an explicit owner sync ─────────
  //
  // The decision lives in owner.mjs (pure). Without `body.ownerSync === true`
  // these are today's write-once values. With it, the request is
  // OWNERSHIP-ONLY: it writes only for `handover` / `email-synced`, which
  // require a live row, the registered owner and the stored pointer, so it
  // never creates a row, never lifts a tombstone and never moves the
  // pointer. A handover also needs `ownerSyncReason: 'transfer'` once the row
  // has been handed over before (`ownerHandoverAt`; owner.mjs explains the
  // lock). `ownerSyncReason`, like the flag, is never stored: the item below
  // is an explicit list. Everything else (every refusal, and `unchanged`) returns HERE,
  // before the tombstone guard below and before any PutItem, so the guard
  // and the item build are untouched for it.
  const owner = resolveOwnerFields({ existing, body, isOwner, now });
  // `handlePut` logs the `registry_owner_sync` line from this (once per request).
  noteSync(owner.sync);
  if (body.ownerSync === true && !owner.write) {
    // Nothing written, so the pointer was "accepted" only in the no-op sense the
    // guard below uses: the request echoed the live row's stored pointer.
    const pointerAccepted =
      owner.sync.outcome !== 'refused-deleted' && onCanonicalPointer(body, existing);
    return {
      res: response(
        200,
        {
          success: true,
          pointerAccepted,
          // From owner.mjs: the stored owner, or null for a missing or deleted row.
          owner: { memberId: owner.ownerMemberId, email: owner.ownerEmail },
          // Which refusal (or `unchanged`), so the client can act on it (a transfer to a
          // deleted family is abandoned, not retried).
          outcome: owner.sync.outcome,
        },
        event
      ),
    };
  }

  // ─── A DELETED FAMILY IS NOT WRITEABLE EXCEPT BY ITS OWNER ────────────
  //
  // ⚠️ THIS GUARD IS `isOwner`, NOT `pointerAccepted`, AND THE FIRST CUT GOT
  // THAT WRONG IN A WAY THAT LOOKED RIGHT. `pointerAccepted` is
  // `isOwner || samePointer`, and `samePointer` is VACUOUSLY TRUE against a
  // tombstone: the DELETE arm deliberately drops `provider`/`fileId`/
  // `displayPath`, so a device that sends a null pointer — a cold boot, an
  // evicted provider config, an `ensureRegistered` mid-boot — compares
  // 'local' to 'local' and null to null, matches, and lifts the tombstone.
  // The family came back LIVE pointing at nothing.
  //
  // ⚠️ AND IT RETURNS RATHER THAN MERGING. Preserving only `deletedAt` was
  // not enough either: the same `PutItem` re-stamps `familyName`,
  // `subscribeNewsletter`, `country`, `memberCount`, `beanpodSizeKb` and, on
  // a login, `lastLoginAt: today` — every field the DELETE arm dropped ON
  // PURPOSE, because they are family content, a marketing consent, and
  // activity signals that would keep a deleted family alive in the metrics.
  // A member's ordinary background register would have resurrected the
  // deleted family's NAME and its newsletter opt-in, invisibly, because GET
  // still 404s.
  //
  // So: nothing to merge, nothing to write. The family is deleted, and the
  // caller gets the same success a write to a deleted row has always got.
  //
  // ⚠️ `ownerKnown` GATES THE REFUSAL, NOT THE WRITE, and the first cut had
  // it the other way round. Requiring a KNOWN owner in order to write BRICKED
  // the row: a family whose owner fields were never stamped — a background
  // register mid-boot sends both null — could not be restored once deleted by
  // ANYONE, its real owner included. The tombstone never lifted, GET kept
  // 404ing, and the client was told 200 success so restore never learned its
  // recovery anchor had been refused. Only a manual DynamoDB edit healed it.
  //
  // So an ownerless tombstone falls open exactly as an ownerless LIVE row
  // does. That is the trade the pointer guard already makes everywhere else,
  // and it is the right one here too: a family with no recorded owner has no
  // authority to check a writer against, and refusing everyone is strictly
  // worse than admitting the first writer — which is the state the row was
  // already in before it was deleted.
  const ownerKnown = !!existing.ownerMemberId || !!existing.ownerEmail;
  if (existing.deletedAt && ownerKnown && !isOwner) {
    // Rule 1: a security-relevant branch says why. Without this the rate of
    // devices writing to deleted families is unobservable — which is exactly
    // the signal that would have caught the resurrection this branch fixes.
    // Masked to tails, like the pointer-refusal warn it returns above.
    console.warn(
      '[registry] write to a deleted family refused',
      familyId,
      String(writerMemberId ?? '').slice(-6) || 'no-writer-id'
    );
    return { res: response(200, { success: true, pointerAccepted: false }, event) };
  }

  // A write that would not CHANGE the pointer is a no-op, not a refusal.
  // This matters: the common case is a member device re-picking the family's
  // correct file, or simply logging in and echoing the pointer back. Reporting
  // those as refused would page the team every time a member recovers normally,
  // and would drown the one signal that means something — a device actually
  // trying to MOVE the family's pointer somewhere it shouldn't.
  const samePointer =
    (body.provider || 'local') === (existing.provider || 'local') &&
    (body.fileId || null) === (existing.fileId ?? null) &&
    (body.displayPath || null) === (existing.displayPath ?? null);

  const pointerAccepted = isOwner || samePointer;

  if (!pointerAccepted) {
    // Domains + id tails only — never full member emails or ids in CloudWatch.
    console.warn(
      '[registry] pointer write refused',
      familyId,
      String(existing.ownerEmail).split('@')[1],
      String(writerEmail).split('@')[1],
      String(existing.ownerMemberId ?? '').slice(-6),
      String(writerMemberId ?? '').slice(-6)
    );
  }

  // This write stamps createdAt when the row has none, unless the row is a #125 step-1 row and
  // this is not the pod-creation write (a watcher or background PUT must not start the trial).
  // Read again by the inference gate below, so "this write creates the pod" is decided once.
  const stampsCreatedAt =
    !existing.createdAt && (!isNeverFinishedRow(existing) || body.isSignupEvent === true);

  const item = {
    familyId,
    provider: pointerAccepted ? body.provider || 'local' : existing.provider || 'local',
    fileId: pointerAccepted ? body.fileId || null : (existing.fileId ?? null),
    displayPath: pointerAccepted ? body.displayPath || null : (existing.displayPath ?? null),
    // Preserve-on-omit (2026-08-10): an omitted name previously nulled a
    // stored one. Same semantics as country/subscribeNewsletter below.
    familyName: body.familyName || existing.familyName || null,
    // `undefined` (no stamp) is dropped by `removeUndefinedValues`: a step-1 row stays podless.
    createdAt: existing.createdAt || (stampsCreatedAt ? now : undefined),
    // When step 1 of the create wizard ran (#125, stamped only by `signupStartRound`). Carried
    // so this whole-item PutItem keeps it; legacy rows carry null.
    signupStartedAt: existing.signupStartedAt ?? null,
    // Write-once. Previously `body.ownerEmail ?? existing.ownerEmail` let the
    // last writer win, so a member device could take over the row. This stays
    // an ops/contact field (see the guard above) but is also the LEGACY
    // authority for rows registered before `ownerMemberId` existed, so it must
    // be stable either way.
    // ⚠️ `|| null` ON THE BODY, because this field is WRITE-ONCE and `''` is
    // not nullish. An empty string from any client — deployed ones included,
    // which is why the guard is here and not only in the client — would latch
    // permanently, and the legacy pointer tier reads `!existing.ownerEmail`
    // as TRUE, falling open for every writer on that row forever.
    // ⚠️ `||` ON BOTH SIDES. Guarding only the body prevents NEW poisoning and
    // leaves rows already holding `''` broken forever: `'' ?? x` is `''`, so
    // the write-once merge preserved it even when the real owner later sent a
    // genuine address — and the legacy pointer tier reads `!existing.ownerEmail`
    // as TRUE for `''`, falling open for every writer on that row. Deployed
    // clients did send empty strings, so such rows exist; this repairs them
    // rather than only preventing new ones.
    // The value comes from owner.mjs `resolveOwnerFields`: this write-once
    // idiom (`existing.ownerEmail || realEmail(body.ownerEmail) || null`, so a
    // placeholder never latches either), or an `ownerSync` email sync/handover.
    ownerEmail: owner.ownerEmail,
    // Write-once, and the real pointer authority. Stamped on a row's first
    // accepted write — including the first write by the owner of a legacy
    // email-only row, which upgrades that row off the mutable email.
    // ⚠️ `isOwner`, NOT `pointerAccepted`. This is a WRITE-ONCE field, so a
    // wrong value is permanent and there is no in-app route back. Gating it
    // on `pointerAccepted` let `samePointer` do the stamping: every member
    // device echoes the family's real pointer on every login, so on a legacy
    // (email-only) row a member running a still-deployed PRE-SPLIT client —
    // which sends its own id as `ownerMemberId` — matched on the pointer and
    // stamped ITSELF as the family's permanent registry owner. The real owner
    // then fails tier 1 forever and every deliberate re-point pages Slack.
    //
    // The tier-2 comment above already says what this should be: stamp "the
    // first time its OWNER writes".
    // Same repair as `ownerEmail` above: a stored `''` was falsy at tier 1 (so
    // the guard never engaged) yet non-nullish at the merge (so it never
    // healed). `||` on both sides lets a real id land later.
    // The value comes from owner.mjs `resolveOwnerFields`: this write-once
    // idiom (`existing.ownerMemberId || (isOwner ? body.ownerMemberId || null :
    // null)`), or an `ownerSync` handover.
    ownerMemberId: owner.ownerMemberId,
    // When an owner sync last HANDED the row on (owner.mjs): set only by a handover,
    // preserved by every other write. Its presence locks drift handovers, so a device on a
    // stale roster cannot hand ownership back; a deliberate `transfer` still goes through.
    ownerHandoverAt: owner.ownerHandoverAt,
    subscribeNewsletter:
      typeof body.subscribeNewsletter === 'boolean'
        ? body.subscribeNewsletter
        : (existing.subscribeNewsletter ?? null),
    // Same preserved-merge semantics as subscribeNewsletter: a write that
    // omits `country` (older client, member device without the local
    // setting) preserves the existing value. A `null` body.country also
    // preserves — clearing country is a deliberate ops action, not a side
    // effect of registering.
    country: typeof body.country === 'string' ? body.country : (existing.country ?? null),
    // Usage signals (metadata, never content). Same preserve-on-omit
    // semantics as country/subscribeNewsletter above.
    //
    // lastLoginAt: server-stamped (never client-supplied — no clock trust)
    // and moved ONLY when the client marks a genuine login/resume via the
    // transient `isLoginEvent` flag. Every other PUT (country change, Drive
    // connect, background sync) preserves it, so it stays a clean activity
    // signal distinct from `updatedAt`. `isLoginEvent` itself is never stored.
    lastLoginAt: body.isLoginEvent === true ? today : (existing.lastLoginAt ?? null),
    // beanpodSizeKb: client-rounded approximate .beanpod size. Number-guarded
    // so a malformed/negative value is ignored (preserve existing), never fatal.
    beanpodSizeKb:
      typeof body.beanpodSizeKb === 'number' && body.beanpodSizeKb >= 0
        ? Math.round(body.beanpodSizeKb)
        : (existing.beanpodSizeKb ?? null),
    // memberCount: how many members the family roster holds — a bare integer
    // for analytics (total users across families), never names or ids. Sent
    // by clients from the decrypted in-memory roster (the unencrypted
    // envelope would undercount: unclaimed beans carry no wrappedKey).
    // Same guarded preserve-on-omit idiom as beanpodSizeKb; refreshes on
    // every write so it tracks the roster as families grow.
    memberCount:
      typeof body.memberCount === 'number' && body.memberCount >= 1
        ? Math.round(body.memberCount)
        : (existing.memberCount ?? null),
    // Which platform the family signed up ON. Two independent conditions, and
    // BOTH are load-bearing:
    //
    //   1. `existing.signupPlatform ??` — never move a value already stamped.
    //      Note this is NOT the plain `existing.x ?? body.x` write-once idiom
    //      by itself: that alone would stamp every row created before this
    //      shipped with whichever device wrote next, relabelling a family
    //      created on iOS as `web` the first time its owner opened a browser.
    //   2. `body.isSignupEvent` — only a genuine family-creation write may
    //      stamp at all. Row EXISTENCE is NOT a usable proxy for "this is a
    //      signup". This used to cite `syncStore.disconnect()`, which dropped
    //      the row outright from an ordinary Settings action; that function is
    //      deleted and the DELETE arm below tombstones rather than drops, so a
    //      deleted-then-recreated family now comes back with its original
    //      stamp. The flag stays anyway: the guarantee must not rest on which
    //      callers happen to exist this week, and a row can still be removed
    //      by hand in ops.
    //
    // Together: absent stays absent, and absent means UNKNOWN — excluded from
    // platform breakdowns, never assumed web. A pod creation whose registry
    // write fails (offline) simply leaves the field unknown rather than
    // letting some later device's platform stand in for it.
    //
    // Two concurrent first writes no longer race: the Put is conditioned
    // (`handlePut`; a first write on `attribute_not_exists(familyId)`), so the
    // loser re-reads the row the winner created and merges into it with these
    // same idioms, rather than overwriting it.
    signupPlatform:
      existing.signupPlatform ??
      (body.isSignupEvent === true ? validPlatform(body.signupPlatform) : null),
    // Campaign attribution (#118): the SAME two conditions as signupPlatform above, for the
    // same reasons (never move a stamped value; only a genuine signup write may stamp, so a
    // row that predates this is never stamped retroactively). `existing.attribution ??` is
    // also what carries it across every later whole-item PutItem. Validated per field by
    // `validAttribution`, which is only reached on a stampable write, so its drop log never
    // fires for a login/background PUT.
    attribution:
      existing.attribution ??
      (body.isSignupEvent === true ? validAttribution(body.attribution, familyId) : null),
    // The create attempt (#128): the same two conditions as `attribution` above, for the same
    // reasons (a member login PUT can never stamp it). A step-1 row already carries the id its
    // own write stamped, and `existing.createAttemptId ??` keeps it; the pod-creation write
    // stamps it only on a row that has none (an old step-1 row, or no step-1 row at all).
    createAttemptId:
      existing.createAttemptId ??
      (body.isSignupEvent === true ? validAttemptId(body.createAttemptId, familyId) : null),
    // Survey answer id (#121). Write-once like `attribution`, but stampable by ANY OWNER write,
    // not only the signup one (#128): the survey now runs after the pod is written, so the answer
    // arrives on the setup-completion write. An old client still sends it on the `isSignupEvent`
    // write, which is an owner write, so that path stamps exactly as before. `isOwner`, not
    // `pointerAccepted`: a member device echoing the pointer must never answer the owner's
    // survey. `validHeardVia` logs nothing for an absent or null answer, so login PUTs stay
    // quiet. A first stamp also rescales a stored inferred value (below the item).
    heardVia: existing.heardVia ?? (isOwner ? validHeardVia(body.heardVia, familyId) : null),
    // Inferred attribution (#121, #125). Never read from the body (a client cannot set or clear
    // it); carried here because this whole-item PutItem would otherwise erase it on the next
    // login. Three writers, none of them a client: `inferAtCreate` on the pod-creation write,
    // the late `heardVia` rescale below (#128), and the metrics skill's batch reconcile.
    attributionInferred: existing.attributionInferred ?? null,
    // Country from the device time zone (#125): the same two conditions as `signupPlatform`
    // (never move a stamped value; only a signup write may stamp). A null stored at step 1
    // because the zone was unknown is re-evaluated here by the pod-creation write, since
    // `null ?? x` is `x`. The zone itself is never stored. (A `signupStart` body never gets here.)
    deviceCountry:
      existing.deviceCountry ??
      (body.isSignupEvent === true ? countryForTimeZone(body.deviceTimeZone) : null),
    // No `deletedAt` here, deliberately: `PutItem` replaces the whole item,
    // so reaching this point at all IS the revival. Only the owner reaches
    // it — every other writer returned above with the family still deleted.
    updatedAt: now,
  };
  // Create-time inference (#125): only on the write that creates the pod, and only for a family
  // `wantsCreateInference` says is scorable. `inferAtCreate` never rejects; null means "nothing".
  if (body.isSignupEvent === true && stampsCreatedAt && wantsCreateInference(item)) {
    item.attributionInferred = await inferAtCreate({
      origin: event.headers?.origin,
      familyId,
      item,
      now,
    });
  }
  const lateHeardViaStamped = stampHeardViaLate({ existing, item, body, familyId });
  // Conditioned on the owner version this round READ (see `handlePut`): a handover that landed
  // since then fails the write, and the round re-runs against the handed-over row instead of
  // writing the previous owner back.
  const version = ownerVersionCondition(existingRaw ? existing : null);
  try {
    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: version.expression,
        ...(version.values ? { ExpressionAttributeValues: marshall(version.values) } : {}),
      })
    );
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') return { conflict: true };
    throw err;
  }
  // `pointerAccepted` lets the client distinguish a refused DELIBERATE
  // re-point (data at risk — the registry now disagrees with where the pod
  // actually is) from the boring ambient case (every member device sends
  // pointer fields on every login because the payload is uniform). Clients
  // that predate this field treat its absence as accepted.
  // An `ownerSync` request also gets the stored `owner` after the write and the
  // outcome, so the client can tell applied from refused. A signup write (#125) also gets the
  // stamped country and the inferred band + tag, for the creating client's Slack line only.
  // So does the setup-completion write (#128), which now posts the "created" Slack line: it says
  // so with the transient `setupComplete` flag (never stored), honoured only from the OWNER so a
  // member device cannot fish for ops data, and a late `heardVia` stamp counts too (a client that
  // answers on any later owner write still gets the post-rescale band). The flag is what covers a
  // skipped survey, where nothing is stamped. Every other PUT's response is unchanged.
  const signupExtras =
    body.isSignupEvent === true || lateHeardViaStamped || (isOwner && body.setupComplete === true)
      ? signupResponseFields(item)
      : {};
  return {
    res: response(
      200,
      body.ownerSync === true
        ? {
            success: true,
            pointerAccepted,
            owner: { memberId: item.ownerMemberId, email: item.ownerEmail },
            outcome: owner.sync.outcome,
            ...signupExtras,
          }
        : { success: true, pointerAccepted, ...signupExtras },
      event
    ),
  };
}

/**
 * The PUT arm's step-1 mode (#125, `signupStart: true`): create the row only when no row exists,
 * and never touch an existing one. Resolves `{ res }`, or `{ conflict: true }` when a concurrent
 * writer created the row between the read and the write (`handlePut` re-runs the round, which then
 * answers `exists`). The flag itself is never stored, and this arm reads none of `isLoginEvent`,
 * `isSignupEvent` or `ownerSync` (the step-1 item has no `lastLoginAt` and no pointer for them to
 * decide).
 */
async function signupStartRound({ event, existingRaw, body, familyId, tableName, now }) {
  // Validated before logging: the raw `signupPlatform` is client input and never reaches a log.
  const platform = validPlatform(body.signupPlatform);
  const answer = (outcome, extra = {}, deviceCountry = null) => {
    // eslint-disable-next-line no-console -- structured step-1 outcome line, read by CloudWatch
    console.log(
      JSON.stringify({
        msg: 'registry_signup_start',
        family_id_hash: familyIdHash(familyId),
        outcome,
        platform,
        has_country: deviceCountry !== null,
        table: tableLabel(event.headers?.origin),
      })
    );
    return { res: response(200, { success: true, signupStart: outcome, ...extra }, event) };
  };

  // A live row is a pod (or an earlier step 1) and a tombstone is a deleted family: a late or
  // replayed step-1 write must not touch either, so both answer `exists` with nothing written.
  if (existingRaw) return answer('exists');

  // The row this creates stamps its owner, so the writer must BE that owner: otherwise a later
  // pod-creation write from the real owner would fail the pointer guard (`isOwner`). Absent,
  // null and empty writer ids are refused for the same reason.
  if (!body.writerMemberId || body.writerMemberId !== body.ownerMemberId) {
    return answer('refused');
  }

  const deviceCountry = countryForTimeZone(body.deviceTimeZone);
  const item = buildSignupStartItem({ familyId, body, now, deviceCountry });
  // `attribute_not_exists(familyId)`, the ordinary first write's condition: a row created since
  // the read fails this write and `handlePut`'s existing retry re-reads it (no second mechanism).
  const version = ownerVersionCondition(null);
  try {
    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: version.expression,
      })
    );
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') return { conflict: true };
    throw err;
  }
  return answer('created', { deviceCountry }, deviceCountry);
}

/**
 * The survey answer's first stamp (#128), applied to the item `putOnce` is about to write. When
 * this write is the first to stamp `heardVia` and the row already holds an inferred attribution,
 * that value was scored without the answer (the answer is write-once, so it was null then), and
 * `applyHeardVia` rescales it with the scorer's own multiplier and bands (never an upgrade; null
 * below the threshold, as the scorer stores nothing there).
 *
 * Returns true for a LATE stamp (a first stamp on a write that is not the pod-creation one),
 * which `putOnce` answers with the signup response fields. An old client stamping on the
 * `isSignupEvent` write gets false: its row has no inferred value yet (`inferAtCreate` scores it
 * on that same write, with the answer already in the item), so nothing here changes for it.
 *
 * Logs one `heard_via_late_stamp` line per late stamp or rescale (hash and bands only, never the
 * answer), so the rate of answers arriving after the pod is countable from the success path.
 */
function stampHeardViaLate({ existing, item, body, familyId }) {
  if (existing.heardVia != null || item.heardVia == null) return false;
  const late = body.isSignupEvent !== true;
  const before = existing.attributionInferred ?? null;
  if (before) {
    item.attributionInferred = applyHeardVia(before, item.heardVia, before.fields?.utm_source);
  }
  if (late || before) {
    // eslint-disable-next-line no-console -- structured late-stamp line, read by CloudWatch
    console.log(
      JSON.stringify({
        msg: 'heard_via_late_stamp',
        family_id_hash: familyIdHash(familyId),
        band_before: before?.band ?? null,
        band_after: item.attributionInferred?.band ?? null,
      })
    );
  }
  return late;
}

/**
 * The response-only fields of a pod-creation write (#125): the stamped country and the inferred
 * band + tag, for the creating client's Slack line. The full `attributionInferred` stays ops data
 * (GET strips it), so only `band` and `fields` go back.
 */
function signupResponseFields(item) {
  const inferred = item.attributionInferred;
  return {
    deviceCountry: item.deviceCountry ?? null,
    attributionInferred: inferred ? { band: inferred.band, fields: inferred.fields } : null,
  };
}

/** The sparse events-table index (#125 Terraform): store taps only, by platform and time. */
const INFERENCE_INDEX = 'platform-tsEpoch-index';
/** Ledger rows read per inference. Newest first, so the cut drops the oldest, never the nearest. */
const INFERENCE_QUERY_LIMIT = 200;

/**
 * Create-time inference (#125): score a native pod against the store-tap ledger at its
 * pod-creation write, with the same rules as the metrics run (`inference.mjs`). Returns the
 * `attributionInferred` value to store, or null.
 *
 * NEVER REJECTS, the `readBilling` pattern. This is derived data: a Query or scoring failure must
 * never fail a pod creation, so every failure logs and returns null and the PUT proceeds. It does
 * not see other families' claims (that would need a scan); the metrics run reconciles, never
 * overwrites, and reports a tap held by two rows.
 *
 * Logs exactly one `attribution_inference` line per call, so `putOnce` carries no inference
 * logging.
 */
async function inferAtCreate({ origin, familyId, item, now }) {
  const log = (fields) =>
    // eslint-disable-next-line no-console -- structured inference outcome line, read by CloudWatch
    console.log(
      JSON.stringify({
        msg: 'attribution_inference',
        family_id_hash: familyIdHash(familyId),
        platform: item.signupPlatform,
        ...fields,
      })
    );

  // A self-host with no ledger has nothing to score against; that is a configuration, not an error.
  const tableName = tableForOrigin(origin, EVENTS_TABLES);
  if (!tableName) {
    log({ outcome: 'skipped', reason: 'no-events-table' });
    return null;
  }

  let events;
  try {
    const toSec = Math.floor(Date.parse(now) / 1000);
    const { Items } = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: INFERENCE_INDEX,
        KeyConditionExpression: '#p = :p AND tsEpoch BETWEEN :from AND :to',
        ExpressionAttributeNames: { '#p': 'platform' },
        ExpressionAttributeValues: marshall({
          ':p': item.signupPlatform,
          ':from': toSec - SCORING.windowHours * 3600,
          ':to': toSec,
        }),
        // The scorer picks the nearest tap, so the Limit must cut the oldest, not the newest.
        ScanIndexForward: false,
        Limit: INFERENCE_QUERY_LIMIT,
      })
    );
    events = (Items || []).map((i) => unmarshall(i));
  } catch (err) {
    console.error(
      `[registry] attribution_inference query failed: check the ${INFERENCE_INDEX} index on the events table and dynamodb:Query on it (policy marketing-events-read)`,
      err
    );
    log({ outcome: 'error', reason: 'ddb_query' });
    return null;
  }

  let r;
  try {
    // `createdAt = now`, which is what the batch scorer uses for this row too, so the two paths
    // score the same gap. `attribution: null`: `wantsCreateInference` already declined a tag.
    r = scoreFamily(
      {
        createdAt: now,
        signupPlatform: item.signupPlatform,
        heardVia: item.heardVia,
        attribution: null,
      },
      events,
      { now: new Date(now) }
    );
  } catch (err) {
    // Pure code on stored ledger rows; a throw here is a bug, and still must not fail the create.
    console.error('[registry] attribution_inference scoring threw', err);
    log({ outcome: 'error', reason: 'score' });
    return null;
  }

  if (r.status === 'scored') {
    log({
      outcome: 'scored',
      band: r.value.band,
      candidates: r.value.candidates,
      gap_minutes: r.value.gapMinutes,
    });
    return r.value;
  }
  if (r.status === 'no-candidates' || r.status === 'below-threshold') {
    log({ outcome: r.status, candidates: r.candidates ?? 0 });
    return null;
  }
  // `deterministic` / `ineligible`: unreachable behind `wantsCreateInference`, logged if not.
  log({ outcome: 'skipped', reason: r.status });
  return null;
}

/**
 * The DELETE arm: tombstone the row (see the comment inside). Moved out of `handler` as
 * `handlePut` already is, so `handler` stays a dispatcher. Throws to the handler's catch (500),
 * as before.
 *
 * `?neverFinishedOnly=1` (#125, "Start over" on the resume-setup screen) tombstones the row only
 * when it is a step-1 row (`isNeverFinishedRow`), and answers `skipped: 'pod-exists'` for anything
 * else. The decision is made HERE, from the stored row, never from client state: a device that
 * thinks no pod exists may be wrong, and a tombstoned pod is a family gone missing. Without the
 * flag the arm is unchanged.
 */
async function handleDelete(event, familyId, tableName) {
  // ─── TOMBSTONE, NOT A DROP (2026-09-09) ──────────────────────────────
  //
  // A hard delete lost `createdAt`, `ownerMemberId`, `ownerEmail`, `country`
  // and `signupPlatform` irrecoverably, and the next write from ANY member
  // device recreated the row from scratch with that member stamped as the
  // owner. That is how greg's pod reported an owner it never had. See
  // docs/investigations/2026-09-08-compaction-fallout.md items 3 + 8.
  //
  // Keeping the identity attributes makes that loss structurally impossible:
  // a re-registration restores the row the family had rather than inventing
  // a new one. The client-side fix (a per-device action no longer issues a
  // DELETE at all) closes the door that was actually used; this closes the
  // room, because the investigation could not fully identify the trigger and
  // defence in depth is the whole design here.
  const { Item: existingRaw } = await client.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall({ familyId }),
      ConsistentRead: true,
    })
  );
  const existing = existingRaw ? unmarshall(existingRaw) : null;

  const neverFinishedOnly = event.queryStringParameters?.neverFinishedOnly === '1';
  // One line per start-over request, so the decision is visible: the client does not parse it.
  const logStartOver = (outcome) =>
    neverFinishedOnly &&
    // eslint-disable-next-line no-console -- structured start-over outcome line, read by CloudWatch
    console.log(
      JSON.stringify({
        msg: 'registry_start_over',
        family_id_hash: familyIdHash(familyId),
        outcome,
        table: tableLabel(event.headers?.origin),
      })
    );

  // Nothing to tombstone. Writing a bare `deletedAt` row for a family that
  // never registered would manufacture junk every reader then has to filter,
  // so report the same idempotent success the hard delete gave.
  if (!existing) {
    logStartOver('no-row');
    return response(200, { success: true }, event);
  }

  // A DELETE on a tombstone (a second start-over, a teardown retry, a double tap) has nothing
  // live to remove, and rewriting `deletedAt` would move the deletion forward in every ops
  // scan. Idempotent for the whole arm, flag or no flag.
  if (existing.deletedAt) {
    logStartOver('already-tombstoned');
    return response(200, { success: true, skipped: 'already-tombstoned' }, event);
  }

  // Start over must never delete a family that has a pod: only a step-1 row is abandoned.
  if (neverFinishedOnly && !isNeverFinishedRow(existing)) {
    logStartOver('skipped-pod-exists');
    return response(200, { success: true, skipped: 'pod-exists' }, event);
  }

  // ─── DELETE ladder, step 1 of 2: MEASURE, DO NOT ENFORCE ─────────────
  //
  // NOT AUTHORIZATION, and it must not later be mistaken for it. The API key
  // ships inside the client bundle, so a curl gets the same answer here that
  // the app does — exactly as the pointer guard above already concedes. This
  // defends a family against the APP'S OWN BUGS, which is the failure that
  // actually happened, and against nothing else.
  //
  // The delete still proceeds. This warn IS the measurement that decides when
  // the 403 can ship: every client deployed before the writer id goes on the
  // wire sends none at all and would be refused on day one, including the
  // Playwright teardown hook. Enforce only once this line is quiet for real
  // families for a full release cycle.
  const writerMemberId = event.queryStringParameters?.writerMemberId;
  const writerValid = typeof writerMemberId === 'string' && UUID_RE.test(writerMemberId);
  const deleteAuthorized =
    writerValid && !!existing.ownerMemberId && writerMemberId === existing.ownerMemberId;

  if (!deleteAuthorized) {
    // Id TAILS only — never a full member id in CloudWatch, matching the
    // masking the pointer-refusal warn above already uses.
    console.warn(
      '[registry] delete would be refused',
      familyId,
      writerValid ? String(writerMemberId).slice(-6) : 'no-writer-id',
      String(existing.ownerMemberId ?? '').slice(-6) || 'no-owner'
    );
  }

  const deletedNow = new Date().toISOString();
  await client.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall(
        {
          familyId,
          // Identity and provenance survive so a restore is a restore.
          createdAt: existing.createdAt ?? null,
          ownerMemberId: existing.ownerMemberId ?? null,
          ownerEmail: existing.ownerEmail ?? null,
          // The drift-handover lock (owner.mjs) survives a delete, so a restored family
          // cannot have its ownership handed back by a stale roster either.
          ownerHandoverAt: existing.ownerHandoverAt ?? null,
          country: existing.country ?? null,
          signupPlatform: existing.signupPlatform ?? null,
          // Campaign provenance (#118): identifies the ad, not the family, and a
          // restore must not lose which ad created the pod.
          attribution: existing.attribution ?? null,
          // The survey answer and the scorer's inferred ad (#121): provenance of the same
          // kind, so a restore keeps them too.
          heardVia: existing.heardVia ?? null,
          attributionInferred: existing.attributionInferred ?? null,
          // When sign-up started and the zone-derived country (#125): provenance too, and
          // `signupStartedAt` is what still marks a started-over row as never-finished.
          signupStartedAt: existing.signupStartedAt ?? null,
          deviceCountry: existing.deviceCountry ?? null,
          // The create attempt (#128): a random id, not the family, and a started-over row is
          // exactly the one whose firehose funnel needs joining back to it.
          createAttemptId: existing.createAttemptId ?? null,
          // Everything else is deliberately DROPPED, and the omissions are
          // decisions: the canonical pointer (a stale pointer is worse than
          // none), the activity signals and roster size (they would keep a
          // deleted family alive in the metrics), and `familyName` +
          // `subscribeNewsletter` (family content and a marketing consent —
          // the user asked for this family to be gone).
          deletedAt: deletedNow,
          // Ops hygiene: every other row carries one, and a tombstone with
          // no `updatedAt` is invisible to a "what changed recently" scan.
          updatedAt: deletedNow,
        },
        { removeUndefinedValues: true }
      ),
    })
  );
  logStartOver('tombstoned');
  return response(200, { success: true }, event);
}

export async function handler(event) {
  // The keyless marketing-events beacon (#121) has no API key and no familyId, so it branches
  // BEFORE both checks below. Every other route keeps the key + UUID gate.
  if (event.routeKey === 'POST /events') return handleEvents(event);

  // API key check
  const key = event.headers?.['x-api-key'];
  if (key !== API_KEY) {
    return response(401, { error: 'Unauthorized' }, event);
  }

  const familyId = event.pathParameters?.familyId;
  if (!familyId || !UUID_RE.test(familyId)) {
    return response(400, { error: 'Invalid familyId — must be a UUID' }, event);
  }

  const method = event.requestContext?.http?.method;
  const tableName = tableForOrigin(event.headers?.origin, REGISTRY_TABLES);

  try {
    if (method === 'GET') {
      // The billing read (#95) runs alongside, never after: `readBilling` cannot reject, so a
      // registry failure still reaches the outer catch exactly as before.
      const [{ Item }, billingRead] = await Promise.all([
        client.send(
          new GetItemCommand({
            TableName: tableName,
            Key: marshall({ familyId }),
            // Strongly consistent. An eventually-consistent read can miss a row
            // written moments ago, and a client told "absent" for a family that
            // does exist takes a recovery path it had no business taking.
            ConsistentRead: true,
          })
        ),
        readBilling(familyId),
      ]);
      if (!Item) return response(404, { error: 'Family not found' }, event);
      const row = unmarshall(Item);
      // A tombstoned row is GONE as far as every client is concerned. Its
      // identity attributes survive so a later PUT can restore them (see the
      // DELETE arm); that is bookkeeping, not a live family.
      if (row.deletedAt) return response(404, { error: 'Family not found' }, event);
      // Additive: every existing reader ignores the extra key, and `entitlement: null` means
      // "could not be computed this time", which the client answers by keeping its cache.
      const entitlement = entitlementFor(familyId, row, billingRead);
      // `attributionInferred` (#121) is derived ops data owned by the metrics skill's scorer,
      // not part of the app's wire contract, so its shape can change without touching the app.
      const publicRow = { ...row };
      delete publicRow.attributionInferred;
      // `dataPolicy` (#117) is a response-only field like `entitlement`: the client persists it
      // device-locally and hands it to the doc worker; it is never a row attribute.
      return response(
        200,
        { ...publicRow, entitlement, dataPolicy: { counterWrites: COUNTER_WRITES } },
        event
      );
    }

    if (method === 'PUT') return await handlePut(event, familyId, tableName);

    if (method === 'DELETE') return await handleDelete(event, familyId, tableName);

    return response(405, { error: 'Method not allowed' }, event);
  } catch (err) {
    console.error('Registry error:', err);
    return response(500, { error: 'Internal server error' }, event);
  }
}
