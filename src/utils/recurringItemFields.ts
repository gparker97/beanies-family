/**
 * Field-control helpers for scoped edits of recurring financial items.
 *
 * These deliberately replace a "spread the whole form payload" approach. A full
 * create payload reused as an update writes fields the user never touched —
 * which is how a "this and future" split had its correct start date immediately
 * overwritten by the template-seeded one from the form. See
 * `docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md`.
 *
 * The two helpers point in OPPOSITE directions on purpose:
 *  - `recurringToTransactionFields` TRANSLATES between two different types
 *    (`CreateRecurringItemInput` → `UpdateTransactionInput`), so a keep-list is
 *    forced — there is no other way to map across shapes.
 *  - `recurringTemplateFields` FILTERS within one type, so an OMIT is correct
 *    and fails safe: a keep-list that forgets a field would silently drop it.
 */
import type {
  CreateRecurringItemInput,
  UpdateRecurringItemInput,
  UpdateTransactionInput,
} from '@/types/models';

/**
 * Extract transaction-level fields from a recurring item input.
 * Used by syncLinkedTransactions and the `this-only` scope handler so the same
 * field list (and the goal fields) can't be forgotten in one place.
 */
export function recurringToTransactionFields(
  data: CreateRecurringItemInput
): UpdateTransactionInput {
  return {
    accountId: data.accountId,
    type: data.type,
    amount: data.amount,
    currency: data.currency,
    category: data.category,
    description: data.description,
    goalId: data.goalId,
    goalAllocMode: data.goalId ? data.goalAllocMode : undefined,
    goalAllocValue: data.goalId ? data.goalAllocValue : undefined,
    // Clear computed allocation so updateTransaction's reversal + reapply
    // cycle starts fresh (applyGoalAllocation will recompute it).
    goalAllocApplied: undefined,
  };
}

/**
 * Template-level fields a scoped edit may change, AFTER a split.
 *
 * Defined as an OMIT of the three schedule fields, never a keep-list.
 * `splitRecurringItem` does not copy `loanId` / `activityId` / `goalId` /
 * `goalAllocMode` / `goalAllocValue` onto the new item, so this update is the
 * only thing that restores them — a keep-list that forgot one would drop it on
 * every split.
 *
 * The split owns the START (Recurring Invariant 3): `startDate` is the split
 * date, and `lastProcessedDate` must not carry over or it suppresses
 * materialisation of the new segment.
 *
 * `endDate` is the exception. The split seeds it from the ORIGINAL, so blanket-
 * stripping it looks safe — but it silently discards a deliberate "ends on"
 * edit made in the same save, which is exactly the anti-pattern the activity
 * side removed in this change. Pass `originalEndDate` (what the split
 * inherited) so an UNCHANGED end date is dropped while a CHANGED one applies.
 * Omit the argument and `endDate` is always stripped.
 *
 * `rule` is stripped for the same reason `startDate` is (#70). The split has
 * already re-anchored the cadence at the split date and RE-BASED any
 * `afterCount` end (`rebaseRuleForSplit`); writing the form's `rule` back over
 * it restores the ORIGINAL count against the NEW anchor, so a 10-instalment
 * plan split at instalment 4 materializes 3 + 10 = 13 real transactions, and
 * compounds on every further split. A deliberate cadence edit made in the same
 * save is handled by the split re-basing what it inherited, not by replaying
 * the pre-split rule.
 */
export function recurringTemplateFields(
  data: CreateRecurringItemInput,
  originalEndDate?: string
): UpdateRecurringItemInput {
  const { startDate: _s, endDate, lastProcessedDate: _l, rule: _r, ...rest } = data;
  void _s;
  void _l;
  void _r;
  const endDateChanged =
    originalEndDate !== undefined && (endDate || undefined) !== (originalEndDate || undefined);
  return endDateChanged ? ({ ...rest, endDate } as UpdateRecurringItemInput) : rest;
}
