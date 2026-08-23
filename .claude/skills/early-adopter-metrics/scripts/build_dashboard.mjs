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

const data = {
  generatedAt: reg.generatedAt,
  dateRange,
  counts: reg.counts,
  engagement: reg.engagement,
  dau: { series: dailyActive, avg: avgDau, peak: peakDau, mau, stickiness },
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
