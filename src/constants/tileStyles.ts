/**
 * Shared tile and calendar-day class vocabularies: the magic-beans tile look and the calendar
 * "today" marker.
 *
 * The magic-beans tile vocabulary, shared by the capture drawer's kind tiles (#108) and the
 * quick-add tiles (#119), so the app has one "selected" look.
 *
 * The selected look is the same light recipe `ChipButton` ships (Heritage Orange text, border
 * and `--tint-orange-8`). On dark the tile sits on `surface-overlay`, so its selected
 * background is the next surface step and the accent takes its `-lift` partner, never a darker
 * orange, per the CIG.
 */
export const MAGIC_TILE_AT_REST =
  'dark:bg-surface-overlay dark:hover:bg-surface-hover border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)]';

export const MAGIC_TILE_SELECTED =
  'border-primary-500 dark:border-accent-lift dark:bg-surface-hover bg-[var(--tint-orange-8)]';

/**
 * The keyboard focus ring every magic-beans and quick-add control shares: Sky Silk, offset from
 * the control, and offset onto the raised card's colour on dark so the gap is not a light slab.
 * A literal string under `src/`, so Tailwind's source scan sees every class.
 */
export const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-silk-300 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-raised';

/**
 * The calendar "today" marker, shared by the month cell (both breakpoints) and the week
 * header/column. Same outline recipe as `MAGIC_TILE_SELECTED`. The text token is Deep Slate in
 * light because orange text on white is 3.3:1 (fails AA); on dark it takes the `-lift` partner.
 */
export const CALENDAR_TODAY = {
  outline: 'border-primary-500 dark:border-accent-lift',
  wash: 'bg-[var(--tint-orange-8)]',
  columnWash: 'bg-[var(--tint-orange-4)]',
  text: 'text-secondary-500 dark:text-accent-lift',
  pill: 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white shadow-[0_2px_6px_rgba(241,93,34,0.3)]',
} as const;

/** Day tints a parent may ask a calendar day surface to paint (desktop month cell, week header). */
export const CALENDAR_DAY_TINT = {
  vacation: 'bg-[var(--vacation-teal-tint)]',
  holiday: 'bg-[var(--holiday-clay-tint)]',
} as const;
export type CalendarDayTint = keyof typeof CALENDAR_DAY_TINT;

/**
 * The ONE background decision for a calendar day surface: tint > today wash > resting.
 * Returns exactly one background class set so Tailwind's variant order never picks the winner.
 * `resting` must be a literal class string at the call site (Tailwind source scan).
 */
export function calendarDayBackground(
  tint: CalendarDayTint | undefined,
  isToday: boolean,
  resting: string
): string {
  if (tint) return CALENDAR_DAY_TINT[tint];
  return isToday ? CALENDAR_TODAY.wash : resting;
}
