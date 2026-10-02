#!/usr/bin/env node
/**
 * beanies-metrics: consolidate collected JSON into the dashboard.
 *
 * Reads the raw source dumps from a directory (produced by pull_registry.mjs,
 * cw_cache.mjs, query_plausible.mjs, pull_openai_ads.mjs) plus the optional
 * manual ad-spend ledger at ~/.config/beanies/ad-spend.json, does the registry<->CloudWatch
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
import { homedir } from 'node:os';
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
  // A collector that exits non-zero (e.g. query_search_console.mjs exiting 3
  // with no credentials) still leaves a zero-byte file behind when it was
  // invoked as `node ... > file`. Treat empty as absent, or the optional
  // source crashes the whole build on JSON.parse instead of degrading.
  const raw = existsSync(p) ? readFileSync(p, 'utf8').trim() : null;
  if (!raw) {
    if (optional) return null;
    throw new Error(`missing or empty ${name} in ${dir}`);
  }
  return JSON.parse(raw);
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
const ads_api = load('openai_ads.json', true); // pull_openai_ads.mjs; optional, see the paid block

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
// Whole UTC calendar days, not rounded elapsed time: cw_cache.mjs reports
// last_seen as the END of the last active day (23:59:59.999Z), which is later
// than NOW for anyone active today, and Math.round of that gap gave "-1d ago".
const daysSince = (fid) => (cw[fid] ? Math.floor(NOW / DAY) - Math.floor(cw[fid].last / DAY) : null);

// Reconciled active counts over the real-family pool. Same day measure as
// `lost` below, so active30 + lost + never partitions the families exactly.
const activeReal30 = fams.filter((f) => daysSince(f.familyId) !== null && daysSince(f.familyId) <= 30).length;
const activeReal7 = fams.filter((f) => daysSince(f.familyId) !== null && daysSince(f.familyId) <= 7).length;

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
// A "deep user" is in the top 10% of real families by lifetime events. The
// went-quiet callout names any of them instead of asserting nobody deep left.
const lifetimeEvents = joined.filter((j) => j.cwDays !== null).map((j) => j.cwEvents).sort((a, b) => a - b);
const deepUserEvents = lifetimeEvents.length ? lifetimeEvents[Math.floor(lifetimeEvents.length * 0.9)] : null;
const lostDeep = deepUserEvents === null ? [] : lost.filter((l) => l.events >= deepUserEvents);
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

  // ── CTA clicks: the step BETWEEN landing and handing off ──────────────────
  //
  // Until these events existed the store-badge path was completely dark: /ios,
  // /android and /download are standalone pages carrying no Plausible at all, so
  // there was not even a pageview between the homepage and the App Store. A
  // visitor who came to install the app was indistinguishable from one who
  // bounced.
  //
  // Kept as its own panel rather than forced into the acquisition funnel: the
  // three CTAs lead to THREE different destinations (the web app, the App Store,
  // Google Play), and only the first continues into the app funnel below. Stacking
  // them as one step would imply a single path that does not exist.
  const ctaRows = pl.marketing.ctaClicks || [];
  const ctaTotal = ctaRows.reduce((n, r) => n + (r.visitors || 0), 0);
  const ctaByName = (needle) => {
    const r = ctaRows.find((x) => (x['event:name'] || '').includes(needle));
    return r ? r.visitors : 0;
  };
  const cta = ctaRows.length
    ? {
        total: ctaTotal,
        createPod: ctaByName('Create Pod'),
        ios: ctaByName('iOS'),
        android: ctaByName('Android'),
        // Of everyone who reached the site, how many asked to start? The honest
        // top-of-funnel intent signal, and the one to move.
        pctOfVisitors: siteVisitors ? Math.round((ctaTotal / siteVisitors) * 1000) / 10 : null,
        byPlacement: pl.marketing.ctaByPlacement || [],
      }
    : null;

  // Step choice matters. `appArrivals` is NOT a funnel step under the marketing
  // site: it also contains returning users signing in, who were never marketing
  // visitors this window — so placing it below the hand-off makes the funnel
  // *widen*, which reads as nonsense. When we have a measured hand-off we use it
  // and keep appArrivals as context; without one, appArrivals is the best
  // available second step and the boundary is drawn there instead.
  // ── Signups by platform (#71) ─────────────────────────────────────────────
  //
  // Two sources, and they are NOT known to be the same population: `completed`
  // is a Plausible dashboard-configured GOAL matched by substring, while this
  // breakdown queries the raw EVENT `signup`. The goal→event mapping is
  // Plausible-side config this repo cannot see, and the sibling goal
  // `Family Create - Button Clicked` has no matching event name at all — so
  // assuming 1:1 and dividing one by the other would put a percentage next to a
  // count computed off a different N.
  //
  // Reconciled instead of assumed: take the web SHARE from the breakdown and
  // apply it to the goal count. When the two totals agree this is exactly the
  // web row; when they disagree the headline stays consistent with the count
  // displayed beside it. `platformTotalsAgree` records which case shipped.
  //
  // ABSENT ⇒ WEB, for PLAUSIBLE only. Every signup recorded before native
  // analytics shipped is provably web, because native builds never loaded
  // Plausible at all. Plausible returns those under the literal string
  // `(none)`, folded into `web` here so it can never reach the template. (The
  // registry's rule is the opposite — see `newWebInWindow` below.)
  const platformRows = pl.app.signupPlatforms || [];
  const byPlatform = new Map();
  for (const r of platformRows) {
    const raw = r['event:props:platform'];
    const platform = !raw || raw === '(none)' ? 'web' : raw;
    byPlatform.set(platform, (byPlatform.get(platform) || 0) + (r.visitors || 0));
  }
  const eventTotal = [...byPlatform.values()].reduce((a, b) => a + b, 0);
  const webShare = eventTotal ? (byPlatform.get('web') || 0) / eventTotal : null;
  // NO all-platform fallback. `webShare === null` means the breakdown returned
  // nothing — a goal wired to a differently-named event, a stale plausible.json,
  // or the `platform` custom property not enabled in Plausible site settings.
  // Falling back to `completed` there would print the retired, inflated
  // all-platform rate under the new "web signups" label, with nothing flagging
  // it (`platformTotalsAgree` would be null, not false, and the split clause
  // that would expose the contradiction is suppressed when the array is empty).
  // A missing number the reader can see beats a wrong one they cannot.
  const completedWeb = webShare === null ? null : Math.round(completed * webShare);

  // Set to true ONLY once a TestFlight build has been confirmed to produce iOS
  // pageviews in the app property. See `inAppPct` below for why it matters.
  const IOS_PAGEVIEW_AUTOCAPTURE = false;
  const iosSignups = byPlatform.get('ios') || 0;
  const countedInAppSignups =
    IOS_PAGEVIEW_AUTOCAPTURE || !eventTotal
      ? completed
      : Math.max(0, completed - Math.round(completed * (iosSignups / eventTotal)));
  // `funnelAcq`'s bottom step must match the funnel it sits in — same
  // numerator/denominator platform coverage as `inAppPct` above it.
  const funnelCompleted = countedInAppSignups;

  funnelAcq = {
    steps: [
      { label: 'Reached the marketing site', value: siteVisitors, site: 'marketing' },
      ...(outboundToApp
        ? [{ label: 'Clicked through to the app', value: outboundToApp, site: 'boundary', sub: 'measured outbound clicks' }]
        : [{ label: 'Arrived at the app', value: appArrivals, site: 'app', boundary: true, sub: 'incl. returning sign-ins' }]),
      { label: 'Reached the welcome gate', value: welcome, site: 'app' },
      { label: 'Started creating a family', value: started, site: 'app' },
      {
        label: 'Completed signup',
        value: funnelCompleted,
        site: 'app',
        // Matches `inAppPct` above: while iOS pageview autocapture is
        // unconfirmed, iOS signups are excluded here too, or this step would
        // count arrivals the steps above it never saw.
        ...(funnelCompleted !== completed ? { sub: 'excl. iOS' } : {}),
      },
    ],
    hasMeasuredHandoff: !!outboundToApp,
    appArrivals,
  };


  conversion = {
    siteVisitors,
    appArrivals,
    started,
    completed,
    completedWeb,
    // null when no CTA events have landed yet (e.g. before the marketing deploy
    // that added them) — the template hides the panel rather than showing zeros
    // that would read as "nobody clicked".
    cta,
    // Volume, not a second rate — looped in the template so a new platform (or a
    // `(none)` bucket) is never an HTML edit.
    //
    // Rescaled to the GOAL total by the same share the headline uses, for the
    // same reason: Plausible counts `visitors` per prop-value row, and those
    // rows do not sum to unique visitors. Reporting them verbatim beside a goal
    // total printed one clause earlier gives the reader two different web
    // figures in a single sentence and a split that does not sum to the stated
    // total. Both numbers now come off one denominator.
    signupsByPlatform:
      eventTotal === 0
        ? []
        : [...byPlatform.entries()]
            .map(([platform, visitors]) => ({
              platform,
              visitors: Math.round(completed * (visitors / eventTotal)),
            }))
            .sort((a, b) => b.visitors - a.visitors),
    // Whether the goal and the event agree on the total. Surfaced so the
    // reconciliation above is verifiable from a dashboard run rather than taken
    // on trust; null when the event query returned nothing at all.
    //
    // Expect `false` routinely on multi-platform windows — per-prop `visitors`
    // rows double-count anyone who appears under two values, so `eventTotal`
    // exceeding `completed` is normal, not a fault. It is a "do not quote the
    // split as exact" marker, not an alarm; a LOWER eventTotal is the one worth
    // investigating, since it means signup events the goal never saw.
    platformTotalsAgree: eventTotal ? eventTotal === completed : null,
    signupEventTotal: eventTotal || null,
    // THE headline, and the only like-for-like pairing on the page: web-only
    // signups over marketing visitors, both of which exclude native entirely.
    // Deliberately ONE percentage — a web-only/all-platform axis stacked on the
    // existing cross-site/single-site axis is a 2x2 the reader must hold, and
    // two rates invite "which one is real?".
    overallPct:
      siteVisitors && completedWeb !== null
        ? Math.round((completedWeb / siteVisitors) * 1000) / 10
        : null,
    // Numerator/denominator must cover the same platforms. `completed` is a
    // CUSTOM EVENT (fires everywhere Plausible is loaded); `appArrivals` is a
    // PAGEVIEW count (needs autocapture). On iOS the WebView origin is
    // `capacitor://app.beanies.family` — `iosScheme: 'https'` is silently
    // ignored by WKWebView (capacitor.config.ts) — so iOS pageviews are not
    // confirmed to land. Until a TestFlight build proves they do, iOS signups
    // are excluded from this numerator rather than inflating the one metric
    // data-sources.md calls the one to optimise against. Flip the constant when
    // verified; that is the whole change.
    inAppPct: appArrivals
      ? Math.round((countedInAppSignups / appArrivals) * 1000) / 10
      : null,
    inAppPctExcludesIos: !IOS_PAGEVIEW_AUTOCAPTURE && (byPlatform.get('ios') || 0) > 0,
    // Of those who *started* creating a family, how many finished? The single
    // most fixable number on the page — pure product friction, no traffic mix.
    finishPct: started ? Math.round((completed / started) * 1000) / 10 : null,
  };
}

// Registry cross-check on the funnel's bottom step. The registry is ground truth
// for "a family was actually created", so it validates (or contradicts) the
// Plausible signup goal. A large gap means the goal is mis-fired or mis-configured.
// Share of in-window registry rows that must carry a platform before any
// web-only registry comparison is meaningful. Below this, the comparison is
// suppressed rather than shown wrong.
const PLATFORM_COVERAGE_MIN = 0.8;
// The date native builds began loading Plausible AND the registry began stamping
// `signupPlatform`. Before it, neither source can attribute a platform.
const PLATFORM_DATA_FROM = '2026-08-24';
const inWindow = fams.filter((f) => {
  if (!f.createdAt) return false;
  const t = new Date(f.createdAt).getTime() / 1000;
  return t >= NOW - WINDOW_DAYS * DAY && t <= NOW;
});
const newInWindow = inWindow.length;
if (conversion) {
  // Stays ALL-PLATFORM: this renders as "families actually created (registry)",
  // a volume fact. Making it web-only would show 0 on every run before platform
  // coverage builds up.
  conversion.actualNewFamilies = newInWindow;
  // The HEADLINE is the same-source rate (Plausible signup goal / Plausible
  // marketing visitors). Both halves come from one tool with one definition, so
  // it is the defensible number even though the goal may under-fire.
  //
  // The registry rate is deliberately NOT the headline. Its numerator counts
  // every family created anywhere — direct app arrivals, invited members, native
  // app installs — while the denominator is marketing visitors only. Dividing
  // one by the other mixes populations and inflates the rate, so it is exposed
  // as a labelled upper bound, never as "the" conversion rate.
  // A large gap means one of two things, and both are worth knowing: the signup
  // goal is mis-firing, or most families never touch the marketing site.
  //
  // Gated on platform COVERAGE (#71). REGISTRY absent ⇒ UNKNOWN, the opposite of
  // the Plausible rule above: `signupPlatform` is stamped only on rows created
  // after it shipped, and those older rows genuinely cannot be attributed —
  // assuming web would re-introduce the very inflation this change removes. On
  // the first post-deploy runs correctly NO in-window row carries a platform, so
  // a web-only gap would be computed against ~0 and fire spuriously. Below the
  // threshold the flag is null and the template renders nothing.
  //
  // The threshold is also raised. Restricting both sides to web-only roughly
  // halves n, which would make the constant floor the binding term at realistic
  // monthly volumes — i.e. it would fire on ordinary ad-blocker noise and become
  // something to ignore, which is how a flag dies. See references/data-sources.md
  // for the expected trigger rate.
  const webInWindow = inWindow.filter((f) => f.signupPlatform === 'web');
  const attributed = inWindow.filter((f) => f.signupPlatform).length;
  const coverage = inWindow.length ? attributed / inWindow.length : 0;
  conversion.platformCoverage = Math.round(coverage * 100);

  // The two sides use OPPOSITE absent-platform rules (Plausible folds `(none)`
  // into web; the registry excludes absent), which is correct per-source but
  // makes them incomparable across any window that straddles the deploy. Every
  // pre-deploy signup would land in `completedWeb` with no matching row in
  // `newWebInWindow`, biasing the gap negative with no compensating term — at
  // ~15-25 families/month a 4-6 day tail alone clears the floor, which is
  // exactly the spurious fire the gate exists to prevent. So the comparison is
  // suppressed until the whole window sits after the deploy. Self-resolving:
  // WINDOW_DAYS after that date it opens on its own.
  const windowStartsAfterDeploy =
    new Date((NOW - WINDOW_DAYS * DAY) * 1000).toISOString().slice(0, 10) >= PLATFORM_DATA_FROM;

  conversion.gapCheckBlockedBy = !windowStartsAfterDeploy
    ? 'window-straddles-deploy'
    : coverage < PLATFORM_COVERAGE_MIN
      ? 'low-coverage'
      : null;

  if (conversion.gapCheckBlockedBy === null && conversion.completedWeb !== null) {
    // NOT gated on `webInWindow.length > 0`. That short-circuit suppressed the
    // flag precisely when disagreement was TOTAL — full coverage, every family
    // native, Plausible still attributing signups to web — which is the loudest
    // signal available, not a reason to stay quiet.
    conversion.newWebInWindow = webInWindow.length;
    const webGap = webInWindow.length - conversion.completedWeb;
    conversion.goalVsRegistryGap = webGap;
    conversion.gapIsMaterial = Math.abs(webGap) >= Math.max(5, webInWindow.length * 0.34);
  } else {
    conversion.newWebInWindow = null;
    // Explicit null, not left undefined — JSON.stringify drops undefined, so the
    // key would vanish from the payload rather than read as "not computed".
    conversion.goalVsRegistryGap = null;
    conversion.gapIsMaterial = null;
  }
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
    // sessions per visitor — the ONLY repeat-visit proxy available. Plausible
    // is cookieless and its visitor hash is stable only within a single day, so
    // the Stats API exposes no new-vs-returning dimension at all (verified
    // against the live API and the v2 docs, 2026-08-24). For a real returning
    // signal use the registry+CloudWatch cohort funnel, which has stable ids.
    sessionsPerVisitor: ov?.visitors ? Math.round((ov.visits / ov.visitors) * 100) / 100 : null,
    homepageVisitors: sum(home),
    deepLinkVisitors: sum(deep),
    entryPages: entries.slice(0, 8),
    countries: d.countries || null,
    devices: d.devices || null,
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

// ── Paid campaigns (OpenAI Ads API ⊕ manual ledger ⊕ Plausible UTM) ─────────
// Spend / impressions / clicks per ad per day come from the ads platform when
// `openai_ads.json` is present (pull_openai_ads.mjs), and from the hand-typed
// ledger at ~/.config/beanies/ad-spend.json otherwise. Precedence is per ad
// slug (`utm_content`): a slug the API knows is API-only — its ledger `daily`
// rows are ignored, never summed on top — while a ledger-only slug keeps its
// ledger rows as a fallback. With no API file the ledger behaves exactly as it
// always did. `pods_manual` is ledger-only in every case: the platform cannot
// know which Slack create-pod message was an ad. Every figure says which source
// it came from (`spendSource`, `podsSource`).
//
// Plausible contributes visitors + CTA clicks per `utm_content` on the
// marketing site, and — once UTMs carry through to the app — signups per ad.
//
// CPA here = spend ÷ new families (pods). It is NOT a revenue ROI — no paid
// plan exists yet, so there is no revenue to divide by.
const LEDGER_PATH = join(homedir(), '.config', 'beanies', 'ad-spend.json');
let paid = null;
let paidLedgerError = null;
{
  let ledger = null;
  if (existsSync(LEDGER_PATH)) {
    try {
      ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    } catch (err) {
      // A malformed ledger must hide the panel with a reason, never crash the
      // whole dashboard over a hand-edited file.
      paidLedgerError = `ad-spend.json unreadable: ${String(err?.message || err).slice(0, 160)}`;
    }
  }
  const inWindowDate = (d) => typeof d === 'string' && d >= dateRange.start && d <= dateRange.end;
  const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const ratio = (a, b) => (b ? a / b : null); // never divide by zero
  const notSet = (v) => !v || v === '(not set)';
  const sumBy = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);

  // ── API index: everything keyed by the ad slug the ledger and Plausible use.
  const apiAdsAll = Array.isArray(ads_api?.ads) ? ads_api.ads : [];
  const apiAdById = new Map(apiAdsAll.map((a) => [a.id, a]));
  const apiTagged = apiAdsAll.filter((a) => a.utmContent && a.utmCampaign);
  const apiUntagged = apiAdsAll.filter((a) => !(a.utmContent && a.utmCampaign));
  // Daily platform rows re-keyed to {date, utm_content, spend, impressions, clicks}
  // so the per-ad arithmetic below is identical whichever source fed it.
  const apiDaily = (ads_api?.dailyByAd || [])
    .map((d) => ({ ...d, utm_content: apiAdById.get(d.adId)?.utmContent ?? null, utm_campaign: apiAdById.get(d.adId)?.utmCampaign ?? null }))
    .filter((d) => d.utm_content);
  const apiCountry = (ads_api?.byCountry || [])
    .filter((d) => inWindowDate(d.date))
    .map((d) => ({ ...d, utm_content: apiAdById.get(d.adId)?.utmContent ?? null }))
    .filter((d) => d.utm_content);
  const apiCampaignById = new Map((ads_api?.campaigns || []).map((c) => [c.id, c]));
  const apiLifetimeByCampaign = new Map((ads_api?.lifetime?.byCampaign || []).map((l) => [l.campaignId, l]));
  const apiCurrency = ads_api?.account?.currency || null;

  // Ledger campaigns first; then any API campaign (by utm_campaign) the ledger
  // does not declare, so the panel still renders from the platform alone.
  const campaignsIn = Array.isArray(ledger?.campaigns) ? [...ledger.campaigns] : [];
  for (const a of apiTagged) {
    if (!campaignsIn.some((c) => c.utm_campaign === a.utmCampaign)) {
      campaignsIn.push({
        platform: a.utmSource || 'openai ads',
        utm_source: a.utmSource,
        utm_campaign: a.utmCampaign,
        currency: apiCurrency || 'USD',
        ads: [],
        daily: [],
        pods_manual: [],
        _synthesizedFromApi: true,
      });
    }
  }

  if (campaignsIn.length) {
    const mktPaid = pl?.marketing?.paid || null;
    const appPaid = pl?.app?.paid || null;

    const campaigns = campaignsIn.map((c) => {
      const ledgerAds = Array.isArray(c.ads) ? c.ads : [];
      const ledgerDailyAll = Array.isArray(c.daily) ? c.daily : [];
      const podsManual = (Array.isArray(c.pods_manual) ? c.pods_manual : []).filter((p) => inWindowDate(p.date));

      // Platform ads for THIS campaign, by slug. API wins per slug.
      const sameUtm = (a) => a.utmCampaign === c.utm_campaign && (!c.utm_source || !a.utmSource || a.utmSource === c.utm_source);
      const apiAdsHere = apiTagged.filter(sameUtm);
      const apiBySlug = new Map(apiAdsHere.map((a) => [a.utmContent, a]));
      const apiSlugs = new Set(apiBySlug.keys());
      const apiCampaignIds = [...new Set(apiAdsHere.map((a) => a.campaignId).filter(Boolean))];
      const apiCampaign = apiCampaignIds.length === 1 ? apiCampaignById.get(apiCampaignIds[0]) || null : null;
      const spendSource = apiAdsHere.length ? 'openai-ads-api' : ledgerDailyAll.length ? 'ledger' : 'none';

      // Merged daily rows: API rows for API-known slugs, ledger rows only for
      // slugs the API does not know. Ledger rows on an API slug are counted as
      // superseded and surfaced, never silently summed.
      const apiDailyHere = apiDaily.filter((d) => d.utm_campaign === c.utm_campaign);
      const ledgerSuperseded = ledgerDailyAll.filter((d) => apiSlugs.has(d.utm_content)).length;
      const ledgerFallbackAll = ledgerDailyAll.filter((d) => !apiSlugs.has(d.utm_content));
      const dailyAll = [...apiDailyHere, ...ledgerFallbackAll];
      const daily = dailyAll.filter((d) => inWindowDate(d.date));

      // Plausible rows for THIS campaign, keyed by utm_content.
      const sameCampaign = (r) =>
        r['visit:utm_campaign'] === c.utm_campaign &&
        (r['visit:utm_source'] == null || r['visit:utm_source'] === c.utm_source);
      const trafficByContent = new Map();
      for (const r of (mktPaid?.byAd || []).filter(sameCampaign)) {
        trafficByContent.set(r['visit:utm_content'], r);
      }
      // CTA clickers per ad: visitors summed across the CTA event names. A
      // visitor who clicked two different CTAs counts twice — same approximation
      // the site-wide CTA panel accepts. Rows without a utm_source (only present
      // when the API refused the filter) are dropped here.
      const ctaByContent = new Map();
      for (const r of (mktPaid?.ctaByContent || []).filter(sameCampaign)) {
        const k = r['visit:utm_content'];
        ctaByContent.set(k, (ctaByContent.get(k) || 0) + (r.visitors || 0));
      }
      const ctaCampaign = (mktPaid?.ctaByCampaign || [])
        .filter((r) => r['visit:utm_campaign'] === c.utm_campaign)
        .reduce((n, r) => n + (r.visitors || 0), 0);
      // Registry (first-party) first: rows whose write-once `attribution` names
      // this campaign, created in the window, not tombstoned, keyed on
      // utm_content. Filtering on utm_campaign matters: a utm_content slug
      // reused by another campaign must not leak in.
      // A row tagged with the campaign but no utm_content is a real pod that no per-ad
      // row can show: it goes to `untaggedPods` (the manual source's rule), never under
      // a Map key of `undefined`. Tombstoned families never reach `fams` at all
      // (`pull_registry.mjs` drops `deletedAt` rows feed-wide), so a self-deleted pod is
      // absent here while Slack and Plausible still counted the conversion.
      const registrySignups = new Map();
      let registryUntagged = 0;
      for (const f of fams) {
        const a = f.attribution;
        if (!a || a.utm_campaign !== c.utm_campaign || !f.createdAt) continue;
        const t = Date.parse(f.createdAt) / 1000;
        if (!(t >= NOW - WINDOW_DAYS * DAY && t <= NOW)) continue;
        const k = a.utm_content;
        if (notSet(k)) {
          registryUntagged += 1;
          continue;
        }
        registrySignups.set(k, (registrySignups.get(k) || 0) + 1);
      }
      const hasRegistry = registrySignups.size > 0 || registryUntagged > 0;
      const plausibleSignups = new Map();
      for (const r of (appPaid?.signupsByContent || []).filter((r) => r['visit:utm_campaign'] === c.utm_campaign)) {
        const k = r['visit:utm_content'];
        plausibleSignups.set(k, (plausibleSignups.get(k) || 0) + (r.visitors || 0));
      }
      const signupsByContent = hasRegistry ? registrySignups : plausibleSignups;
      const appVisitorsCampaign = (appPaid?.byCampaign || []).find((r) => r['visit:utm_campaign'] === c.utm_campaign)?.visitors ?? null;
      const campaignSignups = [...signupsByContent.values()].reduce((a, b) => a + b, 0);
      // One rule for the whole campaign, so per-ad pods and the campaign total
      // never mix sources. Precedence: registry rows (ground truth) -> Plausible
      // app-UTM signups -> hand-recorded pods -> nothing.
      const podsSource = hasRegistry
        ? 'registry-utm'
        : campaignSignups > 0
          ? 'plausible-app-utm'
          : podsManual.length
            ? 'manual'
            : 'none';
      // Both automatic sources are per-ad signup counts keyed on utm_content;
      // every downstream site tests this one flag, not the source names.
      const fromSignups = podsSource === 'registry-utm' || podsSource === 'plausible-app-utm';

      // The ad roster: platform ads first (API fields), then ledger-only ads.
      // The ledger `ads` entry is an optional overlay — its `angle` (the API has
      // no such field) and `name` fill gaps, they never override API truth.
      const ledgerBySlug = new Map(ledgerAds.map((a) => [a.utm_content, a]));
      const roster = [
        ...apiAdsHere.map((a) => {
          const l = ledgerBySlug.get(a.utmContent) || {};
          return {
            utm_content: a.utmContent,
            name: a.name || l.name || a.utmContent,
            title: a.title || l.name || null,
            // "funny - dinner" -> "funny" when the ledger does not say.
            angle: l.angle || (a.name && a.name.includes(' - ') ? a.name.split(' - ')[0].trim() : null),
            status: a.status || l.status || null,
            reviewStatus: a.reviewStatus || null,
            adId: a.id,
            rowSource: 'openai-ads-api',
          };
        }),
        ...ledgerAds
          .filter((a) => !apiSlugs.has(a.utm_content))
          .map((a) => ({
            utm_content: a.utm_content,
            name: a.name || a.utm_content,
            title: null,
            angle: a.angle || null,
            status: a.status || null,
            reviewStatus: null,
            adId: null,
            rowSource: ledgerFallbackAll.some((d) => d.utm_content === a.utm_content) ? 'ledger' : 'none',
          })),
      ];

      const adRows = roster.map((ad) => {
        const mine = daily.filter((d) => d.utm_content === ad.utm_content);
        const spend = sumBy(mine, 'spend');
        const impressions = sumBy(mine, 'impressions');
        const clicks = sumBy(mine, 'clicks');
        const t = trafficByContent.get(ad.utm_content) || null;
        const visitors = t ? t.visitors : null;
        const ctaClicks = ctaByContent.has(ad.utm_content) ? ctaByContent.get(ad.utm_content) : (t ? 0 : null);
        const signups = signupsByContent.get(ad.utm_content) || 0;
        const pods =
          fromSignups
            ? signups
            : podsSource === 'manual'
              ? podsManual.filter((p) => p.utm_content === ad.utm_content).length
              : 0;
        // Per-country split (API only, window-scoped). Empty when the segment
        // query degraded or the ad has not served yet.
        const countryAgg = new Map();
        for (const d of apiCountry.filter((d) => d.utm_content === ad.utm_content)) {
          const o = countryAgg.get(d.country) || { country: d.country, impressions: 0, clicks: 0, spend: 0 };
          o.impressions += d.impressions || 0;
          o.clicks += d.clicks || 0;
          o.spend += d.spend || 0;
          countryAgg.set(d.country, o);
        }
        const countries = [...countryAgg.values()]
          .map((o) => ({ ...o, spend: r2(o.spend) }))
          .sort((a, b) => b.impressions - a.impressions);
        return {
          utmContent: ad.utm_content,
          name: ad.name,
          title: ad.title,
          angle: ad.angle,
          status: ad.status,
          reviewStatus: ad.reviewStatus,
          adId: ad.adId,
          spendSource: ad.rowSource,
          daysActive: new Set(mine.filter((d) => d.impressions || d.spend).map((d) => d.date)).size,
          spend: r2(spend),
          impressions,
          clicks,
          ctr: r2(ratio(clicks * 100, impressions)),
          cpc: r2(ratio(spend, clicks)),
          visitors,
          bounce: t?.bounce_rate ?? null,
          duration: t?.visit_duration ?? null,
          ctaClicks,
          ctaRate: r1(ctaClicks != null && visitors ? (ctaClicks / visitors) * 100 : null),
          signups: fromSignups ? signups : null,
          pods,
          podsSource,
          cpa: pods > 0 && spend > 0 ? r2(spend / pods) : null,
          countries,
        };
      });

      const spend = adRows.reduce((n, a) => n + a.spend, 0);
      const impressions = adRows.reduce((n, a) => n + a.impressions, 0);
      const clicks = adRows.reduce((n, a) => n + a.clicks, 0);
      // Campaign visitors come from the per-ad rows (same denominator as the
      // table); untagged-content rows ("(not set)") are added so a mis-tagged
      // ad still counts toward the campaign.
      const visitorsAll = [...trafficByContent.values()].reduce((n, r) => n + (r.visitors || 0), 0);
      const hasTraffic = trafficByContent.size > 0;
      const untaggedPods =
        podsSource === 'manual'
          ? podsManual.filter((p) => notSet(p.utm_content)).length
          : podsSource === 'registry-utm'
            ? registryUntagged
            : 0;
      const pods =
        podsSource === 'registry-utm'
          ? campaignSignups + registryUntagged
          : fromSignups
            ? campaignSignups
            : podsSource === 'manual'
              ? podsManual.length
              : 0;
      const ctaClicks = hasTraffic ? ctaCampaign : null;

      // Spend on a slug no roster entry declares (ledger fallback rows only —
      // every API row has a roster entry by construction), Plausible contents
      // nobody declared, and platform ads with no utm tag at all — all tagging
      // mistakes worth a line, not silent drops.
      const declared = new Set(roster.map((a) => a.utm_content));
      const undeclaredLedger = [...new Set(daily.map((d) => d.utm_content).filter((k) => k && !declared.has(k)))];
      const undeclaredPlausible = [...trafficByContent.keys()].filter((k) => !notSet(k) && !declared.has(k));
      const untaggedApiAds = apiCampaign ? apiUntagged.filter((a) => a.campaignId === apiCampaign.id).map((a) => a.name) : [];

      // Credit progress is LIFETIME (the credit is a budget, not a window). From
      // the platform's un-windowed insights call when it answered; else the sum
      // of every row we hold (right only while the window covers the campaign).
      const apiLifetime = apiCampaignIds.map((id) => apiLifetimeByCampaign.get(id)).filter(Boolean);
      const lifetimeSpend =
        apiLifetime.length ? sumBy(apiLifetime, 'spend') + sumBy(ledgerFallbackAll, 'spend') : sumBy(dailyAll, 'spend');
      const lifetimeSource = apiLifetime.length ? ads_api?.lifetime?.source || 'insights-lifetime' : 'row-sum';
      const startDate = apiCampaign?.startDate || c.started || null;
      const firstServed = dailyAll.filter((d) => d.impressions || d.spend).map((d) => d.date).sort()[0] || null;
      const elapsedFrom = startDate || firstServed;
      const daysElapsed = elapsedFrom
        ? Math.max(1, Math.floor((new Date(dateRange.end + 'T00:00:00Z').getTime() - new Date(elapsedFrom + 'T00:00:00Z').getTime()) / (DAY * 1000)) + 1)
        : null;
      const credit = c.credit_usd
        ? {
            amount: c.credit_usd,
            spent: r2(lifetimeSpend),
            pct: Math.min(100, Math.round((lifetimeSpend / c.credit_usd) * 100)),
            deadline: c.credit_deadline || null,
            daysLeft: c.credit_deadline
              ? Math.max(0, Math.ceil((new Date(c.credit_deadline + 'T23:59:59Z').getTime() / 1000 - NOW) / DAY))
              : null,
            daysElapsed,
            source: lifetimeSource,
          }
        : null;

      // Winner: lowest CPA among ads with pods; else highest CTA-click rate.
      const withPods = adRows.filter((a) => a.pods > 0 && a.cpa != null);
      let winner = null;
      if (withPods.length) {
        const w = withPods.sort((a, b) => a.cpa - b.cpa)[0];
        winner = { utmContent: w.utmContent, name: w.name, by: 'cpa', value: w.cpa };
      } else {
        const withRate = adRows.filter((a) => a.ctaRate != null && a.ctaRate > 0);
        if (withRate.length) {
          const w = withRate.sort((a, b) => b.ctaRate - a.ctaRate)[0];
          winner = { utmContent: w.utmContent, name: w.name, by: 'cta-rate', value: w.ctaRate };
        }
      }

      const currency = spendSource === 'openai-ads-api' && apiCurrency ? apiCurrency : c.currency || 'USD';
      // The ledger's `credit_usd` and `currency` were written before the platform
      // reported its own currency; flag a mismatch rather than silently mixing.
      const currencyMismatch = spendSource === 'openai-ads-api' && apiCurrency && c.currency && c.currency !== apiCurrency ? { ledger: c.currency, platform: apiCurrency } : null;

      // ── Tweaks: explicit, named rules; only emitted when the precondition holds.
      const tweaks = [];
      const served = adRows.filter((a) => a.impressions > 0 && a.ctr != null);
      const median = (xs) => {
        const s = [...xs].sort((a, b) => a - b);
        return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
      };
      const medianCtr = served.length >= 2 ? median(served.map((a) => a.ctr)) : null;
      if (medianCtr != null && medianCtr > 0) {
        // (a) ≥300 impressions and CTR below half the campaign median.
        for (const a of served.filter((a) => a.impressions >= 300 && a.ctr < medianCtr / 2)) {
          tweaks.push({ rule: 'a', action: 'consider pausing', utmContent: a.utmContent, name: a.name, detail: `ctr ${a.ctr}% vs campaign median ${r2(medianCtr)}% on ${a.impressions} impressions` });
        }
        // (b) the best CTR, and at least twice the median.
        const best = [...served].sort((a, b) => b.ctr - a.ctr)[0];
        if (best && best.ctr >= 2 * medianCtr) {
          tweaks.push({ rule: 'b', action: 'shift budget here', utmContent: best.utmContent, name: best.name, detail: `best ctr ${best.ctr}% ≥ 2× campaign median ${r2(medianCtr)}%` });
        }
      }
      // (c) clicks on the platform but no tagged visitor in Plausible over the same window.
      if (pl) {
        for (const a of adRows.filter((a) => a.clicks >= 10 && !(a.visitors > 0))) {
          tweaks.push({ rule: 'c', action: 'tagging or landing problem', utmContent: a.utmContent, name: a.name, detail: `${a.clicks} ad click${a.clicks === 1 ? '' : 's'} but plausible saw no visitor with utm_content=${a.utmContent}` });
        }
      }
      // (d) credit pace: current daily pace × days left would not spend what is
      // left. Needs some spend first — zero spend is "not started", not pacing.
      if (credit && credit.daysLeft > 0 && daysElapsed && lifetimeSpend > 0) {
        const remaining = credit.amount - lifetimeSpend;
        const pace = lifetimeSpend / daysElapsed;
        const projected = pace * credit.daysLeft;
        const target = r2(remaining / credit.daysLeft);
        // Only worth saying when the suggested cap is above the one already set.
        const capTooLow = apiCampaign?.dailyBudget == null || target > apiCampaign.dailyBudget;
        if (remaining > 0 && projected < remaining && capTooLow) {
          tweaks.push({
            rule: 'd',
            action: `under-pacing, raise daily budget to ${target}`,
            utmContent: null,
            name: null,
            value: target,
            detail: `${r2(pace)}/day over ${daysElapsed} day${daysElapsed === 1 ? '' : 's'} × ${credit.daysLeft} left = ${r2(projected)}, but ${r2(remaining)} of credit remains${apiCampaign?.dailyBudget != null ? ` (daily cap now ${apiCampaign.dailyBudget})` : ''}`,
          });
        }
      }
      // (e) active but not approved.
      for (const a of adRows.filter((a) => a.status === 'active' && a.reviewStatus && a.reviewStatus !== 'approved')) {
        tweaks.push({ rule: 'e', action: 'blocked in review', utmContent: a.utmContent, name: a.name, detail: `review_status=${a.reviewStatus}` });
      }

      return {
        platform: c.platform,
        utmSource: c.utm_source,
        utmCampaign: c.utm_campaign,
        currency,
        currencyMismatch,
        notes: c.notes || null,
        started: startDate,
        spendSource,
        api: apiCampaign
          ? { id: apiCampaign.id, name: apiCampaign.name, status: apiCampaign.status, dailyBudget: apiCampaign.dailyBudget, countries: apiCampaign.countries, objective: apiCampaign.objective }
          : null,
        synthesizedFromApi: !!c._synthesizedFromApi,
        totals: {
          spend: r2(spend),
          impressions,
          clicks,
          ctr: r2(ratio(clicks * 100, impressions)),
          cpc: r2(ratio(spend, clicks)),
          visitors: hasTraffic ? visitorsAll : null,
          appVisitors: appVisitorsCampaign,
          ctaClicks,
          ctaRate: r1(ctaClicks != null && visitorsAll ? (ctaClicks / visitorsAll) * 100 : null),
          signups: fromSignups ? campaignSignups : null,
          pods,
          untaggedPods,
          podsSource,
          cpa: pods > 0 && spend > 0 ? r2(spend / pods) : null,
        },
        credit,
        ads: adRows.sort((a, b) => b.spend - a.spend || b.impressions - a.impressions),
        winner,
        tweaks,
        undeclaredLedger,
        undeclaredPlausible,
        untaggedApiAds,
        ledgerSuperseded,
      };
    });

    const sumT = (k) => campaigns.reduce((n, c) => n + (c.totals[k] || 0), 0);
    const anyTraffic = campaigns.some((c) => c.totals.visitors != null);
    const totalSpend = sumT('spend');
    const totalPods = sumT('pods');
    paid = {
      ledgerPath: '~/.config/beanies/ad-spend.json',
      ledgerPresent: !!ledger,
      apiAvailable: !!ads_api,
      apiAccount: ads_api?.account ? { name: ads_api.account.name, currency: ads_api.account.currency, timezone: ads_api.account.timezone, status: ads_api.account.status } : null,
      apiWindow: ads_api?.window || null,
      spendUnit: ads_api?.spendUnit || null,
      plausibleAvailable: !!pl,
      // Overall sources, for the one-line notes. Mixed campaigns are possible
      // in principle; the per-campaign fields are the exact answer.
      spendSource: campaigns.some((c) => c.spendSource === 'openai-ads-api')
        ? 'openai-ads-api'
        : campaigns.some((c) => c.spendSource === 'ledger')
          ? 'ledger'
          : 'none',
      attribution: campaigns.some((c) => c.totals.podsSource === 'registry-utm')
        ? 'registry-utm'
        : campaigns.some((c) => c.totals.podsSource === 'plausible-app-utm')
        ? 'plausible-app-utm'
        : campaigns.some((c) => c.totals.podsSource === 'manual')
          ? 'manual'
          : 'none',
      utmCarryThrough: campaigns.some((c) => c.totals.signups != null),
      ctaFilteredByUtmSource: mktPaid?.ctaFilteredByUtmSource ?? null,
      totals: {
        spend: r2(totalSpend),
        clicks: sumT('clicks'),
        visitors: anyTraffic ? sumT('visitors') : null,
        pods: totalPods,
        cpa: totalPods > 0 && totalSpend > 0 ? r2(totalSpend / totalPods) : null,
      },
      campaigns,
    };
  }
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
  // Paid campaigns: null when ~/.config/beanies/ad-spend.json is absent or has
  // no campaigns (the panel hides itself); `paidLedgerError` names a malformed
  // file so it is never a silent drop.
  paid,
  paidLedgerError,
  // Which optional Plausible / ads-API queries degraded this run, so the page
  // can say so rather than rendering a silently-empty panel.
  degraded: [...(pl?._degraded || []), ...(ads_api?._degraded || [])],
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
  users: reg.users ?? null, // total-users block (2026-08-29); null on pre-field registry pulls
  churn: reg.churnTiming,
  topActive,
  lost,
  lostDeep,
  deepUserEvents,
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
