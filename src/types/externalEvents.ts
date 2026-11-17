// View-only external calendar events (plan 2026-11-17, A4). Held in memory on each
// device only: never written to the family file, never pushed to any calendar.

/**
 * One event from a view-only calendar, normalized once at the store boundary.
 *
 * A busy-only event (`busyOnly`) has had `title` and `location` dropped before it
 * reached any reactive state, so no surface, search index, widget snapshot or log
 * can leak them.
 */
export interface ExternalEvent {
  /** Google's event id (an expanded instance has its own). Memory only; never logged. */
  id: string;
  /** The `ViewedCalendar` record this came from. */
  viewedCalendarId: string;
  /** The viewed calendar's name, shown as the event's source. */
  calendarName: string;
  /** The viewed calendar's color. */
  color: string;
  allDay: boolean;
  /** Absolute `[startMs, endMs)`. Timed: the real instant. All-day: local-midnight span. */
  startMs: number;
  endMs: number;
  /** First local `YYYY-MM-DD` the event covers. */
  startYmd: string;
  /** LAST local `YYYY-MM-DD` the event covers (inclusive; Google's exclusive end resolved). */
  endYmd: string;
  title?: string;
  location?: string;
  /** "Open in Google Calendar". Present on busy-only events too. */
  htmlLink?: string;
  /** Times only: the title and location were not shown or not available. */
  busyOnly: boolean;
  /** The owner marked it "free" (`transparency: 'transparent'`); a missing value is busy. */
  transparent: boolean;
}

/**
 * Per-device health of one viewed calendar's read, held in memory only.
 *  - `ok`              read cleanly.
 *  - `stale`           the last read failed for a transient reason; the last good events stay.
 *  - `truncated`       the read hit the page cap; some events may be missing.
 *  - `unavailable`     Google refused the calendar (sharing stopped); events cleared.
 *  - `needs_reconnect` the account's sign-in is dead, or its record is gone; events cleared.
 */
export type ViewCalendarState = 'ok' | 'stale' | 'truncated' | 'unavailable' | 'needs_reconnect';

/** An inclusive local-date range, `YYYY-MM-DD` both ends. */
export interface YmdRange {
  startYmd: string;
  endYmd: string;
}
