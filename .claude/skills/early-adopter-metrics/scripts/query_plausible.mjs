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
 *
 * ── Query tolerance ──────────────────────────────────────────────────────────
 * The core queries (overview, sources, channels, pages, goals) are REQUIRED — if
 * one fails the run fails loudly, because a silently-empty dashboard is worse
 * than no dashboard. The enrichment queries (channel x source drill-down, the
 * Direct deep-dive, outbound links, new-vs-returning) go through `soft()`, which
 * returns null on any API error. That is deliberate: Plausible's available
 * dimensions vary by plan and version, and an unsupported dimension must degrade
 * one panel, never the whole report. Every soft failure is recorded in
 * `_degraded` so the dashboard and the operator can see exactly what was lost.
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

/** Every soft-query that failed, so the caller can state the gap honestly. */
const degraded = [];

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

/**
 * Optional query: resolve to null instead of throwing, and record why.
 * `name` is what the dashboard shows when the panel is missing.
 */
async function soft(name, siteId, body) {
  try {
    return await q(siteId, body);
  } catch (err) {
    degraded.push({ name, reason: String(err?.message || err).slice(0, 220) });
    return null;
  }
}

/** Flatten a v2 response into [{...dims, ...metrics}] rows for easy reading. */
function rows(resp) {
  if (!resp) return null;
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

// Plausible labels the no-referrer bucket "Direct" as a channel and
// "Direct / None" as a source. We filter on the channel.
const DIRECT_FILTER = [['is', 'visit:channel', ['Direct']]];

async function marketingBundle() {
  const site = SITES.marketing;
  const [
    overview, sources, channels, referrers, utmSources, utmCampaigns,
    topPages, entryPages, exitPages, countries,
  ] = await Promise.all([
    q(site, { metrics: TRAFFIC_METRICS }),
    // bounce_rate + visit_duration per source = acquisition QUALITY, not just volume.
    q(site, { metrics: ['visitors', 'visits', 'bounce_rate', 'visit_duration'], dimensions: ['visit:source'], pagination: { limit: 20 } }),
    q(site, { metrics: ['visitors', 'visits', 'bounce_rate', 'visit_duration'], dimensions: ['visit:channel'], pagination: { limit: 15 } }),
    q(site, { metrics: ['visitors', 'visits'], dimensions: ['visit:referrer'], pagination: { limit: 20 } }),
    q(site, { metrics: ['visitors'], dimensions: ['visit:utm_source'], pagination: { limit: 15 } }),
    q(site, { metrics: ['visitors'], dimensions: ['visit:utm_campaign'], pagination: { limit: 15 } }),
    q(site, { metrics: ['visitors', 'pageviews'], dimensions: ['event:page'], pagination: { limit: 25 } }),
    q(site, { metrics: ['visitors'], dimensions: ['visit:entry_page'], pagination: { limit: 20 } }),
    q(site, { metrics: ['visitors'], dimensions: ['visit:exit_page'], pagination: { limit: 20 } }),
    q(site, { metrics: ['visitors'], dimensions: ['visit:country'], pagination: { limit: 20 } }),
  ]);

  // ── Enrichment (all soft) ──────────────────────────────────────────────────
  const [
    channelSources, directEntry, directCountries, directDevices,
    directOverview, goals, outbound, outboundToApp, returning,
  ] = await Promise.all([
    // THE channel->source drill-down: turns "Organic Social 120" into
    // "Organic Social: Reddit 90, Pinterest 30". Two dimensions in one query.
    soft('channel breakdown by source', site, {
      metrics: ['visitors', 'visits', 'bounce_rate'],
      dimensions: ['visit:channel', 'visit:source'],
      pagination: { limit: 100 },
    }),
    // Direct deep-dive. Entry page is the most diagnostic thing about Direct:
    // landing on "/" reads as typed/bookmarked/brand-aware; landing on a deep
    // URL (a blog post) is almost always DARK SOCIAL — a link pasted into
    // WhatsApp/Discord/iMessage/email, which strips the referrer.
    soft('direct traffic by entry page', site, {
      metrics: ['visitors', 'visits', 'bounce_rate'],
      dimensions: ['visit:entry_page'],
      filters: DIRECT_FILTER,
      pagination: { limit: 15 },
    }),
    soft('direct traffic by country', site, {
      metrics: ['visitors'], dimensions: ['visit:country'], filters: DIRECT_FILTER, pagination: { limit: 10 },
    }),
    soft('direct traffic by device', site, {
      metrics: ['visitors'], dimensions: ['visit:device'], filters: DIRECT_FILTER, pagination: { limit: 6 },
    }),
    // visits/visitors for Direct = sessions per visitor, our repeat-visit proxy.
    soft('direct traffic overview', site, {
      metrics: ['visitors', 'visits', 'pageviews', 'bounce_rate', 'visit_duration'], filters: DIRECT_FILTER,
    }),
    soft('marketing goals', site, { metrics: ['visitors', 'events'], dimensions: ['event:goal'], pagination: { limit: 30 } }),
    // Outbound link clicks are the ONLY real marketing->app handoff signal we
    // have (the two sites share no visitor id). Requires Plausible's outbound
    // -links script extension on the marketing site; degrades if absent.
    soft('outbound link clicks', site, {
      metrics: ['visitors', 'events'],
      dimensions: ['event:props:url'],
      filters: [['is', 'event:name', ['Outbound Link: Click']]],
      pagination: { limit: 20 },
    }),
    // Deduplicated count of people who clicked ANY link to the app. Summing the
    // per-URL rows above would double-count someone who clicked both /welcome
    // and /login, so the hand-off number must come from a single filtered query.
    soft('outbound clicks to app (deduped)', site, {
      metrics: ['visitors', 'events'],
      filters: [
        ['is', 'event:name', ['Outbound Link: Click']],
        ['contains', 'event:props:url', ['app.beanies.family']],
      ],
    }),
    // Not documented as universally available; probed tolerantly. If Plausible
    // supports it we get a true new-vs-returning split, otherwise the dashboard
    // falls back to the sessions-per-visitor proxy.
    soft('new vs returning', site, {
      metrics: ['visitors', 'visits'], dimensions: ['visit:is_returning'], pagination: { limit: 4 },
    }),
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
    // enrichment (any may be null)
    channelSources: rows(channelSources),
    goals: rows(goals),
    outbound: rows(outbound),
    outboundToApp: rows(outboundToApp)?.[0] || null,
    returning: rows(returning),
    direct: {
      overview: rows(directOverview)?.[0] || null,
      entryPages: rows(directEntry),
      countries: rows(directCountries),
      devices: rows(directDevices),
    },
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
  // Which channel do APP arrivals come from — lets us say how many app visitors
  // arrived from the marketing site vs direct (returning users signing in).
  const appChannels = await soft('app arrivals by channel', site, {
    metrics: ['visitors', 'visits'], dimensions: ['visit:channel'], pagination: { limit: 10 },
  });
  return {
    site,
    overview: rows(overview)[0] || {},
    goals: rows(goals),
    topPages: rows(topPages),
    topSources: rows(sources),
    featureUsage: rows(features),
    loginMethods: rows(loginMethods),
    channels: rows(appChannels),
  };
}

async function main() {
  const out = { generatedAt: new Date().toISOString(), dateRange: range };
  if (mode === 'marketing' || mode === 'both') out.marketing = await marketingBundle();
  if (mode === 'app' || mode === 'both') out.app = await appBundle();
  out._degraded = degraded;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (degraded.length) {
    process.stderr.write(`[query_plausible] ${degraded.length} optional quer(ies) degraded: ${degraded.map((d) => d.name).join(', ')}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[query_plausible] FAILED: ${err?.message || err}\n`);
  process.exit(1);
});
