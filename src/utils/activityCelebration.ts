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

/**
 * Whole-word match. A substring match lights up "partygoer", "Anniversary Road"
 * and half the words containing "bday", so the boundary is the point rather than
 * a refinement. Multi-word keywords ("baby shower") are matched as a phrase.
 *
 * CJK has no word boundaries and `\b` does not apply, so those locales fall back
 * to a plain substring test — correct for a script where a term cannot appear
 * inside an unrelated word the way "bday" can inside "bdays".
 */
function matchesWord(haystack: string, needle: string): boolean {
  if (WORD_BOUNDED_SCRIPT.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(haystack);
  }
  return haystack.includes(needle);
}

/**
 * Does the title OPEN with an errand verb?
 *
 * A bare `startsWith` suppressed every title whose first word merely begins with a
 * verb's letters — "Payton's birthday" by `pay`, "Booker family wedding" by `book`,
 * "Post-graduation party" by `post`, "Planetarium trip" by `plan`. Each lost its card
 * treatment AND reported `suppressed: 'errand-verb'`, so the false negatives looked
 * deliberate in telemetry and were unmeasurable.
 *
 * The mirror failure: the list stores "pick up", and `'picking up'.startsWith('pick up')`
 * is false, so the gerund escaped. Matching on a word boundary fixes both directions,
 * and the trailing `\w*` accepts inflections (picking, booking, ordered).
 */
function startsWithErrandVerb(title: string, locale: string): boolean {
  const verbs = CELEBRATION_ERRAND_VERBS[locale] ?? CELEBRATION_ERRAND_VERBS.en ?? [];
  const trimmed = title.trim().toLowerCase();
  return verbs.some((verb) => {
    const v = verb.toLowerCase();
    if (!WORD_BOUNDED_SCRIPT.test(v)) return trimmed.startsWith(v);
    const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Inflections are an EXPLICIT small set, not `\w*`. `\w*` let "book" swallow
    // "Booker" and "pay" swallow "Payton", which is the over-matching this replaced.
    const [first, ...rest] = v.split(/\s+/);
    const head = `${esc(first!)}(?:s|ed|ing|d)?`;
    const tail = rest.length ? `\\s+${rest.map(esc).join('\\s+')}` : '';
    return new RegExp(`^${head}${tail}($|[^\\p{L}\\p{N}])`, 'u').test(trimmed);
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
