/* global process */
/**
 * `youtube` mode — get a recipe out of a video link (#72 phase 3).
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * This mode originally tried to read the video's CAPTIONS. That approach is dead, and not
 * only from AWS: measured from a residential connection, on a watch page with
 * `playabilityStatus: OK`, across two videos and three caption formats, every `timedtext`
 * fetch returns HTTP 200 with ZERO BYTES. YouTube now gates that endpoint behind a
 * proof-of-origin token. The original local test checked that a caption track was LISTED,
 * never that fetching it returned anything — so the feature shipped broken. Do not
 * reintroduce a captions path without first proving a non-empty body.
 *
 * The replacement is better than captions ever were. Recipe channels put the recipe on
 * their OWN SITE and link it from the description, so a reliable DESCRIPTION is worth more
 * than a transcript: the client's ladder follows that link and reads schema.org JSON-LD,
 * getting exact quantities — "¾ cup packed light brown sugar ((165g))" — with the model
 * never invoked. Captions at their theoretical best would have given an unpunctuated
 * transcript in which the creator says "add the flour" while 250g sits in an on-screen
 * overlay the audio never mentions. Structured data beats a transcript.
 *
 * SCOPE: this mode returns the video's TEXT and stops. Choosing what to do with it — follow
 * a description link, fall back to the description itself, or refuse — belongs to
 * `recipeSourceResolver` on the client, which already owns that ladder and its fetch budget.
 * Do not re-implement link-following here; two blocklists would drift apart.
 *
 * ADR-030 is unchanged and unchallenged. Gemini (watches frames) and Whisper (transcribes
 * audio) were REJECTED because they send user content outside the privacy boundary. Nothing
 * here revisits that — this path reads public text and hands it to the same managed model.
 *
 * TWO WAYS IN, IN ORDER — and the ordering is the product of a measurement, not a guess.
 *
 *  1. The official Data API (`videos.list`), when `YOUTUBE_API_KEY` is set. Keyed Google
 *     endpoint, serves datacenter traffic by design, 1 quota unit per video against a free
 *     10,000/day. This is the reliable path.
 *  2. InnerTube's player endpoint, as the no-credential fallback.
 *
 * InnerTube was tried FIRST and demoted on evidence. It works perfectly from a residential
 * connection — verified through this very `guardedFetch`, returning the full 992-character
 * description — and returns `video_blocked` from Lambda. YouTube refuses the AWS egress IP
 * for the player endpoint exactly as it does for the watch page. It stays as a fallback
 * because it costs nothing and would keep working if the key were ever missing, but do not
 * expect it to succeed in production.
 *
 * `playabilityStatus` is deliberately not a gate on either path: a blocked request reports
 * `UNPLAYABLE` while STILL carrying the title and description, and the original code checked
 * it FIRST and returned `not_found` on a payload that had everything we needed in it.
 */
import { guardedFetch } from '../guardedFetch.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION = 8000;

/** Optional. Absent = InnerTube only, which in production means "blocked". */
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

/** Accept every common YouTube URL shape; return the 11-char id or ''. */
export function parseVideoId(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return '';
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const id = (v) => (/^[A-Za-z0-9_-]{11}$/.test(v || '') ? v : '');
  if (host === 'youtu.be') return id(u.pathname.slice(1).split('/')[0]);
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return '';
  if (u.pathname === '/watch') return id(u.searchParams.get('v') || '');
  const m = /^\/(?:embed|v|shorts|live)\/([^/?]+)/.exec(u.pathname);
  return m ? id(m[1]) : '';
}

/**
 * Ask the official Data API for the video's snippet.
 *
 * `part=snippet` is all we need and is the cheapest useful call: 1 unit. The key is
 * URL-encoded into the query because that is the only shape the endpoint accepts; it is a
 * browser-key-class secret, never logged, and the response is public data either way.
 */
async function fetchDataApi(videoId, budgetMs) {
  if (!YOUTUBE_API_KEY) return null;

  const url =
    'https://www.googleapis.com/youtube/v3/videos' +
    `?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;

  const res = await guardedFetch(url, { maxBytes: MAX_BYTES, totalBudgetMs: budgetMs });
  if (!res.ok) {
    // NOT the same as "no key configured", which is what returning null used to mean.
    //
    // The Data API is THE production path, so its own failure is the most likely real outage
    // of this feature — and the day the free quota runs out, EVERY capture fails while
    // CloudWatch shows `resolved=video_blocked via=innertube`, the exact line the header
    // says to expect as normal. Nobody would ever find it. `site_refused` covers both 403
    // (key revoked/restricted) and 429 (quota), so the log names the class explicitly and
    // alerting has something to match on.
    console.error(
      `[youtube] data-api FAILED code=${res.code} — key invalid, quota exhausted or blocked`
    );
    return { apiFailed: true };
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body.toString('utf8'));
  } catch {
    console.error('[youtube] data-api returned unparseable json');
    return { apiFailed: true };
  }

  const snippet = parsed?.items?.[0]?.snippet;
  if (!snippet?.title) {
    // An empty `items` means the id is genuinely gone — a real not_found, distinct from a
    // block. Signalled by the empty object so the caller can tell the two apart.
    console.warn(`[youtube] data-api no items (deleted or private) items=${parsed?.items?.length}`);
    return { missing: true };
  }
  return {
    title: String(snippet.title).slice(0, 200),
    channel: String(snippet.channelTitle ?? '').slice(0, 200),
    description: String(snippet.description ?? '').slice(0, MAX_DESCRIPTION),
  };
}

/**
 * Ask InnerTube for the video's metadata.
 *
 * This is a plain public JSON endpoint — no credential, no quota, no cost line. It answers
 * datacenter IPs that the watch page refuses. `contentCheckOk`/`racyCheckOk` stop it
 * withholding details behind an age-gate interstitial.
 */
async function fetchInnertube(videoId, budgetMs) {
  const body = JSON.stringify({
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: {
      client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' },
    },
  });

  const res = await guardedFetch('https://www.youtube.com/youtubei/v1/player', {
    maxBytes: MAX_BYTES,
    totalBudgetMs: budgetMs,
    post: { body, headers: { 'content-type': 'application/json' } },
  });
  if (!res.ok) {
    console.warn(`[youtube] innertube fetch failed code=${res.code}`);
    return null;
  }

  try {
    return JSON.parse(res.body.toString('utf8'));
  } catch {
    // Never silent: this is a DIFFERENT failure from "the request never landed", and
    // conflating the two is what made the first YouTube outage need a local repro.
    console.warn('[youtube] innertube returned unparseable json');
    return null;
  }
}

/**
 * Turn a player response into the fields we care about, or null when it carries none.
 *
 * `playabilityStatus` is deliberately NOT consulted. A blocked request reports UNPLAYABLE
 * and still includes the full description; treating that as "video not found" was the bug
 * that made every YouTube link fail with "the page may have moved" about a video sitting
 * right there in the user's browser.
 */
export function readVideoDetails(player) {
  const d = player?.videoDetails;
  if (!d || !d.title) return null;
  return {
    title: String(d.title).slice(0, 200),
    channel: String(d.author ?? '').slice(0, 200),
    // By code point, not UTF-16 unit: emoji are ubiquitous in video descriptions and a
    // raw .slice() can cut one in half, leaving a lone surrogate that is invalid UTF-8 by
    // the time it reaches the model or the log.
    description: [...String(d.shortDescription ?? '')].slice(0, MAX_DESCRIPTION).join(''),
  };
}

/** Tell "YouTube refused us" apart from "this video is genuinely gone". */
function classifyEmpty(player) {
  const status = player?.playabilityStatus?.status ?? '';
  const reason = String(player?.playabilityStatus?.reason ?? '').toLowerCase();
  if (status === 'LOGIN_REQUIRED' || reason.includes('bot') || reason.includes('sign in')) {
    return 'video_blocked';
  }
  // Only a reason that NAMES the video's absence is a not_found. `UNPLAYABLE` on its own is
  // what a region-locked or age-gated video reports — and what this file's own header
  // documents as the shape a BLOCKED request comes back in — so mapping it to not_found told
  // the user "the page may have moved" about a video that is sitting right there.
  if (
    reason.includes('unavailable') ||
    reason.includes('removed') ||
    reason.includes('private') ||
    reason.includes('deleted') ||
    reason.includes('terminated')
  ) {
    return 'not_found';
  }
  return 'video_blocked';
}

export async function fetchYoutube(url) {
  const videoId = parseVideoId(url);
  if (!videoId) return { ok: false, code: 'bad_url' };

  // ONE deadline across both paths. Two independent 6s budgets can total 12s inside a 15s
  // Lambda, and the invocation dies mid-flight as a raw CORS-less 502 outside the typed
  // taxonomy — the failure the budgets exist to prevent.
  const deadline = Date.now() + 10_000;
  const left = () => Math.max(500, deadline - Date.now());

  // Path 1 — the official API, when configured.
  const api = await fetchDataApi(videoId, left());
  if (api?.apiFailed) {
    // Its own outage, not YouTube refusing this video. Do NOT fall through to InnerTube: it
    // is blocked from AWS, so it would only relabel an API outage as a video problem.
    return { ok: false, code: 'site_refused' };
  }
  if (api?.missing) {
    console.warn(`[youtube] resolved=not_found via=data_api id_len=${videoId.length}`);
    return { ok: false, code: 'not_found' };
  }
  if (api) {
    console.info(`[youtube] resolved=ok via=data_api desc_chars=${api.description.length}`);
    return { ok: true, data: { videoId, ...api } };
  }

  // Path 2 — InnerTube. Expected to be blocked in production; see the header.
  const player = await fetchInnertube(videoId, left());
  if (!player) {
    // THE observability gap this closes: the old code returned `video_blocked` for both
    // "the request never landed" and "it landed but carried nothing", so a CloudWatch line
    // could not tell a network block from an empty payload — which is exactly the question
    // that mattered when every YouTube capture started failing.
    console.warn('[youtube] resolved=video_blocked via=innertube reason=fetch_failed');
    return { ok: false, code: 'video_blocked' };
  }

  const details = readVideoDetails(player);
  if (!details) {
    const code = classifyEmpty(player);
    console.warn(
      `[youtube] resolved=${code} via=innertube reason=no_details ` +
        `playability=${player?.playabilityStatus?.status ?? 'none'}`
    );
    return { ok: false, code };
  }

  console.info(`[youtube] resolved=ok via=innertube desc_chars=${details.description.length}`);
  return {
    ok: true,
    data: {
      videoId,
      title: details.title,
      channel: details.channel,
      description: details.description,
    },
  };
}
