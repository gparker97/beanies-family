import { useTranslation } from '@/composables/useTranslation';
import { describeRule } from '@/services/recurrence/describe';
import { resolveRecurringItemRule, activityRuleAdapter } from '@/services/recurrence/adapters';
import { extractDatePart } from '@/utils/date';
import type { RecurrenceRule } from '@/types/recurrence';
import type { RecurringItem, FamilyActivity } from '@/types/models';

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
    const { rule, anchor } = resolveRecurringItemRule(item);
    return describeRule(rule, anchor, t);
  };

  /** Summary for a `FamilyActivity` — `rule` first, else the legacy recurrence. */
  const describeActivity = (
    activity: Pick<
      FamilyActivity,
      'recurrence' | 'date' | 'daysOfWeek' | 'recurrenceEndDate' | 'rule'
    >
  ): string => {
    const rule = activityRuleAdapter(activity);
    return rule
      ? describeRule(rule, extractDatePart(activity.date), t)
      : t('planner.recurrence.none');
  };

  return { describe, describeRecurringItem, describeActivity };
}
