/**
 * Inferred attribution for native pods (#121, #125): the store-tap scorer.
 *
 * WHY THIS EXISTS
 * A pod created on the web carries the ad's tag deterministically (#118: registry `attribution`).
 * A pod created after an App Store or Play badge tap carries nothing, because the stores drop the
 * tag. The marketing site records every badge tap in the first-party ledger (`store_tap`, with
 * the tag and the platform), so a native pod created shortly after a same-platform tap can be
 * joined to that tap with a stated confidence.
 *
 * ONE SCORER, TWO CALLERS
 * The registry Lambda scores a native pod once, at its pod-creation write (`inferAtCreate` in
 * `index.mjs`, gated by `wantsCreateInference` below), and the metrics skill's batch run
 * (`beanies-metrics/scripts/infer_attribution.mjs`) reconciles every family later. Both import
 * the rules from here, and the batch script re-exports them, so the two can never score the same
 * family differently. The rules were lifted from that script unchanged (#125); its tests and
 * `references/data-sources.md` still pin `SCORING`.
 *
 * PURE, ON PURPOSE
 * No AWS imports, no `process.env`, no clock (the caller passes `now`), no logging. The Lambda
 * owns the ledger Query and the log lines; the batch script owns its file reads and its write.
 *
 * THE SCORE (every number lives in SCORING below)
 *   - Candidates: `store_tap` events whose `platform` equals the family's `signupPlatform`, in
 *     [createdAt - 72 h, createdAt], not already claimed by an earlier family. Rows with
 *     `signupPlatform` web or null are never inferred: web pods carry the tag deterministically,
 *     and null means a row older than the platform stamp.
 *   - The chosen tap is the nearest one. Its gap sets the base (gapTiers).
 *   - Competition: the base is divided by the number of distinct `utm_content` values among the
 *     candidates in the SAME gap tier (an untagged tap is its own value: it may be an organic
 *     visitor, which is real competition).
 *   - heardVia: a survey answer naming a channel that contradicts the tap's `utm_source` (say
 *     `reddit` against a `chatgpt` tap) multiplies by `heardViaContradiction`; anything else,
 *     including no answer, is x1.0. There is no corroboration boost: every base is already <= 1.
 *   - Bands: high >= 0.8, medium >= 0.5, low >= 0.25; below that nothing is written.
 *   - An untagged tap scores the same way with `fields: {}`.
 */

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};

/** Every threshold and multiplier the scorer uses. Quoted in references/data-sources.md. */
export const SCORING = deepFreeze({
  method: 'store_tap_v1',
  windowHours: 72,
  gapTiers: [
    { maxMinutes: 10, base: 1.0 },
    { maxMinutes: 30, base: 0.85 },
    { maxMinutes: 120, base: 0.6 },
    { maxMinutes: 360, base: 0.4 },
    { maxMinutes: 72 * 60, base: 0.2 },
  ],
  heardViaContradiction: 0.6,
  bands: { high: 0.8, medium: 0.5, low: 0.25 },
});

/**
 * Survey ids that name a channel, mapped to the normalised `utm_source` values consistent with
 * it. An id not listed here (`app_store`, `friend`, `other`) names no channel and never
 * contradicts a tap. `app_store` is deliberately neutral: a person who tapped the badge after an
 * ad did, truthfully, install from the store.
 */
export const HEARD_VIA_SOURCES = deepFreeze({
  chatgpt_ad: ['chatgpt', 'openai'],
  ai: ['chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot'],
  reddit: ['reddit'],
  product_hunt: ['producthunt', 'product_hunt', 'product-hunt'],
  substack: ['substack'],
  google: ['google'],
});

/** The platforms a pod can be inferred for: the store installs that drop the campaign tag. */
export const NATIVE_PLATFORMS = Object.freeze(['ios', 'android']);
const BAND_ORDER = ['high', 'medium', 'low'];

/** `chatgpt.com` and `www.Reddit.com` compare equal to `chatgpt` and `reddit`. */
export function normalizeSource(source) {
  if (typeof source !== 'string') return null;
  const s = source
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.com$/, '');
  return s || null;
}

/** A plain object with at least one key: an attribution map worth the name. */
export function hasFields(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
}

/** True when the survey answer names a channel the tap's source is not. */
export function contradicts(heardVia, utmSource) {
  // eslint-disable-next-line security/detect-object-injection -- frozen map, own keys only read
  const consistent = HEARD_VIA_SOURCES[heardVia];
  const source = normalizeSource(utmSource);
  if (!consistent || !source) return false;
  return !consistent.includes(source);
}

/** Epoch seconds for a ledger event (`tsEpoch` is seconds; `ts` is the ISO fallback). */
export function eventEpoch(e) {
  if (typeof e?.tsEpoch === 'number' && Number.isFinite(e.tsEpoch)) return e.tsEpoch;
  const ms = Date.parse(e?.ts);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function tierIndex(gapMinutes) {
  return SCORING.gapTiers.findIndex((t) => gapMinutes <= t.maxMinutes);
}

function bandFor(confidence) {
  // eslint-disable-next-line security/detect-object-injection -- `b` is from the constant BAND_ORDER
  return BAND_ORDER.find((b) => confidence >= SCORING.bands[b]) ?? null;
}

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Unclaimed same-platform taps in the window before the pod, nearest first. */
export function candidatesFor(family, events, claimed) {
  const created = Date.parse(family.createdAt) / 1000;
  if (!Number.isFinite(created)) return [];
  const earliest = created - SCORING.windowHours * 3600;
  const out = [];
  for (const e of events) {
    if (e?.kind !== 'store_tap' || e.platform !== family.signupPlatform || !e.eventId) continue;
    if (claimed.has(e.eventId)) continue;
    const t = eventEpoch(e);
    if (t == null || t < earliest || t > created) continue;
    out.push({ event: e, gapMinutes: (created - t) / 60 });
  }
  // Nearest first; on an exact tie prefer a tagged tap, then a stable id order.
  return out.sort(
    (a, b) =>
      a.gapMinutes - b.gapMinutes ||
      Number(hasFields(b.event.fields)) - Number(hasFields(a.event.fields)) ||
      String(a.event.eventId).localeCompare(String(b.event.eventId))
  );
}

/**
 * Score one family against the ledger.
 * @returns {{ status: 'deterministic' | 'ineligible' | 'no-candidates' | 'below-threshold' | 'scored',
 *             candidates?: number, confidence?: number, value?: object }}
 * `value` (status `scored` only) is the `attributionInferred` map to store.
 */
export function scoreFamily(family, events, { claimed = new Set(), now = new Date() } = {}) {
  if (hasFields(family?.attribution)) return { status: 'deterministic' };
  if (!NATIVE_PLATFORMS.includes(family?.signupPlatform)) return { status: 'ineligible' };
  if (!Number.isFinite(Date.parse(family.createdAt))) return { status: 'ineligible' };

  const cands = candidatesFor(family, events || [], claimed);
  if (!cands.length) return { status: 'no-candidates', candidates: 0 };

  const chosen = cands[0];
  const tier = tierIndex(chosen.gapMinutes);
  const sameTier = cands.filter((c) => tierIndex(c.gapMinutes) === tier);
  const competitors = new Set(sameTier.map((c) => c.event.fields?.utm_content ?? null)).size;
  const fields = hasFields(chosen.event.fields) ? { ...chosen.event.fields } : {};
  const multiplier = contradicts(family.heardVia, fields.utm_source)
    ? SCORING.heardViaContradiction
    : 1;
  // eslint-disable-next-line security/detect-object-injection -- `tier` is a findIndex result
  const confidence = round((SCORING.gapTiers[tier].base / competitors) * multiplier, 3);
  const band = bandFor(confidence);
  if (!band) return { status: 'below-threshold', candidates: cands.length, confidence };

  return {
    status: 'scored',
    candidates: cands.length,
    confidence,
    value: {
      fields,
      confidence,
      band,
      method: SCORING.method,
      eventId: chosen.event.eventId,
      gapMinutes: round(chosen.gapMinutes, 1),
      candidates: cands.length,
      scoredAt: now.toISOString(),
    },
  };
}

/**
 * A pod-creation write worth a ledger Query: native, no deterministic tag, nothing inferred yet.
 * The single statement of who is scorable at create time, so the Lambda and the batch run cannot
 * drift on it. Takes the item about to be written (its `attributionInferred` is the stored value
 * carried forward, so a family already scored is declined here).
 */
export const wantsCreateInference = ({ signupPlatform, attribution, attributionInferred }) =>
  NATIVE_PLATFORMS.includes(signupPlatform) &&
  !hasFields(attribution) &&
  attributionInferred == null;
