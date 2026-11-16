/**
 * The ONE "picture from the words in a name" matcher, shared by the chore suggester
 * (`suggestChoreEmoji`, `constants/choreBlocks.ts`) and the reward suggester
 * (`suggestRewardEmoji`, `constants/choreStars.ts`). Each passes its own keyword table; the
 * algorithm lives only here. Pure.
 *
 * English words match whole words (an optional plural `s` / `es` allowed), so "cat" never fires
 * inside "education"; Chinese words match anywhere in the name. `weak` marks a generic word
 * ("feed", "trip"): any other word beats it. Within a tier the longest keyword wins, then the
 * earlier table entry.
 *
 * The rename rule both follow (`pictureAfterRename`) lives here too, so chores and rewards
 * re-pick a picture for exactly the same reasons.
 */

/** One keyword entry: never shown, only matched. */
export interface EmojiKeywordEntry {
  emoji: string;
  words: readonly string[];
  weak?: boolean;
}

interface Matcher {
  emoji: string;
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

/** A suggester over one keyword table (`emojiSuggester`). */
export interface EmojiSuggester {
  /**
   * A name's picture, or `undefined` when nothing in it is known. The most specific word wins:
   * a strong word over a weak one, then the longest keyword, then the earlier table entry.
   */
  suggest: (name: string) => string | undefined;
  /**
   * Every picture the name matches, in its strongest tier: the strong words' pictures when any
   * strong word is in the name, else the weak ones'. So a generic word ("brush", "feed") holds
   * no picture once a specific word is there ("Brush hair" matches the comb, not the
   * toothbrush). `suggest` is always one of these. Empty when nothing is known.
   */
  matches: (name: string) => ReadonlySet<string>;
}

/** Scripts written without spaces between words: a name in one compares by character. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
/** Short English words too common to make two names "the same name". */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'your',
  'our',
  'from',
  'into',
]);

/** A name's significant words: words of three or more letters, and each character of a word in
 * a script written without spaces. Punctuation and digits never count. */
function significantWords(name: string): Set<string> {
  const out = new Set<string>();
  for (const word of name.toLocaleLowerCase().split(/[^\p{L}\p{M}]+/u)) {
    if (UNSPACED_SCRIPT.test(word)) {
      for (const ch of word) if (UNSPACED_SCRIPT.test(ch)) out.add(ch);
    } else if ([...word].length >= 3 && !FILLER_WORDS.has(word)) out.add(word);
  }
  return out;
}

/**
 * Whether `newName` is an edit of `oldName` rather than a different name: they share at least
 * one significant word (case-insensitive; `significantWords`). "Clear your plate" to "Clear the
 * table" is an edit (both say "clear"); "Clear your plate" to "Feed the dog" is not. Pure.
 */
export function isEditOfName(oldName: string, newName: string): boolean {
  const before = significantWords(oldName);
  for (const word of significantWords(newName)) if (before.has(word)) return true;
  return false;
}

/** A suggester over `table`. Each keyword is compiled once, here. */
export function emojiSuggester(table: readonly EmojiKeywordEntry[]): EmojiSuggester {
  const matchers: Matcher[] = table.flatMap((entry, order) =>
    entry.words.map((word) => ({
      emoji: entry.emoji,
      weak: !!entry.weak,
      order,
      size: word.length,
      test: matcherFor(word),
    }))
  );
  const hits = (name: string): Matcher[] => {
    const text = name.trim().toLocaleLowerCase();
    if (!text) return [];
    const all = matchers.filter((m) => m.test(text));
    // The strongest tier present: a weak word counts only when no strong word matched.
    return all.some((m) => !m.weak) ? all.filter((m) => !m.weak) : all;
  };
  return {
    suggest: (name) => {
      let best: Matcher | undefined;
      for (const m of hits(name)) {
        if (!best || m.size > best.size || (m.size === best.size && m.order < best.order)) {
          best = m;
        }
      }
      return best?.emoji;
    },
    matches: (name) => new Set(hits(name).map((m) => m.emoji)),
  };
}

/**
 * THE rename rule for a picture, shared by chores and rewards: the NEW picture a rename gives,
 * or `undefined` when the current picture stays as it is (and, for a chore, its card art too).
 * A new picture replaces card art.
 *
 *   1. The new name suggests nothing: keep.
 *   2. No picture at all (`current` empty and no art): the new name's suggestion.
 *   3. The settled name suggested a picture: re-pick ONLY when the name's meaning moved away
 *      from it, i.e. the new name no longer matches that picture at all (`matches`). A longer
 *      keyword appended to the same thing ("Take out the trash" to "Take out the trash after
 *      dinner", "Take a bath" to "Take a bath before bedtime") changes the single best match
 *      but still matches the old one, so it keeps a hand pick and card art.
 *   4. The settled name suggested nothing: the plain default (`plainDefault`, no art) yields
 *      to the new name's suggestion. A real picture (a hand pick, card art, a starter set's
 *      picture) stays when the new name is an edit of the settled one (`isEditOfName`: they
 *      share a significant word) or there was no settled name yet (a first title), and gives
 *      way to the suggestion when it is a different name. So "Clear your plate" (art) renamed
 *      to "Clear your plate after dinner" or "Clear the table" keeps its art, and renamed to
 *      "Feed the dog" gets the dog.
 *
 * `settledName` is the name the picture was last settled against: the stored or opened name, or
 * the name at a pick by hand (which wins immediately: the caller simply stores it), never the
 * previous keystroke. Opening something (the name unchanged) never changes a real picture.
 * Nothing records how a picture was chosen. Pure.
 */
export function pictureAfterRename(
  suggester: EmojiSuggester,
  rename: {
    settledName: string;
    newName: string;
    /** The picture now; empty or undefined is none. */
    current: string | undefined;
    /** Card art is drawn instead of the emoji (chores): a real picture whatever the emoji. */
    hasArt: boolean;
    /** The picture a row has when nothing was picked and nothing suggested. */
    plainDefault: string;
  }
): string | undefined {
  const { settledName, newName, current, hasArt, plainDefault } = rename;
  const after = suggester.suggest(newName);
  if (after === undefined) return undefined;
  if (!current && !hasArt) return after;
  const before = suggester.suggest(settledName);
  if (before !== undefined) return suggester.matches(newName).has(before) ? undefined : after;
  if (!hasArt && current === plainDefault) return after;
  return !settledName.trim() || isEditOfName(settledName, newName) ? undefined : after;
}
