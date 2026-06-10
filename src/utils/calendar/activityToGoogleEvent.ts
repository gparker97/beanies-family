// Pure mapper: a beanies activity → a Google Calendar event resource (the subset
// of fields beanies sets). No I/O — exhaustively unit-tested. The reconcile engine
// (Layer 5) sets the deterministic id and handles recurring-override *exceptions*
// using the parent link; this mapper produces the base event + native RRULE.

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

function buildStartEnd(
  activity: FamilyActivity,
  timeZone: string
): { start: GoogleEventDateTime; end: GoogleEventDateTime } {
  const days = resolveActivityDays(activity);

  if (days.allDay) {
    // Google all-day end.date is EXCLUSIVE → add one day past the (inclusive) last day.
    return { start: { date: days.startYmd }, end: { date: addDaysYmd(days.endYmd, 1) } };
  }

  return {
    start: { dateTime: `${days.startYmd}T${days.startTime}:00`, timeZone },
    end: { dateTime: `${days.endYmd}T${days.endTime}:00`, timeZone },
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
    recurrence,
    reminders: buildReminders(activity),
    status: 'confirmed',
  };
  if (activity.location && activity.location.trim()) resource.location = activity.location;
  return resource;
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
