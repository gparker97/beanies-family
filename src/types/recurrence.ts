import type { ISODateString } from '@/types/models';

/**
 * The canonical recurrence model shared by every surface that repeats
 * (transactions, activities, lists). One shape, one engine, one picker —
 * replacing the three parallel implementations. See
 * `docs/plans/2026-08-23-unified-recurrence-picker.md`.
 *
 * The **anchor start date is the entity's own field** (`transaction.date`,
 * `activity.date`, list creation) — it is never duplicated into the rule.
 * Monthly/yearly derived labels ("the 23rd", "the 4th Sunday", "23 Aug") are
 * computed from that anchor at render + expansion time.
 */

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';

/** How a monthly rule lands each month. */
export type MonthlyAnchor =
  | 'date' // "on the 23rd" — a fixed day-of-month (or last day)
  | 'weekday'; // "on the 4th Sunday" — the nth weekday, derived from the anchor date

/** When a repetition stops. `afterCount` is stateless (counted from the anchor). */
export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'onDate'; date: ISODateString } // YYYY-MM-DD; inclusive
  | { kind: 'afterCount'; count: number }; // >= 1 occurrences total, from the anchor

/**
 * `Cadence` = the SHAPE of the repetition. Lists (which reset on a cadence and
 * have no end) store/consume ONLY this — a flat rule would force them to carry a
 * meaningless `end` and could express the nonsense "a reset that ends after N
 * times". Transactions + activities use the full {@link RecurrenceRule}.
 */
export interface Cadence {
  unit: RecurrenceUnit;
  /** >= 1. Biweekly is `{ unit: 'week', interval: 2 }`. */
  interval: number;
  /**
   * Week unit only. 0=Sun..6=Sat. Multiple days are allowed ONLY when
   * `interval === 1` (plain weekly); `interval >= 2` uses a single weekday.
   * Empty/undefined → the engine defaults to the anchor date's weekday.
   */
  weekdays?: number[];
  /** Month unit only. */
  monthlyAnchor?: MonthlyAnchor;
  /** `monthlyAnchor === 'date'` only: 1..28, or 'last' (last day of month). */
  monthlyDay?: number | 'last';
}

/** A full occurrence-generating rule adds an end. */
export type RecurrenceRule = Cadence & { end: RecurrenceEnd };
