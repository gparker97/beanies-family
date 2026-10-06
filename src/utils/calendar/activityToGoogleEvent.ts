// Pure mapper: a beanies activity → a Google Calendar event resource (the subset
// of fields beanies sets). No I/O — exhaustively unit-tested. This mapper produces
// a base event + native RRULE for a whole activity; the reconcile engine (Layer 5)
// also uses `startEndForDate` / `masterOccurrenceBody` here to emit per-occurrence
// recurring-instance EXCEPTIONS (reschedule / edit-one / delete-one) and restore
// them, keyed by the master's deterministic id + the occurrence instance.
//
// This module is no longer one-directional: `googleTimesToActivityFields` (at the
// foot) is the INVERSE of `startEndForDate`, added for the one-time import (#94).
// The two live together on purpose, so a change to one is made staring at the other.

import type { FamilyActivity } from '@/types/models';
import { normalizeAssignees } from '@/utils/assignees';
import { addDaysYmd, toDateInputValue, toTimeInputValue } from '@/utils/date';
import { wallClockInZone } from '@/utils/timeZone';
import { resolveActivityDays, isAllDayActivity } from './activityDays';
import { buildRecurrenceRule } from './recurrenceRrule';
import { buildEventDescription, type EventDescriptionContext } from './eventDescription';

/** Minimal Google Calendar event resource — only the fields beanies writes. */
export interface GoogleEventResource {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  /** Always present (`[]` when non-recurring) so a `patch` can CLEAR a stale RRULE. */
  recurrence: string[];
  reminders: { useDefault: false; overrides: Array<{ method: 'popup'; minutes: number }> };
  /** Always 'confirmed' — on a patch this resurrects an event that was previously
   *  deleted (Google marks deleted events `cancelled` and reserves their id, so a
   *  re-inserted deterministic id 409s and must be patched back to confirmed). */
  status: 'confirmed';
}

export type GoogleEventDateTime =
  | { date: string } // all-day (YYYY-MM-DD); `end.date` is EXCLUSIVE
  | { dateTime: string; timeZone: string }; // timed (local wall time + IANA tz)

export interface ActivityMapContext extends EventDescriptionContext {
  /** IANA timezone for timed events: the family's resolved HOME zone
   *  (`makePushHashContext().timeZone`), never the pushing device's own zone. */
  timeZone: string;
}

/**
 * What the push hash depends on beyond the activity's own fields. REQUIRED at every
 * call site, on purpose: an optional resolver was the trap that let the import and
 * reconcile hash the same activity two ways (an adopted event then re-pushed for no
 * reason, rewriting the family's real Google event). Build it with
 * `makePushHashContext()`; never export a default from production code.
 */
export interface PushHashContext {
  /** Resolves member ids → names rendered into the description (#32 F3). */
  memberName: (id: string) => string | undefined;
  /**
   * The PERSISTED family `homeTimeZone`, or `''` (no fold). Never a device or
   * country-derived zone: those differ per device / per engine and would ping-pong
   * the hash between devices. `''` keeps the payload byte-identical to the
   * pre-home-zone hash, so a deploy alone re-pushes nothing.
   */
  hashZone: string;
}

/**
 * Google start/end for an activity anchored to ONE date (`ymd`). The single
 * formatter for both the whole-activity event (`buildStartEnd` delegates here with
 * the activity's own start day) and a re-anchored recurring occurrence
 * (`masterOccurrenceBody`, which passes the occurrence date). The end day is the
 * occurrence date shifted by the activity's own `endDayOffset` (overnight / multi-
 * day preserved). Pure.
 */
export function startEndForDate(
  activity: FamilyActivity,
  ymd: string,
  timeZone: string
): { start: GoogleEventDateTime; end: GoogleEventDateTime } {
  const days = resolveActivityDays(activity);
  const endYmd = addDaysYmd(ymd, days.endDayOffset);

  if (days.allDay) {
    // Google all-day end.date is EXCLUSIVE → add one day past the (inclusive) last day.
    return { start: { date: ymd }, end: { date: addDaysYmd(endYmd, 1) } };
  }

  return {
    start: { dateTime: `${ymd}T${days.startTime}:00`, timeZone },
    end: { dateTime: `${endYmd}T${days.endTime}:00`, timeZone },
  };
}

function buildStartEnd(
  activity: FamilyActivity,
  timeZone: string
): { start: GoogleEventDateTime; end: GoogleEventDateTime } {
  return startEndForDate(activity, resolveActivityDays(activity).startYmd, timeZone);
}

/**
 * Synced events carry NO reminder — deliberately, and permanently (greg,
 * 2026-07-23). Reminders live in beanies, where they are more configurable; a
 * reminder on both surfaces means duplicate alerts from two apps for the same
 * event.
 *
 * `useDefault: false` with an empty `overrides` explicitly means "no reminders",
 * and also suppresses the CALENDAR's own default popup — which is the point:
 * beanies owns the alert.
 *
 * Caveat worth knowing: `reminders` is per-authenticated-user, so this silences
 * the connected account only. Another Google user who has *subscribed* to the
 * calendar still gets their own calendar-level defaults, which no field we write
 * can override.
 *
 * Takes no argument on purpose — a parameter would invite "just read
 * reminderMinutes again". See also `computePushHash`, which deliberately
 * excludes `reminderMinutes` because of this.
 */
function buildReminders(): GoogleEventResource['reminders'] {
  return { useDefault: false, overrides: [] };
}

/** Assemble the shared event body (summary/description/reminders/status/location)
 *  around a resolved start/end + recurrence. The one place these fields are set,
 *  reused by `activityToGoogleEvent` (whole event) and `masterOccurrenceBody`
 *  (restore body). Pure. */
function assembleEvent(
  activity: FamilyActivity,
  start: GoogleEventDateTime,
  end: GoogleEventDateTime,
  recurrence: string[],
  ctx: ActivityMapContext
): GoogleEventResource {
  const resource: GoogleEventResource = {
    summary: activity.title,
    description: buildEventDescription(activity, ctx),
    start,
    end,
    recurrence,
    reminders: buildReminders(),
    status: 'confirmed',
  };
  if (activity.location && activity.location.trim()) resource.location = activity.location;
  return resource;
}

/** Map an activity to the Google event resource beanies will insert/patch. Pure.
 *  A `recurrence:'none'` activity (incl. every override child) yields `recurrence:[]`,
 *  so patching an instance id with this body keeps it a single instance (no RRULE). */
export function activityToGoogleEvent(
  activity: FamilyActivity,
  ctx: ActivityMapContext
): GoogleEventResource {
  const { start, end } = buildStartEnd(activity, ctx.timeZone);
  const recurrence = buildRecurrenceRule({
    recurrence: activity.recurrence,
    date: activity.date,
    daysOfWeek: activity.daysOfWeek,
    recurrenceEndDate: activity.recurrenceEndDate,
    isAllDay: isAllDayActivity(activity),
    rule: activity.rule, // #70: authoritative when present
  });
  return assembleEvent(activity, start, end, recurrence, ctx);
}

/**
 * A body that PATCHes a recurring-instance id. Identical to `GoogleEventResource`
 * minus `recurrence`: instances never carry that field, and Google rejects its
 * PRESENCE on an instance patch with HTTP 400 "Invalid value" — even an empty
 * array. (The empty-array-clears-stale-RRULE trick from #32 F2 applies to MASTER
 * patches only.)
 */
export type GoogleInstanceBody = Omit<GoogleEventResource, 'recurrence'>;

/** Strip the `recurrence` field from an event body so it can PATCH an instance id.
 *  See {@link GoogleInstanceBody} for why the field must be absent, not `[]`. */
export function toInstanceBody(resource: GoogleEventResource): GoogleInstanceBody {
  const { recurrence: _neverOnAnInstance, ...body } = resource;
  return body;
}

/**
 * The Google body for a recurring MASTER's occurrence on `occurrenceYmd`, as a
 * single instance (`status:'confirmed'`, no `recurrence` — see
 * {@link GoogleInstanceBody}). Used to RESTORE a Google instance to the master's
 * generated value after an override is deleted — patched onto the stored instance
 * id (un-cancels a cancelled instance / moves a moved one back). Pure.
 */
export function masterOccurrenceBody(
  master: FamilyActivity,
  occurrenceYmd: string,
  ctx: ActivityMapContext
): GoogleInstanceBody {
  const { start, end } = startEndForDate(master, occurrenceYmd, ctx.timeZone);
  return toInstanceBody(assembleEvent(master, start, end, [], ctx));
}

/**
 * Stable hash of the activity fields that affect the pushed event. Stored on the
 * link (`lastPushedHash`) so reconcile skips unchanged activities. Pure +
 * deterministic; a change to any pushed-relevant field changes the hash.
 * (djb2 — fast, collision-rare enough for change detection, not security.)
 *
 * `hash.hashZone` is folded only when non-empty; which links fold it at all is
 * `hashFoldsHomeZone`'s call (adopted events never do), made by the CALLER.
 */
export function computePushHash(activity: FamilyActivity, hash: PushHashContext): string {
  const relevant = {
    title: activity.title,
    date: activity.date,
    endDate: activity.endDate,
    isAllDay: activity.isAllDay,
    startTime: activity.startTime,
    endTime: activity.endTime,
    recurrence: activity.recurrence,
    daysOfWeek: activity.daysOfWeek,
    recurrenceEndDate: activity.recurrenceEndDate,
    // #70: the RULE is what `activityToGoogleEvent` actually serializes, and the
    // legacy shadow above is LOSSY — changing monthlyDay 15 -> 20, every-2 ->
    // every-3 weeks, or never -> after-10-times all leave the shadow
    // byte-identical. Without this the hash matches, `reconcilePlan` skips the
    // upsert, and Google keeps the stale RRULE forever with no error.
    rule: activity.rule,
    assigneeIds: activity.assigneeIds,
    assigneeId: activity.assigneeId,
    pickupMemberId: activity.pickupMemberId,
    dropoffMemberId: activity.dropoffMemberId,
    instructorName: activity.instructorName,
    instructorContact: activity.instructorContact,
    location: activity.location,
    feeAmount: activity.feeAmount,
    feeCurrency: activity.feeCurrency,
    feeSchedule: activity.feeSchedule,
    notes: activity.notes,
    link: activity.link,
    isActive: activity.isActive,
    // NOTE: `reminderMinutes` is deliberately EXCLUDED — it is not exported
    // (`buildReminders` always emits empty overrides), so a field that cannot
    // affect the pushed event must not dirty its hash. Including it made every
    // reminder-time edit re-push a byte-identical event to Google, forever.
    // Do not restore it as "obviously push-relevant"; it is not.
  };
  // ⚠️ CANONICAL, key-order-independent. `JSON.stringify` preserves insertion
  // order, and `relevant.rule` is a nested object whose key order DIFFERS
  // depending on where the activity came from: a freshly built object literal
  // keeps its authored order, while the same activity read back through
  // Automerge comes out with its map keys SORTED. Verified against the installed
  // @automerge/automerge: `{unit,interval,weekdays,end}` reloads as
  // `{end,interval,unit,weekdays}`.
  //
  // Without this the same activity hashes two different ways, and the damage is
  // silent and delayed: the one-time import (#94) records a hash computed from a
  // literal, the first reconcile matches because the projection delta echoes that
  // literal, and then on the NEXT app load the projection returns the sorted form,
  // the hashes disagree, and every imported activity is pushed to Google. For an
  // ADOPTED event that patch rewrites the family's real event: their description
  // body is replaced, their reminders are cleared, and beanies' RRULE is stamped
  // over theirs. Sorting here fixes the class rather than the one caller.
  let payload = JSON.stringify(relevant, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
      );
    }
    return value;
  });
  // Fold the RESOLVED member names rendered into the description, so a member rename
  // (which changes no activity field) still changes the hash and re-pushes only the
  // activities that reference that member. (F3)
  const ids = [
    ...normalizeAssignees(activity),
    activity.pickupMemberId,
    activity.dropoffMemberId,
  ].filter((id): id is string => !!id);
  payload += '|names:' + ids.map((id) => hash.memberName(id) ?? '').join(',');
  // ⚠️ BYTE-EXACT, and AFTER `|names:`. With `hashZone === ''` the payload is
  // identical to the pre-home-zone hash (pinned by a fixture test), so shipping this
  // re-pushes nothing; persisting `homeTimeZone` then re-pushes every beanies-created
  // event once, in the home zone (the repair for a foreign-zone stamp).
  if (hash.hashZone) payload += '|tz:' + hash.hashZone;
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = (h * 33) ^ payload.charCodeAt(i);
  }
  // Unsigned hex.
  return (h >>> 0).toString(16);
}

/**
 * Change-detection token for a recurring-occurrence EXCEPTION link. Reuses
 * `computePushHash` for the override child's content, then folds in the occurrence
 * date + mode so a delete↔edit↔reschedule transition on the same occurrence (or a
 * different original occurrence) re-pushes. Stored on the exception link's
 * `lastPushedHash`; opaque + stable (not security). Pure.
 */
export function computeExceptionHash(
  child: FamilyActivity,
  occurrenceYmd: string,
  mode: 'modify' | 'cancel',
  hash: PushHashContext
): string {
  return `${computePushHash(child, hash)}|${occurrenceYmd}|${mode}`;
}

/**
 * The INVERSE of {@link startEndForDate}: a Google event's start/end → the activity
 * fields that describe the same span. Added for the one-time import (#94).
 *
 * Returns the ACTIVITY-shaped subset, not `ActivityDays`. `ActivityDays` is the
 * internal day-math shape (`startYmd` / `endYmd` / `endDayOffset` / `allDay`), and
 * spreading it into a `CreateFamilyActivityInput` would produce a draft with none
 * of the right field names and no type error at the call site. Returning the real
 * field names lets the planner spread the result directly.
 *
 * Timezone: `FamilyActivity` has no timezone field. `startTime`/`endTime` are bare
 * wall-clock `HH:mm` in the family's HOME zone, and the push stamps that zone on the
 * way out. So an offset-bearing Google `dateTime` is converted to wall clock in
 * `zone` (the resolved home zone), wherever the importing device is: a Singapore
 * 10:45 imported on a Los Angeles laptop stays 10:45, not 19:45 the day before.
 */
export function googleTimesToActivityFields(
  start: { date?: string; dateTime?: string } | undefined,
  end: { date?: string; dateTime?: string } | undefined,
  zone: string
): Pick<FamilyActivity, 'date' | 'endDate' | 'isAllDay' | 'startTime' | 'endTime'> | null {
  if (!start) return null;

  if (start.date) {
    // All-day. Google's `end.date` is EXCLUSIVE; beanies' `endDate` is inclusive,
    // so step back a day. A missing or equal end is a single-day event.
    const startYmd = start.date.slice(0, 10);
    const exclusiveEnd = end?.date?.slice(0, 10);
    const inclusiveEnd = exclusiveEnd ? addDaysYmd(exclusiveEnd, -1) : startYmd;
    return {
      date: startYmd,
      isAllDay: true,
      // Only carry endDate when it genuinely spans more than one day, so a
      // single-day import matches what the activity form would have produced.
      ...(inclusiveEnd > startYmd ? { endDate: inclusiveEnd } : {}),
    };
  }

  if (!start.dateTime) return null;
  const startAt = new Date(start.dateTime);
  if (Number.isNaN(startAt.getTime())) return null;
  // A timed event with no end is not something Google returns, but the type allows
  // it; treat it as zero-length rather than inventing a duration.
  const endAt = end?.dateTime ? new Date(end.dateTime) : startAt;
  if (Number.isNaN(endAt.getTime())) return null;

  const startWall = wallClockOrDevice(startAt, zone);
  const endWall = wallClockOrDevice(endAt, zone);
  const startYmd = startWall.ymd;
  const endYmd = endWall.ymd;

  return {
    date: startYmd,
    isAllDay: false,
    startTime: startWall.hhmm,
    endTime: endWall.hhmm,
    // A timed span that ends on a LATER day carries an explicit `endDate`. The
    // model's implicit overnight roll (`endTime < startTime` with no `endDate`)
    // only ever adds ONE day and only when the clock wraps, so relying on it alone
    // truncated a three-day conference to one night — and, worse, collapsed an
    // exactly-24-hour event to ZERO length, because 10:00 is not < 10:00.
    // `resolveActivityDays` reads `endDate` back as the end day directly.
    ...(endYmd > startYmd ? { endDate: endYmd } : {}),
  };
}

/**
 * Wall clock in `zone`, or on THIS device's clock when the engine cannot format the
 * zone (a stored id an older engine lacks). The device fallback is the pre-home-zone
 * behaviour, so the worst case is today's, never a failed import.
 */
function wallClockOrDevice(at: Date, zone: string): { ymd: string; hhmm: string } {
  try {
    return wallClockInZone(at, zone);
  } catch {
    // Not reported here (pure module): the caller's resolver already logs
    // `home-time-zone` `invalid-stored` for exactly this case.
    return { ymd: toDateInputValue(at), hhmm: toTimeInputValue(at) };
  }
}
