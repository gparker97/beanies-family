/**
 * Campaign attribution, shared by the marketing site and the app (#118).
 *
 * One parser, one key list, one storage envelope, one query serialiser. The site
 * (`web/src/components/AppLinks.astro`) captures the landing URL's tag and decorates
 * every app-bound link with it; the app (`src/utils/attributionStash.ts`) captures the
 * same tag on first load, holds it for 30 days (first touch wins), and the pod-creation
 * flow forwards it to the create-pod Slack message, the family registry row and the
 * Plausible `signup` event, then clears it.
 *
 * ⚠️ `ATTRIBUTION_KEYS` is the single edit point, but it has TWINS that cannot import it.
 * Change the list or the value rule here AND in each of:
 *   - `infrastructure/lambda/registry/index.mjs` `validAttribution` (a Lambda is its own zip);
 *     `src/utils/__tests__/attribution.test.ts` and `infrastructure/lambda/registry/index.test.mjs`
 *     share the fixture strings so a rule change on one side fails the other.
 *   - `web/src/pages/privacy.astro` (the registry list + the analytics paragraph)
 *   - `docs/runbooks/native-store-submission.md` §1 (the "Campaign tag" row)
 *   - `ios/App/App/PrivacyInfo.xcprivacy` (header comment under Product Interaction)
 *   - `src/content/help/security.ts` ("What we collect")
 *
 * `ref` is NOT here on purpose: it is an invite-link parameter (`parseInviteLink`). The
 * OpenAI click id is `oppref`, never shortened.
 *
 * `ATTRIBUTION_STORAGE_KEY` is the same string on two origins (`beanies.family` and
 * `app.beanies.family`). Web storage is per origin, so the two stores are independent and
 * nothing is shared through the key; the tag crosses the boundary only in the link's query.
 *
 * Pure: no DOM, no storage, never throws.
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
] as const;

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type Attribution = Partial<Record<AttributionKey, string>>;

/** Non-UTM keys: the app scrubs these from the Plausible pageview URL (Plausible consumes `utm_*` natively). */
export const NON_UTM_ATTRIBUTION_KEYS: readonly AttributionKey[] = ATTRIBUTION_KEYS.filter(
  (k) => !k.startsWith('utm_')
);

/** The subset forwarded as Plausible custom props; `PublicPropKey` in plausible.ts derives from it. */
export const PLAUSIBLE_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
] as const satisfies readonly AttributionKey[];

export const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * A `capturedAt` this far in the future is a hand-edited or nonsensical envelope and reads as
 * `corrupt`; anything nearer is clock skew (an NTP step between the write and the read) and
 * is honoured, expiring at `capturedAt + TTL` like any other.
 */
export const ATTRIBUTION_SKEW_MS = 60 * 60 * 1000;
export const ATTRIBUTION_STORAGE_KEY = 'beanies:attribution';

/**
 * The value rule, stated once for both twins: after `trim()`, 1–100 chars from this set.
 * Anything else drops THAT FIELD (never the whole record). A backtick, `<`, `=`, `&`, space
 * and every mrkdwn-significant character beyond `_ ~ :` are outside the set, so a value can
 * be rendered inside a Slack code span, stored, or sent as a Plausible prop as-is.
 */
export const ATTRIBUTION_VALUE_RE = /^[A-Za-z0-9._~:-]{1,100}$/;

export interface AttributionEnvelope {
  v: 1;
  capturedAt: number;
  fields: Attribution;
}

export type AttributionEnvelopeState =
  | { state: 'none' }
  | { state: 'corrupt' }
  | { state: 'expired' }
  | { state: 'ok'; fields: Attribution };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate one value against the shared rule. `null` when it fails. */
export function normaliseAttributionValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return ATTRIBUTION_VALUE_RE.test(v) ? v : null;
}

/**
 * Pull the allowlisted keys out of a query string (with or without the leading `?`).
 * Invalid values drop their own field; `null` when nothing valid remains.
 */
export function parseAttribution(search: string): Attribution | null {
  return parseAttributionDetailed(search).fields;
}

/**
 * The same parse, plus `present`: how many allowlisted keys the query string carried, valid or
 * not. `present - Object.keys(fields).length` is the number of per-field drops, which is what
 * makes a value that fails the rule beside valid siblings observable instead of vanishing.
 * One pass over the query string; `new URLSearchParams(string)` never throws and the leading
 * `?` is optional.
 */
export function parseAttributionDetailed(search: string): {
  fields: Attribution | null;
  present: number;
} {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw: Record<string, string> = {};
  let present = 0;
  for (const key of ATTRIBUTION_KEYS) {
    const v = params.get(key);
    if (v !== null) {
      present += 1;
      raw[key] = v;
    }
  }
  return { fields: present ? sanitiseAttribution(raw) : null, present };
}

/**
 * Keep the allowlisted keys of an arbitrary object whose values pass the rule.
 * Unknown keys are ignored (so a newer writer never nulls an older reader's record);
 * `null` when nothing valid remains.
 */
export function sanitiseAttribution(value: unknown): Attribution | null {
  if (!isRecord(value)) return null;
  const out: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const v = normaliseAttributionValue(value[key]);
    if (v !== null) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function toSearchParams(a: Attribution): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ATTRIBUTION_KEYS) {
    const v = a[key];
    if (v) params.set(key, v);
  }
  return params;
}

/**
 * Append the tag to `href` when it points at `appOrigin`. A parameter already present on the
 * link is never overwritten; the hash is preserved by construction; an off-origin or
 * unparseable href comes back unchanged. Idempotent.
 */
export function appendAttribution(href: string, a: Attribution, appOrigin: string): string {
  let url: URL;
  let origin: string;
  try {
    url = new URL(href);
    origin = new URL(appOrigin).origin;
  } catch {
    // A relative href (`/ios`, `#top`) or a non-URL scheme is a legitimate input that `new URL`
    // rejects; it cannot point at the app origin, so unchanged IS the classification.
    return href;
  }
  if (url.origin !== origin) return href;
  let touched = false;
  for (const key of ATTRIBUTION_KEYS) {
    const v = a[key];
    if (v && !url.searchParams.has(key)) {
      url.searchParams.set(key, v);
      touched = true;
    }
  }
  return touched ? url.toString() : href;
}

export function makeEnvelope(fields: Attribution, now: number): AttributionEnvelope {
  return { v: 1, capturedAt: now, fields };
}

/**
 * Classify an already-parsed stored value (`storedJson` in the app, `JSON.parse` on the site).
 * A wrong version, a missing timestamp or no valid fields all read as `corrupt` so the caller
 * replaces it; `expired` once `capturedAt + TTL` is in the past.
 */
export function readEnvelope(value: unknown, now: number): AttributionEnvelopeState {
  if (value === null || value === undefined) return { state: 'none' };
  if (!isRecord(value) || value.v !== 1 || typeof value.capturedAt !== 'number') {
    return { state: 'corrupt' };
  }
  const fields = sanitiseAttribution(value.fields);
  if (!fields) return { state: 'corrupt' };
  if (value.capturedAt > now + ATTRIBUTION_SKEW_MS) return { state: 'corrupt' };
  if (now - value.capturedAt >= ATTRIBUTION_TTL_MS) return { state: 'expired' };
  return { state: 'ok', fields };
}

/** The four Plausible props, only those present; `undefined` when there is nothing to send. */
export function pickPlausibleProps(
  a: Attribution | null
): Partial<Record<(typeof PLAUSIBLE_ATTRIBUTION_KEYS)[number], string>> | undefined {
  if (!a) return undefined;
  const out: Partial<Record<(typeof PLAUSIBLE_ATTRIBUTION_KEYS)[number], string>> = {};
  for (const key of PLAUSIBLE_ATTRIBUTION_KEYS) {
    if (a[key]) out[key] = a[key];
  }
  return Object.keys(out).length ? out : undefined;
}

/** `source / campaign / content`, the human-readable summary used in the Slack line. */
export function summariseAttribution(a: Attribution): string {
  return [a.utm_source, a.utm_campaign, a.utm_content].filter(Boolean).join(' / ');
}
