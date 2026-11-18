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
 * May an event whose details show only by the email-created exception (see
 * `isKeptPrivate`) keep them on this calendar? Only when the connected Google
 * account OWNS the calendar.
 */
function ownsCalendar(calendar: Pick<ViewedCalendar, 'accessRole'>): boolean {
  return calendar.accessRole === 'owner';
}

/**
 * An already-normalized event, re-stripped for its calendar's CURRENT setting: when
 * the calendar is now busy only, the title and location go at once, without waiting
 * for a refetch that might fail (or for a concurrent merge to be noticed). An event
 * shown only by the email-created exception (`detailsNeedOwner`) is stripped too
 * once the calendar is no longer one the account owns. The meeting link (#150 P4) goes
 * with the title and location. The same object comes back
 * when there is nothing to strip, so identity stays stable.
 */
export function restripForCalendar(
  event: ExternalEvent,
  calendar: Pick<ViewedCalendar, 'detailLevel' | 'accessRole'>
): ExternalEvent {
  const strip =
    isBusyOnlyCalendar(calendar) || (event.detailsNeedOwner === true && !ownsCalendar(calendar));
  if (!strip) return event;
  if (
    event.busyOnly &&
    event.title === undefined &&
    event.location === undefined &&
    event.meetingUrl === undefined
  ) {
    return event;
  }
  const {
    title: _title,
    location: _location,
    meetingUrl: _meetingUrl,
    detailsNeedOwner: _owner,
    ...rest
  } = event;
  return { ...rest, busyOnly: true };
}

/** Visibilities Google uses for an event its owner wants kept to themselves. */
const PRIVATE_VISIBILITIES = new Set(['private', 'confidential']);

/** Did Google mark this event private or confidential? */
function isMarkedPrivate(raw: CalendarViewEvent): boolean {
  return raw.visibility !== undefined && PRIVATE_VISIBILITIES.has(raw.visibility);
}

/**
 * A private event that keeps its details only because Google made it from an email
 * (`eventType: 'fromGmail'`: a dinner booking, a flight) and the connected account
 * OWNS the calendar. Google marks those private by default, so on the family's own
 * calendar the mark is not a choice, and hiding them made a family's own dinner read
 * as "Busy" (found in testing; greg's decision, 2026-11-17: "on a view-only calendar
 * that the connected Google account owns").
 *
 * ONLY `accessRole: 'owner'`. Google returns a private event's details to any account
 * that may change the calendar (`writer` too), so a partner's email-created dinner
 * shared with "make changes" access would otherwise be shown to the whole family.
 */
function isOwnEmailEvent(raw: CalendarViewEvent, calendar: NormalizeCalendar): boolean {
  return raw.eventType === 'fromGmail' && ownsCalendar(calendar);
}

/**
 * Did the owner choose to keep this event to themselves? `private` / `confidential`
 * means yes, except an email-created event on a calendar the account owns
 * (`isOwnEmailEvent`).
 */
function isKeptPrivate(raw: CalendarViewEvent, calendar: NormalizeCalendar): boolean {
  return isMarkedPrivate(raw) && !isOwnEmailEvent(raw, calendar);
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
  return isBusyOnlyCalendar(calendar) || isKeptPrivate(raw, calendar) || !raw.summary;
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
 *  4. strip `title` and `location` for a busy-only event (see `isBusyOnly`);
 *  5. keep the client's screened `meetingUrl` (#150 P4) only when `includeMeetingUrl`
 *     is true (the caller passes `locationLinksEnabled()`) and the event is not busy-only.
 *
 * `transparent` is true only for `transparency: 'transparent'`; a missing value is
 * busy (a free/busy calendar returns no `transparency` at all).
 */
/**
 * Did beanies itself put this event on the calendar (pushed, adopted or imported)?
 * Its own id or its series id is in `beaniesIds` (`beaniesEventIds`). The one test,
 * used when a read commits AND by the store's `events` selector, so an event that
 * becomes beanies-origin after its read (an activity pushed from another device
 * arrives by sync later) stops showing at once.
 */
export function isBeaniesOrigin(
  event: { id: string; seriesId?: string },
  beaniesIds: ReadonlySet<string>
): boolean {
  return (
    beaniesIds.has(event.id) || (event.seriesId !== undefined && beaniesIds.has(event.seriesId))
  );
}

export interface NormalizeOptions {
  /** Keep the event's join link (#150 P4). The store passes `locationLinksEnabled()`. */
  includeMeetingUrl?: boolean;
}

export function normalizeViewEvents(
  raw: readonly CalendarViewEvent[],
  calendar: NormalizeCalendar,
  beaniesIds: ReadonlySet<string>,
  { includeMeetingUrl = false }: NormalizeOptions = {}
): NormalizeResult {
  const events: ExternalEvent[] = [];
  let droppedAsBeanies = 0;
  let malformed = 0;
  for (const item of raw) {
    if (item.status === 'cancelled') continue;
    if (isBeaniesOrigin({ id: item.id, seriesId: item.recurringEventId }, beaniesIds)) {
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
      if (includeMeetingUrl && item.meetingUrl) event.meetingUrl = item.meetingUrl;
      // Shown only by the owner exception: `restripForCalendar` drops the details if
      // the calendar ever stops being one the account owns.
      if (isMarkedPrivate(item)) event.detailsNeedOwner = true;
    }
    if (item.recurringEventId !== undefined) event.seriesId = item.recurringEventId;
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

/** An inclusive local-date range as the `[startMs, endMs)` instants it covers (`rangeToIsoWindow`'s span). */
export function rangeToMsSpan(range: YmdRange): MsSpan {
  return {
    startMs: parseLocalDate(range.startYmd).getTime(),
    endMs: parseLocalDate(addDaysYmd(range.endYmd, 1)).getTime(),
  };
}

/** A half-open span of instants, `[startMs, endMs)`. */
export interface MsSpan {
  startMs: number;
  endMs: number;
}

/** One window's cached events, as the merge reads them. */
export interface WindowEvents {
  events: readonly ExternalEvent[];
  /** When `events` were read from Google (0 = never or nothing to claim). A failed read keeps the previous value. */
  eventsAt: number;
  /** That read returned EVERY event of its span (it was not cut short by the page cap). */
  complete: boolean;
  /** The span that read asked Google for. */
  span: MsSpan;
}

/**
 * Would a read of `span` have returned this event? Google's own test for
 * `timeMin` / `timeMax`: the event ends after the span starts and starts before it
 * ends (both bounds exclusive).
 */
function readWouldInclude(event: Pick<ExternalEvent, 'startMs' | 'endMs'>, span: MsSpan): boolean {
  return event.startMs < span.endMs && event.endMs > span.startMs;
}

/**
 * One calendar's events from its windows (standing and screen), each event once.
 *
 * THE MERGE RULE. The windows are taken freshest first (by `eventsAt`; a tie keeps
 * the given order, standing first):
 *  1. A fresher window's copy of an event wins over a staler copy of the same id, so
 *     a moved or edited event shows as it is now, never at its old time.
 *  2. A staler window's event is DROPPED when a fresher COMPLETE read's span covers
 *     its time and that read did not return it. Google returns every event that
 *     overlaps the span it is asked for, so its absence there means the event was
 *     deleted or moved away after the staler read; resurrecting it would show a
 *     deleted event until the staler window's next poll.
 *  3. Otherwise it is kept: no fresher read has looked at its time.
 *
 * A truncated read (`complete: false`) still wins by id (rule 1) but never drops
 * anything (rule 2): what it did not return may simply be past the page cap.
 */
export function mergeWindowEvents(windows: readonly WindowEvents[]): ExternalEvent[] {
  const ordered = windows
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w.eventsAt - a.w.eventsAt || a.i - b.i)
    .map(({ w }) => w);
  const out: ExternalEvent[] = [];
  const seen = new Set<string>();
  const fresherComplete: MsSpan[] = [];
  for (const win of ordered) {
    for (const e of win.events) {
      if (seen.has(e.id)) continue;
      if (fresherComplete.some((span) => readWouldInclude(e, span))) continue;
      seen.add(e.id);
      out.push(e);
    }
    if (win.complete) fresherComplete.push(win.span);
  }
  return out;
}

/** The cache key of a range: two reads of the same span are the same read. */
export function spanKeyOf(range: YmdRange): string {
  return `${range.startYmd}|${range.endYmd}`;
}

// ── Health ──────────────────────────────────────────────────────────────────

/** What a failed read says about a calendar: Google refused it, or something else went wrong. */
export type ReadFailureClass = 'refused' | 'other';

/**
 * Classify a failed read from the classified `CalendarApiError.kind`, NEVER the raw
 * HTTP status: Google throttles with 403, which the client already classifies as
 * `rate_limited`, so a throttle must not count against a calendar.
 *
 * `forbidden` / `not_found` are a refusal (the owner may have stopped sharing, or
 * deleted the calendar). Everything else, including a single `auth`, is `other`.
 * A refusal is only a STRIKE: the calendar's sharing health (`healthAfterRead`)
 * turns unavailable after `REFUSALS_BEFORE_UNAVAILABLE` of them. No cache entry ever
 * holds `unavailable` (that state belongs to the calendar, R6 in the store); a
 * failed read leaves its entry `stale`, and `needs_reconnect` is decided by the
 * caller from the token provider's permanent-failure latch.
 */
export function classifyReadFailure(err: unknown): ReadFailureClass {
  if (err instanceof CalendarApiError && (err.kind === 'forbidden' || err.kind === 'not_found')) {
    return 'refused';
  }
  return 'other';
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
  return classifyReadFailure(err) === 'refused';
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
