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

function text(v, max = MAX_FIELD) {
  if (typeof v === 'number') return String(v).slice(0, max);
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/** `@type` may be a string OR an array (`["Recipe","NewsArticle"]`). Both are legal. */
function typeMatches(node, wanted) {
  const t = node?.['@type'];
  if (typeof t === 'string') return t.toLowerCase() === wanted;
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === wanted);
  return false;
}

/** Walk any JSON-LD shape — bare node, array, or `@graph` — for the first Recipe node. */
export function findRecipeNode(root, depth = 0) {
  if (depth > 6 || root === null || typeof root !== 'object') return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findRecipeNode(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeMatches(root, 'recipe')) return root;
  if (Array.isArray(root['@graph'])) {
    const hit = findRecipeNode(root['@graph'], depth + 1);
    if (hit) return hit;
  }
  return null;
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
  if (!d && !h && !mi && !sec) return s;
  const parts = [];
  if (d) parts.push(`${d} day${d === '1' ? '' : 's'}`);
  if (h) parts.push(`${h} hour${h === '1' ? '' : 's'}`);
  if (mi) parts.push(`${mi} min${mi === '1' ? '' : 's'}`);
  // Only show seconds when they are the whole story; "1 hour 30 mins 12 secs" is noise.
  if (sec && !d && !h && !mi) parts.push(`${sec} sec${sec === '1' ? '' : 's'}`);
  return parts.join(' ') || s;
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
  };
}

/**
 * Pull every `<script type="application/ld+json">` block out of raw HTML and return the
 * first normalized Recipe. A malformed block is skipped, not fatal — pages routinely carry
 * several, and one broken analytics blob should not cost us the recipe.
 */
export function extractRecipeFromHtml(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const node = findRecipeNode(parsed);
    if (node) {
      const normalized = normalizeRecipeNode(node);
      if (normalized) return normalized;
    }
  }
  return null;
}
