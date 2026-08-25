/**
 * `image` mode — fetch a dish photo and return it as a data URL for the client to store (#72).
 *
 * Exists because the browser CANNOT do this: reading a cross-origin image's bytes is blocked
 * by CORS, and an opaque no-cors response cannot be turned into a Blob we can persist. And
 * we must persist it — hot-linking would fire a third-party request from every family
 * device on every render, which is precisely the local-first posture we are protecting.
 *
 * The URL reaching here is attacker-influenceable: it comes either from a model reading an
 * untrusted page, or from that page's own JSON-LD. So the bytes are sniffed, not trusted.
 */
import { guardedFetch } from '../guardedFetch.mjs';

/** 1.5 MB DECODED. Base64 inflates ~1.33x, keeping the response under the 6 MB URL ceiling. */
const MAX_BYTES = 1.5 * 1024 * 1024;

/**
 * Magic-number sniffing, because Content-Type is attacker-controlled.
 *
 * SVG is the one that matters: it is an image by content-type but a script container by
 * capability, and `usePhotos` would let it through — its accept test ORs the FILENAME
 * extension, so `image/svg+xml` named `dish.jpg` passes. Sniffing here is what stops it.
 */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export async function fetchImage(url) {
  const res = await guardedFetch(url, { maxBytes: MAX_BYTES });
  if (!res.ok) return res;

  // BOTH checks. The header alone is attacker-controlled; the bytes alone would accept an
  // image served with a lying content-type from a host that only meant to serve HTML.
  // `image/jpg` is not the registered type but plenty of older hosts send it; rejecting on
  // the header alone would drop valid JPEGs whose BYTES we are about to verify anyway.
  if (!/^image\/(jpeg|jpg|png|webp)\b/i.test(res.contentType)) {
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
