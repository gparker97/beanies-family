// Duplicate-activity detection for the AI document-extraction (photo/PDF → activity) wedge.
//
// When an extracted activity prefill closely matches an activity the family already has, the
// caller (FamilyPlannerPage) offers a confirm prompt to UPDATE the existing one instead of
// silently creating a duplicate. These helpers are pure + total so they unit-test in isolation;
// the merge mirrors travel's `mergeOneSegment` shape (iterate the incoming keys, fill blanks
// only) and reuses `mergeNotes` rather than re-implementing line dedupe.

import type { CreateFamilyActivityInput, FamilyActivity } from '@/types/models';
import { mergeNotes } from './segmentMerge';
import { TITLE_MATCH_THRESHOLD, tokenSimilarity } from './textSimilarity';

/** Jaccard token-overlap of two titles in [0, 1]. Alias kept so existing callers and tests read unchanged. */
export const titleSimilarity = tokenSimilarity;

/**
 * Find the single existing activity an extracted prefill most likely duplicates, or `null`.
 * Conservative by design — a false "update" that edits a distinct event is worse than a missed
 * duplicate:
 *  - requires the prefill to have BOTH a date and a non-blank title (else returns null),
 *  - only considers non-recurring activities that are NOT recurrence-override children,
 *  - requires the SAME date AND a title similarity at/above `threshold`,
 *  - returns the match ONLY when exactly one candidate qualifies (0 or 2+ → null, ambiguous).
 */
export function findDuplicateActivity(
  prefill: Partial<CreateFamilyActivityInput>,
  candidates: FamilyActivity[],
  threshold = TITLE_MATCH_THRESHOLD
): FamilyActivity | null {
  const title = prefill.title?.trim();
  const date = prefill.date;
  if (!title || !date) return null;

  const matches = candidates.filter(
    (a) =>
      a.recurrence === 'none' &&
      !a.parentActivityId &&
      a.date === date &&
      titleSimilarity(a.title, title) >= threshold
  );
  return matches.length === 1 ? matches[0] : null;
}

// Keys handled explicitly (notes, schedule) or never overwritten (identity, title, people).
// Everything else in the prefill is filled generically below, so adding a new extractable field
// needs no change here.
const MERGE_SKIP_KEYS = new Set<string>([
  'id',
  'title',
  'date',
  'notes',
  'isAllDay',
  'startTime',
  'endTime',
  'recurrence',
  'assigneeId',
  'assigneeIds',
]);

/**
 * Non-destructively fold an extracted prefill into an EXISTING activity, returning a copy that
 * KEEPS `existing.id` (so the caller opens it in edit mode → updateActivity). Only fields the
 * existing activity is missing get filled — user-entered values are never overwritten. Notes are
 * appended + de-duped via `mergeNotes`. The all-day/time triplet is coupled: the prefill's
 * schedule is adopted ONLY when the existing activity has no time signal at all, so the merge can
 * never produce an all-day activity that still carries times (or times on an all-day activity).
 */
export function mergeExtractionIntoActivity(
  existing: FamilyActivity,
  prefill: Partial<CreateFamilyActivityInput>
): FamilyActivity {
  const merged = { ...existing };
  const bag = merged as unknown as Record<string, unknown>;

  // Generic blank-fill: copy each non-special prefill string only when the existing value is unset.
  for (const [k, v] of Object.entries(prefill)) {
    if (MERGE_SKIP_KEYS.has(k)) continue;
    if (typeof v !== 'string' || v.trim() === '') continue;
    const current = bag[k];
    const isBlank =
      current === undefined ||
      current === null ||
      (typeof current === 'string' && current.trim() === '');
    if (isBlank) bag[k] = v;
  }

  // A read's link only blank-fills `link` (above). When the matched activity already has a
  // DIFFERENT link, keep the new one in the notes rather than dropping it: before the link
  // field was filled (#113) a shared page's URL always reached the notes, and an "update
  // existing" must not lose where the update came from.
  const existingLink = existing.link?.trim();
  const incomingLink = prefill.link?.trim();
  const displacedLink = existingLink && incomingLink && existingLink !== incomingLink;
  const incomingNotes = displacedLink
    ? [prefill.notes?.trim(), incomingLink].filter(Boolean).join('\n')
    : prefill.notes;
  const notes = mergeNotes(existing.notes, incomingNotes);
  if (notes !== undefined) merged.notes = notes;

  const existingHasTimeSignal = !!existing.isAllDay || !!existing.startTime || !!existing.endTime;
  if (!existingHasTimeSignal) {
    if (prefill.isAllDay) {
      merged.isAllDay = true;
    } else {
      if (prefill.startTime) merged.startTime = prefill.startTime;
      if (prefill.endTime) merged.endTime = prefill.endTime;
    }
  }

  return merged;
}
