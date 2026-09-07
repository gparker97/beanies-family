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
