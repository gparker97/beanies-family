/**
 * `page` mode — fetch a recipe URL once, generically. No per-site scrapers (#72).
 *
 * Two outcomes, and the order matters:
 *   1. schema.org/Recipe JSON-LD → exact ingredients/steps/times, model NEVER invoked.
 *   2. otherwise → the page reduced to readable text, handed to the model as a fallback.
 *
 * Returning `{ok:false, code}` rather than throwing keeps the dispatcher a pure mapping.
 */
import { asciiLower } from '../asciiLower.mjs';
import { guardedFetch, screenUrl } from '../guardedFetch.mjs';
import { extractRecipeFromHtml } from '../recipeJsonLd.mjs';
import { decodeEntities } from '../entities.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
/** Cap handed to the model. Comfortably under ai-extract's 32k hard limit. */
export const MAX_TEXT_CHARS = 24_000;
/** Below this, the "page" is a cookie wall or a JS shell — refuse rather than prompt on noise. */
const MIN_USEFUL_CHARS = 200;

/**
 * Strip a tag and its contents entirely (script/style/nav/etc).
 *
 * Written as a LINEAR scan, not a regex, for two reasons that both matter:
 *
 *  1. DoS. `<tag\b[^>]*>[\s\S]*?</tag>` is O(n²) when the closing tag is missing: the lazy
 *     quantifier re-scans the tail from every opening position. Measured: 64KB → 211ms,
 *     512KB → 13.6s. `htmlToText` runs this seven times and the body cap is 2MB, so
 *     `'<script>'.repeat(65536)` — about 2KB gzipped on the wire — burned the entire 15s
 *     Lambda timeout on a publicly-callable endpoint. This scan is O(n) regardless.
 *  2. `new RegExp(interpolated)` trips the security lint (rightly — it is how a caller's
 *     string becomes a pattern), and the whole `security:full` gate is CI-blocking.
 */
function dropTag(html, tag) {
  const open = `<${tag}`;
  const close = `</${tag}`;
  const lower = asciiLower(html);
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = lower.indexOf(open, cursor);
    if (start === -1) break;
    // Must be a real tag boundary: `<script` matches, `<scriptfoo` does not.
    const after = lower[start + open.length];
    if (
      after !== undefined &&
      after !== '>' &&
      after !== ' ' &&
      after !== '\t' &&
      after !== '\n' &&
      after !== '/'
    ) {
      out += html.slice(cursor, start + open.length);
      cursor = start + open.length;
      continue;
    }
    const end = lower.indexOf(close, start);
    out += html.slice(cursor, start) + ' ';
    if (end === -1) {
      // Unclosed marker: SKIP THE OPENING TAG AND CARRY ON, do not drop the rest.
      //
      // The comment here used to claim this matched the regex's intent. It is the opposite:
      // `/<script[\s\S]*?<\/script>/` finds no match on an unterminated tag and therefore
      // removes NOTHING, leaving the document intact. Truncating instead means one stray
      // `<!--` — or a legal HTML5 `<!-->` — silently deletes everything after it, which on a
      // recipe page is usually the entire method section.
      cursor = start + open.length;
      continue;
    }
    const gt = html.indexOf('>', end);
    cursor = gt === -1 ? html.length : gt + 1;
  }
  return out + html.slice(cursor);
}

/**
 * Remove every `open…close` span. Linear, unlike `/<!--[\s\S]*?-->/g`, whose lazy tail
 * re-scans from every opening position: `'<!--'.repeat(n)` measured 256KB → 13.8s.
 */
function stripBetween(text, open, close) {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(open, cursor);
    if (start === -1) return out + text.slice(cursor);
    out += text.slice(cursor, start) + ' ';
    const end = text.indexOf(close, start + open.length);
    if (end === -1) return out; // unterminated — drop the rest, as the regex intended
    cursor = end + close.length;
  }
}

/**
 * Strip every `<…>` tag. Linear, unlike `/<[^>]+>/g`, where `[^>]+` backtracks from every
 * `<` when no `>` follows: `'<'.repeat(n)` measured 64KB → 4.1s, 128KB → 16.6s.
 */
function stripTags(text) {
  let out = '';
  let cursor = 0;
  for (;;) {
    const lt = text.indexOf('<', cursor);
    if (lt === -1) return out + text.slice(cursor);
    out += text.slice(cursor, lt) + ' ';
    const gt = text.indexOf('>', lt);
    if (gt === -1) return out; // unterminated tag — drop the rest
    cursor = gt + 1;
  }
}

/**
 * Find one tag's attribute value by a QUOTED key. Linear scan — see dropTag on why not regex.
 *
 * ⚠️ `lower` is a PARAMETER, not computed here, and that is load-bearing. `asciiLower` is a
 * whole-string replace over a body capped at 2MB; the image ladder calls this six times, so
 * computing it internally would lowercase 12MB per page. `collectImageCandidates` computes it
 * once and passes it down. Do not "simplify" this back.
 *
 * ⚠️ The key is matched WITH ITS QUOTES (`"og:image"`, not `og:image`). That is what stops the
 * `og:image` rung also matching `property="og:image:secure_url"` and collapsing two ladder
 * rungs into one. Every row of IMAGE_LADDER depends on it; asserted in the tests.
 */
export function findTagAttr(html, lower, tagOpen, key, attr) {
  const needle = `"${key}"`;
  const alt = `'${key}'`;
  let cursor = 0;
  for (;;) {
    const at = lower.indexOf(tagOpen, cursor);
    if (at === -1) return '';
    const end = lower.indexOf('>', at);
    if (end === -1) return '';
    // ⚠️ SLICE THE LOWERED STRING, never `tag.toLowerCase()`. Full Unicode lowercasing is NOT
    // length-preserving — U+0130 (İ, ordinary on Turkish recipe sites) becomes two UTF-16
    // units — so an offset found in a `toLowerCase()`d copy indexes one character off in the
    // original, the quote guard below fails, and the rung silently returns ''. That is the
    // exact hazard `asciiLower.mjs` exists to prevent, and its docblock records this class
    // already costing a page its whole JSON-LD recipe once. `lower` is ascii-only and
    // index-safe by construction, which is the other reason it is a parameter.
    const tag = html.slice(at, end);
    const tagLower = lower.slice(at, end);
    if (tagLower.includes(needle) || tagLower.includes(alt)) {
      const value = readAttr(tag, tagLower, attr);
      // A MATCH WITH AN EMPTY VALUE IS NOT AN ANSWER — keep scanning. WordPress food blogs
      // routinely emit two `og:image` tags (the theme's and the SEO plugin's) and the first
      // is often blank; returning '' here reported "the page declared no image" while the
      // real hero sat in the very next tag.
      if (value) return value;
    }
    cursor = end + 1;
  }
}

/**
 * Read `attr`'s quoted value out of one tag, matching the attribute NAME at a real boundary.
 *
 * The boundary check is the point. A bare `indexOf('content=')` also matches `data-content=`,
 * so `<meta property="og:image" data-content="junk" content="…hero.jpg">` returned `junk` —
 * which `absolutize` then laundered into a plausible same-origin URL that `screenUrl` cannot
 * reject, shipping as candidate #1 and burning one of only three client fetch attempts while
 * the real hero went unread. The quoted-needle defence was applied to the key but not to the
 * attribute; this closes the other half.
 */
function readAttr(tag, tagLower, attr) {
  let from = 0;
  for (;;) {
    const ci = tagLower.indexOf(attr, from);
    if (ci === -1) return '';
    const before = ci === 0 ? ' ' : tagLower[ci - 1];
    // Only whitespace or a closing quote may precede an attribute name.
    if (before === ' ' || before === '\t' || before === '\n' || before === '\r' || before === '/') {
      const valueAt = ci + attr.length;
      const q = tag[valueAt];
      if (q === '"' || q === "'") {
        const close = tag.indexOf(q, valueAt + 1);
        if (close !== -1) return tag.slice(valueAt + 1, close);
      }
    }
    from = ci + attr.length;
  }
}

/**
 * Find one meta tag's content by property/name.
 *
 * ⚠️ NO PRODUCTION CALLER since #86 — the ladder goes through `findTagAttr` with a `lower`
 * computed once. Retained because it is the narrow, well-tested surface those tests exercise,
 * but note it lowercases the WHOLE (up to 2MB) body on every call: reintroducing it in a hot
 * path is how the ladder would silently start costing ~150ms of Lambda CPU per rung.
 */
export function findMeta(html, key) {
  return findTagAttr(html, asciiLower(html), '<meta', key, 'content=');
}

/**
 * Reduce HTML to readable text. Deliberately crude — this is the FALLBACK path, and a
 * heavier DOM parser would be a dependency and an attack surface for a result the model
 * only needs to read approximately. Structure is preserved as line breaks so ingredient
 * lists do not collapse into one run-on paragraph.
 */
export function htmlToText(html) {
  let s = html;
  for (const tag of ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'svg', 'form']) {
    s = dropTag(s, tag);
  }
  s = stripBetween(s, '<!--', '-->');
  // Block-level boundaries become newlines BEFORE tags are stripped, so list items and
  // paragraphs stay on separate lines.
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*\/?>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.replace(/[ \t\u00a0]+/g, ' '); // includes NBSP, written as an escape
  s = s.replace(/\n\s*\n\s*\n+/g, '\n\n');
  s = s
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
  return s.slice(0, MAX_TEXT_CHARS);
}

/**
 * Read a meta tag's content, DECODED.
 *
 * The decode is load-bearing, not tidiness: every escaping HTML generator (WordPress/Yoast,
 * Next.js image URLs) writes `&amp;` in attribute values, so a CDN-resized og:image arrives
 * as `...?url=%2Fdish.jpg&amp;w=1200`. Fetched literally, the CDN sees params named `amp;w`
 * and returns a 404 or a non-image — so the dish photo silently never attaches, with only an
 * `attach_failed` info log to show for it. This is the common case, not an exotic one.
 */
function metaContent(html, lower, property) {
  return decodeEntities(findTagAttr(html, lower, '<meta', property, 'content=')).trim();
}

/**
 * Resolve a possibly-relative URL against the page it came from.
 *
 * Root-relative `og:image` (`/images/dish.jpg`) is what most CMSes emit. Left unresolved it
 * reaches `safeHttpsUrl`, which treats anything without `://` as a bare domain and FABRICATES
 * `https://images/dish.jpg` — a screening function inventing a hostname it cannot vouch for
 * and handing it to the SSRF fetcher. Resolving here means the screen sees a real URL or
 * nothing at all.
 */
function absolutize(raw, base) {
  if (!raw) return '';
  try {
    return new URL(raw, base).toString();
  } catch {
    return '';
  }
}

/**
 * The dish-image ladder, in preference order (#86).
 *
 * Every rung here is AUTHOR-DECLARED: a tag whose entire purpose is "this is the picture for
 * this page". That is why none of them needs an AI relevance check — the page's own canonical
 * image, on a page the user deliberately chose, is not a guess. The deferred in-body `<img>`
 * rung would be a guess, which is exactly why it is gated differently (see the plan's
 * Appendix A).
 *
 * Order matters and is not arbitrary: structured data first (a publisher stating the recipe's
 * image), then Open Graph (stated for sharing, near-universal on food blogs), then Twitter,
 * then the legacy `link rel`, then the JSON-LD thumbnail — which is last because it is
 * routinely a cropped square.
 */
const IMAGE_LADDER = Object.freeze([
  { source: 'jsonld', read: (_h, _l, jsonld) => jsonld?.imageUrl ?? '' },
  { source: 'og_image', read: (h, l) => metaContent(h, l, 'og:image') },
  { source: 'og_secure', read: (h, l) => metaContent(h, l, 'og:image:secure_url') },
  { source: 'twitter', read: (h, l) => metaContent(h, l, 'twitter:image') },
  { source: 'twitter_src', read: (h, l) => metaContent(h, l, 'twitter:image:src') },
  {
    source: 'link_rel',
    read: (h, l) => decodeEntities(findTagAttr(h, l, '<link', 'image_src', 'href=')).trim(),
  },
  { source: 'thumbnail', read: (_h, _l, jsonld) => jsonld?.thumbnailUrl ?? '' },
]);

/** At most this many candidates cross the wire; the client tries a smaller number still. */
const MAX_IMAGE_CANDIDATES = 5;

/**
 * Collect the page's declared images, best first, absolutised, deduped and pre-screened.
 *
 * PRE-SCREENING IS NOT THE AUTHORISATION. `screenUrl` is synchronous and purely syntactic
 * (https, no credentials, port 443, length) — it does no DNS and no private-range test. The
 * real SSRF control is `resolvePublicAddress`, which still runs inside `guardedFetch` on every
 * candidate we actually fetch, on every redirect hop. Screening here only spares the client a
 * round trip for a URL that could never have been fetched. Do not read this as the check that
 * matters, and do not delete the one that does.
 */
export function collectImageCandidates(html, lower, finalUrl, jsonld) {
  const out = [];
  const seen = new Set();
  for (const rung of IMAGE_LADDER) {
    if (out.length >= MAX_IMAGE_CANDIDATES) break;
    const url = absolutize(rung.read(html, lower, jsonld), finalUrl);
    if (!url || seen.has(url)) continue;
    if (!screenUrl(url).ok) continue;
    seen.add(url);
    out.push({ url, source: rung.source });
  }
  return out;
}

export function pageTitle(html, lower = asciiLower(html)) {
  // Linear — `/<title[^>]*>([\s\S]*?)<\/title>/i` measured 420KB → 9.25s on
  // `'<title>'.repeat(n)` with no closing tag.
  //
  // `lower` is a parameter for the same reason it is on findTagAttr: `fetchPage` has already
  // lowercased the (up to 2MB) body, and recomputing it here cost ~150ms of Lambda CPU per
  // text-branch fetch for no benefit.
  const open = lower.indexOf('<title');
  if (open === -1) return '';
  const openEnd = lower.indexOf('>', open);
  if (openEnd === -1) return '';
  const close = lower.indexOf('</title', openEnd);
  if (close === -1) return '';
  return htmlToText(html.slice(openEnd + 1, close)).slice(0, 200);
}

export async function fetchPage(url) {
  const res = await guardedFetch(url, { maxBytes: MAX_BYTES });
  if (!res.ok) return res;

  // A PDF or image served at a "recipe URL" is not something this mode can read; say so
  // rather than handing the model a wall of binary noise.
  // FAIL CLOSED. The old `res.contentType && …` short-circuited when the header was absent
  // (trivial for an attacker, common from misconfigured CDNs), so a 2MB PDF or JPEG was
  // decoded as UTF-8 and 24k chars of mojibake were billed to the inference call. image.mjs
  // gets this right by testing the positive case; match it.
  if (!/text\/html|application\/xhtml|text\/plain/i.test(res.contentType)) {
    return { ok: false, code: 'not_readable' };
  }

  const html = res.body.toString('utf8');

  // Lowered ONCE for the whole ladder — see the warning on findTagAttr.
  const lower = asciiLower(html);
  const jsonld = extractRecipeFromHtml(html);

  // ⚠️ The JSON-LD branch must NOT return before this runs. It used to, and that was the
  // second-largest cause of missing dish photos (#86): a Recipe node carrying no `image` key
  // yielded nothing at all, while the page's own `og:image` sat in this very string. The
  // ladder reads both, so structured data and meta tags now cooperate instead of competing.
  const imageCandidates = collectImageCandidates(html, lower, res.finalUrl, jsonld);

  if (jsonld) {
    // Structured-data `image` is relative just as often as og:image is.
    jsonld.imageUrl = absolutize(jsonld.imageUrl, res.finalUrl);
    return {
      ok: true,
      data: {
        kind: 'jsonld',
        recipe: jsonld,
        imageCandidates,
        // COMPATIBILITY SHIM, one release only. A client built before #86 reads `imageUrl`
        // and ignores `imageCandidates`, so the Lambda can deploy first with no broken
        // intermediate state. Delete both this and the `imageUrl` on the text branch in the
        // release after — tracked in CHANGELOG.md.
        imageUrl: imageCandidates[0]?.url ?? '',
        finalUrl: res.finalUrl,
      },
    };
  }

  const text = htmlToText(html);
  if (text.length < MIN_USEFUL_CHARS) return { ok: false, code: 'not_readable' };

  return {
    ok: true,
    data: {
      kind: 'text',
      text,
      title: pageTitle(html, lower),
      imageCandidates,
      /** Compatibility shim — see the note on the jsonld branch. */
      imageUrl: imageCandidates[0]?.url ?? '',
      finalUrl: res.finalUrl,
    },
  };
}
