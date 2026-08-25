/**
 * Pure URL routing for recipe capture (#72). No network, no Vue — trivially unit-testable.
 *
 * Built on the EXISTING `utils/url` helpers rather than re-deriving anything: `extractUrls`
 * already knows how to find links in prose (including bare domains, with a false-positive
 * list for things like `file.vue`), and re-implementing that here — or worse, in the
 * Lambda's `.mjs` where it could drift — would duplicate shipped, tested code.
 */
import { extractUrls, safeHttpsUrl } from '@/utils/url';

/** Where a pasted URL should be sent. */
export type RecipeUrlRoute =
  | { kind: 'youtube'; url: string; videoId: string }
  | { kind: 'page'; url: string }
  | { kind: 'invalid' };

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/**
 * Sites that will never hold a recipe, so following one wastes the capture's fetch budget.
 *
 * Matched on the SITE LABEL (`amazon` out of `www.amazon.co.uk`) rather than the exact
 * hostname. The exact-host list this replaced blocked `amazon.com` but sailed straight past
 * `amazon.co.uk`, `bookshop.org`, `barnesandnoble.com` and `a.co` — every one of which
 * appears in the description of the very video used to test this. That only stayed invisible
 * because the recipe link happened to be listed first; a creator who leads with their book
 * would have burnt the whole budget on a shop page.
 *
 * A blocklist, not an allowlist, on purpose: an allowlist would have to enumerate every food
 * blog on the internet and would silently fail on the long tail, which is most of them.
 */
const NEVER_A_RECIPE_LABELS = new Set([
  // Video and social
  'youtube',
  'youtu',
  'instagram',
  'facebook',
  'twitter',
  'tiktok',
  'pinterest',
  'threads',
  'reddit',
  'linkedin',
  'snapchat',
  // Shops — where the cookbook lives, not the recipe
  'amazon',
  'amzn',
  'bookshop',
  'barnesandnoble',
  'booksamillion',
  'waterstones',
  'target',
  'walmart',
  'ebay',
  'etsy',
  // Support and link aggregators
  'patreon',
  'paypal',
  'venmo',
  'ko-fi',
  'buymeacoffee',
  'linktr',
  'beacons',
  'discord',
  'spotify',
]);

/** Whole hosts with no useful label (shorteners, and Amazon's one-letter domain). */
const NEVER_A_RECIPE_HOSTS = new Set([
  'a.co',
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'rb.gy',
  'shorturl.at',
]);

function isNeverARecipe(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (NEVER_A_RECIPE_HOSTS.has(host)) return true;
  // Every label, not just the registrable one: `amazon.co.uk` registers as `co`, so keying
  // on the second-to-last label alone would let the biggest shop on the list through.
  return host.split('.').some((label) => NEVER_A_RECIPE_LABELS.has(label));
}

export function parseYoutubeVideoId(url: URL): string {
  const host = url.hostname.toLowerCase();
  const ok = (v: string | null) => (v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : '');
  if (host === 'youtu.be' || host === 'www.youtu.be')
    return ok(url.pathname.slice(1).split('/')[0]);
  if (url.pathname === '/watch') return ok(url.searchParams.get('v'));
  const m = /^\/(?:embed|v|shorts|live)\/([^/?]+)/.exec(url.pathname);
  return m ? ok(m[1]) : '';
}

/**
 * Decide where a pasted string goes. Screened with `safeHttpsUrl` first, so a
 * `javascript:` or `http:` value can never reach the fetch service at all.
 */
export function routeUrl(raw: string): RecipeUrlRoute {
  const safe = safeHttpsUrl(raw);
  if (!safe) return { kind: 'invalid' };
  let url: URL;
  try {
    url = new URL(safe);
  } catch {
    return { kind: 'invalid' };
  }
  // A hostname with no dot is not a public site — `hello` would otherwise be normalized to
  // `https://hello` and sent to the fetcher, which can only ever fail. Refusing here gives
  // the user "that needs to be a web address" instead of a confusing network error.
  if (!url.hostname.includes('.')) return { kind: 'invalid' };
  if (YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    const videoId = parseYoutubeVideoId(url);
    // A YouTube URL with no readable video id (a channel or playlist page) is not
    // something we can read — say so rather than fetching a page that has no recipe.
    return videoId ? { kind: 'youtube', url: safe, videoId } : { kind: 'invalid' };
  }
  return { kind: 'page', url: safe };
}

/**
 * Find plausible recipe links inside a video's description.
 *
 * This is rung 1 of the YouTube ladder and the one that produces the BEST result: most food
 * channels post the full recipe on their own blog, so following the link yields exact
 * quantities from schema.org markup with no inference at all.
 *
 * Filters out hosts that are never a recipe (socials, affiliates, shorteners) and bare
 * homepages with no path, because a channel's "follow me" links would otherwise burn the
 * per-capture fetch budget before the real link is reached.
 */
export function pickRecipeLinks(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const candidate of extractUrls(text)) {
    const safe = safeHttpsUrl(candidate);
    if (!safe) continue;
    let url: URL;
    try {
      url = new URL(safe);
    } catch {
      continue;
    }
    if (isNeverARecipe(url.hostname)) continue;
    // A bare domain with no path is a homepage, not a recipe.
    if (url.pathname === '/' || url.pathname === '') continue;
    if (!out.includes(safe)) out.push(safe);
  }
  return out;
}
