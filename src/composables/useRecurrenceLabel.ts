import { useTranslation } from '@/composables/useTranslation';
import { describeRule } from '@/services/recurrence/describe';
import { resolveRecurringItemRule } from '@/services/recurrence/adapters';
import type { RecurrenceRule } from '@/types/recurrence';
import type { RecurringItem } from '@/types/models';

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

  return { describe, describeRecurringItem };
}
