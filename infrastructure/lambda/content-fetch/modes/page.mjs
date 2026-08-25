/**
 * `page` mode — fetch a recipe URL once, generically. No per-site scrapers (#72).
 *
 * Two outcomes, and the order matters:
 *   1. schema.org/Recipe JSON-LD → exact ingredients/steps/times, model NEVER invoked.
 *   2. otherwise → the page reduced to readable text, handed to the model as a fallback.
 *
 * Returning `{ok:false, code}` rather than throwing keeps the dispatcher a pure mapping.
 */
import { guardedFetch } from '../guardedFetch.mjs';
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
  const lower = html.toLowerCase();
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
      // Unclosed tag: drop the rest. Matches the regex's intent without its blow-up.
      cursor = html.length;
      break;
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

/** Find one meta tag's content by property/name. Linear scan — see dropTag on why not regex. */
function findMeta(html, key) {
  const lower = html.toLowerCase();
  const needle = `"${key}"`;
  const alt = `'${key}'`;
  let cursor = 0;
  for (;;) {
    const at = lower.indexOf('<meta', cursor);
    if (at === -1) return '';
    const end = lower.indexOf('>', at);
    if (end === -1) return '';
    const tag = html.slice(at, end);
    const tagLower = tag.toLowerCase();
    if (tagLower.includes(needle) || tagLower.includes(alt)) {
      const ci = tagLower.indexOf('content=');
      if (ci !== -1) {
        const q = tag[ci + 8];
        if (q === '"' || q === "'") {
          const close = tag.indexOf(q, ci + 9);
          if (close !== -1) return tag.slice(ci + 9, close);
        }
      }
    }
    cursor = end + 1;
  }
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
function metaContent(html, property) {
  return decodeEntities(findMeta(html, property)).trim();
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

function pageTitle(html) {
  // Linear — `/<title[^>]*>([\s\S]*?)<\/title>/i` measured 420KB → 9.25s on
  // `'<title>'.repeat(n)` with no closing tag.
  const lower = html.toLowerCase();
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

  const jsonld = extractRecipeFromHtml(html);
  if (jsonld) {
    // Structured-data `image` is relative just as often as og:image is.
    jsonld.imageUrl = absolutize(jsonld.imageUrl, res.finalUrl);
    return { ok: true, data: { kind: 'jsonld', recipe: jsonld, finalUrl: res.finalUrl } };
  }

  const text = htmlToText(html);
  if (text.length < MIN_USEFUL_CHARS) return { ok: false, code: 'not_readable' };

  return {
    ok: true,
    data: {
      kind: 'text',
      text,
      title: pageTitle(html),
      imageUrl: absolutize(metaContent(html, 'og:image'), res.finalUrl),
      finalUrl: res.finalUrl,
    },
  };
}
