/**
 * Map a structured doses-per-day count (1-4) to its localized display
 * string ("once daily", "twice daily", ...). Pure helper used by
 * `MedicationFormModal` to auto-fill `frequency` when a user picks one
 * of the structured chip options.
 *
 * Returns the empty string for any out-of-range value so the caller can
 * detect the no-match case without checking the input separately.
 *
 * Caller passes the active `t` function (rather than importing the
 * translation system here) so the helper stays pure and easy to unit
 * test against a stub `t`. Typed against `UIStringKey` so the strict
 * keyset of the translation system matches at the call site.
 */
import type { UIStringKey } from '@/services/translation/uiStrings';

type TFn = (key: UIStringKey) => string;

export function frequencyDisplayFor(n: number, t: TFn): string {
  switch (n) {
    case 1:
      return t('medications.frequencyAuto.onceDaily');
    case 2:
      return t('medications.frequencyAuto.twiceDaily');
    case 3:
      return t('medications.frequencyAuto.threeDaily');
    case 4:
      return t('medications.frequencyAuto.fourDaily');
    default:
      return '';
  }
}

/**
 * The valid range of structured `dosesPerDay` values. Anything else is
 * treated as "as needed / other" by both the UI and `useCriticalItems`.
 */
export function isValidDosesPerDay(n: unknown): n is 1 | 2 | 3 | 4 {
  return Number.isInteger(n) && (n === 1 || n === 2 || n === 3 || n === 4);
}
