/**
 * THE keyword matcher: "which value do the words in this text name?". Value-generic, so one set
 * of matching rules serves the chore and reward pictures (`emojiSuggester`, a thin adapter in
 * `emojiSuggest.ts`), the activity and transaction category guess (`categorySuggest.ts`) and
 * the category pickers' search (`matchesQuery`). Each caller passes its own table; the rules
 * live only here. Pure.
 *
 * English words match whole words (an optional plural `s` / `es` allowed), so "cat" never fires
 * inside "education"; Chinese words match anywhere in the text. `weak` marks a generic word
 * ("feed", "game"): any other word beats it. Within a tier the longest keyword wins, then the
 * earlier table entry.
 *
 * Keywords are compared as written, so a table keeps them lowercase: the text is lowercased,
 * the keyword is not.
 */

/** One keyword entry: never shown, only matched. */
export interface KeywordEntry<T> {
  value: T;
  words: readonly string[];
  weak?: boolean;
}

/** A match: the value, and the keyword (as written in the table) that named it. */
export interface KeywordHit<T> {
  value: T;
  word: string;
}

/** A suggester over one keyword table (`keywordSuggester`). */
export interface KeywordSuggester<T> {
  /**
   * The value the text names, or `undefined` when nothing in it is known. The most specific
   * word wins: a strong word over a weak one, then the longest keyword, then the earlier entry.
   */
  suggest: (text: string) => KeywordHit<T> | undefined;
  /**
   * Every value the text matches, in its strongest tier: the strong words' values when any
   * strong word is in the text, else the weak ones'. So a generic word holds no value once a
   * specific word is there. `suggest` is always one of these. Empty when nothing is known.
   */
  matches: (text: string) => ReadonlySet<T>;
}

interface Matcher<T> {
  value: T;
  word: string;
  weak: boolean;
  order: number;
  size: number;
  test: (text: string) => boolean;
}

const isLatinLetter = (ch: string) => ch >= 'a' && ch <= 'z';

function hasWholeWord(text: string, form: string): boolean {
  for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) {
    const before = at === 0 ? '' : text.charAt(at - 1);
    const after = text.charAt(at + form.length);
    if (!isLatinLetter(before) && !isLatinLetter(after)) return true;
  }
  return false;
}

function matcherFor(word: string): (text: string) => boolean {
  if (!/[a-z]/.test(word)) return (text) => text.includes(word);
  // Whole word, with an optional plural. Plain string search: no pattern is built from data.
  const forms = [word, `${word}s`, `${word}es`];
  return (text) => forms.some((form) => hasWholeWord(text, form));
}

/**
 * Lowercase for matching. `toLowerCase`, never `toLocaleLowerCase`: on a Turkish-locale device
 * the locale form turns "I" into a dotless "ı", so "PICNIC" would stop matching "picnic"
 * (`textSimilarity.ts` documents the same hazard).
 *
 * A possessive apostrophe (the typed ' or the typographic U+2019 an iOS keyboard inserts) is
 * dropped, so a possessive is one word: "Wendy's" reads as "wendys", the keyword as stored,
 * where the apostrophe would otherwise split it into "wendy" and "s". Only the possessive: an
 * apostrophe followed by `s` and then a non-letter or the end. Any other apostrophe stays, so a
 * contraction never joins into a word ("she'll" must not read as "shell"; "don't", "o'clock"
 * are untouched). So a table never writes an apostrophe: it could never match.
 */
const POSSESSIVE_APOSTROPHE = /['\u2019](?=s(?![a-z]))/g;
const normalise = (text: string) => text.trim().toLowerCase().replace(POSSESSIVE_APOSTROPHE, '');

/** An apostrophe (typed or U+2019) at the very end of a query: see `matchesQuery`. */
const TRAILING_APOSTROPHE = /['\u2019]$/;

/**
 * Whether a picker query is a search at all: the pickers' one emptiness test, so the picker
 * (`GroupedChipPicker`, which swaps its groups for results) and `matchesQuery` cannot disagree.
 */
export const isSearchQuery = (query: string): boolean => normalise(query) !== '';

/** A suggester over `table`. Each keyword is compiled once, here. */
export function keywordSuggester<T>(table: readonly KeywordEntry<T>[]): KeywordSuggester<T> {
  const matchers: Matcher<T>[] = table.flatMap((entry, order) =>
    entry.words.map((word) => ({
      value: entry.value,
      word,
      weak: !!entry.weak,
      order,
      size: word.length,
      test: matcherFor(word),
    }))
  );
  const hits = (text: string): Matcher<T>[] => {
    const lower = normalise(text);
    if (!lower) return [];
    const all = matchers.filter((m) => m.test(lower));
    // The strongest tier present: a weak word counts only when no strong word matched.
    return all.some((m) => !m.weak) ? all.filter((m) => !m.weak) : all;
  };
  return {
    suggest: (text) => {
      let best: Matcher<T> | undefined;
      for (const m of hits(text)) {
        if (!best || m.size > best.size || (m.size === best.size && m.order < best.order)) {
          best = m;
        }
      }
      return best && { value: best.value, word: best.word };
    },
    matches: (text) => new Set(hits(text).map((m) => m.value)),
  };
}

/**
 * The pickers' one search rule: the label contains the query, or one of the keywords does
 * (both sides normalised as above: lowercased, trimmed, possessive apostrophes dropped). An
 * empty query (`!isSearchQuery`) matches nothing, so the caller shows its full list; any other
 * query is a plain substring filter, with no minimum length, so the first keystroke never reads
 * as "no match". Pure.
 *
 * A query that ENDS with an apostrophe after other text ("wendy'", one keystroke before
 * "wendy's") is matched as if the apostrophe were not typed yet, so the results never blink
 * out mid-word. Only the query, and only a trailing one: a lone apostrophe is still a query.
 */
export function matchesQuery(query: string, label: string, keywords: readonly string[]): boolean {
  if (!isSearchQuery(query)) return false;
  const typed = normalise(query);
  const q = typed.length > 1 ? typed.replace(TRAILING_APOSTROPHE, '') : typed;
  return normalise(label).includes(q) || keywords.some((word) => normalise(word).includes(q));
}
