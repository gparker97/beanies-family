// Word-token text similarity, shared by the activity duplicate check (`activityDuplicate.ts`),
// the magic beans to-do duplicate check (`magicTodoDrafts.ts`) and the statement-import
// matcher (`statement/match.ts`), plus the whole-word phrase matcher used by the celebration
// detector and the occasion keyword table. One implementation so these "does this look like
// the same thing" answers can never drift apart.

/**
 * The title-similarity bar for "this is the same thing" in the activity duplicate check. The
 * magic beans to-do duplicate check (`markDuplicateDrafts`) sets a higher bar of its own
 * (`TODO_MATCH_THRESHOLD`): short to-do titles that differ by one word already score 0.6.
 */
export const TITLE_MATCH_THRESHOLD = 0.6;

/**
 * Lowercased word tokens of a string, in order (drops punctuation + empties). Letters and digits
 * in ANY script: an `[a-z0-9]` split turned a Chinese, Thai or Cyrillic description into no
 * tokens at all, so two identical non-Latin names scored 0.
 *
 * A LITERAL split, deliberately. The celebration matcher once built a `new RegExp` per keyword
 * per title, which the security lint flags (`detect-non-literal-regexp`): nothing structurally
 * stops a future caller passing a title or a user-supplied list, and a crafted pattern is a
 * ReDoS. Tokenising is safe by construction rather than by convention, and it is what "whole
 * word" actually means.
 *
 * `.toLowerCase()`, NOT `.toLocaleLowerCase()`: the latter follows the host OS, and a Turkish
 * device maps 'I' to 'ı', so 'BIRTHDAY' would stop matching 'birthday' entirely.
 */
export function wordTokenList(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function wordTokens(text: string): Set<string> {
  return new Set(wordTokenList(text));
}

/** Latin-ish scripts, where word boundaries exist and matter. */
const WORD_BOUNDED_SCRIPT = /^[ -ɏ\s]+$/;

/** True when `text` is written in a script with word boundaries (Latin-ish). CJK is not. */
export function isWordBoundedScript(text: string): boolean {
  return WORD_BOUNDED_SCRIPT.test(text);
}

/**
 * Whole-word (or whole-phrase) match, case-insensitive. A substring match lights up
 * "partygoer", "Anniversary Road" and half the words containing "bday", so the boundary is the
 * point rather than a refinement. Both sides are lowercased here, so callers pass raw text.
 *
 * CJK has no word boundaries, so a needle in those scripts falls back to a substring test,
 * which is correct for a script where a term cannot hide inside an unrelated word.
 *
 * Shared by the celebration detector (`activityCelebration.ts`) and the occasion keyword
 * matcher (`occasions.ts`), so "does this title mention X" has one answer.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  const want = needle.toLowerCase();
  if (!want.trim()) return false; // an empty needle is "contained" in everything
  if (!isWordBoundedScript(want)) return haystack.toLowerCase().includes(want);
  const hay = wordTokenList(haystack);
  const words = wordTokenList(want);
  if (!words.length) return false;
  for (let i = 0; i + words.length <= hay.length; i++) {
    if (words.every((w, k) => hay[i + k] === w)) return true;
  }
  return false;
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
