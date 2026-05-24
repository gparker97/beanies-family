import { isValidDosesPerDay } from '@/utils/medicationFrequency';

/**
 * The recommendation status of a single day's medication doses.
 *
 * Shared by every surface that needs to reason about "did this day exceed
 * the recommended doses-per-day" — the grouped dose log (`MedicationDayHeader`)
 * and the dose-log confirm dialog (`DoseLogConfirmModal`) — so they can never
 * disagree about what counts as "over".
 */
export interface DailyDoseStatus {
  /** The recommended doses/day, or `null` when there is no recommendation ("as needed"). */
  limit: number | null;
  /** True when `count` strictly exceeds `limit`. Always false when `limit` is null. */
  isOver: boolean;
  /** How many doses over the limit (0 when within the limit or limitless). */
  over: number;
}

/**
 * Status of a day that has `count` doses logged, for a medication whose
 * recommended doses-per-day is `dosesPerDay`.
 *
 * "Is this a real per-day limit?" is delegated to the app-wide
 * `isValidDosesPerDay` predicate (only 1–4 is a real limit). Anything else —
 * `null`/`undefined` ("as needed"), 0, 5+, or a corrupt value — is treated as
 * limitless, keeping the log flag, the confirm-dialog warning, the medication
 * form, and `useCriticalItems` in lockstep. A pure function: no I/O, nothing
 * that can throw on valid input.
 */
export function getDailyDoseStatus(
  count: number,
  dosesPerDay: number | null | undefined
): DailyDoseStatus {
  if (!isValidDosesPerDay(dosesPerDay)) return { limit: null, isOver: false, over: 0 };
  const limit = dosesPerDay; // narrowed to 1 | 2 | 3 | 4
  const over = Math.max(0, count - limit);
  return { limit, isOver: over > 0, over };
}
