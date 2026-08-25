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

/** Hosts that will never be a recipe page, so following them wastes the call budget. */
const NEVER_A_RECIPE = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'instagram.com',
  'www.instagram.com',
  'facebook.com',
  'www.facebook.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'www.tiktok.com',
  'pinterest.com',
  'www.pinterest.com',
  'patreon.com',
  'www.patreon.com',
  'amazon.com',
  'www.amazon.com',
  'amzn.to',
  'bit.ly',
  'tinyurl.com',
  't.co',
  'linktr.ee',
]);

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
    const host = url.hostname.toLowerCase();
    if (NEVER_A_RECIPE.has(host)) continue;
    // A bare domain with no path is a homepage, not a recipe.
    if (url.pathname === '/' || url.pathname === '') continue;
    if (!out.includes(safe)) out.push(safe);
  }
  return out;
}
