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

/**
 * A suggester over `table`: a name's picture, or `undefined` when nothing in it is known. Each
 * keyword is compiled once, here. The most specific word wins: a strong word over a weak one,
 * then the longest keyword, then the earlier table entry.
 */
export function emojiSuggester(
  table: readonly EmojiKeywordEntry[]
): (name: string) => string | undefined {
  const matchers: Matcher[] = table.flatMap((entry, order) =>
    entry.words.map((word) => ({
      emoji: entry.emoji,
      weak: !!entry.weak,
      order,
      size: word.length,
      test: matcherFor(word),
    }))
  );
  return (name) => {
    const text = name.trim().toLocaleLowerCase();
    if (!text) return undefined;
    let best: Matcher | undefined;
    for (const m of matchers) {
      if (!m.test(text)) continue;
      if (
        !best ||
        (best.weak && !m.weak) ||
        (best.weak === m.weak &&
          (m.size > best.size || (m.size === best.size && m.order < best.order)))
      ) {
        best = m;
      }
    }
    return best?.emoji;
  };
}

/**
 * Does a rename re-pick the picture? Only when the new name suggests something (`after`) and
 * that differs from what the old name suggested (`before`): the thing turned into something
 * else. The one condition `emojiAfterRename` and a caller with more than an emoji (a chore's card
 * art, `chorePictureAfterRename`) both read. Pure.
 */
export function renameRepicks(
  before: string | undefined,
  after: string | undefined
): after is string {
  return after !== undefined && after !== before;
}

/**
 * A picture once its name has changed, from the suggestions for the old and the new name (any
 * suggester: it takes the two answers, not the names), shared by chores and rewards. Only a
 * CHANGE of suggestion re-picks (`renameRepicks`): the new name's suggestion wins, even over a
 * picture picked by hand. Otherwise (the same suggestion, as for "Allowance" to "Weekly
 * allowance", or none) `current` stays, picked by hand or not; only no picture at all gets
 * `after`, else `fallback`.
 *
 * `before` is the suggestion for the name the picture was last settled against (the stored or
 * opened name, or the name at a pick by hand), never the previous keystroke, so a small edit
 * cannot clobber a hand pick and opening something never changes its picture. Nothing records
 * how a picture was chosen. Pure.
 */
export function emojiAfterRename(rename: {
  before: string | undefined;
  after: string | undefined;
  current: string | undefined;
  fallback: string;
}): string {
  const { before, after, current, fallback } = rename;
  if (renameRepicks(before, after)) return after;
  return current || (after ?? fallback);
}
