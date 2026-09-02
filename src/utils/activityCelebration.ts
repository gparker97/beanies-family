import { getActivityCategoryById } from '@/constants/activityCategories';
import {
  CELEBRATION_EMOJI,
  CELEBRATION_ERRAND_VERBS,
  CELEBRATION_KEYWORDS,
} from '@/constants/celebrationKeywords';
import type { FamilyActivity } from '@/types/models';

/**
 * Whether an activity is a genuine celebration — a birthday, an anniversary, a
 * wedding — and therefore earns the loud card treatment.
 *
 * Named `activityCelebration`, NOT `celebration`: `useCelebration.ts` already
 * owns that word in this codebase (the app-wide overlay/shower system with
 * `celebrate()` and `CelebrationTrigger`). Two unrelated modules called
 * "celebration" is a trap for the next reader.
 *
 * Celebration is ORTHOGONAL to `ActivityChipClass.kind`, never a fourth kind.
 * `kind` answers "whose is this" and drives hue; this is a decoration on top, so
 * a shared birthday is `shared` AND celebrating. Folding it into `kind` would
 * make ownership and decoration one axis and force every consumer to re-learn it.
 *
 * Returns the REASON, not just a boolean, so callers can report which rule fired
 * without re-deriving it — that is what makes the false-positive rate measurable
 * from CloudWatch rather than guessed at.
 */
export type CelebrationRule = 'override' | 'category-group' | 'emoji' | 'keyword' | 'none';

export interface CelebrationVerdict {
  celebrating: boolean;
  rule: CelebrationRule;
  suppressed: 'errand-verb' | null;
}

/** The category group whose every member is a celebration. */
const CELEBRATION_GROUP = 'Party';

const NOT_CELEBRATING: CelebrationVerdict = {
  celebrating: false,
  rule: 'none',
  suppressed: null,
};

/** Latin-ish scripts, where word boundaries exist and matter. */
const WORD_BOUNDED_SCRIPT = /^[ -ɏ\s]+$/;

/** Inflections a base verb may legitimately wear: book/books/booked/booking. */
const VERB_INFLECTIONS = ['', 's', 'ed', 'ing', 'd'] as const;

/**
 * Word tokens, lowercased. A LITERAL split, deliberately.
 *
 * This used to build a `new RegExp` per keyword per title, which the security lint
 * flags (`detect-non-literal-regexp`) — rightly, even though the inputs are our own
 * curated constants today: nothing structurally stops a future caller passing a title
 * or a user-supplied list, and a crafted pattern is a ReDoS. Tokenising is safe by
 * construction rather than by convention, and it is what "whole word" actually means.
 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whole-word (or whole-phrase) match. A substring match lights up "partygoer",
 * "Anniversary Road" and half the words containing "bday", so the boundary is the
 * point rather than a refinement.
 *
 * CJK has no word boundaries, so those locales fall back to a substring test —
 * correct for a script where a term cannot hide inside an unrelated word.
 */
function matchesWord(haystack: string, needle: string): boolean {
  if (!WORD_BOUNDED_SCRIPT.test(needle)) return haystack.includes(needle);
  const hay = tokens(haystack);
  const want = tokens(needle);
  if (!want.length) return false;
  for (let i = 0; i + want.length <= hay.length; i++) {
    if (want.every((w, k) => hay[i + k] === w)) return true;
  }
  return false;
}

/**
 * Does the title OPEN with an errand verb?
 *
 * A bare `startsWith` suppressed every title whose first word merely BEGAN with a
 * verb's letters — "Payton's birthday" by `pay`, "Booker family wedding" by `book` —
 * and reported each as a deliberate errand, so the false negatives were unmeasurable.
 * Matching whole tokens fixes that, and the inflection list is explicit so "book"
 * covers "booking" without also swallowing "Booker".
 */
function startsWithErrandVerb(title: string, locale: string): boolean {
  const verbs = CELEBRATION_ERRAND_VERBS[locale] ?? CELEBRATION_ERRAND_VERBS.en ?? [];
  const hay = tokens(title);
  const lowered = title.trim().toLowerCase();

  return verbs.some((verb) => {
    const v = verb.toLowerCase();
    if (!WORD_BOUNDED_SCRIPT.test(v)) return lowered.startsWith(v);
    const want = tokens(v);
    if (!want.length || hay.length < want.length) return false;
    // Only the FIRST word inflects; "pick up" must still be followed by "up".
    const head = want[0]!;
    if (!VERB_INFLECTIONS.some((suffix) => hay[0] === head + suffix)) return false;
    return want.slice(1).every((w, k) => hay[k + 1] === w);
  });
}

/**
 * @param activity the activity to judge
 * @param locale   active UI locale, for the keyword + errand lists
 * @param override explicit user choice; wins over everything, in both directions
 */
export function isCelebrationActivity(
  activity: Pick<FamilyActivity, 'title' | 'category'>,
  locale = 'en',
  override?: boolean | null
): CelebrationVerdict {
  // A guess you cannot correct is worse than no guess.
  if (override === true) return { celebrating: true, rule: 'override', suppressed: null };
  if (override === false) return { celebrating: false, rule: 'override', suppressed: null };

  // The category is the reliable signal and always wins. Using the GROUP rather than a
  // hand-maintained id list means a future Party category celebrates automatically.
  // (`work_party` deliberately sits in the Work group and does not.)
  if (getActivityCategoryById(activity.category)?.group === CELEBRATION_GROUP) {
    return { celebrating: true, rule: 'category-group', suppressed: null };
  }

  const title = activity.title ?? '';
  if (!title.trim()) return NOT_CELEBRATING;

  // Emoji is the strongest signal there is, and the only one that survives every
  // language — so it is tested before the errand suppressor. "Buy 🎂" is still a cake.
  if (CELEBRATION_EMOJI.some((e) => title.includes(e))) {
    return { celebrating: true, rule: 'emoji', suppressed: null };
  }

  // `.toLowerCase()`, NOT `.toLocaleLowerCase()`: the latter follows the host OS, and a
  // Turkish device maps 'I' to 'ı', so 'BIRTHDAY' stopped matching 'birthday' entirely
  // — and the regex `i` flag cannot help once the haystack is destructively lowercased.
  const lower = title.toLowerCase();
  const keywords = CELEBRATION_KEYWORDS[locale] ?? CELEBRATION_KEYWORDS.en ?? [];
  const hit = keywords.some((k) => matchesWord(lower, k.toLowerCase()));
  if (!hit) return NOT_CELEBRATING;

  // An errand ABOUT a celebration is not one. Checked only once a keyword matched, so
  // the common case never pays for it.
  if (startsWithErrandVerb(title, locale)) {
    return { celebrating: false, rule: 'keyword', suppressed: 'errand-verb' };
  }

  return { celebrating: true, rule: 'keyword', suppressed: null };
}

/**
 * The glyph that overhangs a celebrating card's corner.
 *
 * Derived from the activity's own emoji when that already reads as celebratory (a
 * birthday category gives 🎂), so the sticker echoes the card rather than contradicting
 * it; 🎉 otherwise.
 */
const CELEBRATORY_GLYPHS = new Set(['🎂', '🎉', '🎈', '🥳', '🍰', '💍', '🎓', '💒', '🍼']);

export function celebrationSticker(emoji: string): string {
  return CELEBRATORY_GLYPHS.has(emoji) ? emoji : '🎉';
}
