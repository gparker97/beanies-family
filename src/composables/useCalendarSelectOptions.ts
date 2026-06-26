import { computed, type ComputedRef } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

/**
 * Shared month + day-of-month `<select>` option builders.
 *
 * Deliberately NOT named "date of birth" — two of its consumers are DOB pickers
 * (`FamilyMemberModal`, `CreateMembersStep`, 31 days) but a third is recurrence
 * scheduling (`TransactionModal`: month-of-year + day-of-month, 28 days). The
 * shared piece is the 12-month list (identical `month.*` i18n keys everywhere)
 * plus a length-parameterized day list. Each call site keeps its own markup
 * (BaseSelect vs native `<option>`); only the option data is shared.
 *
 * `monthOptions` is a `computed` so labels re-resolve on language change.
 */

const MONTH_KEYS = [
  'month.january',
  'month.february',
  'month.march',
  'month.april',
  'month.may',
  'month.june',
  'month.july',
  'month.august',
  'month.september',
  'month.october',
  'month.november',
  'month.december',
] as const;

export interface CalendarSelectOption {
  value: string;
  label: string;
}

export function useCalendarSelectOptions(daysInMonth = 31): {
  monthOptions: ComputedRef<CalendarSelectOption[]>;
  dayOptions: CalendarSelectOption[];
} {
  const { t } = useTranslation();

  const monthOptions = computed<CalendarSelectOption[]>(() =>
    MONTH_KEYS.map((key, i) => ({ value: String(i + 1), label: t(key) }))
  );

  const dayOptions: CalendarSelectOption[] = Array.from({ length: daysInMonth }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  return { monthOptions, dayOptions };
}
