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

/** Strip a tag and its contents entirely (script/style/nav/etc). */
function dropTag(html, tag) {
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
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
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Block-level boundaries become newlines BEFORE tags are stripped, so list items and
  // paragraphs stay on separate lines.
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*\/?>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
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

function metaContent(html, property) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
    'i'
  );
  const m = re.exec(html);
  if (m) return m[1].trim();
  // Attribute order is not guaranteed — try content-first too.
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );
  const m2 = re2.exec(html);
  return m2 ? m2[1].trim() : '';
}

function pageTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? htmlToText(m[1]).slice(0, 200) : '';
}

export async function fetchPage(url) {
  const res = await guardedFetch(url, { maxBytes: MAX_BYTES });
  if (!res.ok) return res;

  // A PDF or image served at a "recipe URL" is not something this mode can read; say so
  // rather than handing the model a wall of binary noise.
  if (res.contentType && !/text\/html|application\/xhtml|text\/plain/i.test(res.contentType)) {
    return { ok: false, code: 'not_readable' };
  }

  const html = res.body.toString('utf8');

  const jsonld = extractRecipeFromHtml(html);
  if (jsonld) {
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
      imageUrl: metaContent(html, 'og:image'),
      finalUrl: res.finalUrl,
    },
  };
}
