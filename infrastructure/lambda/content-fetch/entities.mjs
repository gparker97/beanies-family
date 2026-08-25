/**
 * HTML/XML entity decoding, in ONE pass (#72).
 *
 * Shared by `page` (html → text) and `youtube` (timedtext → text) so the two cannot drift.
 *
 * WHY ONE PASS MATTERS. The obvious implementation — replace `&amp;` then `&quot;` then
 * `&lt;` … — cascades: `&amp;quot;` becomes `&quot;` after the first replacement and then
 * `"` after the second, so text that literally said `&quot;` silently turns into a quote
 * character. That is double-decoding, and it is how an escaped payload can un-escape itself
 * on the way to the model. A single regex pass with one lookup table cannot cascade, because
 * each match is consumed exactly once.
 *
 * Caught by a unit test asserting the exact output for `&amp;quot;`.
 */

const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

/** Decode named and numeric entities in a single pass. */
export function decodeEntities(input) {
  if (typeof input !== 'string' || input.length === 0) return '';
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    const key = body.toLowerCase();
    if (Object.hasOwn(NAMED, key)) return NAMED[key];
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    // Unknown entity: leave it verbatim rather than guessing or dropping it.
    return match;
  });
}
