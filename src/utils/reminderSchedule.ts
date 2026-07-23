/**
 * Shared reminder-scheduling primitives.
 *
 * Pure, framework-free helpers + default lead-times, extracted so BOTH the
 * in-app notification deriver (`utils/notifications.ts`) and the OS local-
 * notification forward builder (`composables/useScheduledReminders.ts`) compute
 * fire times the same way — no duplicated date math, one source of default
 * leads. See `docs/plans/2026-07-23-notifications-end-to-end-native.md`.
 */
import type { SupportedTravelType } from '@/utils/vacation';
import type { FamilyActivity, FamilyMember } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';
import { normalizeAssignees } from '@/utils/assignees';
import { classifyAudience } from '@/utils/audience';

/**
 * Parse a local `YYYY-MM-DD` (+ optional `HH:mm`) into a LOCAL-time Date —
 * avoids the UTC-midnight trap of `new Date('YYYY-MM-DD')`. Returns null on a
 * malformed date so callers can skip the record rather than schedule `NaN`.
 */
export function localDateTime(dateStr: string, time?: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!dm) return null;
  let hh = 0;
  let mm = 0;
  if (time) {
    const tm = /^(\d{1,2}):(\d{2})/.exec(time);
    if (tm) {
      hh = Number(tm[1]);
      mm = Number(tm[2]);
    }
  }
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hh, mm, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Subtract `minutes` from a Date, returning a new Date. */
export function minusMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() - minutes * 60_000);
}

/** Whether/how an activity occurrence concerns the current member, + its
 *  reminder-line context. Shared verbatim by the in-app deriver
 *  (`utils/notifications.ts`) and the OS forward scheduler
 *  (`composables/useScheduledReminders.ts`) so the two can't diverge on who
 *  sees a reminder or how the "who · where" line reads. */
export interface ActivityReminderContext {
  /** False when this occurrence isn't the current member's concern (hide it). */
  relevant: boolean;
  /** The activity's own title (shown bold). */
  title: string;
  /** Assignee names then the location — the at-a-glance "who · where" parts. */
  who: string[];
  /** The viewer's duty on this occurrence, if any (drives the role chip). */
  dutyRole?: 'dropoff' | 'pickup';
}

export function activityReminderContext(
  activity: FamilyActivity,
  currentMember: FamilyMember,
  resolveMember: (id: string) => FamilyMember | undefined
): ActivityReminderContext {
  const assignees = normalizeAssignees(activity);
  const audience = classifyAudience(assignees, currentMember, resolveMember);
  const isDropoff = activity.dropoffMemberId === currentMember.id;
  const isPickup = activity.pickupMemberId === currentMember.id;
  const isDuty = isDropoff || isPickup;
  const who = assignees
    .map(resolveMember)
    .filter((m): m is FamilyMember => m !== undefined)
    .map((m) => m.name);
  if (activity.location) who.push(activity.location);
  return {
    // Duty (dropoff/pickup) overrides a 'hidden' audience — you still need the
    // reminder even if you're not an assignee.
    relevant: !(audience.kind === 'hidden' && !isDuty),
    title: activity.title,
    who,
    dutyRole: isDropoff ? 'dropoff' : isPickup ? 'pickup' : undefined,
  };
}

// ── Default reminder lead-times (minutes) — the single source of defaults ──────
/** Activity reminder lead when an activity has no explicit `reminderMinutes`. */
export const DEFAULT_ACTIVITY_LEAD = 30;
/** Timed-to-do reminder lead when the device hasn't overridden it. */
export const DEFAULT_TODO_LEAD = 30;
/**
 * Per-travel-type default lead. Keyed on the occurrence's `transportType`
 * (`SupportedTravelType`) — flights + cruises 2h (airport/embarkation buffer),
 * rail/ferry 1h. A device override in `GlobalSettings.travelReminderLeads`
 * takes precedence per-type.
 */
export const DEFAULT_TRAVEL_LEADS: Record<SupportedTravelType, number> = {
  flight_outbound: 120,
  flight_return: 120,
  cruise: 120,
  train: 60,
  ferry: 60,
};

/**
 * Lead-time options offered in the Settings selects (minutes). `0` = "at the
 * event time"; `1440` = "the day before".
 */
export const LEAD_OPTIONS = [0, 15, 30, 60, 120, 180, 1440] as const;

/**
 * Human, i18n label for a lead value ("2 hours before", "30 minutes before",
 * "at the time", "the day before"). `t` is injected so this stays pure — the
 * keys carry `{n}` placeholders filled via `fillTemplate`.
 */
export function formatLeadLabel(minutes: number, t: (key: UIStringKey) => string): string {
  if (minutes <= 0) return t('reminders.lead.atTime');
  if (minutes === 1440) return t('reminders.lead.dayBefore');
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return fillTemplate(t(hours === 1 ? 'reminders.lead.hourOne' : 'reminders.lead.hours'), {
      n: String(hours),
    });
  }
  return fillTemplate(t(minutes === 1 ? 'reminders.lead.minuteOne' : 'reminders.lead.minutes'), {
    n: String(minutes),
  });
}
