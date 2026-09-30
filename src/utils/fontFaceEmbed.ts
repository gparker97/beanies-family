/**
 * Pure helpers for building the `@font-face` CSS a sheet export inlines into its capture.
 *
 * WHY WE BUILD IT OURSELVES instead of calling html-to-image's `getFontEmbedCSS`: in a
 * production build every stylesheet is a `<link>` (Vite injects `<style>` tags only in dev),
 * and the library's fallback for our cross-origin Google Fonts sheet inserts the refetched
 * rules into "the first sheet without an href", else `document.styleSheets[0]`, which in the
 * production document IS the unreadable Google Fonts sheet. The insert throws, the library
 * swallows it with a `console.error`, and it resolves an EMPTY string: no fonts, no error,
 * so every production export silently rendered in fallback faces while dev looked perfect.
 *
 * This module is the string side of the replacement: parse `@font-face` blocks, keep only the
 * ones the captured element can draw with, collapse per-weight duplicates of one file, and
 * swap each `url()` for a `data:` URL. The DOM + network side lives in `useSheetExport`.
 */

/** One `@font-face` block, with what the selector and inliner need already parsed out. */
export interface FontFaceBlock {
  /** Normalised (unquoted, lowercased) family name. */
  family: string;
  /** The block exactly as written, `url()`s untouched. */
  cssText: string;
  /** Absolute URLs of every non-`data:` `url()` in `src`, in order. */
  urls: string[];
  /** Parsed `unicode-range`, or `null` when the block has none (covers everything). */
  ranges: Array<[number, number]> | null;
}

const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi;
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

type Declaration = 'font-style' | 'font-weight' | 'unicode-range';

const DECLARATION_RE = new Map<Declaration, RegExp>([
  ['font-style', /font-style\s*:\s*([^;}]+)/i],
  ['font-weight', /font-weight\s*:\s*([^;}]+)/i],
  ['unicode-range', /unicode-range\s*:\s*([^;}]+)/i],
]);

function declaration(cssText: string, prop: Declaration): string {
  return DECLARATION_RE.get(prop)!.exec(cssText)?.[1]?.trim() ?? '';
}

/** Family name as the capture compares it: unquoted, trimmed, lowercased. */
export function normalizeFamily(name: string): string {
  return name.trim().replace(/["']/g, '').toLowerCase();
}

/** Every family in a CSS `font-family` list, normalised: `"Outfit", sans-serif` → `outfit`, `sans-serif`. */
export function familiesInList(fontFamily: string): string[] {
  return fontFamily
    .split(',')
    .map(normalizeFamily)
    .filter((f) => f.length > 0);
}

/**
 * Parse a `unicode-range` value (`U+0000-00FF, U+0131, U+4??`) into inclusive `[lo, hi]` pairs.
 * Unparseable parts are skipped rather than failing the whole face.
 */
export function parseUnicodeRange(value: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const raw of value.split(',')) {
    const part = raw.trim().replace(/^u\+/i, '');
    if (!part) continue;
    let lo: number;
    let hi: number;
    if (part.includes('?')) {
      lo = parseInt(part.replace(/\?/g, '0'), 16);
      hi = parseInt(part.replace(/\?/g, 'F'), 16);
    } else if (part.includes('-')) {
      const [a, b] = part.split('-');
      lo = parseInt(a ?? '', 16);
      hi = parseInt(b ?? '', 16);
    } else {
      lo = hi = parseInt(part, 16);
    }
    if (Number.isFinite(lo) && Number.isFinite(hi)) out.push([lo, hi]);
  }
  return out;
}

/** Every `@font-face` block in `css`, with relative URLs resolved against `baseUrl`. */
export function parseFontFaceBlocks(css: string, baseUrl: string): FontFaceBlock[] {
  const blocks: FontFaceBlock[] = [];
  for (const [cssText] of css.replace(COMMENT_RE, '').matchAll(FONT_FACE_RE)) {
    const family = /font-family\s*:\s*([^;}]+)/i.exec(cssText)?.[1];
    if (!family) continue;
    const urls: string[] = [];
    for (const m of cssText.matchAll(URL_RE)) {
      const url = m[2]!.trim();
      if (url.startsWith('data:')) continue;
      try {
        urls.push(new URL(url, baseUrl).href);
      } catch {
        // An unresolvable URL can never be fetched; the face is dropped at inline time.
        urls.push(url);
      }
    }
    const range = declaration(cssText, 'unicode-range');
    blocks.push({
      family: normalizeFamily(family),
      cssText,
      urls,
      ranges: range ? parseUnicodeRange(range) : null,
    });
  }
  return blocks;
}

/**
 * The blocks the capture can actually use: a family the element names, and a `unicode-range`
 * that covers at least one character it renders. The range filter is what keeps the embed
 * small: Google splits each family into up to 7 script subsets, and a sheet in English needs
 * only `latin`. (The whole-family embed was ~2 MB and is what Firefox choked on.)
 */
export function selectFontFaces(
  blocks: readonly FontFaceBlock[],
  families: ReadonlySet<string>,
  codepoints: ReadonlySet<number>
): FontFaceBlock[] {
  return blocks.filter(
    (b) =>
      families.has(b.family) &&
      (b.ranges === null ||
        [...codepoints].some((cp) => b.ranges!.some(([lo, hi]) => cp >= lo && cp <= hi)))
  );
}

/**
 * Collapse blocks that point at the SAME file for the same family/style/range into one block
 * whose `font-weight` spans them all.
 *
 * Google serves a variable font as one file per script subset and repeats it in a separate
 * block for every requested weight (Outfit: six blocks, one file). Inlined naively, that file's
 * base64 is written six times. One file declared for weights `300 800` is exactly what the six
 * blocks said, so the merge changes nothing about which glyphs render, only the byte count.
 */
export function mergeSameFileFaces(blocks: readonly FontFaceBlock[]): FontFaceBlock[] {
  const groups = new Map<string, { block: FontFaceBlock; weights: number[] }>();
  const order: string[] = [];
  for (const block of blocks) {
    const key = [
      block.family,
      declaration(block.cssText, 'font-style') || 'normal',
      declaration(block.cssText, 'unicode-range'),
      block.urls.join(' '),
    ].join('|');
    const weights = declaration(block.cssText, 'font-weight')
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    const group = groups.get(key);
    if (group) {
      group.weights.push(...weights);
    } else {
      groups.set(key, { block, weights: [...weights] });
      order.push(key);
    }
  }
  return order.map((key) => {
    const { block, weights } = groups.get(key)!;
    if (weights.length === 0) return block;
    const lo = Math.min(...weights);
    const hi = Math.max(...weights);
    const weight = lo === hi ? String(lo) : `${lo} ${hi}`;
    const cssText = /font-weight\s*:/i.test(block.cssText)
      ? block.cssText.replace(/font-weight\s*:\s*[^;}]+/i, `font-weight: ${weight}`)
      : block.cssText;
    return { ...block, cssText };
  });
}

/**
 * The block with every `url()` swapped for its `data:` URL, or `null` when any of its files is
 * missing from `dataUrls`: a face pointing at a network URL cannot load inside the capture's
 * isolated SVG image, so emitting it would only hide the gap.
 */
export function inlineFontFace(
  block: FontFaceBlock,
  dataUrls: ReadonlyMap<string, string>
): string | null {
  if (block.urls.some((u) => !dataUrls.has(u))) return null;
  let i = 0;
  return block.cssText.replace(URL_RE, (match, _q: string, url: string) => {
    if (url.trim().startsWith('data:')) return match;
    return `url(${dataUrls.get(block.urls[i++]!)})`;
  });
}
