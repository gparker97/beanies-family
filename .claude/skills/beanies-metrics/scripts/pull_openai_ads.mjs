#!/usr/bin/env node
/**
 * beanies-metrics: OpenAI Ads API collector (READ-ONLY).
 *
 * The ChatGPT Ads pilot used to be fed from a hand-typed ledger because there
 * was no platform API. There is one now. This script pulls the account, the
 * campaign / ad-group / ad roster, and the per-ad and per-campaign daily
 * insights, so `build_dashboard.mjs` can use the platform as the source of
 * spend / impressions / clicks and leave the manual ledger with only what the
 * platform cannot know (`pods_manual`, plus optional overrides).
 *
 * Auth: env OPENAI_ADS_API_KEY, normally loaded from ~/.openai.env
 * (`set -a; . ~/.openai.env; set +a`). The key is NEVER printed and NEVER
 * committed. If it is absent the script exits 3 with a clear message so the
 * pipeline degrades exactly like query_plausible.mjs does (the paid panel
 * falls back to the ledger alone).
 *
 * Usage:
 *   node pull_openai_ads.mjs [DAYS]      # default 30; window ends "today" in the
 *                                        # ad account's timezone (Asia/Singapore)
 *
 * Emits one JSON object on stdout:
 *   { generatedAt, window:{since,until}, account, campaigns[], adGroups[], ads[],
 *     dailyByAd[], dailyByCampaign[], byCountry[], lifetime, spendUnit, _degraded[] }
 *
 * ── Units (verified 2026-10-01 against the first live day) ──────────────────
 * `spend` and `cpc` come back in WHOLE CURRENCY UNITS of the account currency
 * (`account.currency`, SGD for this account), not micros: the campaign row read
 * spend 14.69 / clicks 4 / cpc 3.67, and 4 x 3.67 = 14.68, while the campaign's
 * `budget.daily_spend_limit_micros` = 25,000,000 for a S$25/day cap. So budgets
 * are micros and insights are units — `dailyBudget` below is already divided.
 * `ctr` is a FRACTION (0.0061 = 4 / 653), converted to percent here so it
 * matches the ledger's convention. `spendUnit` records the inference.
 *
 * ── Query tolerance ─────────────────────────────────────────────────────────
 * The roster and the daily insights are REQUIRED — a silently empty paid panel
 * is worse than a visibly degraded one. The per-country split and the lifetime
 * aggregate go through `soft()`; a failure records itself in `_degraded` and
 * the build step falls back (lifetime -> sum of the daily rows, which is only
 * right while the window covers the whole campaign).
 */

const API = 'https://api.ads.openai.com/v1';
const DAYS = Math.max(1, Number(process.argv[2] || 30));
const DEFAULT_TZ = 'Asia/Singapore';

const KEY = (process.env.OPENAI_ADS_API_KEY || '').trim();
if (!KEY) {
  process.stderr.write(
    'OPENAI_ADS_API_KEY_MISSING: load it with `set -a; . ~/.openai.env; set +a` before running. ' +
      'The paid panel will fall back to the manual ledger alone.\n'
  );
  process.exit(3);
}

/** Every soft query that failed, so the dashboard can say what is missing. */
const degraded = [];

async function get(path, params = []) {
  const url = new URL(API + path);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message || text;
    } catch {
      /* keep raw */
    }
    throw new Error(`OpenAI Ads ${res.status} for ${path}: ${String(msg).slice(0, 200)}`);
  }
  return JSON.parse(text);
}

/** Walk a `{object:'list', data, has_more, last_id}` endpoint to the end. */
async function listAll(path, params = []) {
  const out = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const resp = await get(path, [
      ...params,
      ['limit', '100'],
      ...(after ? [['after', after]] : []),
    ]);
    out.push(...(resp.data || []));
    if (!resp.has_more || !resp.last_id || resp.last_id === after) break;
    after = resp.last_id;
  }
  return out;
}

async function soft(name, fn) {
  try {
    return await fn();
  } catch (err) {
    degraded.push({ name, reason: String(err?.message || err).slice(0, 220) });
    return null;
  }
}

/** yyyy-mm-dd of an instant in a named timezone. */
function isoDateIn(tz, ms = Date.now()) {
  // en-CA formats as yyyy-mm-dd; sv-SE would too, but en-CA is the common idiom.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}
function shiftIso(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  return new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10);
}

/** Pull the `utm_*` pairs out of an ad's landing-page query-string template. */
function parseUtm(template) {
  if (!template) return { utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null };
  const p = new URLSearchParams(template);
  const pick = (k) => {
    const v = p.get(k);
    return v && !/^\{.*\}$/.test(v) ? v : null;
  };
  return {
    utmSource: pick('utm_source'),
    utmMedium: pick('utm_medium'),
    utmCampaign: pick('utm_campaign'),
    utmContent: pick('utm_content'),
  };
}

const r2 = (n) => (n == null ? null : Math.round(Number(n) * 100) / 100);
const pct2 = (frac) => (frac == null ? null : Math.round(Number(frac) * 10000) / 100);
const epochToIso = (s, tz) => (s ? isoDateIn(tz, Number(s) * 1000) : null);

function insightParams(level, since, until, fields, extra = [], { zeroRows = true } = {}) {
  return [
    ['aggregation_level', level],
    ...fields.map((f) => ['fields[]', f]),
    ['time_ranges[]', JSON.stringify({ type: 'date_range', since, until })],
    // The API refuses zero_impression_items together with segments[].
    ...(zeroRows ? [['includes[]', 'zero_impression_items']] : []),
    ...extra,
  ];
}

async function main() {
  const accounts = await listAll('/ad_accounts');
  const acct = accounts[0] || null;
  const tz = acct?.timezone || DEFAULT_TZ;
  const until = isoDateIn(tz);
  const since = shiftIso(until, -(DAYS - 1));

  const [campaignsRaw, adGroupsRaw, adsRaw] = await Promise.all([
    listAll('/campaigns'),
    listAll('/ad_groups'),
    listAll('/ads'),
  ]);

  const campaigns = campaignsRaw.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    objective: c.objective ?? null,
    biddingType: c.bidding_type ?? null,
    // Budgets are micros (25,000,000 = 25.00); insights are plain units.
    dailyBudget:
      c.budget?.daily_spend_limit_micros != null
        ? r2(c.budget.daily_spend_limit_micros / 1e6)
        : null,
    countries: (c.targeting?.locations?.include || []).map((l) => l.country_code).filter(Boolean),
    startDate: epochToIso(c.start_time, tz),
    endDate: epochToIso(c.end_time, tz),
    createdAt: epochToIso(c.created_at, tz),
  }));
  const adGroups = adGroupsRaw.map((g) => ({
    id: g.id,
    name: g.name,
    status: g.status,
    contextHints: g.context_hints || [],
    biddingStrategy: g.bidding_config?.strategy ?? null,
  }));

  // Ad-level insights over the window, daily. Required.
  const AD_FIELDS = [
    'metadata.readable_time',
    'ad.id',
    'ad.name',
    'ad.impressions',
    'ad.clicks',
    'ad.spend',
    'ad.ctr',
    'ad.cpc',
  ];
  const dailyByAdRaw = await listAll(
    '/ad_account/insights',
    insightParams('ad', since, until, AD_FIELDS, [['time_granularity', 'daily']])
  );
  const dailyByAd = dailyByAdRaw
    .map((r) => ({
      date: r.readable_time,
      adId: r.ad_id,
      adName: r.ad_name ?? null,
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      spend: r2(r.spend || 0),
      ctr: pct2(r.ctr),
      cpc: r2(r.cpc),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const CAMP_FIELDS = [
    'metadata.readable_time',
    'campaign.id',
    'campaign.name',
    'campaign.impressions',
    'campaign.clicks',
    'campaign.spend',
    'campaign.ctr',
    'campaign.cpc',
  ];
  const dailyByCampaignRaw = await listAll(
    '/ad_account/insights',
    insightParams('campaign', since, until, CAMP_FIELDS, [['time_granularity', 'daily']])
  );
  const dailyByCampaign = dailyByCampaignRaw
    .map((r) => ({
      date: r.readable_time,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name ?? null,
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      spend: r2(r.spend || 0),
      ctr: pct2(r.ctr),
      cpc: r2(r.cpc),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Lifetime: one un-granulated call from the earliest campaign start to today,
  // so credit progress is a budget figure, not a window figure. Also the only
  // call that links ad -> campaign / ad group (the /ads list carries neither).
  const earliestStart =
    campaigns
      .map((c) => c.startDate)
      .filter(Boolean)
      .sort()[0] || since;
  const lifetimeSince = earliestStart < since ? earliestStart : since;
  const lifetimeAds = await soft('openai-ads lifetime (ad)', () =>
    listAll(
      '/ad_account/insights',
      insightParams(
        'ad',
        lifetimeSince,
        until,
        ['ad.id', 'campaign.id', 'ad_group.id', 'ad.impressions', 'ad.clicks', 'ad.spend'],
        [['time_granularity', 'none']]
      )
    )
  );
  const lifetimeCampaigns = await soft('openai-ads lifetime (campaign)', () =>
    listAll(
      '/ad_account/insights',
      insightParams(
        'campaign',
        lifetimeSince,
        until,
        ['campaign.id', 'campaign.impressions', 'campaign.clicks', 'campaign.spend'],
        [['time_granularity', 'none']]
      )
    )
  );
  const linkByAd = new Map(
    (lifetimeAds || []).map((r) => [
      r.ad_id,
      { campaignId: r.campaign_id ?? null, adGroupId: r.ad_group_id ?? null },
    ])
  );
  const lifetimeByAd = new Map(
    (lifetimeAds || []).map((r) => [
      r.ad_id,
      {
        spend: r2(r.spend || 0),
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0),
      },
    ])
  );
  const sumRows = (rows) => ({
    spend: r2(rows.reduce((n, r) => n + (Number(r.spend) || 0), 0)),
    clicks: rows.reduce((n, r) => n + (Number(r.clicks) || 0), 0),
    impressions: rows.reduce((n, r) => n + (Number(r.impressions) || 0), 0),
  });
  const lifetime = lifetimeCampaigns
    ? {
        since: lifetimeSince,
        until,
        ...sumRows(lifetimeCampaigns),
        byCampaign: lifetimeCampaigns.map((r) => ({ campaignId: r.campaign_id, ...sumRows([r]) })),
        source: 'insights-lifetime',
      }
    : {
        since,
        until,
        ...sumRows(dailyByCampaign),
        byCampaign: campaigns.map((c) => ({
          campaignId: c.id,
          ...sumRows(dailyByCampaign.filter((d) => d.campaignId === c.id)),
        })),
        // Only equal to the true lifetime while the window covers the campaign.
        source: 'window-sum-fallback',
      };

  const ads = adsRaw.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    reviewStatus: a.review_status ?? a.review?.status ?? null,
    title: a.creative?.title ?? null,
    body: a.creative?.body ?? null,
    targetUrl: a.creative?.target_url ?? null,
    queryStringTemplate: a.landing_page_configuration?.query_string_template ?? null,
    ...parseUtm(a.landing_page_configuration?.query_string_template),
    campaignId: linkByAd.get(a.id)?.campaignId ?? (campaigns.length === 1 ? campaigns[0].id : null),
    adGroupId: linkByAd.get(a.id)?.adGroupId ?? null,
    lifetime: lifetimeByAd.get(a.id) ?? null,
    createdAt: epochToIso(a.created_at, tz),
  }));

  // Soft: per-ad-per-day by country. Field names change shape under a segment
  // (`ad_spend`, `country_name`), so this is normalised separately.
  const byCountryRaw = await soft('openai-ads by country', () =>
    listAll(
      '/ad_account/insights',
      insightParams(
        'ad',
        since,
        until,
        ['metadata.readable_time', 'ad.id', 'ad.impressions', 'ad.clicks', 'ad.spend'],
        [
          ['time_granularity', 'daily'],
          ['segments[]', 'country'],
        ],
        { zeroRows: false }
      )
    )
  );
  const byCountry = (byCountryRaw || [])
    .map((r) => ({
      date: r.readable_time,
      adId: r.ad_id,
      country: r.country_name ?? r.country ?? null,
      impressions: Number(r.ad_impressions ?? r.impressions ?? 0),
      clicks: Number(r.ad_clicks ?? r.clicks ?? 0),
      spend: r2(r.ad_spend ?? r.spend ?? 0),
    }))
    .filter((r) => r.impressions || r.clicks || r.spend);

  const out = {
    generatedAt: new Date().toISOString(),
    window: { since, until, days: DAYS, timezone: tz },
    account: acct
      ? {
          id: acct.id,
          name: acct.account_name || acct.name,
          status: acct.status,
          currency: acct.currency_code || null,
          timezone: tz,
          reviewStatus: acct.review?.status ?? null,
        }
      : null,
    spendUnit: {
      unit: 'currency-units',
      currency: acct?.currency_code || null,
      note: 'insights spend/cpc are whole currency units (4 clicks x cpc 3.67 = spend 14.69); budgets are micros and are divided by 1e6 here; ctr converted from fraction to percent',
    },
    campaigns,
    adGroups,
    ads,
    dailyByAd,
    dailyByCampaign,
    byCountry,
    lifetime,
    _degraded: degraded,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (degraded.length) {
    process.stderr.write(
      `[pull_openai_ads] ${degraded.length} optional quer(ies) degraded: ${degraded.map((d) => d.name).join(', ')}\n`
    );
  }
}

main().catch((err) => {
  process.stderr.write(`[pull_openai_ads] FAILED: ${err?.message || err}\n`);
  process.exit(1);
});
