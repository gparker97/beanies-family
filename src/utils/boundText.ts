/**
 * Truncate a string to at most `max` UTF-16 code units WITHOUT splitting a surrogate pair.
 *
 * `String.prototype.slice` counts UTF-16 code units, so cutting at an arbitrary index can
 * land between the high and low halves of an astral character (emoji, CJK Ext-B, Adlam,
 * Deseret) and leave a lone surrogate. That lone surrogate is not a valid character: it
 * renders as `U+FFFD`, and it survives all the way into whatever the string is used for.
 *
 * The trailing-high-surrogate trim is the same idiom `sanitiseFilename.ts:52` already uses
 * for the same reason. Kept as ONE shared helper so the two cannot drift into two different
 * answers about what a bounded string is — this one is not filename-specific, so it lives in
 * `utils/` rather than beside the sanitiser.
 *
 * Only a trailing HIGH surrogate (`\uD800-\uDBFF`) can be orphaned by a cut: a low surrogate
 * at the end is only reachable if its high half is also inside the slice, in which case the
 * pair is intact.
 *
 * @param text The string to bound. Returned unchanged when it already fits.
 * @param max Maximum length in UTF-16 code units. A non-positive `max` yields `''`.
 */
export function boundText(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}
