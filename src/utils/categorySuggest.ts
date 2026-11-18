/**
 * The category guess (#152): which activity or transaction category the words in a title or
 * description name. The ONE place the guess is composed, read by the activity and transaction
 * forms (`useCategoryGuess`) and by AI capture (`extractionToActivity.inferActivityCategory`).
 * Pure.
 *
 * Every category keeps its words on its own definition (`keywords` / `weakKeywords` in
 * `constants/activityCategories.ts` and `constants/categories.ts`) and all of them go through
 * the one matcher (`keywordSuggest.ts`). The occasion categories are the exception: their words,
 * veto list and precedence stay in `OCCASION_TYPES`, and `matchOccasionCategory` is asked first
 * ("Anniversary dinner" is an anniversary, not dining out).
 *
 * Lives in `utils`, not beside the constants, because `occasions.ts` documents an import-cycle
 * hazard: this module imports constants, `occasions.ts` and the matcher, and nothing that logs.
 */
import type { ActivityCategory } from '@/types/models';
import { ACTIVITY_CATEGORIES } from '@/constants/activityCategories';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/constants/categories';
import { OCCASION_TYPES, matchOccasionCategory } from '@/utils/occasions';
import { containsPhrase } from '@/utils/textSimilarity';
import { keywordSuggester, type KeywordEntry, type KeywordHit } from '@/utils/keywordSuggest';

interface KeywordedDef<T> {
  id: T;
  keywords: readonly string[];
  weakKeywords?: readonly string[];
}

/**
 * One table per area, built once: each definition's strong words, then (only when `withWeak`)
 * its weak ones.
 */
function tableOf<T>(defs: readonly KeywordedDef<T>[], withWeak: boolean): KeywordEntry<T>[] {
  return defs.flatMap((def) => {
    const entries: KeywordEntry<T>[] = [{ value: def.id, words: def.keywords }];
    if (withWeak && def.weakKeywords?.length) {
      entries.push({ value: def.id, words: def.weakKeywords, weak: true });
    }
    return entries;
  });
}

// Each area has its own table and they are never merged: "game" is a sporting event for an
// activity, and "rent" is Rent / Mortgage going out but Rental Income coming in.
// Activities guess from strong + weak words. Transactions guess from STRONG words only: a wrong
// guess lands money in the wrong budget line, so a transaction category's `weakKeywords` are
// searchable in the picker but never guessed.
const ACTIVITY_SUGGESTER = keywordSuggester(tableOf(ACTIVITY_CATEGORIES, true));
const INCOME_SUGGESTER = keywordSuggester(tableOf(INCOME_CATEGORIES, false));
const EXPENSE_SUGGESTER = keywordSuggester(tableOf(EXPENSE_CATEGORIES, false));

/**
 * The activity category a title names, with the word that named it, or `undefined`. The
 * occasion matcher first (its word is the first of the occasion's own keywords found in the
 * text), then every other category's keywords.
 */
export function suggestActivityCategory(text: string): KeywordHit<ActivityCategory> | undefined {
  const occasion = matchOccasionCategory(text);
  if (occasion) {
    const word = OCCASION_TYPES[occasion].keywords.find((k) => containsPhrase(text, k)) ?? '';
    return { value: occasion, word };
  }
  return ACTIVITY_SUGGESTER.suggest(text);
}

/**
 * The transaction category a description names, from the income table for money coming in and
 * the expense table for money going out, or `undefined`. Strong words only (see above).
 */
export function suggestTransactionCategory(
  text: string,
  type: 'income' | 'expense'
): KeywordHit<string> | undefined {
  return (type === 'income' ? INCOME_SUGGESTER : EXPENSE_SUGGESTER).suggest(text);
}
