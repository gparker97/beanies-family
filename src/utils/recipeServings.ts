/**
 * Recipe servings: a NUMBER to the app, a digit STRING on disk (#116).
 *
 * `Recipe.servings` stays `string` in both the TypeScript type and the Automerge doc,
 * deliberately. Every client since 0.21.1 (the update floor) calls `.trim()` on it when a
 * recipe is saved, so a stored number would make every recipe edit throw on an older
 * phone. Keeping the type `string` means the compiler rejects a numeric write anywhere,
 * including hand-built `MutationOp`s that bypass the repository.
 *
 * New writes store the digit string ("4"). Older recipes still hold free text ("Serves
 * 4-6", "12 muffins"), and older clients keep writing it (Automerge is last-writer-wins),
 * so a one-time conversion could never hold. Parsing at READ time is the only durable
 * conversion, which is why every numeric read goes through `servingsOf`.
 */
import { fillTemplate } from './fillTemplate';
import type { Recipe } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** The largest servings count the app accepts (the form stepper's max reads this too). */
export const SERVINGS_MAX = 99;

/**
 * A range, "4-6" / "4–6" / "4 to 6". Collapsed to its LOW end before anything else is
 * matched, so the patterns below never need an optional range group (a nested quantifier
 * `security/detect-unsafe-regex` rightly flags). The low end is the honest count to scale by.
 */
const RANGE = /(\d+)\s*(?:-|–|to)\s*\d+/gi;
/**
 * A PEOPLE keyword before the number: "serves 4", "feeds 6", "Servings: 4", "Portions 6".
 * Singular "serving" is deliberately absent: "Serving size 1 cup" and "Per serving: 350
 * kcal" are nutrition, not a headcount. Global, so every match is tried in turn.
 */
// `(?!\d|...)` stops backtracking: without it "serves 12.5" would retreat to "1" and read 1.
const PEOPLE_BEFORE =
  /\b(?:serves|servings|feeds|portions?|people|persons?)\s*:?\s*(\d+)(?!\d|\s*[.,/]\d)/gi;
/**
 * What may follow a keyword-before count for it to be a headcount: the end, punctuation,
 * or a people word ("serves 4", "Serves 4.", "serves 4 people"). Another word makes it
 * ambiguous: "Serves 2 adults and 2 children" is not 2.
 */
const HEADCOUNT_END =
  /^\s*(?:$|[^\p{L}\p{N}\s]|(?:people|persons?|servings?|portions?|pax|guests?)\b)/iu;
/** "8 servings", "4 people", "6 portions", "4 persons". The number PRECEDES the keyword. */
// The lookbehind stops "1.5 servings" reading as 5 (a match starting mid-number).
const PEOPLE_AFTER = /(?<![\d.,/])(\d+)\s*(?:servings?|people|persons?|portions?|pax)\b/gi;
/** "makes 4", "yield: 6". Only honoured when no people count is found. */
const MAKES = /\b(?:yields?|makes)\s*:?\s*(\d+)(?!\d|\s*[.,/]\d)/i;
/** A bare count and nothing else: "4" (or a range, already collapsed to "4"). */
const BARE = /^\s*(\d+)\s*$/;

function toCount(digits: string | undefined): number | undefined {
  if (digits === undefined) return undefined;
  const n = Number(digits);
  return Number.isInteger(n) && n >= 1 && n <= SERVINGS_MAX ? n : undefined;
}

/**
 * The first VALID people count in the text, before or after its keyword, in reading
 * order. Every match is tried, so "Per serving: 350 kcal. Serves 4" is 4 and an
 * out-of-range early number never hides a later valid one.
 */
function peopleCount(text: string): number | undefined {
  // A keyword-before count is a headcount when a people word or punctuation follows it,
  // or when no OTHER number follows it at all ("Serves 4 as a main", "Serves 4 adults").
  // A second number is what makes it ambiguous: "Serves 2 adults and 2 children".
  const before = [...text.matchAll(PEOPLE_BEFORE)].filter((m) => {
    const rest = text.slice(m.index + m[0].length);
    return HEADCOUNT_END.test(rest) || !/\d/.test(rest);
  });
  const after = [...text.matchAll(PEOPLE_AFTER)];
  for (const m of [...before, ...after].sort((a, b) => a.index - b.index)) {
    const n = toCount(m[1]);
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * The number of people a recipe serves, or `undefined` when the text does not say.
 *
 * Only an UNAMBIGUOUS count of PEOPLE counts. "Makes 2 loaves (16 servings)" is 16, not
 * 2; "12 muffins", "Makes 2 loaves" and "Serves 2 adults and 2 children" are undefined,
 * because scaling a shopping list by the wrong count would buy the wrong amount (and
 * undefined falls back to the recipe's own amounts). `makes` / `yield` is only honoured
 * when no people count is found and nothing but the number follows it, so "makes 4"
 * reads 4, "makes 2 loaves" does not, and "Makes 24 cookies, serves 12" reads 12.
 */
export function parseServings(raw: unknown): number | undefined {
  // A non-integer is not a count of people (same rule as "Serves 1.5" below).
  if (typeof raw === 'number') return Number.isInteger(raw) ? toCount(String(raw)) : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().replace(RANGE, '$1');
  if (!text) return undefined;

  const people = peopleCount(text);
  if (people !== undefined) return people;

  const makes = MAKES.exec(text);
  if (makes) {
    // "makes 2 loaves", "makes 4, serves 2 adults": anything but punctuation after the
    // number names a thing (or muddies the count), not people.
    const rest = text.slice(makes.index + makes[0].length);
    if (/[\p{L}\p{N}]/u.test(rest)) return undefined;
    return toCount(makes[1]);
  }

  const bare = BARE.exec(text);
  return bare ? toCount(bare[1]) : undefined;
}

/** The ONLY way code reads a recipe's servings as a number (scaling, display, the form). */
export function servingsOf(recipe: Pick<Recipe, 'servings'> | undefined): number | undefined {
  return parseServings(recipe?.servings);
}

/**
 * The stored form of any incoming servings value: the digit string of its people count,
 * or `undefined` when there is none. Used by capture prefill and share-link decode.
 */
export function normalizeServings(raw: unknown): string | undefined {
  const n = parseServings(raw);
  return n === undefined ? undefined : String(n);
}

/** "Serves 4", or '' when the count is unknown. The one display helper. */
export function formatServes(n: number | undefined, t: (key: UIStringKey) => string): string {
  return n === undefined ? '' : fillTemplate(t('recipes.servesN'), { n });
}
