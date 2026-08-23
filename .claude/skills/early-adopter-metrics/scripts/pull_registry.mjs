#!/usr/bin/env node
/**
 * early-adopter-metrics: registry pull + engagement computation.
 *
 * READ-ONLY. Scans the prod family registry (DynamoDB) and emits a single
 * JSON blob of founder metrics on stdout: family counts, growth over time,
 * engagement buckets, churn timing, most-engaged rankings, geography,
 * sync-provider adoption, newsletter opt-in, and beanpod-size distribution.
 *
 * The consuming skill turns this JSON into a terminal report + HTML dashboard.
 * This script NEVER writes to the table and NEVER publishes anything.
 *
 * Usage:
 *   node pull_registry.mjs                 # real families only (dev/test excluded), pretty JSON
 *   node pull_registry.mjs --include-dev   # keep dev/test rows in the numbers
 *   node pull_registry.mjs --raw           # also include per-family rows (with ownerEmail) in output
 *
 * Requires AWS creds resolvable by the default provider chain (this machine's
 * `default` profile authenticates as user/greg; region ap-southeast-1).
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const TABLE = 'beanies-family-registry-prod';
const REGION = 'ap-southeast-1';

const args = new Set(process.argv.slice(2));
const INCLUDE_DEV = args.has('--include-dev');
const INCLUDE_RAW = args.has('--raw');

// --- dev/test classification (mirrors scripts/migrate-registry-dev-rows.mjs) ---
function normalizeGmail(email) {
  if (!email) return '';
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf('@');
  if (at === -1) return lower;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (domain !== 'gmail.com') return lower;
  const stripped = local.split('+')[0].replace(/\./g, '');
  return `${stripped}@${domain}`;
}
const DEV_GMAIL = 'gpsp2001@gmail.com';
function isDevRow(row) {
  const email = (row.ownerEmail || '').toLowerCase().trim();
  if (!email) return false; // no-email rows are treated as real (can't prove dev)
  if (normalizeGmail(email) === DEV_GMAIL) return true;
  if (email.endsWith('@test.com')) return true;
  return false;
}

// --- date helpers (all UTC, date-only where the source is date-only) ---
const NOW = new Date();
const MS_DAY = 86_400_000;
function dateFloorUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NaN;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
/**
 * Whole-day span between two dates. Both sides are floored to UTC date first
 * because createdAt is a full ISO timestamp but lastLoginAt is date-only
 * (YYYY-MM-DD @ 00:00Z) — subtracting raw would make a same-day login look
 * negative. Clamped at 0: a family can't log in before it existed.
 */
function daysBetween(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const a = dateFloorUtc(aIso);
  const b = dateFloorUtc(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / MS_DAY));
}
function daysAgo(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((NOW.getTime() - t) / MS_DAY);
}
function isoWeek(d) {
  // ISO week key YYYY-Www
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / MS_DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function monthKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function median(nums) {
  const s = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
function tally(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it) ?? 'unknown';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

async function scanAll() {
  const client = new DynamoDBClient({ region: REGION });
  const rows = [];
  let ExclusiveStartKey;
  do {
    const out = await client.send(
      new ScanCommand({ TableName: TABLE, ExclusiveStartKey }),
    );
    for (const item of out.Items || []) rows.push(unmarshall(item));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

// Recency buckets keyed off lastLoginAt (date-only YYYY-MM-DD in the source).
// "active" = engaged; dormant/churned/never = non-engaged.
function recencyBucket(daysSinceLogin) {
  if (daysSinceLogin == null) return 'never'; // never recorded a login event
  if (daysSinceLogin <= 7) return 'active_7d';
  if (daysSinceLogin <= 30) return 'active_30d';
  if (daysSinceLogin <= 90) return 'dormant_90d';
  return 'churned_90d_plus';
}
const ENGAGED_BUCKETS = new Set(['active_7d', 'active_30d']);

function enrich(row) {
  const dLogin = daysAgo(row.lastLoginAt);
  const dCreated = daysAgo(row.createdAt);
  const lifespanDays = daysBetween(row.createdAt, row.lastLoginAt); // active window proxy
  const bucket = recencyBucket(dLogin);
  const sizeKb = typeof row.beanpodSizeKb === 'number' ? row.beanpodSizeKb : null;
  // Transparent engagement score: recency (0-60) + data volume (0-40).
  // Recency: 60 at today, linear to 0 at 90d, 0 beyond / never.
  const recencyScore = dLogin == null ? 0 : Math.max(0, 60 * (1 - Math.min(dLogin, 90) / 90));
  // Volume: log-scaled, ~40 near 2MB+, 0 at empty. Coarse but monotonic.
  const volScore = sizeKb == null ? 0 : Math.min(40, 40 * (Math.log10(1 + sizeKb) / Math.log10(1 + 2048)));
  const engagementScore = Math.round(recencyScore + volScore);
  return {
    familyId: row.familyId,
    familyName: row.familyName || null,
    ownerEmail: row.ownerEmail || null,
    country: row.country || null,
    provider: row.provider || 'local',
    subscribeNewsletter: !!row.subscribeNewsletter,
    createdAt: row.createdAt || null,
    lastLoginAt: row.lastLoginAt || null,
    beanpodSizeKb: sizeKb,
    daysSinceLogin: dLogin,
    daysSinceCreated: dCreated,
    lifespanDays,
    bucket,
    engaged: ENGAGED_BUCKETS.has(bucket),
    engagementScore,
  };
}

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

async function main() {
  const allRows = await scanAll();
  const devRows = allRows.filter(isDevRow);
  const pool = INCLUDE_DEV ? allRows : allRows.filter((r) => !isDevRow(r));
  const fam = pool.map(enrich);

  const buckets = tally(fam, (f) => f.bucket);
  const engagedCount = fam.filter((f) => f.engaged).length;

  // Growth: new families by week and month from createdAt.
  const byWeek = {};
  const byMonth = {};
  for (const f of fam) {
    if (!f.createdAt) continue;
    const d = new Date(f.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const wk = isoWeek(d);
    const mo = monthKey(f.createdAt);
    byWeek[wk] = (byWeek[wk] || 0) + 1;
    if (mo) byMonth[mo] = (byMonth[mo] || 0) + 1;
  }

  // Churn timing: for families that have gone quiet (dormant/churned), how long
  // were they active first? lifespanDays = last login - created. Coarse (date-only)
  // and a lower bound on true tenure, but a usable "time-to-quiet" proxy.
  const quiet = fam.filter((f) => f.bucket === 'dormant_90d' || f.bucket === 'churned_90d_plus');
  const lifespans = quiet.map((f) => f.lifespanDays).filter((n) => typeof n === 'number');

  // Rankings.
  const byRecency = [...fam].filter((f) => f.daysSinceLogin != null)
    .sort((a, b) => a.daysSinceLogin - b.daysSinceLogin).slice(0, 15);
  const bySize = [...fam].filter((f) => f.beanpodSizeKb != null)
    .sort((a, b) => b.beanpodSizeKb - a.beanpodSizeKb).slice(0, 15);
  const byScore = [...fam].sort((a, b) => b.engagementScore - a.engagementScore).slice(0, 15);

  const publicRow = (f) => ({
    familyName: f.familyName,
    ownerMasked: maskEmail(f.ownerEmail),
    country: f.country,
    provider: f.provider,
    beanpodSizeKb: f.beanpodSizeKb,
    lastLoginAt: f.lastLoginAt,
    daysSinceLogin: f.daysSinceLogin,
    daysSinceCreated: f.daysSinceCreated,
    lifespanDays: f.lifespanDays,
    bucket: f.bucket,
    engagementScore: f.engagementScore,
  });

  const report = {
    generatedAt: NOW.toISOString(),
    source: { table: TABLE, region: REGION },
    counts: {
      totalRows: allRows.length,
      devTestRows: devRows.length,
      realFamilies: INCLUDE_DEV ? allRows.length : pool.length,
      includeDev: INCLUDE_DEV,
    },
    engagement: {
      engagedFamilies: engagedCount,
      nonEngagedFamilies: fam.length - engagedCount,
      engagedPct: fam.length ? Math.round((engagedCount / fam.length) * 100) : 0,
      buckets, // active_7d / active_30d / dormant_90d / churned_90d_plus / never
      neverLoggedIn: buckets.never || 0,
    },
    churnTiming: {
      quietFamilies: quiet.length,
      medianDaysActiveBeforeQuiet: median(lifespans),
      note: 'lifespan = lastLoginAt - createdAt (date-only source). Lower bound on tenure; families with a single-day span logged in only around signup.',
    },
    growth: {
      byMonth: Object.fromEntries(Object.entries(byMonth).sort()),
      byWeek: Object.fromEntries(Object.entries(byWeek).sort()),
    },
    dataVolume: {
      medianBeanpodSizeKb: median(fam.map((f) => f.beanpodSizeKb)),
      familiesWithSize: fam.filter((f) => f.beanpodSizeKb != null).length,
      emptyOrTinyUnder5Kb: fam.filter((f) => f.beanpodSizeKb != null && f.beanpodSizeKb < 5).length,
    },
    geography: tally(fam, (f) => f.country),
    syncProvider: tally(fam, (f) => f.provider),
    newsletter: {
      optedIn: fam.filter((f) => f.subscribeNewsletter).length,
      optedInPct: fam.length ? Math.round((fam.filter((f) => f.subscribeNewsletter).length / fam.length) * 100) : 0,
    },
    rankings: {
      mostRecentlyActive: byRecency.map(publicRow),
      largestBeanpods: bySize.map(publicRow),
      topEngagementScore: byScore.map(publicRow),
    },
  };

  // Full per-family detail (with real emails) only when explicitly asked.
  // Kept out of the default output so the JSON is safe to hand to an artifact.
  if (INCLUDE_RAW) {
    report.familiesFull = fam.map((f) => ({
      familyId: f.familyId, // join key to CloudWatch family_id (terminal-side only)
      familyName: f.familyName,
      ownerEmail: f.ownerEmail,
      country: f.country,
      provider: f.provider,
      subscribeNewsletter: f.subscribeNewsletter,
      beanpodSizeKb: f.beanpodSizeKb,
      createdAt: f.createdAt,
      lastLoginAt: f.lastLoginAt,
      daysSinceLogin: f.daysSinceLogin,
      lifespanDays: f.lifespanDays,
      bucket: f.bucket,
      engagementScore: f.engagementScore,
    })).sort((a, b) => b.engagementScore - a.engagementScore);
  }

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`[pull_registry] FAILED: ${err?.message || err}\n`);
  process.exit(1);
});
