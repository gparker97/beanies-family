/**
 * Recovery-passphrase generation and the one acceptance check.
 *
 * Suggestions are 6 words from the EFF large list (~77 bits), drawn with unbiased rejection
 * sampling. Typed phrases are scored by zxcvbn (`passphraseScorer.ts`, lazy) and must clear
 * `MIN_GUESSES_LOG10`; the verdict fails CLOSED if the scorer cannot load. The retired
 * 256-word list is kept only as `LEGACY_WORDLIST`: it detects old suggestions for the
 * settings nudge and is a zxcvbn dictionary so such phrases score as the weak things they are.
 */
import { reportError } from '@/utils/errorReporter';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * The retired 256-word list (8 bits a word, so a 4-word phrase carried only 32 bits).
 * `generatePassphrase` never uses it again.
 */
import { LEGACY_WORDLIST } from '@/constants/legacyWordlist';
import {
  canonPassphrase,
  PASSPHRASE_SEPARATORS,
  splitPassphraseWords,
} from '@/utils/passphraseTokens';
export { LEGACY_WORDLIST };

export const PASSPHRASE_WORD_COUNT = 6;
export const PASSPHRASE_MIN_LENGTH = 14;
const LEGACY_WORD_COUNT = 4;
const LEGACY_SET: ReadonlySet<string> = new Set(LEGACY_WORDLIST);

/** True for exactly what the old generator produced: 4 hyphen-joined lowercase legacy words. */
export function isLegacyGeneratedShape(phrase: string): boolean {
  const tokens = phrase.trim().split('-');
  return tokens.length === LEGACY_WORD_COUNT && tokens.every((w) => LEGACY_SET.has(w));
}

/** Draw `count` unbiased indices in [0, range) from 13-bit draws (range <= 8192). */
export function drawIndices(count: number, range: number): number[] {
  const BITS = 13;
  const SPACE = 1 << BITS;
  const limit = SPACE - (SPACE % range); // reject draws in the biased tail
  const out: number[] = [];
  while (out.length < count) {
    const buf = crypto.getRandomValues(new Uint16Array(count * 2));
    for (const raw of buf) {
      const v = raw & (SPACE - 1);
      if (v < limit) {
        out.push(v % range);
        if (out.length === count) break;
      }
    }
  }
  return out;
}

let generatorPool: readonly string[] | null = null;

/**
 * Generate a 6-word passphrase (`word-word-...`) of six DISTINCT single words. Loads the
 * EFF list on first use.
 *
 * Two kinds of draw used to slip through about once in 200 phrases, and both broke the
 * scorer-unavailable fallback (`isEffFallbackPhrase`), which only accepts six distinct EFF
 * words: a repeated word, and one of the list's four hyphenated words ("t-shirt", "yo-yo"),
 * which the hyphen joiner splits into pieces that are not on the list. So the pool drops
 * any word containing a separator, and repeats are redrawn. The pool is 7,772 words, so
 * the phrase keeps its entropy.
 */
export async function generatePassphrase(): Promise<string> {
  const { EFF_WORDLIST } = await import('@/constants/effWordlist');
  generatorPool ??= EFF_WORDLIST.words.filter((w) => !PASSPHRASE_SEPARATORS.test(w));
  const pool = generatorPool;
  const picked = new Set<number>();
  while (picked.size < PASSPHRASE_WORD_COUNT) {
    for (const i of drawIndices(PASSPHRASE_WORD_COUNT - picked.size, pool.length)) picked.add(i);
  }
  return [...picked].map((i) => pool[i]).join('-');
}

type Score = 0 | 1 | 2 | 3 | 4;

export type PassphraseRefusal =
  'too-short' | 'matches-name' | 'too-guessable' | 'scorer-unavailable';

export type PassphraseVerdict =
  | { ok: true; score: 4 }
  | { ok: false; reason: PassphraseRefusal; score: Score; hintKey?: UIStringKey };

/**
 * The ONE reason -> copy map, shared by `authStore.setRecoveryPassphrase` (the Save error)
 * and `RecoveryPassphraseEditor` (the live message) so the two can never disagree.
 */
export const PASSPHRASE_REFUSAL_KEY: Record<PassphraseRefusal, UIStringKey> = {
  'too-short': 'recovery.passphraseTooWeak',
  'matches-name': 'recovery.passphraseMatchesName',
  'too-guessable': 'recovery.passphraseTooGuessable',
  'scorer-unavailable': 'recovery.passphraseCheckUnavailable',
};

/**
 * zxcvbn-ts warning keys (no translations are loaded, so `feedback.warning` is the key
 * itself: straightRow, keyPattern, simpleRepeat, extendedRepeat, sequences, recentYears,
 * dates, topTen, topHundred, common, similarToCommon, wordByItself, namesByThemselves,
 * commonNames, userInputs, pwned) -> the four hints we translate.
 */
const HINT_SLUGS: ReadonlyArray<[RegExp, UIStringKey]> = [
  [/repeat/i, 'recovery.strengthHint.repeats'],
  [/sequence|straightRow|keyPattern/i, 'recovery.strengthHint.sequences'],
  [/year|date/i, 'recovery.strengthHint.dates'],
  [
    /common|similar|topTen|topHundred|names|userInputs|wordByItself|pwned/i,
    'recovery.strengthHint.commonWord',
  ],
];

function hintKeyFor(warning: string | null): UIStringKey | undefined {
  if (!warning) return undefined;
  return HINT_SLUGS.find(([re]) => re.test(warning))?.[1];
}

let effSet: Promise<ReadonlySet<string>> | null = null;
/** The EFF list as a Set, loaded once (it is a lazy chunk) and shared by every check. */
function loadEffSet(): Promise<ReadonlySet<string>> {
  effSet ??= import('@/constants/effWordlist').then(
    ({ EFF_WORDLIST }) => new Set(EFF_WORDLIST.words)
  );
  return effSet;
}

/**
 * The FALLBACK when the scorer chunk cannot load: a phrase of six or more DISTINCT words,
 * every one on the EFF long list and none of them a family or member name, is accepted at
 * score 4 so a suggested phrase is never a dead end. It is only ever consulted after the
 * scorer has failed to load; with the scorer available every phrase is scored for real
 * (a typed six-word EFF phrase is not uniformly random). `false` when the EFF chunk itself
 * cannot load; the caller then fails closed.
 */
async function isEffFallbackPhrase(trimmed: string, userInputs: string[]): Promise<boolean> {
  const words = splitPassphraseWords(trimmed);
  if (words.length < PASSPHRASE_WORD_COUNT || new Set(words).size !== words.length) return false;
  const names = new Set(userInputs.flatMap((n) => splitPassphraseWords(n)));
  if (words.some((w) => names.has(w))) return false;
  try {
    const eff = await loadEffSet();
    return words.every((w) => eff.has(w));
  } catch {
    effSet = null; // let a later call retry the chunk
    return false;
  }
}

/**
 * The ONE acceptance rule for a passphrase: at least 14 characters, never equal to a name in
 * `userInputs` (family, member names, aliases, email local-parts), and hard enough to guess.
 * Async because the scorer is a lazy chunk; fails closed with `scorer-unavailable`.
 */
export async function checkPassphrase(
  phrase: string,
  userInputs: string[] = []
): Promise<PassphraseVerdict> {
  const trimmed = phrase.trim();
  if (trimmed.length < PASSPHRASE_MIN_LENGTH) {
    return { ok: false, reason: 'too-short', score: 0 };
  }
  const canonPhrase = canonPassphrase(trimmed);
  if (userInputs.some((n) => !!n && canonPassphrase(n) === canonPhrase)) {
    return { ok: false, reason: 'matches-name', score: 0 };
  }
  let scorer: typeof import('./passphraseScorer');
  try {
    scorer = await import('./passphraseScorer');
  } catch (error) {
    reportError({
      surface: 'passphrase-strength',
      message: 'the passphrase scorer could not be loaded',
      severity: 'error',
      error,
      context: { action: 'scorer_load_failed' },
    });
    if (await isEffFallbackPhrase(trimmed, userInputs)) return { ok: true, score: 4 };
    return { ok: false, reason: 'scorer-unavailable', score: 0 };
  }
  const r = scorer.scorePassphrase(trimmed, userInputs);
  if (r.guessesLog10 < scorer.MIN_GUESSES_LOG10) {
    const hintKey = hintKeyFor(r.warning);
    return {
      ok: false,
      reason: 'too-guessable',
      score: Math.min(r.score, 3) as Score,
      ...(hintKey ? { hintKey } : {}),
    };
  }
  return { ok: true, score: 4 };
}
