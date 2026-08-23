#!/usr/bin/env node
/**
 * early-adopter-metrics: Plausible Stats API v2 helper (READ-ONLY).
 *
 * Plausible is the product-analytics source of truth for traffic, referral
 * sources/channels, top pages, funnels, and clean feature/goal usage — the
 * things CloudWatch's diagnostic firehose can't give us.
 *
 * Two sites (see research): marketing = "beanies.family", app = "app.beanies.family".
 *
 * Auth: a Stats API token, read from (in order) env PLAUSIBLE_API_KEY, then
 * ~/.config/beanies/plausible-token. The token is a read-only key created in
 * the Plausible dashboard; it is NEVER committed and NEVER printed.
 *
 * Usage:
 *   node query_plausible.mjs marketing [DATE_RANGE]   # traffic sources, channels, top pages, funnel
 *   node query_plausible.mjs app [DATE_RANGE]         # app usage, custom goals, feature breakdown
 *   node query_plausible.mjs both [DATE_RANGE]        # both bundles in one JSON
 * DATE_RANGE is a Plausible period: 7d | 30d (default) | month | 6mo | 12mo | all.
 *
 * Emits one JSON object on stdout. If the token is missing it exits 3 with a
 * clear message so the caller can degrade gracefully (skip the traffic section).
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API = 'https://plausible.io/api/v2/query';
const SITES = { marketing: 'beanies.family', app: 'app.beanies.family' };

function loadToken() {
  if (process.env.PLAUSIBLE_API_KEY) return process.env.PLAUSIBLE_API_KEY.trim();
  try {
    return readFileSync(join(homedir(), '.config', 'beanies', 'plausible-token'), 'utf8').trim();
  } catch {
    return null;
  }
}

const TOKEN = loadToken();
if (!TOKEN) {
  process.stderr.write(
    'PLAUSIBLE_TOKEN_MISSING: set env PLAUSIBLE_API_KEY or write ~/.config/beanies/plausible-token ' +
      '(Plausible dashboard -> Settings -> API Keys, read-only Stats key).\n',
  );
  process.exit(3);
}

const mode = process.argv[2] || 'both';
const range = process.argv[3] || '30d';

async function q(siteId, body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site_id: siteId, date_range: range, ...body }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch { /* keep raw */ }
    throw new Error(`Plausible ${res.status} for ${siteId} (${JSON.stringify(body.dimensions || body.metrics)}): ${msg}`);
  }
  return JSON.parse(text);
}

/** Flatten a v2 response into [{...dims, ...metrics}] rows for easy reading. */
function rows(resp) {
  const dims = resp.query?.dimensions || [];
  const mets = resp.query?.metrics || [];
  return (resp.results || []).map((r) => {
    const o = {};
    dims.forEach((d, i) => (o[d] = r.dimensions[i]));
    mets.forEach((m, i) => (o[m] = r.metrics[i]));
    return o;
  });
}

const TRAFFIC_METRICS = ['visitors', 'visits', 'pageviews', 'bounce_rate', 'visit_duration'];

async function marketingBundle() {
  const site = SITES.marketing;
  const [overview, sources, channels, referrers, utmSources, utmCampaigns, topPages, entryPages, exitPages, countries] =
    await Promise.all([
      q(site, { metrics: TRAFFIC_METRICS }),
      q(site, { metrics: ['visitors', 'visits', 'bounce_rate'], dimensions: ['visit:source'], pagination: { limit: 20 } }),
      q(site, { metrics: ['visitors', 'visits'], dimensions: ['visit:channel'], pagination: { limit: 15 } }),
      q(site, { metrics: ['visitors', 'visits'], dimensions: ['visit:referrer'], pagination: { limit: 20 } }),
      q(site, { metrics: ['visitors'], dimensions: ['visit:utm_source'], pagination: { limit: 15 } }),
      q(site, { metrics: ['visitors'], dimensions: ['visit:utm_campaign'], pagination: { limit: 15 } }),
      q(site, { metrics: ['visitors', 'pageviews'], dimensions: ['event:page'], pagination: { limit: 25 } }),
      q(site, { metrics: ['visitors'], dimensions: ['visit:entry_page'], pagination: { limit: 20 } }),
      q(site, { metrics: ['visitors'], dimensions: ['visit:exit_page'], pagination: { limit: 20 } }),
      q(site, { metrics: ['visitors'], dimensions: ['visit:country'], pagination: { limit: 20 } }),
    ]);
  return {
    site,
    overview: rows(overview)[0] || {},
    topSources: rows(sources),
    channels: rows(channels),
    topReferrers: rows(referrers),
    utmSources: rows(utmSources),
    utmCampaigns: rows(utmCampaigns),
    topPages: rows(topPages),
    entryPages: rows(entryPages),
    exitPages: rows(exitPages),
    countries: rows(countries),
  };
}

async function appBundle() {
  const site = SITES.app;
  const [overview, goals, topPages, sources, features, loginMethods] = await Promise.all([
    q(site, { metrics: TRAFFIC_METRICS }),
    q(site, { metrics: ['visitors', 'events'], dimensions: ['event:goal'], pagination: { limit: 40 } }),
    q(site, { metrics: ['visitors', 'pageviews'], dimensions: ['event:page'], pagination: { limit: 25 } }),
    q(site, { metrics: ['visitors', 'visits'], dimensions: ['visit:source'], pagination: { limit: 15 } }),
    // feature_used breakdown by the `feature` prop = the "most used features" answer.
    q(site, {
      metrics: ['visitors', 'events'],
      dimensions: ['event:props:feature'],
      filters: [['is', 'event:name', ['feature_used']]],
      pagination: { limit: 20 },
    }),
    // login method mix (password / passkey / cross_device).
    q(site, {
      metrics: ['visitors', 'events'],
      dimensions: ['event:props:method'],
      filters: [['is', 'event:name', ['login']]],
      pagination: { limit: 10 },
    }),
  ]);
  return {
    site,
    overview: rows(overview)[0] || {},
    goals: rows(goals),
    topPages: rows(topPages),
    topSources: rows(sources),
    featureUsage: rows(features),
    loginMethods: rows(loginMethods),
  };
}

async function main() {
  const out = { generatedAt: new Date().toISOString(), dateRange: range };
  if (mode === 'marketing' || mode === 'both') out.marketing = await marketingBundle();
  if (mode === 'app' || mode === 'both') out.app = await appBundle();
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`[query_plausible] FAILED: ${err?.message || err}\n`);
  process.exit(1);
});
