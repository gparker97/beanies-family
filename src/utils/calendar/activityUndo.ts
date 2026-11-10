/**
 * Calendar drag and drop (#142): the pure Undo recipes for a drop. No Vue, no store.
 *
 * The orchestrator (`useCalendarMove`) captures the prior fields BEFORE it writes, then asks
 * `undoRecipeFor` what Undo means for the outcome the write produced. Executing a recipe is
 * the orchestrator's job (`undoCalendarMove`): `restore` is one `updateActivity`, and
 * `remove-override` is `resetOccurrenceToSeries`.
 */
import type { ScopedSaveOutcome } from '@/composables/useActivityScopeEdit';
import type { FamilyActivity, UpdateFamilyActivityInput } from '@/types/models';
import { captureBefore } from '@/utils/captureBefore';

/** Defined beside `handleScopedSave`, which returns it; re-exported for the pure layer. */
export type { ScopedSaveOutcome };

/** Every field a drop can change (date/time, span, owner, and a re-targeted rule + shadow). */
export const MOVE_KEYS: readonly (keyof FamilyActivity)[] = [
  'date',
  'endDate',
  'startTime',
  'endTime',
  'assigneeIds',
  'assigneeId',
  'recurrence',
  'rule',
  'daysOfWeek',
  'originalOccurrenceDate',
];

export type UndoRecipe =
  /** A one-off, a reused override child, or an 'all' template: write the prior fields back. */
  | { kind: 'restore'; id: string; before: UpdateFamilyActivityInput }
  /** 'This only' created a new override child: remove it and the series shows through again. */
  | { kind: 'remove-override'; childId: string };

/**
 * The prior values of `keys` on `activity`, as a patch that writes them back. A key the record
 * does not carry is present as an explicit `undefined`, so restoring it CLEARS whatever the
 * drop added (and stops `updateActivity` from rebasing `endDate` on the way back). The generic
 * capture lives in `utils/captureBefore.ts`; this is its typed face for activities.
 */
export function captureActivityBefore(
  activity: FamilyActivity,
  keys: readonly (keyof FamilyActivity)[]
): UpdateFamilyActivityInput {
  return captureBefore<FamilyActivity>(activity, keys);
}

/**
 * What Undo means after a successful scoped save, or `null` for no Undo:
 * - this-only: restore the reused child when one existed (the concurrent-child race), else
 *   remove the child the save created;
 * - all: restore the template, unless the reap deleted override children (Undo could not
 *   bring those back, so it is withheld rather than half-done);
 * - this-and-future: none (reversing a split touches the new series, the old series' end,
 *   the fee item, re-parented sessions and session links).
 */
export function undoRecipeFor(
  outcome: Extract<ScopedSaveOutcome, { kind: 'saved' }>,
  beforeTemplate: UpdateFamilyActivityInput,
  beforeChild: UpdateFamilyActivityInput | null
): UndoRecipe | null {
  switch (outcome.scope) {
    case 'this-only':
      return beforeChild
        ? { kind: 'restore', id: outcome.writtenId, before: beforeChild }
        : { kind: 'remove-override', childId: outcome.writtenId };
    case 'all':
      return outcome.reapedCount === 0
        ? { kind: 'restore', id: outcome.writtenId, before: beforeTemplate }
        : null;
    case 'this-and-future':
      return null;
  }
}
