/**
 * Recipe tag rules (#87) — pure, Vue-free, and EXPLICIT ABOUT REJECTION.
 *
 * The rejection status is the point of this module. A tag input that quietly ignores a
 * duplicate or an over-cap entry looks broken: the user presses Enter, nothing happens, and
 * there is no way to tell a swallowed tag from a dead key. `addTag` therefore returns WHY it
 * did what it did, and `RecipeTagInput` renders that reason. No silent failures.
 *
 * All rules live here rather than in the component so they can be tested without mounting
 * anything — the pattern `recipeExtractionToRecipe.ts` states in its own header.
 */

/** Most tags one recipe can hold. Past this the card is unreadable and the input is a chore. */
export const MAX_TAGS = 12;

/** Longest a single tag may be. Longer entries are TRUNCATED, not rejected — see `addTag`. */
export const MAX_TAG_LENGTH = 24;

/** Most previously-used tags offered under the input. */
export const MAX_SUGGESTIONS = 8;

/**
 * Canonical form of a tag: trimmed, lowercased, internal whitespace collapsed, capped.
 *
 * ⚠️ Lowercasing DOES overwrite what the user typed, proper nouns included ("Nana's" becomes
 * "nana's"). That is a deliberate, stated trade — it is what makes two tags differing only in
 * case impossible — and the input says so in its hint rather than rewriting silently.
 *
 * Returns `''` when there is nothing usable, which every caller treats as "not a tag".
 */
export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH).trim();
}

export type AddTagStatus = 'added' | 'empty' | 'duplicate' | 'limit' | 'truncated';

export interface AddTagResult {
  /** The resulting list. Unchanged (same contents) when nothing was added. */
  tags: string[];
  status: AddTagStatus;
}

/**
 * Add one raw entry to a tag list, reporting what happened.
 *
 * `'truncated'` still ADDS the tag — the user gets the tag they meant, plus a note that it was
 * shortened. Rejecting it outright would lose the input to a rule they cannot see.
 */
export function addTag(tags: readonly string[], raw: string): AddTagResult {
  const normalised = normaliseTag(raw);
  if (!normalised) return { tags: [...tags], status: 'empty' };
  if (tags.includes(normalised)) return { tags: [...tags], status: 'duplicate' };
  if (tags.length >= MAX_TAGS) return { tags: [...tags], status: 'limit' };

  const wasTruncated = normaliseTag(raw) !== raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return { tags: [...tags, normalised], status: wasTruncated ? 'truncated' : 'added' };
}

/** Remove a tag. Absent tags are a no-op, not an error — a double-tap on remove is harmless. */
export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

/**
 * Tags this family has used before, most-used first, excluding ones already on this recipe.
 *
 * ⚠️ The limit is not decoration. A family with 200 distinct tags would otherwise render 200
 * pills under the input. Callers compute this once per (recipes, current) change — never per
 * keystroke.
 */
export function suggestTags(
  allRecipes: readonly { tags?: string[] }[],
  current: readonly string[],
  limit: number = MAX_SUGGESTIONS
): string[] {
  const counts = new Map<string, number>();
  for (const recipe of allRecipes) {
    // Array.isArray, not `?? []`: this walks EVERY recipe in the family, so a single corrupt
    // `tags` value anywhere in the cookbook would throw here and take out the recipe FORM for
    // every recipe — the widest blast radius of any of these guards, and the reason the
    // container is checked rather than assumed.
    if (!Array.isArray(recipe.tags)) continue;
    for (const tag of recipe.tags) {
      if (current.includes(tag)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([tag]) => tag);
}
