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
import type { FamilyActivity, FamilyMember, ReminderMinutes } from '@/types/models';
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
  /**
   * EVERY duty the viewer holds on this occurrence, in fire order (dropoff
   * before pickup). Empty when they hold none. The OS scheduler emits one
   * reminder per entry — dropoff anchored on `startTime`, pickup on `endTime`
   * — because a parent doing both runs needs both alerts.
   */
  dutyRoles: ('dropoff' | 'pickup')[];
  /** The viewer's primary duty — `dutyRoles[0]`. Drives the single-role bell
   *  chip, which has no way to show two. */
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
  const dutyRoles: ('dropoff' | 'pickup')[] = [];
  if (isDropoff) dutyRoles.push('dropoff');
  if (isPickup) dutyRoles.push('pickup');
  return {
    // Duty (dropoff/pickup) overrides a 'hidden' audience — you still need the
    // reminder even if you're not an assignee.
    relevant: !(audience.kind === 'hidden' && !isDuty),
    title: activity.title,
    who,
    dutyRoles,
    dutyRole: dutyRoles[0],
  };
}

// ── Default reminder lead-times (minutes) — the single source of defaults ──────
/** Activity reminder lead when an activity has no explicit `reminderMinutes`. */
export const DEFAULT_ACTIVITY_LEAD = 30;

/**
 * Effective activity lead in minutes for TRIGGER MATH ONLY. `0` is preserved
 * here (fire at the event time) — this function does NOT decide whether a
 * reminder exists. Shared by the in-app deriver (`utils/notifications.ts`) and
 * the OS scheduler so the default can't drift between them.
 */
export function activityLeadMinutes(
  reminderMinutes: number | undefined,
  defaultLead: number = DEFAULT_ACTIVITY_LEAD
): number {
  return typeof reminderMinutes === 'number' ? reminderMinutes : defaultLead;
}

/**
 * OS-scheduling gate. `0` is the activity chip's "None" — `ActivityModal`
 * renders it as `planner.reminder.none` and offers only 0/15/30/60/1440, so it
 * literally means "no reminder", never "at the event time". Returns the lead to
 * use, or `null` to schedule nothing.
 *
 * `isDuty` opts out of the None skip: the chip governs *the activity's*
 * reminder, not *my drop-off run*. This matters more than it looks — every
 * activity stored to date carries `reminderMinutes: 0` (it was the modal's old
 * default and the field is required), so without the duty exemption this gate
 * would silently disable the school-run reminders #55 exists to deliver.
 *
 * Deliberately NOT used by the in-app deriver: the bell is a feed of what's on
 * today, not an alarm, and applying the skip there would empty it. See
 * `activityLeadMinutes`.
 */
export function resolveOsActivityLead(
  reminderMinutes: number | undefined,
  isDuty: boolean,
  /** The device's configured activity default (Settings → Reminders). */
  defaultLead: number = DEFAULT_ACTIVITY_LEAD
): number | null {
  const lead = activityLeadMinutes(reminderMinutes, defaultLead);
  if (lead === 0) return isDuty ? defaultLead : null;
  return lead;
}

/**
 * Morning-of anchor for all-day activities and dated-but-untimed to-dos — the
 * Google Calendar convention. This is an OS *fire time*: the reminder fires AT
 * 09:00 and the lead is NOT subtracted (an all-day item has no start to lead
 * into).
 *
 * Deliberately NOT used by the in-app deriver, whose all-day trigger stays
 * `startOfLocalDay`: there "trigger" means "when does this enter the bell
 * window", and an all-day item is current from midnight. Different question,
 * different answer — do not unify them.
 */
export const ALL_DAY_REMINDER_HOUR = '09:00';
export function allDayAnchor(dateISO: string): Date | null {
  return localDateTime(dateISO, ALL_DAY_REMINDER_HOUR);
}
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
 * Lead-time options for the TRAVEL and TO-DO selects (minutes). `0` = "at the
 * event time"; `1440` = "the day before".
 *
 * NOT for activities — see `ACTIVITY_LEAD_OPTIONS`. This list carries 120/180,
 * which are real travel leads (`DEFAULT_TRAVEL_LEADS` is 120 for flights) but
 * are not offered on activity chips, and 180 is not even in the
 * `ReminderMinutes` union. The names read as general-vs-specific, which is the
 * trap that shipped an activity default the editor could not render.
 */
export const LEAD_OPTIONS = [0, 15, 30, 60, 120, 180, 1440] as const;

/**
 * Lead-time options for ACTIVITIES. Deliberately separate from `LEAD_OPTIONS`:
 *  - `0` means "None" here (no OS reminder), never "at the event time".
 *  - Every value must be a member of `ReminderMinutes`, since it is stored per
 *    activity — `satisfies` makes an out-of-union value a COMPILE ERROR.
 * Shared by the Settings default select and the ActivityModal chips so the two
 * can never offer different values.
 */
export const ACTIVITY_LEAD_OPTIONS = [
  0, 15, 30, 60, 1440,
] as const satisfies readonly ReminderMinutes[];

/**
 * Chip labels (short register — the ActivityModal chip row). An exhaustive
 * record over ACTIVITY_LEAD_OPTIONS, so adding a value is a compile error until
 * its key exists. The selects use the sentence register via `formatLeadLabel`;
 * the two registers are a deliberate design choice, not drift.
 */
export const ACTIVITY_LEAD_CHIP_KEYS: Record<(typeof ACTIVITY_LEAD_OPTIONS)[number], UIStringKey> =
  {
    0: 'planner.reminder.none',
    15: 'planner.reminder.15min',
    30: 'planner.reminder.30min',
    60: 'planner.reminder.1hour',
    1440: 'planner.reminder.1day',
  };

/**
 * Snap a persisted lead to one of the values the activity UI actually OFFERS,
 * falling back to the default.
 *
 * NOTE: narrower than the `ReminderMinutes` union, which still admits 5/10/120 —
 * so do NOT apply this to `activity.reminderMinutes`, it would rewrite a
 * legitimate stored 120 to 30. Named for the option list, not the type, for
 * exactly that reason. Applied ONCE, in the settingsStore getter.
 */
export function toActivityLeadOption(value: number): ReminderMinutes {
  return (ACTIVITY_LEAD_OPTIONS as readonly number[]).includes(value)
    ? (value as ReminderMinutes)
    : DEFAULT_ACTIVITY_LEAD;
}

/**
 * Human, i18n label for a lead value ("2 hours before", "30 minutes before",
 * "at the time", "the day before"). `t` is injected so this stays pure — the
 * keys carry `{n}` placeholders filled via `fillTemplate`.
 */
export function formatLeadLabel(
  minutes: number,
  t: (key: UIStringKey) => string,
  /**
   * The ONE domain difference: for a to-do or a flight `0` means "at the event
   * time"; for an ACTIVITY it means "no reminder". Passing it makes that choice
   * visible at the call site instead of hiding it behind a near-identical second
   * function whose identical signature would make a mis-import silent.
   */
  zeroLabelKey: UIStringKey = 'reminders.lead.atTime'
): string {
  if (minutes <= 0) return t(zeroLabelKey);
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
