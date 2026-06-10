// Pure mapper: a beanies activity → a Google Calendar event resource (the subset
// of fields beanies sets). No I/O — exhaustively unit-tested. The reconcile engine
// (Layer 5) sets the deterministic id and handles recurring-override *exceptions*
// using the parent link; this mapper produces the base event + native RRULE.

import type { FamilyActivity } from '@/types/models';
import { buildRecurrenceRule } from './recurrenceRrule';
import { buildEventDescription, type EventDescriptionContext } from './eventDescription';

/** Minimal Google Calendar event resource — only the fields beanies writes. */
export interface GoogleEventResource {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  recurrence?: string[];
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

/** True when the activity has no specific time → an all-day Google event. */
function isAllDayActivity(activity: FamilyActivity): boolean {
  return activity.isAllDay === true || !activity.startTime;
}

/** `YYYY-MM-DD` + n days → `YYYY-MM-DD` (TZ-safe via local Date arithmetic). */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function buildStartEnd(
  activity: FamilyActivity,
  timeZone: string
): { start: GoogleEventDateTime; end: GoogleEventDateTime } {
  const startYmd = activity.date.slice(0, 10);

  if (isAllDayActivity(activity)) {
    // Google all-day end.date is EXCLUSIVE → add one day past the (inclusive) last day.
    const lastDay = (activity.endDate ?? activity.date).slice(0, 10);
    return { start: { date: startYmd }, end: { date: addDaysYmd(lastDay, 1) } };
  }

  const startTime = activity.startTime as string; // guaranteed by isAllDayActivity check
  const endTime = activity.endTime ?? startTime;
  return {
    start: { dateTime: `${startYmd}T${startTime}:00`, timeZone },
    end: { dateTime: `${startYmd}T${endTime}:00`, timeZone },
  };
}

function buildReminders(activity: FamilyActivity): GoogleEventResource['reminders'] {
  const minutes = activity.reminderMinutes;
  return minutes > 0
    ? { useDefault: false, overrides: [{ method: 'popup', minutes }] }
    : { useDefault: false, overrides: [] };
}

/** Map an activity to the Google event resource beanies will insert/patch. Pure. */
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
  });

  const resource: GoogleEventResource = {
    summary: activity.title,
    description: buildEventDescription(activity, ctx),
    start,
    end,
    reminders: buildReminders(activity),
    status: 'confirmed',
  };
  if (activity.location && activity.location.trim()) resource.location = activity.location;
  if (recurrence) resource.recurrence = recurrence;
  return resource;
}

/**
 * Stable hash of the activity fields that affect the pushed event. Stored on the
 * link (`lastPushedHash`) so reconcile skips unchanged activities. Pure +
 * deterministic; a change to any pushed-relevant field changes the hash.
 * (djb2 — fast, collision-rare enough for change detection, not security.)
 */
export function computePushHash(activity: FamilyActivity): string {
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
    reminderMinutes: activity.reminderMinutes,
    isActive: activity.isActive,
  };
  const json = JSON.stringify(relevant);
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 33) ^ json.charCodeAt(i);
  }
  // Unsigned hex.
  return (hash >>> 0).toString(16);
}
