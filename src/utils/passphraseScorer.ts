/**
 * zxcvbn scoring for typed passphrases. LAZY: only `passphraseStrength.checkPassphrase`
 * imports this, via `await import()`, so the ~1 MB of dictionaries stays out of the entry
 * chunk and a scorer failure never disables suggestions (those live in the EFF chunk).
 *
 * `language-common` only; `language-en` is mostly name/TV dictionaries and is replaced by
 * `userInputs` (family and member names). The retired 256-word list is registered as a
 * dictionary so an old 4-word suggestion scores ~10^9.6 however it is spaced or ordered.
 */
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import { LEGACY_WORDLIST } from '@/constants/legacyWordlist';
import { splitPassphraseWords } from '@/utils/passphraseTokens';

/** A phrase needs at least 10^12 estimated guesses (score 4 is already implied by it). */
export const MIN_GUESSES_LOG10 = 12;

const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, beaniesLegacy: [...LEGACY_WORDLIST] },
  graphs: common.adjacencyGraphs,
});

type Score = 0 | 1 | 2 | 3 | 4;

/** Meter bands, scaled so that score 4 is exactly `>= MIN_GUESSES_LOG10`. */
function scoreFor(guessesLog10: number): Score {
  if (guessesLog10 >= MIN_GUESSES_LOG10) return 4;
  if (guessesLog10 >= 10) return 3;
  if (guessesLog10 >= 8) return 2;
  if (guessesLog10 >= 6) return 1;
  return 0;
}

/**
 * zxcvbn's own whole-string estimate under-prices phrases built from separated words: a
 * separator next to a word defeats its dictionary match (measured: "apple anchor autumn
 * bacon" came out at 10^16, though every word is in the legacy list). So a multi-word
 * phrase is ALSO priced word by word, as the product of each word's own guess count, and
 * the cheaper of the two estimates wins. Never raises an estimate, only lowers it.
 */
export function scorePassphrase(
  phrase: string,
  userInputs: string[]
): { score: Score; guessesLog10: number; warning: string | null } {
  const whole = zxcvbn.check(phrase, userInputs);
  let guessesLog10 = whole.guessesLog10;
  const words = splitPassphraseWords(phrase);
  if (words.length > 1) {
    const perWord = words.reduce((sum, w) => sum + zxcvbn.check(w, userInputs).guessesLog10, 0);
    guessesLog10 = Math.min(guessesLog10, perWord);
  }
  return { score: scoreFor(guessesLog10), guessesLog10, warning: whole.feedback.warning ?? null };
}
