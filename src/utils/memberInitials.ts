/**
 * How a bean's face is labelled when there is no photo.
 *
 * One letter normally, TWO where another member of the same family shares that
 * first letter — because the whole point of putting a face on every card is that
 * identity survives without colour, and "M" over "M" does not. Colour would
 * disambiguate them, but leaning on colour is exactly the dependency this change
 * exists to remove; a filter or a card seen by someone with a colour-vision
 * deficiency has to work on the glyph alone.
 *
 * Grapheme-aware: `[...name]` rather than `charAt(0)`, so an emoji or
 * astral-plane first character yields one whole character instead of half a
 * surrogate pair. Three of the four avatar implementations this replaced used
 * `charAt(0)` and rendered a broken glyph for such names.
 *
 * Computed for the WHOLE ROSTER at once and cached on the store: collision is a
 * property of the set, not of a member, so a per-member helper would have to
 * rescan the roster on every face on every render — O(n²) per card stack.
 */

/**
 * Grapheme-aware splitting. `[...name]` splits by CODE POINT, which breaks a flag
 * ("🇬🇧" becomes a lone regional indicator) and a ZWJ family emoji (two different
 * families both yield "👨\u200D"). `Intl.Segmenter` is the only correct tool; it is
 * available everywhere the app runs, and the spread is kept as a fallback so a test
 * environment without it degrades rather than throws.
 */
function graphemes(name: string): string[] {
  const trimmed = name.trim();
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Seg) return [...trimmed];
  return Array.from(
    new Seg(undefined, { granularity: 'grapheme' }).segment(trimmed),
    (s) => s.segment
  );
}

/**
 * Uppercase for DISPLAY only — never for building a match key.
 *
 * `toLocaleUpperCase()` with no locale follows the host OS, and Turkish maps `i` to
 * `İ`; German `ß` expands to two characters, so a one-letter initial silently became
 * three inside a 24px circle. Plain `toUpperCase()` is locale-independent, and the
 * length guard keeps the glyph count honest.
 */
function upperForDisplay(text: string): string {
  const up = text.toUpperCase();
  return graphemes(up).length > graphemes(text).length ? text : up;
}

/** Uppercased first grapheme of a name, or `'?'` when there is nothing to show. */
function firstGrapheme(name: string): string {
  const first = graphemes(name)[0] ?? '';
  return first ? upperForDisplay(first) : '';
}

/**
 * The shortest prefix that tells this name apart from the others it collides with.
 *
 * Taking a flat two characters was not enough: Max/Mark both give "MA", Sam/Sarah
 * "SA", Ben/Bella "BE" — the commonest sibling pairs there are, so the widening did
 * nothing on exactly the families it exists for. Widen until the labels are actually
 * distinct, then stop.
 */
function distinguishingPrefixes<T extends { id: string; name: string }>(
  bucket: T[]
): Map<string, string> {
  const out = new Map<string, string>();
  const maxLen = Math.max(...bucket.map((m) => graphemes(m.name).length), 1);

  for (let len = 2; len <= Math.min(maxLen, 3); len++) {
    const labels = bucket.map((m) => upperForDisplay(graphemes(m.name).slice(0, len).join('')));
    if (new Set(labels).size === bucket.length) {
      bucket.forEach((m, i) => out.set(m.id, labels[i]!));
      return out;
    }
  }

  // Still ambiguous at three characters (Mia/Mia — genuinely the same name). Two
  // letters plus the member colour is as far as a glyph can go; the picker shows the
  // full name, and this is the one case where colour is doing real work.
  for (const m of bucket) {
    out.set(m.id, upperForDisplay(graphemes(m.name).slice(0, 2).join('')));
  }
  return out;
}

/**
 * Map every member id to its display initials, widening only where a first
 * letter is shared. Pure — the store wraps this in a computed.
 */
export function computeInitials<T extends { id: string; name: string }>(
  members: T[]
): Map<string, string> {
  const byFirst = new Map<string, T[]>();
  for (const m of members) {
    const key = firstGrapheme(m.name) || '?';
    const bucket = byFirst.get(key);
    if (bucket) bucket.push(m);
    else byFirst.set(key, [m]);
  }

  const out = new Map<string, string>();
  for (const [key, bucket] of byFirst) {
    // Only a genuine collision earns extra letters — most beans keep one clean glyph.
    if (bucket.length === 1) {
      out.set(bucket[0]!.id, key);
      continue;
    }
    for (const [id, label] of distinguishingPrefixes(bucket)) out.set(id, label);
  }
  return out;
}
