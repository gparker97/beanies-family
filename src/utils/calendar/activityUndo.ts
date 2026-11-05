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

/** Defined beside `handleScopedSave`, which returns it; re-exported for the pure layer. */
export type { ScopedSaveOutcome };

/** Every field a drop can change (date/time, span, owner, and a re-targeted rule + shadow). */
export const MOVE_KEYS = [
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
] as const satisfies readonly (keyof UpdateFamilyActivityInput)[];

export type UndoRecipe =
  /** A one-off, a reused override child, or an 'all' template: write the prior fields back. */
  | { kind: 'restore'; id: string; before: UpdateFamilyActivityInput }
  /** 'This only' created a new override child: remove it and the series shows through again. */
  | { kind: 'remove-override'; childId: string };

/**
 * A detached plain copy, so a later write to the live record (a reactive / CRDT-backed
 * object) cannot change what Undo restores. The moved fields are strings, string arrays and
 * the plain `RecurrenceRule` object, so a JSON round trip is exact.
 */
function detach<T>(value: T): T {
  return value !== null && typeof value === 'object'
    ? (JSON.parse(JSON.stringify(value)) as T)
    : value;
}

/**
 * The prior values of `keys` on `activity`, as a patch that writes them back. A key the record
 * does not carry is present as an explicit `undefined`, so restoring it CLEARS whatever the
 * drop added (a `diffPayload`-style present-`undefined` is a deliberate clear, and it stops
 * `updateActivity` from rebasing `endDate` on the way back).
 */
export function captureBefore(
  activity: FamilyActivity,
  keys: readonly (keyof UpdateFamilyActivityInput)[]
): UpdateFamilyActivityInput {
  const before: Record<string, unknown> = {};
  // eslint-disable-next-line security/detect-object-injection -- keys are typed activity fields
  for (const key of keys) before[key] = detach(activity[key]);
  return before as UpdateFamilyActivityInput;
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
