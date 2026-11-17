// View-only external calendars (plan 2026-11-17, A4): the pure half of the store.
//
// Normalization, window maths, the error-to-state mapping, the default color pick
// and the calendar dedupe, all testable without Pinia or fake timers. No timers, no
// I/O, no reporter: `calendarViewStore` owns those.

import { CalendarApiError, type CalendarViewEvent } from '@/services/calendar/CalendarClient';
import { eventItemToMs } from '@/utils/calendar/googleEventTime';
import { ASSIGNABLE_MEMBER_COLORS, NEUTRAL_MEMBER_COLOR } from '@/constants/memberColors';
import {
  addDaysYmd,
  daysBetweenYmd,
  monthGridRange,
  parseLocalDate,
  startOfWeekYmd,
  toDateInputValue,
} from '@/utils/date';
import type { ViewedCalendar } from '@/types/models';
import type { ExternalEvent, ViewCalendarState, YmdRange } from '@/types/externalEvents';

export type { ExternalEvent, ViewCalendarState, YmdRange };

// ── Normalization ───────────────────────────────────────────────────────────

/** What normalization needs to know about the calendar an event came from. */
export type NormalizeCalendar = Pick<
  ViewedCalendar,
  'id' | 'name' | 'color' | 'detailLevel' | 'accessRole'
>;

export interface NormalizeResult {
  events: ExternalEvent[];
  /** Events dropped because beanies itself put them there (pushed, adopted, imported). */
  droppedAsBeanies: number;
  /** Items with no usable start/end, dropped. Should never happen; the caller reports it. */
  malformed: number;
}

/**
 * Does the calendar's own setting make EVERY event times only? The family chose
 * "Show as busy only", or the account can only see free/busy on it.
 */
export function isBusyOnlyCalendar(
  calendar: Pick<ViewedCalendar, 'detailLevel' | 'accessRole'>
): boolean {
  return calendar.detailLevel === 'busy' || calendar.accessRole === 'freeBusyReader';
}

/**
 * An already-normalized event, re-stripped for its calendar's CURRENT setting: when
 * the calendar is now busy only, the title and location go at once, without waiting
 * for a refetch that might fail (or for a concurrent merge to be noticed). The same
 * object comes back when there is nothing to strip, so identity stays stable.
 */
export function restripForCalendar(
  event: ExternalEvent,
  calendar: Pick<ViewedCalendar, 'detailLevel' | 'accessRole'>
): ExternalEvent {
  if (!isBusyOnlyCalendar(calendar)) return event;
  if (event.busyOnly && event.title === undefined && event.location === undefined) return event;
  const { title: _title, location: _location, ...rest } = event;
  return { ...rest, busyOnly: true };
}

/** Visibilities Google uses for an event its owner wants kept to themselves. */
const PRIVATE_VISIBILITIES = new Set(['private', 'confidential']);

/**
 * Did the owner choose to keep this event to themselves?
 *
 * `private` / `confidential` normally means yes. The exception is an event Google made
 * from an email (`eventType: 'fromGmail'`: a dinner booking, a flight): Google marks
 * those private by default, so the mark is not a choice, and hiding them made a
 * family's own dinner read as "Busy" (found in testing; greg's decision, 2026-11-17).
 * Google only returns such an event's title to an account that owns the calendar, so
 * this never reveals anything on a calendar someone else shared: there the title is
 * absent and the no-title rule below still applies.
 */
function isKeptPrivate(raw: CalendarViewEvent): boolean {
  if (raw.visibility === undefined || !PRIVATE_VISIBILITIES.has(raw.visibility)) return false;
  return raw.eventType !== 'fromGmail';
}

/**
 * Should this event show as times only?
 *
 * Any one of these is enough: the family chose "Show as busy only"; the account can
 * only see free/busy on the calendar (Google returns no titles, the spike confirmed);
 * the owner marked the event private or confidential (see `isKeptPrivate`); or the
 * event simply has no title (the spike's busy-only shape has no `summary`).
 */
function isBusyOnly(raw: CalendarViewEvent, calendar: NormalizeCalendar): boolean {
  return isBusyOnlyCalendar(calendar) || isKeptPrivate(raw) || !raw.summary;
}

/** Local `YYYY-MM-DD` of an absolute instant. */
function ymdOfMs(ms: number): string {
  return toDateInputValue(new Date(ms));
}

/**
 * Raw Google events -> what the family is shown. Applies, in order:
 *  1. drop `status: 'cancelled'`;
 *  2. drop beanies-origin events (`id` or `recurringEventId` in `beaniesIds`), so a
 *     calendar beanies also pushes to never doubles an activity;
 *  3. convert times: timed events to device-local instants, all-day events to their
 *     calendar dates (Google's exclusive end resolved, so a multi-day all-day event
 *     keeps its real first and last day);
 *  4. strip `title` and `location` for a busy-only event (see `isBusyOnly`).
 *
 * `transparent` is true only for `transparency: 'transparent'`; a missing value is
 * busy (a free/busy calendar returns no `transparency` at all).
 */
export function normalizeViewEvents(
  raw: readonly CalendarViewEvent[],
  calendar: NormalizeCalendar,
  beaniesIds: ReadonlySet<string>
): NormalizeResult {
  const events: ExternalEvent[] = [];
  let droppedAsBeanies = 0;
  let malformed = 0;
  for (const item of raw) {
    if (item.status === 'cancelled') continue;
    if (
      beaniesIds.has(item.id) ||
      (item.recurringEventId !== undefined && beaniesIds.has(item.recurringEventId))
    ) {
      droppedAsBeanies++;
      continue;
    }
    const range = eventItemToMs(item);
    if (!range || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) {
      malformed++;
      continue;
    }
    const allDay = !item.start?.dateTime;
    let startYmd: string;
    let endYmd: string;
    if (allDay) {
      startYmd = item.start!.date!;
      const endExclusive = item.end!.date!;
      endYmd = endExclusive > startYmd ? addDaysYmd(endExclusive, -1) : startYmd;
    } else {
      startYmd = ymdOfMs(range.startMs);
      // An event ending exactly at midnight does not cover the next day.
      endYmd = range.endMs > range.startMs ? ymdOfMs(range.endMs - 1) : startYmd;
    }
    const busyOnly = isBusyOnly(item, calendar);
    const event: ExternalEvent = {
      id: item.id,
      viewedCalendarId: calendar.id,
      calendarName: calendar.name,
      color: calendar.color,
      allDay,
      startMs: range.startMs,
      endMs: Math.max(range.endMs, range.startMs),
      startYmd,
      endYmd,
      busyOnly,
      transparent: item.transparency === 'transparent',
    };
    if (!busyOnly) {
      event.title = item.summary;
      if (item.location) event.location = item.location;
    }
    if (item.htmlLink) event.htmlLink = item.htmlLink;
    events.push(event);
  }
  return { events, droppedAsBeanies, malformed };
}

// ── Indexing ────────────────────────────────────────────────────────────────

/** Guard against a corrupt range spinning the per-day loop. A year is far beyond any window. */
const MAX_INDEX_DAYS = 366;

/** All-day first, then by start, then by end; the id keeps the order stable. */
export function compareExternalEvents(a: ExternalEvent, b: ExternalEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  if (a.endMs !== b.endMs) return a.endMs - b.endMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Events by the local day they cover. A multi-day event appears on EACH day it
 * covers; each day's list is sorted all-day first, then by start.
 */
export function indexByDate(events: readonly ExternalEvent[]): Map<string, ExternalEvent[]> {
  const byDate = new Map<string, ExternalEvent[]>();
  for (const event of events) {
    let ymd = event.startYmd;
    for (let i = 0; i < MAX_INDEX_DAYS && ymd <= event.endYmd; i++) {
      const day = byDate.get(ymd);
      if (day) day.push(event);
      else byDate.set(ymd, [event]);
      ymd = addDaysYmd(ymd, 1);
    }
  }
  for (const day of byDate.values()) day.sort(compareExternalEvents);
  return byDate;
}

// ── Windows ─────────────────────────────────────────────────────────────────

/** The unit a page host pages by. */
export type PeriodUnit = 'day' | 'week' | 'month';

function minYmd(a: string, b: string): string {
  return a < b ? a : b;
}
function maxYmd(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * The visible range plus one period before and one after (Requirement 6), composed
 * from the existing date helpers. Never narrower than the input.
 *
 *  - `day`:   one day each side.
 *  - `week`:  the whole week before the first visible week and the whole week after the last.
 *  - `month`: the month grids of the month before and the month after the visible month.
 *    The visible month is the one holding the middle of the range, so a six-row grid
 *    (which starts in the previous month) and a plain 1st-to-last range agree.
 */
export function widenByPeriod(range: YmdRange, unit: PeriodUnit, weekStartDay: number): YmdRange {
  let startYmd: string;
  let endYmd: string;
  if (unit === 'day') {
    startYmd = addDaysYmd(range.startYmd, -1);
    endYmd = addDaysYmd(range.endYmd, 1);
  } else if (unit === 'week') {
    startYmd = addDaysYmd(startOfWeekYmd(range.startYmd, weekStartDay), -7);
    endYmd = addDaysYmd(startOfWeekYmd(range.endYmd, weekStartDay), 13);
  } else {
    const span = Math.max(0, daysBetweenYmd(range.startYmd, range.endYmd));
    const middle = parseLocalDate(addDaysYmd(range.startYmd, Math.floor(span / 2)));
    const year = middle.getFullYear();
    const month = middle.getMonth();
    startYmd = monthGridRange(new Date(year, month - 1, 1), weekStartDay).startYmd;
    endYmd = monthGridRange(new Date(year, month + 1, 1), weekStartDay).endYmd;
  }
  return { startYmd: minYmd(startYmd, range.startYmd), endYmd: maxYmd(endYmd, range.endYmd) };
}

/** The standing window for surfaces with no on-screen period: yesterday to 35 days ahead. */
export function standingRange(todayYmd: string): YmdRange {
  return { startYmd: addDaysYmd(todayYmd, -1), endYmd: addDaysYmd(todayYmd, 35) };
}

/** An inclusive local-date range as the `[timeMin, timeMax)` instants Google reads. */
export function rangeToIsoWindow(range: YmdRange): { timeMinIso: string; timeMaxIso: string } {
  return {
    timeMinIso: parseLocalDate(range.startYmd).toISOString(),
    timeMaxIso: parseLocalDate(addDaysYmd(range.endYmd, 1)).toISOString(),
  };
}

/** The cache key of a range: two reads of the same span are the same read. */
export function spanKeyOf(range: YmdRange): string {
  return `${range.startYmd}|${range.endYmd}`;
}

// ── Health ──────────────────────────────────────────────────────────────────

/**
 * The cache state a failed read leaves, from the classified `CalendarApiError.kind`
 * and NEVER the raw HTTP status: Google throttles with 403, which the client already
 * classifies as `rate_limited`, so a throttle must not wipe a calendar's events.
 *
 * `forbidden` / `not_found` mean the owner stopped sharing (or deleted the calendar):
 * `unavailable`. Everything else, including a single `auth`, is `stale` and keeps
 * the last good events. `needs_reconnect` is decided by the caller from the token
 * provider's permanent-failure latch, not here.
 */
export function stateFromError(err: unknown): Extract<ViewCalendarState, 'unavailable' | 'stale'> {
  if (err instanceof CalendarApiError && (err.kind === 'forbidden' || err.kind === 'not_found')) {
    return 'unavailable';
  }
  return 'stale';
}

/**
 * Refusals (`forbidden` / `not_found`) before a calendar counts as no longer shared.
 * One alone keeps its events: Google answers some throttles and blips with a 403
 * whose reason cannot be read, and a single one must not wipe a calendar or raise
 * the "no longer shared" toast. A real revocation still shows on the next read.
 */
export const REFUSALS_BEFORE_UNAVAILABLE = 2;

/**
 * Two refusals count as two strikes only this far apart, so one blip seen by
 * several reads (both windows, two quick page flips, a return to the app) is one
 * strike. The poll re-reads every 5 minutes, so a real revocation still lands on
 * the second poll at the latest.
 */
export const REFUSAL_STRIKE_GAP_MS = 60_000;

/**
 * Whether the family can still read a viewed calendar, as seen on this device. A
 * property of the CALENDAR, never of one fetch window: one record per calendar, fed
 * by the reads of every window, so the windows can never disagree about it.
 */
export interface CalendarHealth {
  /** Strikes so far (refusals at least `REFUSAL_STRIKE_GAP_MS` apart). */
  refusals: number;
  /** When the last strike was counted (epoch ms); 0 = never. */
  lastStrikeAt: number;
  /** Sharing stopped: every window's events are hidden. */
  unavailable: boolean;
}

export const HEALTHY: Readonly<CalendarHealth> = Object.freeze({
  refusals: 0,
  lastStrikeAt: 0,
  unavailable: false,
});

/** Is this failure a refusal (the owner stopped sharing, or the calendar is gone)? */
export function isRefusal(err: unknown): boolean {
  return stateFromError(err) === 'unavailable';
}

/**
 * A calendar's health after one read. A success makes it healthy. A refusal is a
 * strike unless the last one was under `REFUSAL_STRIKE_GAP_MS` ago (the same blip).
 * Any other failure (throttle, network, a single 401) says nothing about sharing and
 * leaves it as it was. Returns `prev` itself when nothing changed.
 */
export function healthAfterRead(
  prev: Readonly<CalendarHealth> | undefined,
  outcome: 'ok' | 'refused' | 'other',
  now: number
): Readonly<CalendarHealth> {
  const before = prev ?? HEALTHY;
  if (outcome === 'ok') return before.refusals === 0 && !before.unavailable ? before : HEALTHY;
  if (outcome === 'other') return before;
  if (before.refusals > 0 && now - before.lastStrikeAt < REFUSAL_STRIKE_GAP_MS) return before;
  const refusals = before.refusals + 1;
  return { refusals, lastStrikeAt: now, unavailable: refusals >= REFUSALS_BEFORE_UNAVAILABLE };
}

/** Worst first: what a calendar's card shows when its two windows disagree. */
const STATE_SEVERITY: Record<ViewCalendarState, number> = {
  needs_reconnect: 4,
  unavailable: 3,
  stale: 2,
  truncated: 1,
  ok: 0,
};

/** The worse of two states (`null` = not read yet). */
export function worseState(
  a: ViewCalendarState | null,
  b: ViewCalendarState | null
): ViewCalendarState | null {
  if (a === null) return b;
  if (b === null) return a;
  return STATE_SEVERITY[a] >= STATE_SEVERITY[b] ? a : b;
}

// ── The read guard ──────────────────────────────────────────────────────────

/**
 * May this Google calendar be read? Only when the family added it. The view grant
 * (`calendar.events.readonly`) can read every calendar on the account, so this is
 * the line that keeps beanies to the calendars a member chose.
 */
export function isViewedCalendarId(
  calendarId: string,
  viewed: readonly Pick<ViewedCalendar, 'calendarId'>[]
): boolean {
  return viewed.some((c) => c.calendarId === calendarId);
}

// ── Settings defaults ───────────────────────────────────────────────────────

/** The colors a viewed calendar may wear: neutral gray first, then the member hues. */
export const VIEW_CALENDAR_PALETTE: readonly string[] = [
  NEUTRAL_MEMBER_COLOR,
  ...ASSIGNABLE_MEMBER_COLORS,
];

/**
 * The first palette color no viewed calendar wears yet (neutral gray for the first
 * one), falling back to neutral gray when every color is taken.
 */
export function pickDefaultColor(usedColors: Iterable<string>): string {
  const used = new Set<string>();
  for (const c of usedColors) used.add(c.toLowerCase());
  return VIEW_CALENDAR_PALETTE.find((c) => !used.has(c.toLowerCase())) ?? NEUTRAL_MEMBER_COLOR;
}

/**
 * One record per Google calendar: two devices adding the same calendar, or one
 * calendar reached through two accounts, show it once. The EARLIEST `createdAt`
 * wins (the id breaks a tie, so every device keeps the same one). Returned in
 * `createdAt` order.
 */
export function dedupeViewedCalendars<
  T extends Pick<ViewedCalendar, 'id' | 'calendarId' | 'createdAt'>,
>(list: readonly T[]): T[] {
  const sorted = [...list].sort((a, b) =>
    a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1
  );
  const seen = new Set<string>();
  const out: T[] = [];
  for (const cal of sorted) {
    if (seen.has(cal.calendarId)) continue;
    seen.add(cal.calendarId);
    out.push(cal);
  }
  return out;
}
