import { asciiLower } from './asciiLower.mjs';
import { decodeEntities } from './entities.mjs';
/**
 * schema.org/Recipe extraction from a page's JSON-LD (#72).
 *
 * This is the path that matters most: recipe sites overwhelmingly publish JSON-LD because
 * it powers Google's recipe rich results, and parsing it gives EXACT recipeIngredient[],
 * recipeInstructions[], prepTime, cookTime and recipeYield. The model is never invoked on
 * this path, so it cannot hallucinate a quantity — which for a recipe is the difference
 * between a cake and a brick.
 *
 * Deliberately NOT per-site scrapers. One generic parser over a published standard.
 */

const MAX_ITEMS = 100;
const MAX_LINE = 4000;
const MAX_FIELD = 200;

/**
 * A JSON-LD scalar as clean display text.
 *
 * DECODES ENTITIES. JSON-LD is embedded IN an HTML document, and plenty of CMSes HTML-escape
 * the values they emit into it — allrecipes returns `World&#39;s Best Lasagna` as the recipe
 * name. Undecoded, that lands in the form at confidence 1 and then replicates into the
 * `.beanpod` permanently. Found by probing the deployed endpoint against real sites, not by
 * a test: every fixture in the suite used clean values.
 *
 * Decode BEFORE slicing, so the cap cannot cut an entity in half. `decodeEntities` is
 * single-pass, so an escaped entity (`&amp;quot;`) stays escaped rather than unravelling.
 */
function text(v, max = MAX_FIELD) {
  if (typeof v === 'number') return String(v).slice(0, max);
  if (typeof v !== 'string') return '';
  return decodeEntities(v.trim()).slice(0, max);
}

/** `@type` may be a string OR an array (`["Recipe","NewsArticle"]`). Both are legal. */
function typeMatches(node, wanted) {
  const t = node?.['@type'];
  if (typeof t === 'string') return t.toLowerCase() === wanted;
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === wanted);
  return false;
}

/** Walk any JSON-LD shape — bare node, array, or `@graph` — for the first Recipe node. */
/** How deep to walk a JSON-LD graph before giving up. */
const MAX_NODE_DEPTH = 6;
export function findRecipeNode(root, depth = 0) {
  if (depth > MAX_NODE_DEPTH || root === null || typeof root !== 'object') return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findRecipeNode(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeMatches(root, 'recipe')) return root;
  // Descend ordinary object properties too, not just `@graph`. The very common and legal
  // `{"@type":"WebPage","mainEntity":{"@type":"Recipe",…}}` was being missed entirely, so a
  // site publishing EXACT quantities fell through to the model — the one outcome this file
  // exists to avoid — and `extraction_path` logged `page_text`, making the miss read as
  // "the site has no structured data".
  //
  // But NOT into a list's items. `itemListElement` is where a roundup ("25 Best Pasta
  // Recipes") hangs its twenty-five entries; descending there returns whichever Recipe came
  // first in object key order and presents one arbitrary dish out of twenty as the recipe
  // for the page — on the ONE path where the model is never consulted and confidence is
  // hard-coded to 1. See `collectRecipeNodes` for the ambiguity check that backs this up.
  for (const [key, value] of Object.entries(root)) {
    if (key === 'itemListElement') continue;
    if (value && typeof value === 'object') {
      const hit = findRecipeNode(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Every distinct Recipe in the document, by name.
 *
 * A roundup page can nest its entries somewhere other than `itemListElement`, so skipping
 * that key is necessary but not sufficient. If a document describes SEVERAL dishes we cannot
 * know which one the user meant, and guessing is the worst option available here: this path
 * reports confidence 1, so a guess is presented as exact. Better to fall through to the
 * model, which marks what it inferred.
 *
 * Deduplicated by name because plenty of sites emit the same recipe twice (once in `@graph`,
 * once standalone), and that is one recipe, not an ambiguity.
 */
function collectRecipeNodes(root, depth = 0, found = new Map()) {
  if (!root || typeof root !== 'object' || depth > MAX_NODE_DEPTH) return found;
  if (Array.isArray(root)) {
    for (const item of root) collectRecipeNodes(item, depth + 1, found);
    return found;
  }
  if (typeMatches(root, 'recipe')) {
    const key = text(root.name).trim().toLowerCase() || `__unnamed_${found.size}`;
    if (!found.has(key)) found.set(key, root);
    return found;
  }
  for (const value of Object.values(root)) {
    if (value && typeof value === 'object') collectRecipeNodes(value, depth + 1, found);
  }
  return found;
}

/**
 * ISO-8601 duration → a human string. schema.org uses `PT1H30M`; showing that to a user
 * would be worse than showing nothing. A non-ISO value is passed through as written,
 * because plenty of sites put "1 hour 10 mins" in the field directly.
 */
export function humanizeDuration(raw) {
  const s = text(raw);
  if (!s) return '';
  // Matched in parts with STATIC regexes: one combined pattern nests quantifiers inside an
  // optional group (a ReDoS shape), and a `new RegExp(interpolated)` trips the security lint
  // that gates CI. Static literals avoid both.
  if (!/^P[0-9DTHMS.,]*$/i.test(s) || s.length < 3) return s;
  const tIdx = s.search(/t/i);
  const datePart = tIdx === -1 ? s : s.slice(0, tIdx);
  const timePart = tIdx === -1 ? '' : s.slice(tIdx);
  const d = /([0-9]+)d/i.exec(datePart)?.[1] ?? '';
  const h = /([0-9]+)h/i.exec(timePart)?.[1] ?? '';
  const mi = /([0-9]+)m/i.exec(timePart)?.[1] ?? '';
  // Seconds matter: without this, `PT10S` and `PT1M30S` render the RAW ISO string into the
  // form and then into the Automerge doc — precisely what this function exists to prevent.
  const sec = /([0-9]+)s/i.exec(timePart)?.[1] ?? '';
  // Compare as NUMBERS. These are captured strings, so a zero component is the truthy '0'
  // — and WP Recipe Maker, Tasty Recipes and Schema Pro all emit zero-padded durations, so
  // `P0DT0H30M` rendered as "0 days 0 hours 30 mins" on the common path, then landed in the
  // form asserting confidence 1 and replicated into the .beanpod.
  const n = (v) => (v === '' ? 0 : Number.parseInt(v, 10));
  const [dn, hn, mn, sn] = [n(d), n(h), n(mi), n(sec)];
  // ALL ZERO = the author left the field blank (WP Recipe Maker emits a literal `PT0M`), so
  // the honest answer is nothing at all. Returning `s` here put the raw `PT0M` into the form
  // at confidence 1 and then into the .beanpod — this branch was the one still doing it.
  if (!dn && !hn && !mn && !sn) return '';
  const parts = [];
  if (dn) parts.push(`${dn} day${dn === 1 ? '' : 's'}`);
  if (hn) parts.push(`${hn} hour${hn === 1 ? '' : 's'}`);
  if (mn) parts.push(`${mn} min${mn === 1 ? '' : 's'}`);
  // Only show seconds when they are the whole story; "1 hour 30 mins 12 secs" is noise.
  if (sn && !dn && !hn && !mn) parts.push(`${sn} sec${sn === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * `recipeInstructions` is the messiest field in the wild. Legal shapes:
 *   - "step one\nstep two"                       (a single string)
 *   - ["step one", "step two"]                   (strings)
 *   - [{ "@type":"HowToStep", "text":"..." }]    (objects)
 *   - [{ "@type":"HowToSection", "itemListElement":[ …HowToStep… ] }]  (grouped)
 * Handling only the first two is why naive parsers return empty steps on major sites.
 */
export function flattenInstructions(raw, depth = 0) {
  if (depth > 3) return [];
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) return raw.flatMap((x) => flattenInstructions(x, depth + 1));
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.itemListElement))
      return flattenInstructions(raw.itemListElement, depth + 1);
    const t = raw.text ?? raw.name;
    return typeof t === 'string' && t.trim() ? [t.trim()] : [];
  }
  return [];
}

/** `image` may be a string, an array, or an ImageObject. Returns the first usable URL. */
export function firstImageUrl(raw, depth = 0) {
  if (depth > 3) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const hit = firstImageUrl(x, depth + 1);
      if (hit) return hit;
    }
    return '';
  }
  if (raw && typeof raw === 'object') return firstImageUrl(raw.url ?? raw.contentUrl, depth + 1);
  return '';
}

/** `recipeYield` is often `["8","8 servings"]`; prefer the descriptive one. */
function pickYield(raw) {
  if (Array.isArray(raw)) {
    const descriptive = raw.find((x) => typeof x === 'string' && /[a-z]/i.test(x));
    return text(descriptive ?? raw[0]);
  }
  return text(raw);
}

/** Normalize a Recipe node into our shape. Returns null when it carries nothing usable. */
export function normalizeRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
    .map((x) => text(x, MAX_LINE))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  const steps = flattenInstructions(node.recipeInstructions)
    .map((x) => text(x, MAX_LINE))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  const name = text(node.name);
  // A node needs a NAME **and** something to cook — not merely one non-empty field. A stub
  // `{"@type":"Recipe","name":"Lemon Drizzle Cake","image":"…"}` is common on roundup and
  // category pages and on mis-configured Yoast/WPRM graphs. Accepting it short-circuits the
  // page-text fallback, so the model never sees the page that DOES hold the recipe — and the
  // client cannot rescue it, because jsonLdToPrefill hard-codes confidence 1. The user would
  // get an empty form asserting full confidence.
  if (!name || (ingredients.length === 0 && steps.length === 0)) return null;

  return {
    name,
    subtitle: text(node.description),
    prepTime: humanizeDuration(node.prepTime),
    // `||`, not `??`: the common bad value here is an EMPTY STRING, not null. A site
    // emitting `"cookTime": ""` would otherwise suppress the totalTime fallback entirely
    // and the recipe would lose its time.
    cookTime: humanizeDuration(node.cookTime || node.totalTime),
    servings: pickYield(node.recipeYield),
    ingredients,
    steps,
    // Capped at the URL screen's own limit — MAX_LINE (4000) would pass through something
    // both safeHttpsUrl and screenUrl reject at 2000, which reads as "the image was
    // unreachable" rather than "we sent something too long to be a URL".
    imageUrl: text(firstImageUrl(node.image), 2000),
    // The last rung of the #86 image ladder. Reuses the same depth-bounded reader as `image`
    // rather than a second parse, and is deliberately LAST in the ladder: publishers commonly
    // set thumbnailUrl to a cropped square, which is a poor hero but far better than nothing.
    thumbnailUrl: text(firstImageUrl(node.thumbnailUrl), 2000),
  };
}

/**
 * Pull every `<script type="application/ld+json">` block out of raw HTML and return the
 * first normalized Recipe. A malformed block is skipped, not fatal — pages routinely carry
 * several, and one broken analytics blob should not cost us the recipe.
 */
export function extractRecipeFromHtml(html) {
  // LINEAR SCAN, not a regex. `<script[^>]+…>[\s\S]*?</script>` is quadratic on
  // attacker-controlled HTML: `'<script '.repeat(n)` with no `>` makes `[^>]+` backtrack
  // from every start position. Measured against the real pattern: 211KB → 5.6s, and this
  // is the FIRST thing run on a 2MB body, so ~4KB gzipped on the wire guarantees the 15s
  // Lambda timeout — a raw CORS-less 502 that bypasses the whole typed taxonomy, while
  // pinning one of only 5 concurrency slots. `dropTag` was rewritten for exactly this
  // reason; the rewrite reached one function and not the class.
  const lower = asciiLower(html);
  let cursor = 0;
  for (;;) {
    const open = lower.indexOf('<script', cursor);
    if (open === -1) return null;
    const openEnd = lower.indexOf('>', open);
    if (openEnd === -1) return null;
    const attrs = lower.slice(open, openEnd);
    const close = lower.indexOf('</script', openEnd);
    const bodyEnd = close === -1 ? html.length : close;
    cursor = close === -1 ? html.length : close + 8;
    if (!attrs.includes('application/ld+json')) {
      if (close === -1) return null;
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(html.slice(openEnd + 1, bodyEnd).trim());
    } catch {
      if (close === -1) return null;
      continue;
    }
    // AMBIGUITY CHECK. A roundup page describes many dishes; picking one and stamping it
    // confidence 1 would present a guess as exact. Fall through to the model instead, which
    // at least marks what it inferred.
    const candidates = collectRecipeNodes(parsed);
    if (candidates.size > 1) {
      console.warn(`[recipe-jsonld] ambiguous: ${candidates.size} recipes in one document`);
      if (close === -1) return null;
      continue;
    }
    const node = findRecipeNode(parsed);
    if (node) {
      const normalized = normalizeRecipeNode(node);
      if (normalized) return normalized;
    }
    if (close === -1) return null;
  }
}
