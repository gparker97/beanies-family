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
