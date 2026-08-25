/**
 * `youtube` mode — harvest every scrap of TEXT about a video (#72 phase 3).
 *
 * Greg's explicit direction: capture the full description, the title and channel, follow key
 * links, and give the model the highest possible chance — but stay inside the ADR-030
 * privacy boundary. Gemini (which can watch the video and read on-screen frames) and Whisper
 * (audio transcription) were both considered and REJECTED for exactly that reason. Do not
 * re-propose either; the boundary is the product, not an implementation detail.
 *
 * ACCEPTED GAP, recorded so nobody thinks it is an oversight: cooking channels routinely put
 * quantities on screen as text overlays and never say them aloud ("add the flour" while 250g
 * sits in the corner). A captions-only path misses those. That is the price of the boundary,
 * and it is why the model is told to MARK values it inferred rather than smooth them over.
 *
 * The pinned author comment is NOT fetched: YouTube loads comments through an async
 * continuation API, not the watch page, so it is unreachable without the Data API — a new
 * credential and a new cost line. Recorded as a future option, not attempted speculatively.
 */
import { guardedFetch } from '../guardedFetch.mjs';
import { decodeEntities } from '../entities.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION = 8000;
const MAX_CAPTIONS = 20_000;

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
 * Pull `ytInitialPlayerResponse` out of the watch page.
 *
 * It is assigned as `var ytInitialPlayerResponse = {…};` inline. Brace-matching rather than
 * a greedy regex, because the object contains strings full of braces and a lazy `\{.*?\}`
 * truncates it mid-object on most videos.
 */
export function extractPlayerResponse(html) {
  const marker = 'ytInitialPlayerResponse';
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at);
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Prefer a creator-provided track; fall back to the auto-generated (`asr`) one. */
export function pickCaptionTrack(player) {
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const human = tracks.find((t) => t?.kind !== 'asr' && t?.baseUrl);
  const auto = tracks.find((t) => t?.baseUrl);
  return human ?? auto ?? null;
}

/** YouTube's timedtext XML → plain text. */
export function captionsXmlToText(xml) {
  const out = [];
  const re = /<text[^>]*>([\s\S]*?)<\/text>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    // Strip markup BEFORE decoding, so a decoded `&lt;b&gt;` cannot become a live tag.
    const line = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim();
    if (line) out.push(line);
  }
  // Auto-captions carry no punctuation, so joining with spaces is the honest shape: the
  // model gets a continuous transcript rather than fake sentence boundaries we invented.
  return out.join(' ').slice(0, MAX_CAPTIONS);
}

export async function fetchYoutube(url) {
  const videoId = parseVideoId(url);
  if (!videoId) return { ok: false, code: 'bad_url' };

  const watch = await guardedFetch(`https://www.youtube.com/watch?v=${videoId}`, {
    maxBytes: MAX_BYTES,
  });
  if (!watch.ok) return watch;

  const html = watch.body.toString('utf8');
  const player = extractPlayerResponse(html);
  if (!player) return { ok: false, code: 'not_readable' };

  const details = player.videoDetails ?? {};
  const title = String(details.title ?? '').slice(0, 200);
  const channel = String(details.author ?? '').slice(0, 200);
  const description = String(details.shortDescription ?? '').slice(0, MAX_DESCRIPTION);

  let captions = null;
  const track = pickCaptionTrack(player);
  if (track?.baseUrl) {
    const cap = await guardedFetch(track.baseUrl, { maxBytes: MAX_BYTES });
    if (cap.ok) {
      const t = captionsXmlToText(cap.body.toString('utf8'));
      // null, never '' — "no captions" must be a distinct, testable state rather than
      // something the client has to infer from an empty string.
      captions = t.length > 0 ? t : null;
    }
  }

  return {
    ok: true,
    data: { videoId, title, channel, description, captions },
  };
}
