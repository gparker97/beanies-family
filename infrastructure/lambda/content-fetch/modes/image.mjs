/**
 * `image` mode — fetch a dish photo and return it as a data URL for the client to store (#72).
 *
 * Exists because the browser CANNOT do this: reading a cross-origin image's bytes is blocked
 * by CORS, and an opaque no-cors response cannot be turned into a Blob we can persist. And
 * we must persist it — hot-linking would fire a third-party request from every family
 * device on every render, which is precisely the local-first posture we are protecting.
 *
 * The URL reaching here is attacker-influenceable: it comes from a page we fetched but do not
 * trust. So the bytes are sniffed, not trusted.
 */
import { guardedFetch } from '../guardedFetch.mjs';

/**
 * 3 MB DECODED. Base64 inflates ~1.33x, so this is ~4.0 MB encoded, leaving ~2 MB of headroom
 * under the 6 MB Lambda response ceiling for the JSON envelope.
 *
 * Raised from 1.5 MB in #86, where full-resolution hero JPEGs from recipe blogs were routinely
 * rejected as `too_large`. It is a RESOLUTION budget, not a quality one: the client re-encodes
 * everything to JPEG in `photoCompression` before storing, so a bigger cap buys pixels rather
 * than fidelity. Do not raise it further without recomputing against the 6 MB ceiling.
 */
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Wall-clock budget for an image fetch, raised with the byte cap.
 *
 * The default is 9s and covers DNS, connect, TLS and up to three redirect hops as well as the
 * body — so 3MB inside what remains needs a sustained ~3 Mbps from the origin. Doubling the
 * size cap without this meant the full-resolution heroes the raise was written to rescue were
 * precisely the ones that could not arrive in time: they would hold one of five reserved
 * concurrency slots for the full budget and then return `timeout` instead of the photo.
 * 12s still sits inside the function's own 15s timeout.
 */
const IMAGE_BUDGET_MS = 12_000;

/**
 * Formats we accept, as ONE table so the header test and the byte sniffer cannot drift apart.
 *
 * AVIF and GIF were added in #86. AVIF matters most: it is now the default output of
 * Cloudflare Images, the Next.js image optimizer and several WordPress plugins, so rejecting
 * it silently cost the dish photo on a growing share of modern recipe sites — while
 * `guardedFetch` had been advertising `image/avif` in its own Accept header all along.
 *
 * SVG is still rejected, and the reason is unchanged: it is an image by content-type but a
 * script container by capability, and `usePhotos`' accept test ORs the FILENAME extension, so
 * `image/svg+xml` named `dish.jpg` would pass. Sniffing here is what stops it.
 */
const ACCEPTED = Object.freeze([
  { mime: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    matches: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    matches: (b) => tag(b, 0, 4) === 'RIFF' && tag(b, 8, 12) === 'WEBP',
  },
  {
    // ISO-BMFF: bytes 4-8 are the 'ftyp' box type, 8-12 the major brand. `avif` is a still
    // image, `avis` an image sequence.
    //
    // `mif1` is deliberately NOT accepted. It is the generic HEIF-family brand, so an Apple
    // HEIC matches it too — and since the sniffed mime is what NAMES the file, a HEIC would
    // be stored as `dish-<id>.avif`, a filename that lies about its contents to every later
    // reader. HEIC already has its own accepted type on the client; an AVIF whose major brand
    // is `mif1` (rare) simply falls through to the next ladder rung.
    mime: 'image/avif',
    matches: (b) =>
      tag(b, 4, 8) === 'ftyp' && (tag(b, 8, 12) === 'avif' || tag(b, 8, 12) === 'avis'),
  },
  {
    // An animated GIF is stored as its FIRST FRAME — the client re-encodes to JPEG. That is
    // correct for a dish photo and is not a bug.
    mime: 'image/gif',
    matches: (b) => tag(b, 0, 6) === 'GIF87a' || tag(b, 0, 6) === 'GIF89a',
  },
]);

/**
 * Read a fixed-width byte tag as text, byte-for-byte.
 *
 * ⚠️ `latin1`, NEVER `ascii`. Node's 'ascii' decoder MASKS THE HIGH BIT, so
 * `Buffer.from([0xD2,0xC9,0xC6,0xC6]).toString('ascii')` is `'RIFF'` — every string-based
 * magic-number check written that way matches 2^N byte sequences instead of the one it names,
 * which turns the control documented above as "what stops SVG" into a sieve. `latin1` maps
 * each byte to the code point of the same value and is a drop-in fix.
 */
function tag(buf, start, end) {
  return buf.toString('latin1', start, end);
}

/**
 * The header test, DERIVED from ACCEPTED rather than hand-maintained beside it.
 *
 * Two lists under a comment promising they cannot drift is how they drift. `image/jpg` is not
 * the registered type but plenty of older hosts send it, so it is the one manual addition.
 */
// The pattern is built from the module-level ACCEPTED constant plus one literal and is
// evaluated once at module load. No request data reaches it, so there is no ReDoS surface
// for an attacker to steer.
// eslint-disable-next-line security/detect-non-literal-regexp
const CONTENT_TYPE_RE = new RegExp(
  `^(?:${[...ACCEPTED.map((a) => a.mime), 'image/jpg'].join('|').replace(/\//g, '\\/')})\\b`,
  'i'
);

/**
 * Magic-number sniffing, because Content-Type is attacker-controlled.
 */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  for (const { mime, matches } of ACCEPTED) {
    if (matches(buf)) return mime;
  }
  return null;
}

/**
 * @param {string} url            the image to fetch
 * @param {{pageUrl?: string}} [opts]  the page the URL was found on, sent as `Referer` (#86)
 */
export async function fetchImage(url, opts = {}) {
  const res = await guardedFetch(url, {
    maxBytes: MAX_BYTES,
    totalBudgetMs: IMAGE_BUDGET_MS,
    asImage: true,
    referer: opts.pageUrl,
  });
  if (!res.ok) return res;

  // BOTH checks. The header alone is attacker-controlled; the bytes alone would accept an
  // image served with a lying content-type from a host that only meant to serve HTML.
  if (!CONTENT_TYPE_RE.test(res.contentType)) {
    return { ok: false, code: 'not_image' };
  }
  const sniffed = sniffImageType(res.body);
  if (!sniffed) return { ok: false, code: 'not_image' };

  return {
    ok: true,
    data: {
      // The client names the File from THIS, never from the URL — a filename taken from an
      // attacker-supplied path is how an svg ends up called .jpg.
      mime: sniffed,
      dataUrl: `data:${sniffed};base64,${res.body.toString('base64')}`,
    },
  };
}
