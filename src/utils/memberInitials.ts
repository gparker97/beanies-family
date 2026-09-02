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

/** Uppercased first grapheme of a name, or `'?'` when there is nothing to show. */
function firstGrapheme(name: string): string {
  const first = [...name.trim()][0] ?? '';
  return first.toLocaleUpperCase();
}

/** Uppercased first two graphemes, falling back to one when the name is a single character. */
function firstTwoGraphemes(name: string): string {
  const chars = [...name.trim()];
  if (chars.length === 0) return '?';
  return chars.slice(0, 2).join('').toLocaleUpperCase();
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
    // Only a genuine collision earns a second letter — most beans keep one clean glyph.
    const widen = bucket.length > 1;
    for (const m of bucket) {
      out.set(m.id, widen ? firstTwoGraphemes(m.name) : key);
    }
  }
  return out;
}
