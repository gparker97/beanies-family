/**
 * What a re-read of the source would change about a saved recipe (#93).
 *
 * Pure: no Vue, no stores, no network — so the rules below are unit-testable without a
 * component harness. It wraps `diffPayload` rather than reimplementing comparison, and adds
 * the one rule `diffPayload` must not learn: a re-fetch may ADD or CHANGE, never EMPTY.
 */
import { diffPayload } from './diffPayload';
import { recipeComparable, type RecipeComparable } from './recipeComparable';
import type { RecipePrefill } from './recipeExtractionToRecipe';
import type { Recipe } from '@/types/models';

/** Fields the diff can show, in the order the modal renders them. */
const DISPLAY_ORDER = [
  'name',
  'subtitle',
  'prepTime',
  'cookTime',
  'servings',
  'ingredients',
  'steps',
  'notes',
  'course',
  'mealSlots',
] as const;

export type RecipeDiffField = (typeof DISPLAY_ORDER)[number];

export interface RecipeDiffRow {
  field: RecipeDiffField;
  /** What the recipe holds today. `undefined` / `[]` renders as "nothing yet". */
  mine: unknown;
  /** What the source says now. Never emptier than `mine` — see `isEmptyish`. */
  theirs: unknown;
}

export interface RecipeDiff {
  rows: RecipeDiffRow[];
  /** A dish photo is on offer. True only when the recipe has none yet — see below. */
  photo: boolean;
  /** Nothing to show. Lets the caller toast "nothing new" instead of opening an empty modal. */
  changed: boolean;
  /** The patch to hand `updateRecipe`, already `diffPayload`-shaped and minimal. */
  patch: Partial<RecipeComparable>;
}

/**
 * "This value would empty the field."
 *
 * ⚠️ TWO DISTINCT MECHANISMS, ONE PREDICATE, and both are live:
 *
 *   - a key present with `undefined` becomes a DELETE in `automergeRepository.update`, which
 *     keys its delete list off `Object.keys`;
 *   - an EMPTY ARRAY is not normalised by `diffPayload` at all, so it is written as a literal
 *     `[]` — an assignment that wipes the list just as thoroughly, by a different route.
 *
 * The second is not theoretical: `RecipePrefill.fields.ingredients`/`steps` are unconditional
 * arrays and the capture ladder's `titleOnly` rung produces both empty, so it fires on every
 * video re-fetch. And `recipeExtractionToPrefill` deliberately accepts an extraction with
 * ingredients and NO NAME, so the first can reach the recipe's name.
 *
 * A user who hand-edited a recipe must never lose that work to a worse reading of the page.
 */
function isEmptyish(value: unknown): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function hasContent(value: unknown): boolean {
  return !isEmptyish(value) && value !== null;
}

/**
 * Diff a saved recipe against a fresh reading of its source.
 *
 * Nothing is written here. The result is what the modal shows and, if the user takes it,
 * exactly what `updateRecipe` is handed.
 */
export function diffRecipe(current: Recipe, prefill: RecipePrefill): RecipeDiff {
  // ⚠️ REST-SPREAD, never a field-by-field re-pick. `prefill.fields` is built with conditional
  // spread throughout, so an absent key is genuinely ABSENT — and `diffPayload` treats absence
  // as "leave it alone". Re-picking would turn every absent key into a present-`undefined`
  // one, which `diffPayload` emits as a DELETE: a re-fetch that read less than the original
  // would silently strip the recipe.
  //
  // `sourceUrl` is dropped because capture rewrites it to the resolved provenance URL, which
  // reads as spurious churn. `tags` are not on `RecipePrefill.fields` at all, so omission
  // already excludes them.
  const { sourceUrl: _sourceUrl, ...incoming } = prefill.fields;

  const baseline = recipeComparable(current);
  const raw = diffPayload(baseline, incoming as Partial<RecipeComparable>);

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    // The never-clear rule, applied once, covering both mechanisms above.
    if (isEmptyish(value) && hasContent((baseline as Record<string, unknown>)[key])) continue;
    patch[key] = value;
  }

  const rows: RecipeDiffRow[] = DISPLAY_ORDER.filter((field) => field in patch).map((field) => ({
    field,
    mine: (baseline as Record<string, unknown>)[field],
    theirs: patch[field],
  }));

  // ⚠️ OFFERED ONLY WHEN THE RECIPE HAS NO PHOTO YET. `PhotoAttachment` carries no source
  // URL, so there is no way to tell "the same og:image we already stored" from a new one —
  // and with no per-field toggles in v1, taking a text change would silently add a duplicate
  // on every press. This is honest, needs no model change, and covers the case that actually
  // hurts (a recipe captured before the photo ladder existed). Provenance-aware replacement
  // is a follow-up.
  const photo = (prefill.dishImage?.candidates.length ?? 0) > 0 && !current.photoIds?.length;

  return {
    rows,
    photo,
    changed: rows.length > 0 || photo,
    patch: patch as Partial<RecipeComparable>,
  };
}
