// Pure mapper: a beanies activity → a Google Calendar event resource (the subset
// of fields beanies sets). No I/O — exhaustively unit-tested. This mapper produces
// a base event + native RRULE for a whole activity; the reconcile engine (Layer 5)
// also uses `startEndForDate` / `masterOccurrenceBody` here to emit per-occurrence
// recurring-instance EXCEPTIONS (reschedule / edit-one / delete-one) and restore
// them, keyed by the master's deterministic id + the occurrence instance.

import type { FamilyActivity } from '@/types/models';
import { normalizeAssignees } from '@/utils/assignees';
import { addDaysYmd } from '@/utils/date';
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
  /** IANA timezone for timed events (caller: `Intl.DateTimeFormat().resolvedOptions().timeZone`). */
  timeZone: string;
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
 * The Google body for a recurring MASTER's occurrence on `occurrenceYmd`, as a
 * single instance (`recurrence:[]`, `status:'confirmed'`). Used to RESTORE a Google
 * instance to the master's generated value after an override is deleted — patched
 * onto the stored instance id (un-cancels a cancelled instance / moves a moved one
 * back). Pure.
 */
export function masterOccurrenceBody(
  master: FamilyActivity,
  occurrenceYmd: string,
  ctx: ActivityMapContext
): GoogleEventResource {
  const { start, end } = startEndForDate(master, occurrenceYmd, ctx.timeZone);
  return assembleEvent(master, start, end, [], ctx);
}

/**
 * Stable hash of the activity fields that affect the pushed event. Stored on the
 * link (`lastPushedHash`) so reconcile skips unchanged activities. Pure +
 * deterministic; a change to any pushed-relevant field changes the hash.
 * (djb2 — fast, collision-rare enough for change detection, not security.)
 */
export function computePushHash(
  activity: FamilyActivity,
  memberName?: (id: string) => string | undefined
): string {
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
  let payload = JSON.stringify(relevant);
  // Fold the RESOLVED member names rendered into the description, so a member rename
  // (which changes no activity field) still changes the hash and re-pushes only the
  // activities that reference that member. (F3)
  if (memberName) {
    const ids = [
      ...normalizeAssignees(activity),
      activity.pickupMemberId,
      activity.dropoffMemberId,
    ].filter((id): id is string => !!id);
    payload += '|names:' + ids.map((id) => memberName(id) ?? '').join(',');
  }
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 33) ^ payload.charCodeAt(i);
  }
  // Unsigned hex.
  return (hash >>> 0).toString(16);
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
  memberName?: (id: string) => string | undefined
): string {
  return `${computePushHash(child, memberName)}|${occurrenceYmd}|${mode}`;
}
