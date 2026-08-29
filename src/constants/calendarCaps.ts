/**
 * How many items a month day-cell shows before collapsing the rest into a
 * "+N more" affordance.
 *
 * Shared by both month surfaces — the desktop grid (`CalendarGrid.vue`) and the
 * mobile stream (`CalendarMonthStream.vue`) — because they are the SAME cell
 * rendered at two widths, and a day that reads "+3 more" on the phone and
 * "+2 more" on the laptop is a bug the code cannot tell you is a bug. (The
 * stream briefly shipped its own copy at 3; nothing tied the two numbers
 * together and no test pinned either.)
 *
 * `MonthDayCard` uses these to size both the visible slice and the overflow
 * count, so changing one changes what every day shows on every surface.
 */
export const ALL_DAY_VISIBLE_CAP = 2;
export const TIMED_VISIBLE_CAP = 4;
