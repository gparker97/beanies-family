/**
 * What a NEW list contains — the pure rules, with no store, no clock and no I/O.
 *
 * These are the parts of list creation most likely to drift as `FamilyList` grows
 * fields, so they live where they can be asserted directly rather than only observed
 * through a mounted store: same argument `completedListBands.ts` makes for banding and
 * `expiredCycleIds` makes for the cycle sweep. `listStore` keeps the orchestration
 * (resolve, delegate, mirror, report); everything about *field policy* is here.
 */
import { generateUUID } from './id';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from './fillTemplate';
import { isRecurring } from './listLifecycle';
import type { CreateFamilyListInput, FamilyList, FamilyListItem } from '@/types/models';

/**
 * Items for a brand-new list: fresh ids, nothing ticked.
 *
 * Shared by the template path and the copy path — it is the one rule both genuinely
 * have in common, and the one that silently corrupts data if it is ever forgotten
 * (reusing a source item's id would make two lists alias the same item).
 */
export function freshItems(titles: string[]): FamilyListItem[] {
  return titles.map((title) => ({ id: generateUUID(), title, completed: false }));
}

/** One owner of a copy. Only the two fields the seed actually reads. */
export interface CopyOwner {
  id: string;
  name: string;
}

export interface BuildCopySeedsArgs {
  source: FamilyList;
  /** In selection order — one seed is produced per owner, in this order. */
  owners: CopyOwner[];
  /** A `{bean}`-bearing template; `{bean}` expands to each owner's name. */
  titleTemplate: string;
  /** ymd. Stamped as `lastResetDate` on a recurring copy so it does not reset today. */
  today: string;
  /** The member performing the copy — NOT the source list's original creator. */
  createdBy: string;
}

/**
 * One `CreateFamilyListInput` per owner. Pure: same inputs, same output, always.
 *
 * What is deliberately ABSENT from the seed is as load-bearing as what is present:
 * `linkedActivityId` / `linkedVacationId` (a copy of a packing list must not also be
 * attached to the original trip), `completedBy` / `completedAt`, `dueDate`, and
 * `templateKey` (it means "which curated template seeded this", and a copy of a copy
 * was seeded by neither — carrying it would corrupt template analytics).
 */
export function buildCopySeeds(args: BuildCopySeedsArgs): CreateFamilyListInput[] {
  const { source, owners, titleTemplate, today, createdBy } = args;
  const itemTitles = source.items.map((i) => i.title);
  // Read lifecycle through the shared predicate, never an inline `lifecycle === …`
  // — the invariant `models.ts` states on `FamilyList` and `listStore` re-states.
  const lastResetDate = isRecurring(source) ? today : undefined;

  return owners.map((owner) => ({
    // An emptied `{bean}` token must not yield a nameless list. Falling back to the
    // source title is why the modal needs no blank-title validation branch.
    title: fillTemplate(titleTemplate, { bean: owner.name }).trim() || source.title,
    emoji: source.emoji,
    category: source.category,
    ownerId: owner.id,
    items: freshItems(itemTitles),
    lifecycle: source.lifecycle,
    frequency: source.frequency,
    cadence: source.cadence,
    lastResetDate,
    cycleCelebrated: false,
    completed: false,
    createdBy,
  }));
}

// ── A shopping list from a recipe (#88) ──────────────────────────────────────
//
// `Recipe.ingredients` is already `string[]` and a `FamilyListItem` is already a
// free-text title plus a tick, so "2 cups plain flour" becomes one item unchanged.
// This is a mapping function, not an extraction problem — v1 uses no AI at all.

/**
 * Trim every line and drop the empties.
 *
 * Private, and shared by BOTH directions below — the DRY unit here is the
 * CLEANING, not the policy. The two public functions differ precisely in whether
 * the heading rule applies, and collapsing them would reintroduce the bug the
 * split exists to prevent (see `parseDraftItems`).
 */
function cleanLines(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0);
}

/**
 * Is this line a section heading rather than an ingredient?
 *
 * ⚠️ DELIBERATELY NARROW, and the narrowness is the whole safety argument. A line
 * qualifies only when it ends with ':' AND contains no digit, so "2 cups flour:"
 * — a real ingredient someone happened to punctuate — survives. The broad rule
 * ("ends with a colon") silently deletes that, which is a wrong answer the user
 * cannot see.
 *
 * Module-private on purpose: this is the IMPLEMENTATION of the split, not a
 * separate concept, and it is tested through `splitRecipeIngredients`.
 */
function isIngredientHeading(line: string): boolean {
  return line.endsWith(':') && !/\d/.test(line);
}

export interface RecipeIngredientSplit {
  /** Lines that become list items, in recipe order. */
  titles: string[];
  /** How many headings were dropped. SHOWN to the user — never silent. */
  headingsSkipped: number;
}

/**
 * A recipe's ingredients → the starting draft for a shopping list.
 *
 * ⚠️ Runs ONCE, when the sheet opens. It maps the RECIPE, which the user did not
 * write for this purpose and which routinely carries "For the sauce:" dividers.
 * The draft the user then edits is parsed by `parseDraftItems`, which applies no
 * heading rule at all — re-running this on save would silently delete a line the
 * user had deliberately typed, which is exactly the failure the narrow rule and
 * the visible skipped-count were chosen to avoid, arriving from the other side.
 *
 * Blank lines are dropped and are NOT counted as headings — they were never items.
 */
export function splitRecipeIngredients(ingredients: string[]): RecipeIngredientSplit {
  const lines = cleanLines(ingredients);
  const titles = lines.filter((l) => !isIngredientHeading(l));
  return { titles, headingsSkipped: lines.length - titles.length };
}

/**
 * The review sheet's textarea → the items to create.
 *
 * Trim and drop-blank ONLY. What is in the box is what gets created: by this point
 * every line is the user's own, so a trailing colon is a choice, not recipe
 * formatting. See `splitRecipeIngredients` for why the asymmetry is deliberate.
 */
export function parseDraftItems(text: string): string[] {
  return cleanLines(text.split('\n'));
}

/**
 * The seed for a shopping list built from a recipe.
 *
 * Writes a CLOSED set of eight keys, so "carries no other link field" is a
 * property a test can assert rather than a promise. In particular it sets
 * `linkedRecipeId` and NEITHER `linkedActivityId` NOR `linkedVacationId` — the
 * same discipline `buildCopySeeds` states above, for the same reason.
 *
 * `lifecycle: 'oneoff'`, not recurring: the curated `grocery` template repeats
 * weekly because a weekly shop does, but a shop for THIS recipe happens once, and
 * a recurring list would reset its ticks forever. `cycleCelebrated` is therefore
 * omitted entirely rather than set to false — `setLifecycle('oneoff')` clears that
 * key, which is the authoritative statement that a oneoff list should not carry it.
 *
 * `title` arrives resolved and interpolated: i18n stays out of pure code.
 */
export function buildRecipeListSeed(args: {
  recipeId: string;
  titles: string[];
  title: string;
  memberId: string;
}): CreateFamilyListInput {
  const { recipeId, titles, title, memberId } = args;
  return {
    title,
    // Read, not hardcoded — `getListCategory` is nullable, and the fallback is
    // unreachable by construction (same shape as `NewListSheet.startBlank`).
    emoji: getListCategory('out')?.emoji ?? '🛒',
    category: 'out',
    ownerId: memberId,
    items: freshItems(titles),
    lifecycle: 'oneoff',
    completed: false,
    createdBy: memberId,
    linkedRecipeId: recipeId,
  };
}
