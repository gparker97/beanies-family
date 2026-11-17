// Shared limits for the Google Calendar orchestrators (sync, clash, view-only).
//
// One home so the three stores cannot drift apart on how hard they lean on Google
// or how long a read stays fresh (view-only calendars plan 2026-11-17, A4).

/** Bounded concurrency for Google Calendar reads and writes, per orchestrator pass. */
export const MAX_INFLIGHT = 5;

/** How long a read of someone else's calendar stays fresh before it is re-read (5 min). */
export const CALENDAR_READ_TTL_MS = 300_000;

/** The clash nudge re-reads event times at most once per (connection, window) per this. */
export const CLASH_BUSY_TTL_MS = CALENDAR_READ_TTL_MS;

/** A view-only calendar's events are re-read at most once per (calendar, window) per this. */
export const VIEW_TTL_MS = CALENDAR_READ_TTL_MS;

/**
 * A return to the app (or the poll) skips a view-only read younger than this, so
 * switching tabs does not re-read every calendar. A change the owner makes still
 * shows within this long after coming back.
 */
export const VIEW_MIN_REFRESH_MS = 60_000;
