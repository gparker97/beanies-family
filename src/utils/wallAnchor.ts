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
import { addDaysYmd, isRealYmd, parseLocalDate, startOfWeekYmd } from '@/utils/date';

/** How the arrows move, per view. `null` views (the jobs board) have no arrows. */
export type WallStepUnit = 'week' | 'day';

/**
 * Beyond a year either way the wall is browsing somewhere nobody meant to go, and
 * is far more likely to be holding a computed-wrong date than a deliberate one.
 */
export const MAX_ANCHOR_DRIFT_DAYS = 366;

/** Days in the wall's week. Not a tunable — the views assume seven columns. */
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
  if (Number.isNaN(drift) || Math.abs(drift) > MAX_ANCHOR_DRIFT_DAYS) return todayYmd;

  return next;
}

/**
 * Where a step lands.
 *
 * The rule the table encodes: **today is a special anchor, and leaving it enters
 * calendar weeks.** The wall's default is deliberately forward-biased — a rolling
 * `today + 6`, "what is coming, not what has gone" — so stepping forward from
 * today goes to the START of next calendar week rather than to `today + 7`, and
 * stepping back goes to the start of THIS calendar week, which is the first
 * gesture that shows a family the days they have already used. From there it is
 * plain ±7, because by then the wall is aligned to weeks.
 *
 * Day steps never snap: a day is a day.
 *
 * Note there is no `todayYmd` parameter: "am I on today" turned out to be the
 * wrong question. What matters is whether the anchor is ALIGNED to a week, which
 * covers the today case (an unaligned today steps into the adjacent week) and
 * the day-tap case (an arbitrary Thursday does the same) with one rule instead
 * of two.
 */
export function nextAnchorYmd(
  anchor: string,
  unit: WallStepUnit,
  direction: -1 | 1,
  weekStartDay: number
): string {
  if (unit === 'day') return addDaysYmd(anchor, direction);

  // ⚠️ `startOfWeekYmd` fails OPEN — it returns its input unchanged when that
  // input is not a real date — so an equality test alone reads garbage as
  // "already week-aligned" and takes the blind ±7 branch.
  const alignedToWeek = isRealYmd(anchor) && anchor === startOfWeekYmd(anchor, weekStartDay);
  if (alignedToWeek) return addDaysYmd(anchor, direction * WEEK_LENGTH);

  // Off-week — which on a fresh wall means anchored on today, and after a day tap
  // means anchored on an arbitrary day. Either way the honest move is into the
  // adjacent calendar week rather than a blind ±7 that would preserve the offset.
  const thisWeek = startOfWeekYmd(anchor, weekStartDay);
  return direction === -1 ? thisWeek : addDaysYmd(thisWeek, WEEK_LENGTH);
}

/** The seven consecutive ymds the week views render, starting at the anchor. */
export function anchorWeekDays(anchor: string): string[] {
  return Array.from({ length: WEEK_LENGTH }, (_, i) => addDaysYmd(anchor, i));
}
