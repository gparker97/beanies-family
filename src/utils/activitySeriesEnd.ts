import { occurrencesInRange } from '@/services/recurrence/recurrenceEngine';
import { extractDatePart } from '@/utils/date';
import type { FamilyActivity, UpdateFamilyActivityInput } from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';

/**
 * The patch that ends a series on `endYmd` (inclusive).
 *
 * WHY THIS EXISTS (#70): "delete this and all future", "save this and all
 * future", and `splitActivity` all truncate a series, and all three used to
 * write ONLY `recurrenceEndDate`. Once activities became rule-bearing that
 * stopped working: `expandRecurring` short-circuits to
 * `occurrencesInRange(activity.rule, …)` and never consults
 * `recurrenceEndDate`, so the series kept expanding forever. On the split path
 * that left BOTH the original and its replacement expanding from the same date
 * — the duplicate-series state `splitActivity`'s own rollback comment calls
 * unrecoverable.
 *
 * So the end must be written to whichever representation is authoritative, and
 * the legacy shadow kept in step for pre-#70 clients and the faithful readers
 * that depend on it (`reconcilePlan.activityInWindow`).
 */
export function endSeriesPatch(
  activity: Pick<FamilyActivity, 'rule'>,
  endYmd: string
): UpdateFamilyActivityInput {
  const patch: UpdateFamilyActivityInput = { recurrenceEndDate: endYmd };
  if (activity.rule) {
    patch.rule = { ...activity.rule, end: { kind: 'onDate', date: endYmd } };
  }
  return patch;
}

/**
 * Re-base a rule for a series that now STARTS at `newAnchorYmd`.
 *
 * `end.kind === 'afterCount'` is anchor-relative — the engine counts from the
 * template's own date — so handing a split's replacement template the parent's
 * rule verbatim restarts the count. A 10-session course split at session 4
 * becomes 3 + 10 = 13 sessions, and splitting again compounds it. Only the
 * count needs adjusting; `onDate` and `never` ends are anchor-independent and
 * are returned untouched.
 */
export function rebaseRuleForSplit(
  rule: RecurrenceRule,
  originalAnchor: string,
  newAnchorYmd: string
): RecurrenceRule {
  if (rule.end.kind !== 'afterCount') return rule;
  const anchor = extractDatePart(originalAnchor);
  const cutoff = extractDatePart(newAnchorYmd);
  if (cutoff <= anchor) return rule;
  // Occurrences the original series already owns, i.e. everything strictly
  // before the split point. `occurrencesInRange` is end-aware, so a count that
  // was already exhausted yields the full total and leaves 1 (never 0 — a
  // zero-occurrence rule would make the replacement invisible).
  const consumed = occurrencesInRange(rule, anchor, anchor, cutoff).filter(
    (ymd) => ymd < cutoff
  ).length;
  return { ...rule, end: { kind: 'afterCount', count: Math.max(1, rule.end.count - consumed) } };
}
