/**
 * What a DAY contains, as one vocabulary both calendars speak.
 *
 * ## The drift this exists to make impossible
 *
 * The planner and the beanie wall were two independent pipelines. The planner
 * read activities, holidays and trips; the wall read activities and nothing
 * else. So the wall was not "missing" public holidays so much as it had never
 * had a concept of them, and when family birthdays arrived they had to be wired
 * into six planner surfaces and three wall views by hand — which is exactly how
 * they shipped onto one surface and not the other five, twice in two days.
 *
 * Activities were never the problem: both surfaces already read `activityStore`,
 * so there is one source there by construction. Everything ELSE a day can carry
 * is what drifted, and that is what this module owns.
 *
 * ## Where the boundary is, and why it is here
 *
 * This is the QUERY, not the rendering. Both calendars must see the same SET of
 * things on a day; they must emphatically NOT draw them the same way. The wall
 * is read from across a kitchen at 0.85rem on a locked screen; a month cell is a
 * 12px chip in a 2-slot budget. One component serving both would need mode flags,
 * which this codebase's own docblocks warn against repeatedly.
 *
 * So: one query, two renderers. A surface may choose to render fewer of these
 * (the wall's days view draws 3-7 columns, so it can only place what falls in
 * them), but it can no longer fail to KNOW about one.
 *
 * Pure. The composable that reads the stores and resolves the wording is
 * `useDayExtras`; keeping this half pure is what lets the placement and bucketing
 * be tested without a Pinia or a translator.
 */
import type { HolidayOccurrence } from '@/types/models';
import type { BirthdayOccurrence } from '@/utils/birthdays';

/**
 * The kinds of non-activity content a day can carry.
 *
 * ⚠️ ADDING A KIND IS THE WHOLE POINT OF THIS UNION. A new kind here is a
 * compile error in every consumer that switches on it, which is the mechanism
 * that stops the next one reaching only half the surfaces. `allDaySurfaces.test`
 * additionally asserts every calendar surface consults this module at all.
 */
export type DayExtraKind = 'birthday' | 'holiday' | 'trip';

/** One piece of non-activity content, already labelled for display. */
export interface DayExtra {
  kind: DayExtraKind;
  /** Stable across renders; unique within a day. */
  id: string;
  /** `YYYY-MM-DD`. */
  ymd: string;
  /** Resolved for display by `useDayExtras` — i18n does not belong in here. */
  label: string;
  /**
   * A leading glyph, where the kind has one. Holidays deliberately do NOT:
   * `HolidayChip` and `HolidayBanner` both record that a flag emoji renders
   * differently on every device and looks cramped.
   */
  emoji?: string;
  /** The source record, for a consumer that needs more than the label (the
   *  birthday drawer wants the age and the member id). Exactly one is set. */
  birthday?: BirthdayOccurrence;
  holiday?: HolidayOccurrence;
}

/**
 * Order within one day, shared by every surface so two calendars never disagree
 * about which of two things on the same date comes first.
 *
 * Birthdays lead: they are about somebody in this family. A holiday is reference
 * data about the country, and a trip is already carried by its own bar.
 */
const KIND_ORDER: Record<DayExtraKind, number> = { birthday: 0, holiday: 1, trip: 2 };

/** Sort in place and return: date, then kind, then label, then id. */
export function sortDayExtras(extras: DayExtra[]): DayExtra[] {
  return extras.sort(
    (a, b) =>
      a.ymd.localeCompare(b.ymd) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
  );
}

/** Bucket by date — the shape every calendar cell and every wall column wants. */
export function dayExtrasByDate(extras: readonly DayExtra[]): Map<string, DayExtra[]> {
  const map = new Map<string, DayExtra[]>();
  for (const e of extras) {
    const list = map.get(e.ymd);
    if (list) list.push(e);
    else map.set(e.ymd, [e]);
  }
  return map;
}

/** Just the extras on one day, in order. */
export function dayExtrasFor(extras: readonly DayExtra[], ymd: string): DayExtra[] {
  return extras.filter((e) => e.ymd === ymd);
}

/**
 * How many sleeps until `ymd`, counted from `todayYmd`.
 *
 * "Sleeps" rather than "days" because that is how the Nook already says it to a
 * family, and the two surfaces must not describe the same wait differently.
 * Negative for a past date; 0 is today. Pure string arithmetic on local dates —
 * no `Date` maths, so a DST boundary cannot make it 0.96 of a day.
 */
export function sleepsUntil(todayYmd: string, ymd: string): number {
  const at = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((at(ymd) - at(todayYmd)) / 86_400_000);
}
