/**
 * The store-proof number: how many five-star ratings beanies.family has on the
 * App Store and Google Play, as committed in `web/src/data/store-proof.json`.
 *
 * TWO CALLERS, ONE MODULE. The homepage reads this at build time (Astro) and the
 * refresh script `web/scripts/store-proof.mjs` reads it under plain Node 24, which
 * runs `.ts` by stripping the types. So this file must stay ERASABLE TypeScript with
 * ZERO imports: interfaces, annotations and `as` only; no enums, namespaces or
 * parameter properties (Node rejects them), and no `@beanies/brand/nav` import
 * (it evaluates `import.meta.env.DEV`, which is undefined under plain Node).
 *
 * TWO QUESTIONS, KEPT APART (plan #135, Context fact 5):
 *   - `parseStoreProof` answers "is the file well formed?" and THROWS, naming the
 *     field, so `astro build` fails loudly on a corrupt file.
 *   - `fiveStarTotal` answers "may the page claim N five-star ratings?" and returns
 *     0 when it may not. A sub-5.0 App Store average is a true fact the file records,
 *     not an error, so it never blocks a refresh or a deploy: the counter and the
 *     JSON-LD simply disappear and the refresh summary says why.
 *
 * The App Store count is the SUM of the storefront map, never a second stored field
 * that could drift from it.
 */

/** Drift-tested against `STORE_URL.ios` in `@beanies/brand/nav` (proof.test.ts). */
export const APP_STORE_ID = '6798513944';
/** Drift-tested against `STORE_URL.android` in `@beanies/brand/nav` (proof.test.ts). */
export const PLAY_PACKAGE = 'family.beanies.app';

export interface StoreProof {
  appStore: {
    /** The count-weighted average across storefronts (exactly 5 while every storefront is 5.0). */
    rating: number;
    /** Ratings per public storefront listing, keyed by lowercase country code. */
    storefronts: Record<string, number>;
    fetchedAt: string;
  };
  googlePlay: {
    /**
     * Five-star ratings on Google Play. `confirmed` = the Play Console figure greg
     * confirmed (`--play N`); `listing` = the five-star bar of the public listing's
     * histogram, once Play publishes one.
     */
    ratingCount: number;
    source: 'listing' | 'confirmed';
    fetchedAt: string;
  };
}

const REFRESH_HINT = 'run `node web/scripts/store-proof.mjs` to refresh it';

function invalid(field: string, why: string): never {
  throw new Error(`store-proof.json: ${field} ${why}; ${REFRESH_HINT}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** YYYY-MM-DD (optionally followed by an ISO time) that names a real day. */
function isIsoDate(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}/.test(v) &&
    (v.length === 10 || v[10] === 'T') &&
    !Number.isNaN(Date.parse(v))
  );
}

/**
 * Shape only. Returns a clean copy of a well-formed file and throws
 * `Error('store-proof.json: <field> …; run `node web/scripts/store-proof.mjs` to refresh it')`
 * on anything else. It never judges the rating: see `fiveStarTotal`.
 */
export function parseStoreProof(p: unknown): StoreProof {
  if (!isObject(p)) invalid('(root)', 'is not an object');
  const a = p.appStore;
  const g = p.googlePlay;
  if (!isObject(a)) invalid('appStore', 'is missing');
  if (!isObject(g)) invalid('googlePlay', 'is missing');

  if (typeof a.rating !== 'number' || !Number.isFinite(a.rating) || a.rating < 0 || a.rating > 5) {
    invalid('appStore.rating', 'must be a number between 0 and 5');
  }
  if (!isObject(a.storefronts))
    invalid('appStore.storefronts', 'must be an object of country code -> count');
  const storefronts: Record<string, number> = {};
  for (const [cc, n] of Object.entries(a.storefronts)) {
    if (!/^[a-z]{2}$/.test(cc))
      invalid(`appStore.storefronts.${cc}`, 'is not a lowercase two-letter storefront code');
    if (!isCount(n)) invalid(`appStore.storefronts.${cc}`, 'must be a non-negative integer');
    storefronts[cc] = n;
  }
  if (!isIsoDate(a.fetchedAt)) invalid('appStore.fetchedAt', 'must be an ISO date (YYYY-MM-DD)');

  if (!isCount(g.ratingCount)) invalid('googlePlay.ratingCount', 'must be a non-negative integer');
  if (g.source !== 'listing' && g.source !== 'confirmed') {
    invalid('googlePlay.source', "must be 'listing' or 'confirmed'");
  }
  if (!isIsoDate(g.fetchedAt)) invalid('googlePlay.fetchedAt', 'must be an ISO date (YYYY-MM-DD)');

  return {
    appStore: { rating: a.rating, storefronts, fetchedAt: a.fetchedAt },
    googlePlay: { ratingCount: g.ratingCount, source: g.source, fetchedAt: g.fetchedAt },
  };
}

/** The count of App Store ratings: the sum of the storefront map. */
export function appStoreCount(p: StoreProof): number {
  return Object.values(p.appStore.storefronts).reduce((sum, n) => sum + n, 0);
}

/**
 * The claim. The combined count while every App Store rating averages 5.0 (or
 * there are none yet); otherwise 0, and nothing that says "five-star" renders.
 */
export function fiveStarTotal(p: StoreProof): number {
  const apple = appStoreCount(p);
  return apple === 0 || p.appStore.rating === 5 ? apple + p.googlePlay.ratingCount : 0;
}

/**
 * One storefront's listing page (apps.apple.com/{cc}/app/id…). Two shapes, matched
 * leniently, checked 2026-10-14:
 *
 *   A. the product-ratings item, keyed on OUR product id:
 *      "productId":"6798513944","ratingAverage":5,"totalNumberOfRatings":4
 *      (present on every listing, with 0/0 where nobody has rated yet)
 *   B. the header badge:  "ratingFormatted":"5.0","ratingCount":4
 *      (present only once rated; the decimal is a comma in some storefronts, "5,0")
 *
 * A is preferred because it is keyed on the product id; the "similar apps" shelf on
 * the same page carries other apps' `"ratingCount":"1"` (quoted), which neither
 * pattern can match. Returns `{ ratingCount: 0 }` for a listing nobody has rated (a
 * legitimate zero) and `null`s when the page matched neither shape (`unparsed`: the
 * storefront is carried, and the script refuses to write only when too many are).
 *
 * `exact` is true only when the average came from A. B's badge is ROUNDED to one
 * decimal (a 4.96 shows as "5.0"), so a badge-only average can never establish the
 * all-5 claim; `rateAppStore` treats it as unverified.
 */
export function parseAppStoreListing(html: string): {
  rating: number | null;
  ratingCount: number | null;
  exact: boolean;
} {
  const item = new RegExp(
    `"productId":"${APP_STORE_ID}","ratingAverage":(\\d+(?:\\.\\d+)?),"totalNumberOfRatings":(\\d+)`
  ).exec(html);
  const badge = /"ratingFormatted":"(\d+[.,]\d+)","ratingCount":(\d+)/.exec(html);

  const ratingCount = item ? Number(item[2]) : badge ? Number(badge[2]) : null;
  if (ratingCount === null) return { rating: null, ratingCount: null, exact: false };
  if (ratingCount === 0) return { rating: null, ratingCount: 0, exact: false };

  const raw = item ? Number(item[1]) : badge ? Number(badge[1].replace(',', '.')) : null;
  const rating = raw !== null && Number.isFinite(raw) ? raw : null;
  return { rating, ratingCount, exact: item !== null && rating !== null };
}

/**
 * The public Google Play listing (hl=en). Below Play's threshold the listing shows
 * no aggregate at all (true for family.beanies.app on 2026-10-14), and this returns
 * null. Once Play publishes ratings, the listing carries a five-bar histogram, one
 * element per star (checked against a rated app's listing, 2026-10-14):
 *
 *   <div class="JzwBgb" role="img" aria-label="93,514 reviews for star rating 5">
 *
 * CONSERVATIVE BY DESIGN: it returns a count only when all five bars (stars 1-5)
 * are present exactly once with digit-only counts; anything partial or ambiguous
 * is null, so the script keeps the confirmed value rather than guessing.
 *
 * It returns the FIVE-STAR bar, not the sum of all five: the page's claim is
 * "five-star ratings", and the App Store half only renders while its average is
 * exactly 5.0, so counting Play's five-star bar keeps the total true even after a
 * lower Play rating arrives. (The confirmed Console value is five-star too.)
 */
export function parsePlayListing(html: string): { ratingCount: number } | null {
  const bars = new Map<number, number>();
  const re = /aria-label="(\d[\d,.\u00a0\u202f ]*) reviews? for star rating ([1-5])"/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const star = Number(m[2]);
    const count = Number(m[1].replace(/[^\d]/g, ''));
    if (!Number.isInteger(count) || bars.has(star)) return null;
    bars.set(star, count);
  }
  if (bars.size !== 5) return null;
  return { ratingCount: bars.get(5)! };
}

/** What one App Store scan found, per storefront code. */
export interface StorefrontScan {
  /** Storefronts whose listing reported one or more ratings. */
  counts: Record<string, number>;
  /** The EXACT average (listing shape A) for storefronts in `counts`, when it parsed. */
  ratings: Record<string, number>;
  /** The rounded badge average (shape B) for storefronts in `counts` that had no exact one. */
  badges: Record<string, number>;
  /** Fetch error, timeout, non-2xx, or the run's deadline: the previous count is carried. */
  failed: string[];
  /**
   * A 2xx page that matched neither listing shape (an unavailable-in-your-country page,
   * a newly opened storefront, or a changed page): the previous count is carried, and
   * the script refuses to write only when there are too many of them.
   */
  unparsed: string[];
  /** A listing with no ratings, or a storefront Apple redirected elsewhere. */
  empty: string[];
}

function byCountThenCode(entries: [string, number][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [cc, n] of [...entries].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) {
    out[cc] = n;
  }
  return out;
}

/**
 * Storefronts the scan did not read (`failed` or `unparsed`) that had a count in the
 * previous file: their previous count is CARRIED, so a blip never lowers the number.
 */
function carriedEntries(previous: StoreProof, scan: StorefrontScan): [string, number][] {
  const out: [string, number][] = [];
  for (const cc of [...scan.failed, ...scan.unparsed]) {
    const prev = previous.appStore.storefronts[cc];
    if (prev !== undefined && !(cc in scan.counts)) out.push([cc, prev]);
  }
  return out;
}

/** What `rateAppStore` decided, and why. */
export interface AppStoreRating {
  rating: number;
  /**
   * Every storefront contributing a count (scanned or carried) that has no EXACT
   * average this run (badge-only, missing, or not read), sorted by code.
   */
  unverified: string[];
  /**
   * How `rating` was reached: `mean` of the storefronts that parsed an average (some
   * below 5), `exact` (all exact 5), or `previous` (kept from the previous file).
   */
  basis: 'mean' | 'exact' | 'previous';
}

function rate(
  previous: StoreProof,
  scan: StorefrontScan,
  carried: [string, number][]
): AppStoreRating {
  const contributing = [...Object.keys(scan.counts), ...carried.map(([cc]) => cc)];
  const unverified = contributing.filter((cc) => !(cc in scan.ratings)).sort();
  const averageOf = (cc: string): number | undefined => scan.ratings[cc] ?? scan.badges[cc];
  const averaged = Object.keys(scan.counts).filter((cc) => averageOf(cc) !== undefined);
  if (averaged.some((cc) => averageOf(cc)! < 5)) {
    const weight = averaged.reduce((sum, cc) => sum + scan.counts[cc], 0);
    const mean = averaged.reduce((sum, cc) => sum + scan.counts[cc] * averageOf(cc)!, 0) / weight;
    return { rating: Math.min(Math.round(mean * 10) / 10, 4.9), unverified, basis: 'mean' };
  }
  if (contributing.length > 0 && unverified.length === 0) {
    return { rating: 5, unverified, basis: 'exact' };
  }
  return { rating: previous.appStore.rating, unverified, basis: 'previous' };
}

/**
 * The App Store average for the next file. FAILS CLOSED on the five-star claim:
 *
 * - Any parsed average (exact or badge) below 5: the count-weighted mean to one
 *   decimal, never rounded UP to 5 (a 4.96 is not a five-star average). The mean is
 *   over the storefronts that parsed an average THIS RUN only; carried and
 *   average-less storefronts are not in it, and are named in `unverified`.
 * - Otherwise 5 only when EVERY storefront contributing a count (scanned or carried)
 *   has an exact average this run. A badge-only, missing or carried average cannot
 *   prove 5.0, so the previous rating is kept and `unverified` names those
 *   storefronts for the script's warning line.
 */
export function rateAppStore(o: { previous: StoreProof; scan: StorefrontScan }): AppStoreRating {
  return rate(o.previous, o.scan, carriedEntries(o.previous, o.scan));
}

/** Same counts per storefront, whatever order either map was written in. */
function sameStorefronts(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((cc) => a[cc] === b[cc]);
}

/**
 * The next file, from the previous one and a scan. Pure, so it is tested without
 * the network.
 *
 * - App Store storefronts: the scan's counts; a storefront in `failed` or `unparsed`
 *   CARRIES its previous value (a network blip never lowers the number); one in
 *   `empty` is omitted (a legitimate zero).
 * - App Store rating: `rateAppStore` (fails closed on the five-star claim).
 * - App Store `fetchedAt` moves to today only when its numbers changed.
 * - Google Play: the listing's histogram when `play` is non-null; else the confirmed
 *   `playOverride` when given, which ALWAYS stamps today (restating the count is a
 *   confirmation act); else the previous half unchanged. A listing value that is
 *   unchanged keeps its date.
 *
 * Returns the next file plus what the summary needs, so the script never re-derives
 * them: `carried` (codes whose previous count was carried) and the rating decision.
 */
export function mergeStoreProof(o: {
  previous: StoreProof;
  scan: StorefrontScan;
  play: { ratingCount: number } | null;
  playOverride: number | null;
  today: string;
}): { next: StoreProof; carried: string[]; rating: AppStoreRating } {
  const { previous, scan, play, playOverride, today } = o;

  const carriedFrom = carriedEntries(previous, scan);
  const entries: [string, number][] = [...Object.entries(scan.counts), ...carriedFrom];
  const decision = rate(previous, scan, carriedFrom);
  const { rating } = decision;

  const prevPlay = previous.googlePlay;
  let googlePlay: StoreProof['googlePlay'];
  if (play) {
    googlePlay = { ratingCount: play.ratingCount, source: 'listing', fetchedAt: today };
    // An unchanged listing value keeps its date, so a scan that finds nothing new commits nothing.
    if (play.ratingCount === prevPlay.ratingCount && prevPlay.source === 'listing') {
      googlePlay.fetchedAt = prevPlay.fetchedAt;
    }
  } else if (playOverride !== null) {
    // An explicit --play N is greg confirming the Console figure today, even when it restates it.
    googlePlay = { ratingCount: playOverride, source: 'confirmed', fetchedAt: today };
  } else {
    googlePlay = { ...prevPlay };
  }

  const storefronts = byCountThenCode(entries);
  const prevApp = previous.appStore;
  const appUnchanged =
    rating === prevApp.rating && sameStorefronts(storefronts, prevApp.storefronts);

  return {
    next: {
      appStore: { rating, storefronts, fetchedAt: appUnchanged ? prevApp.fetchedAt : today },
      googlePlay,
    },
    carried: carriedFrom.map(([cc]) => cc),
    rating: decision,
  };
}
