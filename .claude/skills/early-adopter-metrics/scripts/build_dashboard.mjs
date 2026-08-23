#!/usr/bin/env node
/**
 * early-adopter-metrics: consolidate collected JSON into the dashboard.
 *
 * Reads the raw source dumps from a directory (produced by pull_registry.mjs,
 * query_cloudwatch.sh, query_plausible.mjs), does the registry<->CloudWatch
 * reconciliation (the key insight: registry lastLoginAt is date-only/login-only
 * and undercounts, so true "active" comes from CloudWatch last-seen), then:
 *   - writes `dashboard_data.json` (the consolidated, artifact-safe figures), and
 *   - injects it into assets/dashboard-template.html -> `beanies-metrics.html`.
 *
 * The consolidated data masks owner emails already (via pull_registry's
 * ownerMasked / familyName) so the HTML is safe to publish as an artifact.
 *
 * Usage:
 *   node build_dashboard.mjs <dir>            # dir holds registry.json, cw_*.json, plausible.json
 *   node build_dashboard.mjs <dir> --data     # print consolidated JSON to stdout, skip HTML
 *
 * "Today" is taken from registry.generatedAt so the script is deterministic and
 * has no dependency on wall-clock (mirrors the no-Date policy of the pipeline).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
const DATA_ONLY = process.argv.includes('--data');
if (!dir) {
  process.stderr.write('usage: build_dashboard.mjs <dir-with-json> [--data]\n');
  process.exit(2);
}
const TEMPLATE = join(dirname(dirname(fileURLToPath(import.meta.url))), 'assets', 'dashboard-template.html');

function load(name, optional = false) {
  const p = join(dir, name);
  if (!existsSync(p)) {
    if (optional) return null;
    throw new Error(`missing ${name} in ${dir}`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}
function cwRows(doc) {
  return (doc?.results || []).map((r) => Object.fromEntries(r.map((c) => [c.field, c.value])));
}
function cwScalar(doc) {
  const o = {};
  for (const r of doc?.results || []) for (const c of r) o[c.field] = c.value;
  return o;
}
// CloudWatch latest(@timestamp) comes back as epoch seconds or millis depending
// on the field; normalize to seconds.
function normTs(ts) {
  const n = Number(ts);
  return n > 1e11 ? n / 1000 : n;
}

const reg = load('registry.json');
const lastseen = load('cw_lastseen.json', true);
const act30 = load('cw_activity.json', true);
const act7 = load('cw_activity7.json', true);
const surf = load('cw_surface.json', true);
const daily = load('cw_daily.json', true);
const pl = load('plausible.json', true);
const gsc = load('search_console.json', true);

const NOW = new Date(reg.generatedAt).getTime() / 1000;
const DAY = 86400;
const fams = reg.familiesFull || [];
if (!fams.length) throw new Error('registry.json has no familiesFull — run pull_registry.mjs with --raw');

// family_id -> {last, events} from CloudWatch
const cw = {};
for (const row of cwRows(lastseen)) {
  if (row.family_id) cw[row.family_id] = { last: normTs(row.last_seen), events: Number(row.events || 0) };
}
const hasCw = Object.keys(cw).length > 0;

function maskEmail(e) {
  if (!e) return null;
  const [l, d] = e.split('@');
  if (!d) return e;
  return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, l.length - 2))}@${d}`;
}
const daysSince = (fid) => (cw[fid] ? Math.round((NOW - cw[fid].last) / DAY) : null);

// Reconciled active counts over the real-family pool.
const activeReal30 = fams.filter((f) => cw[f.familyId] && NOW - cw[f.familyId].last <= 30 * DAY).length;
const activeReal7 = fams.filter((f) => cw[f.familyId] && NOW - cw[f.familyId].last <= 7 * DAY).length;

const joined = fams.map((f) => ({
  name: f.familyName || maskEmail(f.ownerEmail) || '—',
  country: f.country,
  pod: f.beanpodSizeKb || 0,
  cwDays: daysSince(f.familyId),
  cwEvents: cw[f.familyId]?.events || 0,
  score: f.engagementScore,
}));

const topActive = joined
  .filter((j) => j.cwDays !== null)
  .sort((a, b) => a.cwDays - b.cwDays || b.cwEvents - a.cwEvents)
  .slice(0, 12);
const lost = joined
  .filter((j) => j.cwDays !== null && j.cwDays > 30)
  .sort((a, b) => a.cwDays - b.cwDays)
  .map((j) => ({ name: j.name, days: j.cwDays, events: j.cwEvents }));
// "Never engaged" = registered but no activity signal at all: not active in the
// last 30d and not among the went-quiet set. Defined as the remainder so the
// engagement panel partitions the real families exactly (active7 + active8-30 +
// quiet + never = realFamilies) and every surface shows the same number.
const neverReallyEngaged = reg.counts.realFamilies - activeReal30 - lost.length;

const scalar30 = cwScalar(act30);
const scalar7 = cwScalar(act7);

// Daily active families (DAU, unit = pods). Series of {day, dau} over the window.
const dailyActive = cwRows(daily)
  .map((r) => ({ day: (r.day || '').slice(0, 10), dau: Number(r.dau || 0) }))
  .filter((d) => d.day);
const dauVals = dailyActive.map((d) => d.dau);
const avgDau = dauVals.length ? Math.round((dauVals.reduce((a, b) => a + b, 0) / dauVals.length) * 10) / 10 : null;
const peakDau = dauVals.length ? Math.max(...dauVals) : null;
// MAU = CloudWatch distinct active family_ids over the 30d window (raw, incl. internal pods).
const mau = hasCw ? Number(scalar30.active_families || 0) : null;
// Stickiness = avg DAU / MAU — the fraction of monthly-active families active on an average day.
const stickiness = avgDau != null && mau ? Math.round((avgDau / mau) * 100) : null;

// Window + human date range, derived from generatedAt (no wall-clock dependency).
// Nominal 30-day window (the daily series can carry 31 bins due to inclusive
// calendar-day binning; the label uses the nominal window, not the bin count).
const WINDOW_DAYS = 30;
const endD = new Date(reg.generatedAt);
const startD = new Date(endD.getTime() - WINDOW_DAYS * DAY * 1000);
const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateRange = { start: startD.toISOString().slice(0, 10), end: endD.toISOString().slice(0, 10), label: `${fmt(startD)} – ${fmt(endD)}`, days: WINDOW_DAYS };

// ── Acquisition funnel + overall conversion ─────────────────────────────────
// TWO honest rates, because there are two different questions:
//   overallPct = completed signups / MARKETING visitors — "of everyone who
//     reached the site, how many became a family?" This is the headline number,
//     but it is a CROSS-SITE AGGREGATE RATIO, not a tracked per-visitor funnel:
//     beanies.family and app.beanies.family are separate Plausible sites with no
//     shared visitor id, so no one visitor can be followed across the boundary.
//   inAppPct  = completed signups / APP arrivals — a TRUE single-site funnel
//     (shared sessions). It isolates "once someone reaches the app, does the
//     signup flow work?" and is the one to optimise against.
// They differ because app arrivals also include returning users signing in, who
// were never marketing visitors in this window.
let funnelAcq = null;
let conversion = null;
if (pl) {
  const goalV = (needle) => {
    const g = (pl.app.goals || []).find((x) => x['event:goal'].includes(needle));
    return g ? g.visitors : 0;
  };
  const pageV = (path) => {
    const p = (pl.app.topPages || []).find((x) => x['event:page'] === path);
    return p ? p.visitors : 0;
  };
  const siteVisitors = pl.marketing.overview.visitors || 0;
  const appArrivals = pl.app.overview.visitors || 0;
  const welcome = pageV('/welcome');
  const started = goalV('Button Clicked');
  const completed = goalV('Signup Completed');

  // Outbound clicks from the marketing site to the app — the only *measured*
  // hand-off between the two sites. Absent unless Plausible's outbound-link
  // extension is enabled on the marketing site.
  // Use the DEDUPLICATED single-query count; summing the per-URL rows would
  // double-count anyone who clicked both /welcome and /login.
  const outboundToApp = pl.marketing.outboundToApp?.visitors || null;

  // Step choice matters. `appArrivals` is NOT a funnel step under the marketing
  // site: it also contains returning users signing in, who were never marketing
  // visitors this window — so placing it below the hand-off makes the funnel
  // *widen*, which reads as nonsense. When we have a measured hand-off we use it
  // and keep appArrivals as context; without one, appArrivals is the best
  // available second step and the boundary is drawn there instead.
  funnelAcq = {
    steps: [
      { label: 'Reached the marketing site', value: siteVisitors, site: 'marketing' },
      ...(outboundToApp
        ? [{ label: 'Clicked through to the app', value: outboundToApp, site: 'boundary', sub: 'measured outbound clicks' }]
        : [{ label: 'Arrived at the app', value: appArrivals, site: 'app', boundary: true, sub: 'incl. returning sign-ins' }]),
      { label: 'Reached the welcome gate', value: welcome, site: 'app' },
      { label: 'Started creating a family', value: started, site: 'app' },
      { label: 'Completed signup', value: completed, site: 'app' },
    ],
    hasMeasuredHandoff: !!outboundToApp,
    appArrivals,
  };

  conversion = {
    siteVisitors,
    appArrivals,
    started,
    completed,
    overallPct: siteVisitors ? Math.round((completed / siteVisitors) * 1000) / 10 : null,
    inAppPct: appArrivals ? Math.round((completed / appArrivals) * 1000) / 10 : null,
    // Of those who *started* creating a family, how many finished? The single
    // most fixable number on the page — pure product friction, no traffic mix.
    finishPct: started ? Math.round((completed / started) * 1000) / 10 : null,
  };
}

// Registry cross-check on the funnel's bottom step. The registry is ground truth
// for "a family was actually created", so it validates (or contradicts) the
// Plausible signup goal. A large gap means the goal is mis-fired or mis-configured.
const newInWindow = fams.filter((f) => {
  if (!f.createdAt) return false;
  const t = new Date(f.createdAt).getTime() / 1000;
  return t >= NOW - WINDOW_DAYS * DAY && t <= NOW;
}).length;
if (conversion) {
  conversion.actualNewFamilies = newInWindow;
  conversion.goalVsRegistryGap = newInWindow - conversion.completed;
  // The HEADLINE is the same-source rate (Plausible signup goal / Plausible
  // marketing visitors). Both halves come from one tool with one definition, so
  // it is the defensible number even though the goal may under-fire.
  //
  // The registry rate is deliberately NOT the headline. Its numerator counts
  // every family created anywhere — direct app arrivals, invited members, native
  // app installs — while the denominator is marketing visitors only. Dividing
  // one by the other mixes populations and inflates the rate, so it is exposed
  // as a labelled upper bound, never as "the" conversion rate.
  conversion.overallPctUpperBound = conversion.siteVisitors
    ? Math.round((newInWindow / conversion.siteVisitors) * 1000) / 10
    : null;
  // A large gap means one of two things, and both are worth knowing: the signup
  // goal is mis-firing, or most families never touch the marketing site.
  conversion.gapIsMaterial = newInWindow > 0 && Math.abs(conversion.goalVsRegistryGap) >= Math.max(3, newInWindow * 0.34);
}

// ── Channel -> source drill-down ────────────────────────────────────────────
// "Organic Social" is a bucket; the actionable fact is *Reddit* or *Pinterest*.
// Nest the specific sources under each channel so one panel answers both.
let channelBreakdown = null;
if (pl?.marketing?.channelSources) {
  const byChannel = new Map();
  for (const r of pl.marketing.channelSources) {
    const ch = r['visit:channel'] || 'Unknown';
    const src = r['visit:source'] || 'Unknown';
    if (!byChannel.has(ch)) byChannel.set(ch, { channel: ch, visitors: 0, sources: [] });
    const e = byChannel.get(ch);
    e.visitors += r.visitors || 0;
    e.sources.push({ source: src, visitors: r.visitors || 0, bounce: r.bounce_rate ?? null });
  }
  channelBreakdown = [...byChannel.values()]
    .map((c) => ({ ...c, sources: c.sources.sort((a, b) => b.visitors - a.visitors).slice(0, 6) }))
    .sort((a, b) => b.visitors - a.visitors);
} else if (pl?.marketing?.channels) {
  // Degraded: channel totals only, no source detail.
  channelBreakdown = pl.marketing.channels.map((c) => ({
    channel: c['visit:channel'], visitors: c.visitors, sources: null,
  }));
}

// ── Direct-traffic deep-dive ────────────────────────────────────────────────
// "Direct" is the biggest bucket and looks like a dead end, but the ENTRY PAGE
// splits it into two very different populations:
//   - landing on "/"        -> typed the domain / bookmark / brand-aware return
//   - landing on a deep URL -> DARK SOCIAL: a link pasted into WhatsApp, Discord,
//     iMessage, Slack or an email client, all of which strip the referrer.
// That distinction is the actionable part: dark social is earned distribution
// that is invisible to every referrer report.
let direct = null;
if (pl?.marketing?.direct) {
  const d = pl.marketing.direct;
  const entries = d.entryPages || [];
  const home = entries.filter((e) => ['/', '', '/index.html'].includes(e['visit:entry_page']));
  const deep = entries.filter((e) => !['/', '', '/index.html'].includes(e['visit:entry_page']));
  const sum = (rowsArr) => rowsArr.reduce((a, r) => a + (r.visitors || 0), 0);
  const ov = d.overview;
  direct = {
    visitors: ov?.visitors ?? null,
    visits: ov?.visits ?? null,
    bounce: ov?.bounce_rate ?? null,
    duration: ov?.visit_duration ?? null,
    // sessions per visitor — our only repeat-visit proxy unless Plausible
    // exposes a true returning dimension (probed separately, often absent).
    sessionsPerVisitor: ov?.visitors ? Math.round((ov.visits / ov.visitors) * 100) / 100 : null,
    homepageVisitors: sum(home),
    deepLinkVisitors: sum(deep),
    entryPages: entries.slice(0, 8),
    countries: d.countries || null,
    devices: d.devices || null,
    // A true new-vs-returning split if the API gave us one; null otherwise.
    returning: pl.marketing.returning || null,
  };
}

// ── Google search terms (Search Console) ────────────────────────────────────
// Ranked by clicks. "Converting" terms are INFERRED via the landing page, never
// tracked — GSC has no conversion signal and shares no id with Plausible.
let searchTerms = null;
if (gsc) {
  searchTerms = {
    site: gsc.site,
    dateRange: gsc.dateRange,
    totals: gsc.totals,
    queryLevelTotals: gsc.queryLevelTotals || null,
    // Tie-break on impressions. Early on every query has 0 clicks, and sorting
    // on clicks alone then falls back to API order — which surfaces alphabetical
    // noise instead of the queries actually being shown.
    top: (gsc.queries || [])
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 15),
    // Terms with impressions but poor CTR = ranking but not winning the click.
    // The cheapest SEO win on the page: rewrite those titles/descriptions.
    opportunities: (gsc.queries || [])
      .filter((q) => q.impressions >= 20 && q.ctr < 2 && q.position <= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 8),
    topPages: (gsc.pages || []).sort((a, b) => b.clicks - a.clicks).slice(0, 8),
  };
}

// Activation & retention cohort (registry createdAt joined to CloudWatch last-seen).
// A true per-family funnel over a single denominator: families created >=28d ago
// (so every one has had the chance to hit all thresholds). "Retained at N days" =
// the family had activity at least N days after signup. Retention is a floor —
// activity older than CloudWatch's 90-day window isn't observable.
let funnelRet = null;
if (hasCw) {
  const createdDaysAgo = (f) => (f.createdAt ? (NOW - new Date(f.createdAt).getTime() / 1000) / DAY : null);
  const cohort = fams.filter((f) => { const d = createdDaysAgo(f); return d != null && d >= 28; });
  const obsDays = (f) => {
    const c = cw[f.familyId];
    if (!c) return -1;
    return (c.last - new Date(f.createdAt).getTime() / 1000) / DAY;
  };
  const N = cohort.length;
  funnelRet = {
    cohortN: N,
    cohortDef: 'families created ≥28 days ago',
    steps: [
      { label: 'Signed up', value: N },
      { label: 'Used beyond day 0', value: cohort.filter((f) => obsDays(f) >= 1).length },
      { label: 'Active after 1 week', value: cohort.filter((f) => obsDays(f) >= 7).length },
      { label: 'Active after 4 weeks', value: cohort.filter((f) => obsDays(f) >= 28).length },
    ],
  };
}

const data = {
  generatedAt: reg.generatedAt,
  dateRange,
  counts: reg.counts,
  engagement: reg.engagement,
  dau: { series: dailyActive, avg: avgDau, peak: peakDau, mau, stickiness },
  funnelAcq,
  funnelRet,
  conversion,
  channelBreakdown,
  direct,
  searchTerms,
  searchConsoleAvailable: !!gsc,
  // Which optional Plausible queries degraded this run, so the page can say so
  // rather than rendering a silently-empty panel.
  degraded: pl?._degraded || [],
  activeReal30,
  activeReal7,
  engagedPctReal: reg.counts.realFamilies ? Math.round((activeReal30 / reg.counts.realFamilies) * 100) : 0,
  neverReallyEngaged,
  cwActive30: hasCw ? Number(scalar30.active_families || 0) : null,
  cwActive7: hasCw ? Number(scalar7.active_families || 0) : null,
  cwEvents30: hasCw ? Number(scalar30.events || 0) : null,
  cwAvailable: hasCw,
  growth: reg.growth.byMonth,
  growthWeek: reg.growth.byWeek,
  geography: reg.geography,
  syncProvider: reg.syncProvider,
  newsletter: reg.newsletter,
  dataVolume: reg.dataVolume,
  churn: reg.churnTiming,
  topActive,
  lost,
  surfaces: cwRows(surf).slice(0, 10),
  plausibleAvailable: !!pl,
  mkt: pl
    ? {
        overview: pl.marketing.overview,
        sources: pl.marketing.topSources.slice(0, 8),
        channels: pl.marketing.channels.slice(0, 6),
        pages: pl.marketing.topPages.slice(0, 8),
        referrers: (pl.marketing.topReferrers || [])
          .filter((r) => r['visit:referrer'] && r['visit:referrer'] !== 'Direct / None')
          .slice(0, 8),
        utm: pl.marketing.utmCampaigns
          .filter((u) => u['visit:utm_campaign'] && u['visit:utm_campaign'] !== '(not set)')
          .slice(0, 6),
      }
    : null,
  app: pl
    ? {
        overview: pl.app.overview,
        goals: pl.app.goals.slice(0, 12),
        features: pl.app.featureUsage,
        pages: pl.app.topPages.slice(0, 8),
        login: pl.app.loginMethods,
      }
    : null,
};

if (DATA_ONLY) {
  process.stdout.write(JSON.stringify(data, null, 1) + '\n');
} else {
  writeFileSync(join(dir, 'dashboard_data.json'), JSON.stringify(data, null, 1));
  const tpl = readFileSync(TEMPLATE, 'utf8');
  if (!tpl.includes('__DATA__')) throw new Error('template is missing the __DATA__ placeholder');
  const html = tpl.replace('__DATA__', JSON.stringify(data));
  const outPath = join(dir, 'beanies-metrics.html');
  writeFileSync(outPath, html);
  process.stderr.write(`built ${outPath} (data + template), ${html.length} bytes\n`);
  process.stdout.write(outPath + '\n');
}
