import { useTranslation } from '@/composables/useTranslation';
import { describeRule, describeRuleAt } from '@/services/recurrence/describe';
import {
  resolveTransactionRule,
  resolveActivityRule,
  resolveTodoRule,
  type ActivityRecurrenceFields,
  type RecurSurface,
} from '@/services/recurrence/adapters';
import type { RecurrenceRule } from '@/types/recurrence';
import type { RecurringItem, TodoItem } from '@/types/models';

/**
 * The one recurrence label resolver (#70) — the id→`t()` pattern (like
 * `useCategoryLabel`). Every cadence/summary label routes through here, which
 * calls the canonical `describeRule`. It replaces the three old formatters
 * (`recurringProcessor.formatFrequency`, `OnboardingRecurring`'s local copy,
 * and `format.ts` `formatActivityRecurrence` on the transaction side). It never
 * grows a second summary generator.
 */
export function useRecurrenceLabel() {
  const { t } = useTranslation();

  /** Plain-language summary of a canonical rule anchored at `anchorYmd`. */
  const describe = (rule: RecurrenceRule, anchorYmd: string): string =>
    describeRule(rule, anchorYmd, t);

  /** Summary for a `RecurringItem` — reads `rule` if present, else the legacy fields. */
  const describeRecurringItem = (item: RecurringItem): string => {
    const resolved = resolveTransactionRule(item);
    // null ⟺ unmappable stored shape (already logged) — fall back to the plain
    // frequency word rather than rendering nothing.
    if (!resolved) return t('planner.recurrence.none');
    return describeRule(resolved.rule, resolved.anchor, t);
  };

  /** Summary for a `FamilyActivity` — `rule` first, else the legacy recurrence. */
  const describeActivity = (activity: ActivityRecurrenceFields): string => {
    const resolved = resolveActivityRule(activity);
    return resolved
      ? describeRule(resolved.rule, resolved.anchor, t)
      : t('planner.recurrence.none');
  };

  /** {@link describe} plus " at {time}" when an `HH:mm` time is given. */
  const describeWithTime = (
    rule: RecurrenceRule,
    anchorYmd: string,
    time?: string,
    surface?: RecurSurface
  ): string => describeRuleAt(rule, anchorYmd, time, t, surface);

  /**
   * Summary for a repeating to-do, with its due time ("weekly on Wed at 8pm").
   * `''` when the to-do does not repeat (or its stored rule is unmappable,
   * already logged), so a caller can gate a badge on the result.
   */
  const describeTodo = (todo: Pick<TodoItem, 'repeat' | 'dueTime'>): string => {
    const resolved = resolveTodoRule(todo);
    return resolved ? describeRuleAt(resolved.rule, resolved.anchor, todo.dueTime, t, 'todo') : '';
  };

  return { describe, describeRecurringItem, describeActivity, describeWithTime, describeTodo };
}
