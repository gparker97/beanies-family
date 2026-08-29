#!/usr/bin/env node
/**
 * beanies-metrics: incremental CloudWatch collector (READ-ONLY).
 *
 * WHY THIS EXISTS
 * ---------------
 * The six `query_cloudwatch.sh` calls each ran their own Logs Insights query
 * over their own window, so a single metrics run re-scanned the same log data
 * six times: ~764 MB (30-day queries scan ~106 MB each; the 90-day last-seen
 * scan is ~315 MB). Insights bills `DataScannedBytes` against a 5 GB/month free
 * tier, so running metrics daily would burn ~23 GB/month — four times the
 * allowance — for numbers that barely change between runs.
 *
 * The fix is not to query less often; it is to stop re-reading days we have
 * already read. Every one of those six outputs is derivable from ONE atom:
 *
 *     (day, family_id, surface) -> event count
 *
 * So we keep a local cache of that atom per COMPLETE day and, on each run,
 * query only the days we are missing (normally just today, still in progress).
 * Steady-state cost drops from ~764 MB to ~4 MB per run — roughly 200x — while
 * the report itself is unchanged, because the derived outputs are byte-for-byte
 * the same shape the pipeline already consumes.
 *
 * The cache lives OUTSIDE the repo (it is telemetry-derived data, and it holds
 * family ids): ~/.config/beanies/metrics-cache.json. Deleting it is always safe
 * — the next run simply pays the one-time backfill again.
 *
 * Usage:  node cw_cache.mjs <outDir> [--days 30] [--rebuild]
 * Writes: cw_activity.json cw_activity7.json cw_surface.json
 *         cw_lastseen.json cw_opens.json cw_daily.json
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const REGION = 'ap-southeast-1';
const LOG_GROUP = '/aws/lambda/beanies-family-telemetry-prod';
/** CloudWatch retention on the telemetry group. Nothing older is queryable. */
const RETENTION_DAYS = 90;
/**
 * Days per backfill query. Rows returned = distinct (family x surface x day)
 * combinations, and Insights caps a result set at 10,000 rows — at ~50 families
 * x ~15 surfaces that is ~750 rows/day, so 5 days keeps a wide margin even if
 * the family count triples.
 */
const BACKFILL_CHUNK_DAYS = 5;
const CACHE_PATH = join(homedir(), '.config', 'beanies', 'metrics-cache.json');
const CACHE_VERSION = 1;

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: cw_cache.mjs <outDir> [--days 30] [--rebuild]');
  process.exit(2);
}
const windowDays = Number(argValue('--days') ?? 30);
const rebuild = process.argv.includes('--rebuild');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

// ── UTC day helpers ────────────────────────────────────────────────────────
// CloudWatch `bin(1d)` buckets in UTC, so the cache keys on UTC days too.
// Mixing local days in here would double-count around midnight.
const DAY_MS = 86_400_000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayStartMs = (key) => Date.parse(`${key}T00:00:00.000Z`);
const todayKey = () => dayKey(Date.now());

// ── Cache ──────────────────────────────────────────────────────────────────

function loadCache() {
  if (rebuild || !existsSync(CACHE_PATH)) return { version: CACHE_VERSION, days: {} };
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (parsed?.version !== CACHE_VERSION) return { version: CACHE_VERSION, days: {} };
    return parsed;
  } catch (err) {
    // A corrupt cache must never take the report down — it is a cost
    // optimisation, not a source of truth. Say so and rebuild.
    console.error(`[cw_cache] cache unreadable (${err.message}) — rebuilding from CloudWatch`);
    return { version: CACHE_VERSION, days: {} };
  }
}

function saveCache(cache) {
  // Drop anything past retention; those days can never be re-queried anyway and
  // would otherwise grow the file forever.
  const floor = dayKey(Date.now() - RETENTION_DAYS * DAY_MS);
  for (const key of Object.keys(cache.days)) if (key < floor) delete cache.days[key];
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

// ── CloudWatch ─────────────────────────────────────────────────────────────

function aws(args) {
  return execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * One Insights query for the atom, over [startMs, endMs).
 * Returns rows of { day, family_id, surface, n } plus the bytes it scanned, so
 * the run can report its own cost honestly.
 */
function queryAtom(startMs, endMs) {
  const q =
    'filter t = "beanlog" and ispresent(family_id) ' +
    '| stats count() as n by family_id, surface, bin(1d) as day ' +
    '| limit 10000';
  const queryId = aws([
    'logs', 'start-query',
    '--region', REGION,
    '--log-group-name', LOG_GROUP,
    '--start-time', String(Math.floor(startMs / 1000)),
    '--end-time', String(Math.floor(endMs / 1000)),
    '--query-string', q,
    '--query', 'queryId',
    '--output', 'text',
  ]).trim();

  for (let i = 0; i < 60; i++) {
    const raw = aws([
      'logs', 'get-query-results',
      '--region', REGION,
      '--query-id', queryId,
      '--output', 'json',
    ]);
    const res = JSON.parse(raw);
    if (res.status !== 'Running' && res.status !== 'Scheduled') {
      if (res.status !== 'Complete') {
        throw new Error(`Insights query ended ${res.status} — no data merged for this range`);
      }
      const rows = (res.results || []).map((r) => Object.fromEntries(r.map((c) => [c.field, c.value])));
      if (rows.length >= 10000) {
        console.error(
          `[cw_cache] WARNING: query hit the 10,000-row cap for ${dayKey(startMs)}..${dayKey(endMs)} — ` +
            'counts for that range are INCOMPLETE. Lower BACKFILL_CHUNK_DAYS and re-run with --rebuild.'
        );
      }
      return { rows, bytes: Number(res.statistics?.bytesScanned ?? 0) };
    }
    execFileSync('sleep', ['2']);
  }
  throw new Error('Insights query did not settle within 120s');
}

/** Merge query rows into the cache, replacing each affected day wholesale. */
function mergeRows(cache, rows, touchedDays) {
  for (const key of touchedDays) cache.days[key] = [];
  for (const r of rows) {
    // `bin(1d)` returns e.g. "2026-08-29 00:00:00.000"
    const key = String(r.day || '').slice(0, 10);
    if (!key) continue;
    (cache.days[key] ||= []).push([r.family_id, r.surface || 'unknown', Number(r.n) || 0]);
  }
}

// ── Collect ────────────────────────────────────────────────────────────────

const cache = loadCache();
const today = todayKey();
const retentionFloor = dayKey(Date.now() - (RETENTION_DAYS - 1) * DAY_MS);

// Complete days already cached (today is always re-queried — it is still
// accumulating, so a cached copy of it would silently go stale mid-day).
const haveComplete = new Set(
  Object.keys(cache.days).filter((k) => k < today && k >= retentionFloor)
);

// The days we still need, oldest first.
const needed = [];
for (let ms = dayStartMs(retentionFloor); ms <= Date.now(); ms += DAY_MS) {
  const key = dayKey(ms);
  if (key === today || !haveComplete.has(key)) needed.push(key);
}

let scanned = 0;
let queries = 0;
if (needed.length) {
  // Group contiguous missing days into chunks so a cold start is a handful of
  // queries rather than ninety.
  for (let i = 0; i < needed.length; i += BACKFILL_CHUNK_DAYS) {
    const chunk = needed.slice(i, i + BACKFILL_CHUNK_DAYS);
    const startMs = dayStartMs(chunk[0]);
    const endMs = Math.min(dayStartMs(chunk[chunk.length - 1]) + DAY_MS, Date.now());
    const { rows, bytes } = queryAtom(startMs, endMs);
    mergeRows(cache, rows, chunk);
    scanned += bytes;
    queries += 1;
  }
  saveCache(cache);
}

console.error(
  `[cw_cache] ${queries} quer${queries === 1 ? 'y' : 'ies'}, ` +
    `${(scanned / 1e6).toFixed(1)} MB scanned, ` +
    `${Object.keys(cache.days).length} days cached ` +
    `(the six legacy queries scanned ~764 MB per run)`
);

// ── Derive the six outputs ─────────────────────────────────────────────────
// Emitted in the exact Logs Insights result shape the pipeline already parses
// (`{ results: [[{ field, value }]] }`), so nothing downstream changes.

const asResult = (rows) => ({
  results: rows.map((o) => Object.entries(o).map(([field, value]) => ({ field, value: String(value) }))),
});

/** Day keys inside the last `n` days, newest-inclusive. */
function windowKeys(n) {
  const floor = dayKey(Date.now() - (n - 1) * DAY_MS);
  return Object.keys(cache.days)
    .filter((k) => k >= floor)
    .sort();
}

function aggregate(keys) {
  const families = new Map(); // id -> { events, opens, lastDay }
  const surfaces = new Map(); // surface -> { events, families:Set }
  let events = 0;
  for (const key of keys) {
    for (const [famId, surface, n] of cache.days[key] || []) {
      events += n;
      const fam = families.get(famId) || { events: 0, opens: 0, lastDay: key };
      fam.events += n;
      if (surface === 'open-cycle') fam.opens += n;
      if (key > fam.lastDay) fam.lastDay = key;
      families.set(famId, fam);
      const s = surfaces.get(surface) || { events: 0, families: new Set() };
      s.events += n;
      s.families.add(famId);
      surfaces.set(surface, s);
    }
  }
  return { families, surfaces, events };
}

const w30 = windowKeys(windowDays);
const w7 = windowKeys(7);
const wAll = windowKeys(RETENTION_DAYS);
const agg30 = aggregate(w30);
const agg7 = aggregate(w7);
const aggAll = aggregate(wAll);

const write = (name, doc) => writeFileSync(join(outDir, name), JSON.stringify(doc, null, 1));

write('cw_activity.json', asResult([{ events: agg30.events, active_families: agg30.families.size }]));
write('cw_activity7.json', asResult([{ events: agg7.events, active_families: agg7.families.size }]));

write(
  'cw_surface.json',
  asResult(
    [...agg30.surfaces.entries()]
      .map(([surface, s]) => ({ surface, events: s.events, families: s.families.size }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 40)
  )
);

// Day-granular last-seen. The report only ever renders "N days ago", so the end
// of the last active day is exactly as precise as the output needs.
write(
  'cw_lastseen.json',
  asResult(
    [...aggAll.families.entries()]
      .map(([family_id, f]) => ({
        family_id,
        last_seen: dayStartMs(f.lastDay) + DAY_MS - 1,
        events: f.events,
      }))
      .sort((a, b) => b.last_seen - a.last_seen)
      .slice(0, 200)
  )
);

write(
  'cw_opens.json',
  asResult(
    [...agg30.families.entries()]
      .filter(([, f]) => f.opens > 0)
      .map(([family_id, f]) => ({
        family_id,
        opens: f.opens,
        last_open: dayStartMs(f.lastDay) + DAY_MS - 1,
      }))
      .sort((a, b) => b.opens - a.opens)
      .slice(0, 200)
  )
);

write(
  'cw_daily.json',
  asResult(
    w30.map((key) => ({
      day: `${key} 00:00:00.000`,
      dau: new Set((cache.days[key] || []).map(([famId]) => famId)).size,
    }))
  )
);

console.error(`[cw_cache] wrote 6 derived files to ${outDir}`);
