// Word-token text similarity, shared by the activity duplicate check (`activityDuplicate.ts`)
// and the statement-import matcher (`statement/match.ts`). One implementation so the two
// "does this look like the same thing" answers can never drift apart.

/**
 * Lowercased word tokens of a string (drops punctuation + empties). Letters and digits in ANY
 * script: an `[a-z0-9]` split turned a Chinese, Thai or Cyrillic description into no tokens at
 * all, so two identical non-Latin names scored 0.
 */
function wordTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );
}

/**
 * Jaccard token-overlap of two strings in [0, 1]. 1 when the token sets are equal; 0 when either
 * side has no tokens. Word-level (not character-level) so "Piano Lesson" vs "Piano lesson!" → 1
 * but two distinct titles stay well below a match threshold.
 */
export function tokenSimilarity(a: string, b: string): number {
  const ta = wordTokens(a);
  const tb = wordTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
