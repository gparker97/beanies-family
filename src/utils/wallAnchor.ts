/**
 * The wall's date policy — pure, total, and free of Vue, stores and `useToday`.
 *
 * Split out of the composable for the reason `wallTimeGrid.ts` is split out of
 * `WallTimeGrid.vue`: everything here is derivable from its inputs, so it can be
 * table-tested at every boundary that matters (month, year, DST, both week-start
 * settings) without mocking a module singleton. `useWallAnchor` is the wiring —
 * this is the thinking.
 *
 * ⚠️ The wall used to have NO anchor at all: its week was `today + 6`, recomputed
 * straight from a readonly `useToday()`. The only date state anywhere was
 * `WallTodayView`'s local `focusYmd`, which was destroyed on every view switch
 * because all four views render through one `<component :is>`. Both are replaced
 * by this.
 */
import { addDaysYmd, isRealYmd, parseLocalDate } from '@/utils/date';

/**
 * How the arrows move, per view. `null` views (the jobs board) have no arrows.
 *
 * `'page'` means ONE SCREENFUL — however many day columns that view is currently
 * drawing. It was `'week'`, a fixed seven, which stopped being the right answer
 * when the days view became responsive: a wall showing three columns jumped
 * seven days per press, so four of every seven days could only be reached
 * through the strip below. See `stepDaysFor`.
 */
export type WallStepUnit = 'page' | 'day';

/**
 * Beyond a year either way the wall is browsing somewhere nobody meant to go, and
 * is far more likely to be holding a computed-wrong date than a deliberate one.
 */
export const MAX_ANCHOR_DRIFT_DAYS = 366;

/**
 * How many days the wall keeps in hand, starting at the anchor.
 *
 * ⚠️ NOT the render width. The days view draws `MIN_DAY_COLUMNS`..`MAX_DAY_COLUMNS`
 * (3-7, whatever the glass fits) and puts the remainder in the chip strip below,
 * so this is the size of the WINDOW — columns plus strip — not of the grid. The
 * arrows page by the column count, not by this.
 */
const WEEK_LENGTH = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Signed days from `todayYmd` to `ymd` — negative in the past, positive in the
 * future. `NaN` if either date is unparseable.
 *
 * ⚠️ `daysBetween` in `date.ts` CANNOT be used for this: it wraps the difference
 * in `Math.abs`, so it can say how far but never which way. Telemetry that wants
 * to answer "do families browse forward, or back?" needs the sign.
 *
 * Both ends are normalised to local midnight before subtracting, so a DST
 * transition inside the span cannot round the answer to a fraction of a day.
 */
export function anchorOffsetDays(ymd: string, todayYmd: string): number {
  const from = parseLocalDate(todayYmd.slice(0, 10));
  const to = parseLocalDate(ymd.slice(0, 10));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return NaN;
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * The only gate between a bad ymd and a permanently broken wall.
 *
 * ⚠️ `parseLocalDate` does NOT throw. Given ten characters of garbage it returns
 * an Invalid Date, and `toDateInputValue` then yields the literal string
 * "NaN-NaN-NaN" — which every downstream `addDaysYmd` happily propagates, forever,
 * with nothing on screen to say what went wrong. Validation is therefore the only
 * guard that exists; there is no exception to catch.
 *
 * Returns `todayYmd` for anything unparseable, misshapen, or beyond
 * MAX_ANCHOR_DRIFT_DAYS, so the wall always lands somewhere it can render.
 */
export function clampAnchorYmd(next: string, todayYmd: string): string {
  // `isRealYmd` is the shared shape + round-trip check; a second copy here had
  // already drifted from the one in `date.ts`.
  if (!isRealYmd(next)) return todayYmd;

  const drift = anchorOffsetDays(next, todayYmd);
  if (Number.isNaN(drift)) return todayYmd;

  /*
   * ⚠️ A real day past the limit clamps to the LIMIT, not to today.
   *
   * It used to return `todayYmd`, and the week views render up to six days past
   * the anchor — so at the forward edge an ordinary tap on a drawn column header
   * threw the wall a year backwards to today and, because the caller only
   * switches view on success, did nothing else visible to explain it. Landing on
   * the furthest day the wall will go is the answer the gesture actually asked
   * for, and it is one the family can see happen.
   *
   * Malformed input still lands on today: there is no meaningful "nearest" day
   * to a string that never named one.
   */
  if (Math.abs(drift) > MAX_ANCHOR_DRIFT_DAYS) {
    return addDaysYmd(todayYmd, drift > 0 ? MAX_ANCHOR_DRIFT_DAYS : -MAX_ANCHOR_DRIFT_DAYS);
  }

  return next;
}

/**
 * How many days one press of an arrow moves, for a view stepping in `unit`.
 *
 * A `'page'` is however many day columns are on screen RIGHT NOW, so the arrow
 * always lands the next unseen day in the first column and never skips one. A
 * `'day'` is one day, whatever the layout.
 *
 * Total: a zero, negative, fractional or NaN column count falls back to one day.
 * A step of zero would be an arrow that visibly does nothing, which on a kitchen
 * tablet is indistinguishable from a frozen screen.
 */
export function stepDaysFor(unit: WallStepUnit, visibleDayColumns: number): number {
  if (unit === 'day') return 1;
  if (!Number.isFinite(visibleDayColumns)) return 1;
  return Math.max(1, Math.floor(visibleDayColumns));
}

/**
 * Where a step lands: exactly `stepDays` in the direction pressed.
 *
 * ⚠️ This REPLACES a calendar-week snapping rule, and the deletion is the point.
 * The old rule read "today is a special anchor, and leaving it enters calendar
 * weeks" — forward from today went to the START of next calendar week, back went
 * to the start of THIS one, and thereafter it was a blind ±7.
 *
 * That was coherent only while the days view drew a fixed seven columns. Once the
 * column count became responsive, a wall showing three columns still jumped seven
 * days per press: days four to seven of each week could be reached ONLY by
 * tapping a chip in the strip below, and pressing `›` then `‹` did not return you
 * to where you started. greg reported it as unintuitive, and the intuition is
 * right — a pager should page by what is on the page.
 *
 * So: no snapping, no week alignment, no `weekStartDay`. `‹` and `›` are exact
 * inverses at every anchor, which is the property the old rule could not have
 * (its own tests pinned the asymmetry as "documented, not accidental").
 *
 * The forward bias the old rule expressed is not lost — it lives where it always
 * belonged, in the default anchor being today rather than the start of this week.
 */
export function nextAnchorYmd(anchor: string, stepDays: number, direction: -1 | 1): string {
  return addDaysYmd(anchor, direction * stepDaysFor('page', stepDays));
}

/**
 * The seven consecutive ymds the days view has in hand, starting at the anchor.
 * It RENDERS the first `dayColumns` of them and lays the rest out as chips.
 */
export function anchorWeekDays(anchor: string): string[] {
  return Array.from({ length: WEEK_LENGTH }, (_, i) => addDaysYmd(anchor, i));
}
