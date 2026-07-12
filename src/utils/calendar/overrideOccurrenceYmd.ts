// Shared leaf util (#32) — the ONE definition of "which master occurrence date a
// recurring-override child replaces". No I/O.
//
// A per-occurrence override child (`parentActivityId` set) suppresses exactly one
// occurrence of its recurring master. That occurrence's date is:
//   - `originalOccurrenceDate` when the child was RESCHEDULED (its own `date` moved
//     to a new day, so `date` no longer identifies the replaced occurrence), else
//   - the child's own `date` (edit-this-only and delete-this-only keep the date).
//
// Consumed by BOTH `activityStore.overridesByParent` (suppress the master occurrence
// in the in-app calendar) and `reconcilePlan` (address the Google instance to
// except). Extracted so the fallback lives in exactly one place.

import type { FamilyActivity } from '@/types/models';

/** The master occurrence date (`YYYY-MM-DD`) a recurring-override child replaces. */
export function overrideOccurrenceYmd(child: FamilyActivity): string {
  return (child.originalOccurrenceDate ?? child.date).slice(0, 10);
}
