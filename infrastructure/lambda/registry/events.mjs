/**
 * Marketing-events ledger (#121): the pure half of the keyless `POST /events` route.
 *
 * The marketing site beacons two kinds of first-party event here: `landing` (an entry pageview,
 * tagged or not) and `store_tap` (an App Store / Play badge tap). The metrics skill later joins
 * `store_tap` rows to registry rows whose pod was created natively, to infer which ad brought the
 * family (`attributionInferred`).
 *
 * WHAT IS STORED, AND WHAT IS NOT. Kind, platform, the validated campaign tag, a reduced device
 * class and OS family, a bounded page path, the Origin and the time. Never the raw User-Agent,
 * never an OS or browser version, never an IP, never a cookie or anything that links two events
 * from one person. Rows expire after LEDGER_TTL_MS through the table's `expires_at` TTL.
 *
 * No SDK import, on purpose: the metrics skill imports `eventsTableName` from this file (the
 * `pull_ai_usage.mjs` -> `ai-extract/ddb.mjs` precedent), and the tests drive it without mocks.
 * The DynamoDB write lives in `index.mjs` (`handleEvents`). Never throws.
 */

export const EVENT_KINDS = ['landing', 'store_tap'];
export const PLATFORMS = ['ios', 'android'];
/** Request body cap, checked on the DECODED bytes before `JSON.parse`. */
export const MAX_BODY_BYTES = 2048;
/** `loc` is truncated to this, never rejected: a long slug must not lose a `store_tap`. */
export const MAX_LOC_LENGTH = 120;
/** 390 days: the "about 13 months" the privacy page states. */
export const LEDGER_TTL_MS = 390 * 24 * 60 * 60 * 1000;

/**
 * The table-name grammar, shared with terraform (`modules/registry/main.tf`:
 * `${var.app_name}-marketing-events-${var.environment}` and `...-marketing-events-dev`) and
 * imported by the metrics skill. `eventsTableName('prod')` / `eventsTableName('dev')`.
 */
export const eventsTableName = (env) => `beanies-family-marketing-events-${env}`;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reduce a User-Agent header to `{ class: phone | tablet | desktop, os: ios | android | macos |
 * windows | other }`, or null when the header is absent. Never returns the raw string or any
 * version: Chrome on Android freezes the OS version (`Android 10; K`), so a version could never be
 * matched against anything the app later reports.
 *
 * Known and accepted: iPadOS Safari presents as a Macintosh by default, so it reduces to
 * `desktop` / `macos`. Order matters: an iPhone UA contains "like Mac OS X", so iOS is tested
 * before macOS.
 */
export function reduceUserAgent(ua) {
  if (typeof ua !== 'string' || !ua.trim()) return null;
  if (/\biPad\b/.test(ua)) return { class: 'tablet', os: 'ios' };
  if (/\b(iPhone|iPod)\b/.test(ua)) return { class: 'phone', os: 'ios' };
  if (/\bAndroid\b/.test(ua)) {
    // Android tablets omit the "Mobile" token; phones carry it (reduced UA included).
    return { class: /\bMobile\b/.test(ua) ? 'phone' : 'tablet', os: 'android' };
  }
  if (/\bWindows\b/.test(ua)) return { class: 'desktop', os: 'windows' };
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return { class: 'desktop', os: 'macos' };
  return { class: /\bMobi/.test(ua) ? 'phone' : 'desktop', os: 'other' };
}

/**
 * Validate a parsed request body. Returns `{ ok: true, event }` or `{ ok: false, reason }`, where
 * `reason` is one of `bad_kind | bad_platform | bad_fields`.
 *
 * - `kind` must be one of EVENT_KINDS. A body that is not a JSON object has no kind: `bad_kind`.
 * - `platform` is required on `store_tap` (one of PLATFORMS). A `landing` has no platform: any
 *   value sent is ignored rather than rejected (the funnel event must not be lost to it).
 * - `fields` absent or null is an untagged event. Present but not a plain object is `bad_fields`.
 *   Otherwise each field goes through `validFields` (the registry's `validAttribution`), which
 *   drops an invalid field on its own with one `attribution_dropped` line; nothing valid left
 *   means `fields` absent and `tagged: false`. A stray bad field never loses a tap.
 * - `loc` is never a rejection reason: a string starting with `/` is kept (truncated to
 *   MAX_LOC_LENGTH); anything else is stored as `/`.
 */
export function validateEvent(body, validFields) {
  if (!isPlainObject(body) || !EVENT_KINDS.includes(body.kind)) {
    return { ok: false, reason: 'bad_kind' };
  }
  const kind = body.kind;

  let platform = null;
  if (kind === 'store_tap') {
    if (!PLATFORMS.includes(body.platform)) return { ok: false, reason: 'bad_platform' };
    platform = body.platform;
  }

  let fields = null;
  if (body.fields !== undefined && body.fields !== null) {
    if (!isPlainObject(body.fields)) return { ok: false, reason: 'bad_fields' };
    fields = validFields(body.fields);
  }

  const loc =
    typeof body.loc === 'string' && body.loc.startsWith('/')
      ? body.loc.slice(0, MAX_LOC_LENGTH)
      : '/';

  return { ok: true, event: { kind, platform, fields, tagged: fields !== null, loc } };
}

/**
 * The DynamoDB item (plain JS; the caller marshalls it with `removeUndefinedValues`). `now` is
 * epoch milliseconds. `ts` is ISO-8601, `tsEpoch` and `expires_at` are epoch SECONDS (the TTL
 * attribute must be seconds; `tsEpoch` matches it so the two compare directly). `platform`,
 * `fields` and `device` are omitted, not null, when there is nothing to store.
 */
export function buildItem(event, { now, origin, device, eventId }) {
  return {
    eventId,
    ts: new Date(now).toISOString(),
    tsEpoch: Math.floor(now / 1000),
    kind: event.kind,
    ...(event.platform ? { platform: event.platform } : {}),
    tagged: event.tagged,
    ...(event.fields ? { fields: event.fields } : {}),
    ...(device ? { device } : {}),
    loc: event.loc,
    origin,
    expires_at: Math.floor((now + LEDGER_TTL_MS) / 1000),
  };
}
