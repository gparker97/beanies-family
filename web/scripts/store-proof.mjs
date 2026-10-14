#!/usr/bin/env node
/**
 * Refresh `web/src/data/store-proof.json`: the five-star rating counts the homepage
 * hero counter and its JSON-LD `aggregateRating` render (#135).
 *
 * Usage:
 *   node web/scripts/store-proof.mjs              # scan both stores, write the file
 *   node web/scripts/store-proof.mjs --dry-run    # scan and print; write nothing
 *   node web/scripts/store-proof.mjs --play 5     # also set the confirmed Play Console count
 *   node web/scripts/store-proof.mjs --deadline-seconds 120   # stop fetching after 120 s
 *
 * App Store: every public storefront listing is fetched and its rating count read;
 * the file keeps one count per storefront (the total is their sum, never stored).
 * A storefront that could not be fetched (`failed`) or whose 2xx page carried no
 * rating item for the app (`unparsed`: an "not available in your country" page, a
 * newly opened storefront) CARRIES its previous count, so a blip never lowers the
 * published number. The two are tallied separately in the summary.
 *
 * The whole scan has a deadline (default 4 minutes, `--deadline-seconds N`): once it
 * passes, the remaining storefronts are not fetched and count as `failed` (carried),
 * a retry that would sleep past it is refused (also cut short), and the summary says
 * how many were skipped and how many of those had a previous count to carry.
 *
 * The rating fails closed: 5.0 is written only when every storefront contributing a
 * count parsed an EXACT average of 5 this run. A badge-only (rounded), missing or
 * carried average keeps the previous rating and prints a "Rating unverified for: …"
 * line naming those storefronts.
 *
 * Google Play: there is no API that returns a rating count (the Reporting API is
 * vitals only; the Console's ratings export carries averages only), and the public
 * listing shows no aggregate below Play's threshold. So the Play half is the value
 * greg confirms from the Play Console (`--play N`), until the public listing
 * publishes a histogram, at which point its five-star bar is used automatically.
 *
 * The file is unchanged on every failure: a wholly failed App Store scan, more
 * unparsed storefronts than `max(3, 25% of the 2xx fetches)` (the page shape has
 * changed: update the parser), a corrupt previous file, or a bad flag all exit 1.
 * The result is validated with `parseStoreProof` before writing, so this script can
 * never write a file the build would reject.
 *
 * Run by hand, or by Step 4b of the deploy skills. Never part of `astro build`.
 * The three summary lines it prints (App Store / Google Play / Total) are what the
 * deploy summary quotes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  APP_STORE_ID,
  PLAY_PACKAGE,
  appStoreCount,
  fiveStarTotal,
  mergeStoreProof,
  parseAppStoreListing,
  parsePlayListing,
  parseStoreProof,
} from '../src/lib/storeProof.ts';

const DATA_FILE = new URL('../src/data/store-proof.json', import.meta.url);

const DEFAULT_DEADLINE_SECONDS = 240;

const USAGE = `usage: node web/scripts/store-proof.mjs [--dry-run] [--play <N>] [--deadline-seconds <N>]
  --dry-run               scan and print the result; do not write the file
  --play N                set the confirmed Google Play five-star count (a non-negative integer)
  --deadline-seconds N    stop fetching after N seconds; the rest are carried (default ${DEFAULT_DEADLINE_SECONDS})`;

/**
 * Every App Store storefront (lowercase ISO 3166 codes). The classic 155, plus the
 * 19 Apple opened in 2020, each verified 2026-10-14 to serve its own listing of the
 * app rather than redirecting elsewhere. A code Apple redirects to ANOTHER storefront
 * is counted as empty, never as that other storefront's ratings a second time.
 */
const STOREFRONTS = `
  ae af ag ai al am ao ar at au az ba bb be bf bg bh bj bm bn bo br bs bt bw by bz
  ca cd cg ch ci cl cm cn co cr cv cy cz de dk dm do dz ec ee eg es fi fj fm fr ga
  gb gd ge gh gm gr gt gw gy hk hn hr hu id ie il in iq is it jm jo jp ke kg kh kn
  kr kw ky kz la lb lc lk lr lt lu lv ly ma md me mg mk ml mn mo mr ms mt mu mv mw
  mx my mz na ne ng ni nl no np nr nz om pa pe pg ph pk pl pt pw py qa ro rs ru rw
  sa sb sc se sg si sk sl sn sr st sv sz tc td th tj tm tn to tr tt tw tz ua ug us
  uy uz vc ve vg vn vu xk ye za zm zw
`
  .trim()
  .split(/\s+/);

const CONCURRENCY = 8;
const TIMEOUT_MS = 10_000;
/**
 * apps.apple.com answers a burst of ~50 listing requests with HTTP 429 (seen
 * 2026-10-14), so a 429 or 5xx is retried with backoff (honouring Retry-After)
 * before the storefront is counted as failed. A storefront that still fails
 * carries its previous count, so this only keeps the "failed" list honest.
 */
const RETRIES = 4;
const RETRY_BASE_MS = 1_500;
const RETRY_CAP_MS = 15_000;
/** More unparsed storefronts than this (of the 2xx fetches) means the page shape changed. */
const UNPARSED_FLOOR = 3;
const UNPARSED_SHARE = 0.25;

/** Thrown for work the run's deadline cut short; the storefront counts as failed. */
class DeadlineError extends Error {
  constructor(message = 'deadline reached') {
    super(message);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(res, attempt) {
  const after = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(after) && after > 0 ? after * 1000 : RETRY_BASE_MS * 2 ** attempt;
  return Math.min(ms, RETRY_CAP_MS) + Math.floor(Math.random() * 500);
}

/** GET with retries, never running (or sleeping) past `deadline` (epoch ms). */
async function get(url, deadline) {
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DeadlineError();
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, remaining)),
    });
    if (res.ok) return { html: await res.text(), finalUrl: res.url };
    // Release the connection before anything else, whether we retry or give up.
    await res.body?.cancel();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= RETRIES) throw new Error(`HTTP ${res.status}`);
    const wait = retryDelay(res, attempt);
    if (Date.now() + wait >= deadline) {
      throw new DeadlineError(`HTTP ${res.status} (no retry: deadline)`);
    }
    await sleep(wait);
  }
}

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function scanAppStore(deadline) {
  const scan = { counts: {}, ratings: {}, badges: {}, failed: [], unparsed: [], empty: [] };
  const results = await mapLimit(STOREFRONTS, CONCURRENCY, async (cc) => {
    try {
      const { html, finalUrl } = await get(
        `https://apps.apple.com/${cc}/app/id${APP_STORE_ID}`,
        deadline
      );
      // Apple redirects a storefront it does not serve to ANOTHER storefront (empty: a
      // legitimate zero, never that storefront's ratings counted twice). A landing with
      // no storefront segment at all (e.g. /us/app/... -> /app/...) proves nothing about
      // this storefront, so it is unparsed: carried, and subject to the abort threshold.
      const landed = new URL(finalUrl).pathname.split('/')[1] ?? '';
      if (!/^[a-z]{2}$/.test(landed)) return { cc, kind: 'unparsed' };
      if (landed !== cc) return { cc, kind: 'empty' };
      const { rating, ratingCount, exact } = parseAppStoreListing(html);
      if (ratingCount === null) return { cc, kind: 'unparsed' };
      if (ratingCount === 0) return { cc, kind: 'empty' };
      return { cc, kind: 'count', ratingCount, rating, exact };
    } catch (err) {
      return {
        cc,
        kind: 'failed',
        // a fetch aborted because the deadline arrived mid-flight is cut short too
        cutShort: err instanceof DeadlineError || Date.now() >= deadline,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  for (const r of results) {
    if (r.kind === 'count') {
      scan.counts[r.cc] = r.ratingCount;
      if (r.rating !== null) (r.exact ? scan.ratings : scan.badges)[r.cc] = r.rating;
    } else {
      scan[r.kind].push(r.cc);
    }
  }
  const errors = results.filter((r) => r.kind === 'failed');
  return { scan, errors, cutShort: errors.filter((r) => r.cutShort).map((r) => r.cc) };
}

async function scanPlay(deadline) {
  try {
    const { html } = await get(
      `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}&hl=en&gl=US`,
      deadline
    );
    return { play: parsePlayListing(html), error: null };
  } catch (err) {
    return { play: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function usageExit(message) {
  if (message) console.error(`store-proof: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

function readFlags() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        play: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'deadline-seconds': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    usageExit(err instanceof Error ? err.message : String(err));
  }
  let playOverride = null;
  if (values.play !== undefined) {
    if (!/^\d+$/.test(values.play))
      usageExit(`--play must be a non-negative integer, got "${values.play}"`);
    playOverride = Number(values.play);
  }
  let deadlineSeconds = DEFAULT_DEADLINE_SECONDS;
  if (values['deadline-seconds'] !== undefined) {
    if (!/^[1-9]\d*$/.test(values['deadline-seconds']))
      usageExit(
        `--deadline-seconds must be a positive integer, got "${values['deadline-seconds']}"`
      );
    deadlineSeconds = Number(values['deadline-seconds']);
  }
  return { dryRun: values['dry-run'], playOverride, deadlineSeconds };
}

const fmtRating = (r) => r.toFixed(1);

async function main() {
  const { dryRun, playOverride, deadlineSeconds } = readFlags();

  // The previous file first: a corrupt one is reported, never silently overwritten.
  const previous = parseStoreProof(JSON.parse(await readFile(DATA_FILE, 'utf8')));

  const deadline = Date.now() + deadlineSeconds * 1000;
  const [{ scan, errors, cutShort }, { play, error: playError }] = await Promise.all([
    scanAppStore(deadline),
    scanPlay(deadline),
  ]);

  if (scan.failed.length === STOREFRONTS.length) {
    const sample = [...new Set(errors.map((e) => e.error))].slice(0, 3).join('; ');
    console.error(
      `App Store scan failed (network): ${scan.failed.length} fetch errors (${sample}); file unchanged`
    );
    process.exit(1);
  }
  // A few unparsed storefronts are carried (an unavailable or brand-new storefront);
  // many mean Apple changed the page and every count would silently go stale.
  const fetched2xx = Object.keys(scan.counts).length + scan.empty.length + scan.unparsed.length;
  const unparsedLimit = Math.max(UNPARSED_FLOOR, Math.floor(UNPARSED_SHARE * fetched2xx));
  if (scan.unparsed.length > unparsedLimit) {
    console.error(
      `App Store page shape changed (${scan.unparsed.length} of ${fetched2xx} pages unparsed, limit ${unparsedLimit}: ` +
        `${scan.unparsed.join(', ')}): update parseAppStoreListing in web/src/lib/storeProof.ts; file unchanged`
    );
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const merged = mergeStoreProof({ previous, scan, play, playOverride, today });
  const next = parseStoreProof(merged.next);
  const { carried, rating: decision } = merged;

  // ---- summary: one line per half, one for the change ----
  const stores = Object.entries(next.appStore.storefronts)
    .map(([cc, n]) => `${cc} ${n}`)
    .join(', ');
  const carriedText = carried.length
    ? `${carried.length} carried: ${carried.join(', ')}`
    : '0 carried';
  const unparsedText = scan.unparsed.length
    ? `${scan.unparsed.length} unparsed: ${scan.unparsed.join(', ')}`
    : '0 unparsed';
  const deadlineText = cutShort.length
    ? `; deadline reached after ${deadlineSeconds} s: ${cutShort.length} skipped, ` +
      `${cutShort.filter((cc) => carried.includes(cc)).length} carried`
    : '';
  console.log(
    `App Store: ${appStoreCount(next)} ratings · ${fmtRating(next.appStore.rating)} (${stores || 'none'}; ` +
      `${scan.empty.length} empty, ${carriedText}, ${scan.failed.length} failed, ${unparsedText}${deadlineText})`
  );
  if (decision.unverified.length > 0) {
    const outcome =
      decision.basis === 'mean'
        ? `${fmtRating(decision.rating)} is the mean of the storefronts that parsed an average only`
        : `kept ${fmtRating(previous.appStore.rating)} from the previous file`;
    console.log(
      `Rating unverified for: ${decision.unverified.join(', ')} (no exact average parsed); ${outcome}`
    );
  }

  const gp = next.googlePlay;
  let playNote;
  if (gp.source === 'listing') {
    playNote = `five-star bar of the public listing, ${gp.fetchedAt}`;
    if (playOverride !== null)
      playNote += `; --play ${playOverride} ignored because the listing now publishes ratings`;
  } else {
    const why = playError
      ? `the public listing could not be fetched (${playError}), so the last confirmed value stands`
      : 'the public listing shows no aggregate yet';
    playNote = `confirmed ${gp.fetchedAt}; ${why}`;
  }
  console.log(`Google Play: ${gp.ratingCount} (${playNote})`);

  const was = fiveStarTotal(previous);
  const total = fiveStarTotal(next);
  if (total === 0 && appStoreCount(next) + gp.ratingCount > 0) {
    console.log(
      `Total: 0 (was ${was}). App Store average is ${fmtRating(next.appStore.rating)}, so the "five-star ratings" ` +
        'claim is withdrawn and the counter will not render; revisit the strip copy'
    );
  } else if (total < was) {
    console.log(`Total: ${total} (was ${was}, DOWN ${was - total})`);
  } else {
    console.log(`Total: ${total} (was ${was})`);
  }

  const body = `${JSON.stringify(next, null, 2)}\n`;
  if (dryRun) {
    console.log('\n--dry-run: file not written. It would contain:');
    process.stdout.write(body);
    return;
  }
  const current = await readFile(DATA_FILE, 'utf8');
  if (current === body) {
    console.log(`${fileURLToPath(DATA_FILE)} unchanged`);
    return;
  }
  await writeFile(DATA_FILE, body);
  console.log(`Wrote ${fileURLToPath(DATA_FILE)}`);
}

main().catch((err) => {
  console.error('store-proof failed:', err.message);
  process.exit(1);
});
