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
 * WHY INNERTUBE RATHER THAN THE WATCH PAGE: YouTube serves a bot check to datacenter IPs, so
 * the watch page is unreadable from Lambda. The InnerTube player endpoint still answers, and
 * still returns `videoDetails` — title and full description — even when it reports
 * `UNPLAYABLE`. That last part is the crux: the old code checked `playabilityStatus` FIRST
 * and returned `not_found` on a payload that had the description sitting right there in it.
 */
import { guardedFetch } from '../guardedFetch.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION = 8000;

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
 * Ask InnerTube for the video's metadata.
 *
 * This is a plain public JSON endpoint — no credential, no quota, no cost line. It answers
 * datacenter IPs that the watch page refuses. `contentCheckOk`/`racyCheckOk` stop it
 * withholding details behind an age-gate interstitial.
 */
async function fetchInnertube(videoId) {
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
    totalBudgetMs: 6000,
    post: { body, headers: { 'content-type': 'application/json' } },
  });
  if (!res.ok) return null;

  try {
    return JSON.parse(res.body.toString('utf8'));
  } catch {
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
    description: String(d.shortDescription ?? '').slice(0, MAX_DESCRIPTION),
  };
}

/** Tell "YouTube refused us" apart from "this video is genuinely gone". */
function classifyEmpty(player) {
  const status = player?.playabilityStatus?.status ?? '';
  const reason = String(player?.playabilityStatus?.reason ?? '').toLowerCase();
  if (status === 'LOGIN_REQUIRED' || reason.includes('bot') || reason.includes('sign in')) {
    return 'video_blocked';
  }
  // A real deletion or a private video says so with no details attached.
  if (status === 'ERROR' || status === 'UNPLAYABLE') return 'not_found';
  return 'video_blocked';
}

export async function fetchYoutube(url) {
  const videoId = parseVideoId(url);
  if (!videoId) return { ok: false, code: 'bad_url' };

  const player = await fetchInnertube(videoId);
  if (!player) return { ok: false, code: 'video_blocked' };

  const details = readVideoDetails(player);
  if (!details) return { ok: false, code: classifyEmpty(player) };

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
