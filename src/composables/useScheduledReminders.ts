/**
 * Forward-window reminder source for OS local notifications (#55).
 *
 * `buildReminderSchedule` is pure + total: given an assembled snapshot, a `now`,
 * and the device prefs, it returns the reminders to schedule — each at
 * (event − lead), sorted soonest-first and capped to `MAX_SCHEDULED` (< the OS
 * pending-notification ceiling). Every item is built in its own try/catch so one
 * malformed record — or one whole source failing — never aborts the schedule.
 *
 * The composable wires it to the stores and exposes the reactive `reminderInput`
 * + `prefs`; the OS scheduler (`useLocalNotifications`) calls the pure builder
 * with a FRESH `now` each reschedule so no `fireAt` drifts past between recompute
 * and schedule. See `docs/plans/2026-07-23-notifications-end-to-end-native.md`.
 */
import { computed, type ComputedRef } from 'vue';
import type { FamilyMember, TodoItem, SupportedTravelType } from '@/types/models';
import type { NotificationOccurrence } from '@/utils/notifications';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTranslation } from '@/composables/useTranslation';
import { useToday } from '@/composables/useToday';
import { assembleOccurrencesByDate } from '@/utils/occurrenceAssembly';
import { addDaysYmd, formatTime12 } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import {
  activityReminderContext,
  localDateTime,
  minusMinutes,
  allDayAnchor,
  resolveOsActivityLead,
  DEFAULT_TRAVEL_LEADS,
} from '@/utils/reminderSchedule';
import { activityReminderId, todoDueId, travelReminderId } from '@/utils/notifications';
import { classifyAudience, isDutyDone } from '@/utils/audience';
import { normalizeAssignees } from '@/utils/assignees';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';

/** How far ahead we arm reminders. Kept < the OS pending-notification ceiling via MAX_SCHEDULED. */
export const REMINDER_WINDOW_DAYS = 14;
/** Hard cap on scheduled reminders (soonest kept). Android/iOS silently drop past ~64 pending. */
export const MAX_SCHEDULED = 60;

export type ReminderKind = 'activity' | 'travel' | 'todo';

export interface ScheduledReminder {
  /** Stable id (shared scheme with the in-app system → future unification). */
  id: string;
  fireAt: Date;
  title: string;
  body: string;
  kind: ReminderKind;
}

export interface ReminderPrefs {
  remindersEnabled: boolean;
  todoReminderLead: number;
  /** Device default lead for activities that don't override it, and the
   *  fallback a duty reminder uses when the activity says "None". */
  activityReminderLead: number;
  /** Fully-resolved per-type lead map (defaults merged with device overrides). */
  travelReminderLeads: Partial<Record<SupportedTravelType, number>>;
}

export interface ReminderInput {
  occurrencesByDate: Record<string, NotificationOccurrence[]>;
  travelOccurrences: TravelSegmentOccurrence[];
  todos: TodoItem[];
  currentMember: FamilyMember;
  resolveMember: (id: string) => FamilyMember | undefined;
  /** Inclusive local-day window bounds (YYYY-MM-DD) — occurrences outside are ignored. */
  windowStartISO: string;
  windowEndISO: string;
  /** Translation fn (injected → the builder stays pure). */
  t: (key: UIStringKey) => string;
}

function withinWindow(dateISO: string, startISO: string, endISO: string): boolean {
  return dateISO >= startISO && dateISO <= endISO;
}

/**
 * Activity reminders. Emits EITHER the viewer's duty reminders (one per role —
 * dropoff on `startTime`, pickup on `endTime`) OR the generic activity reminder,
 * never both — mirroring the briefing's rule at `useCriticalItems.ts:191`. Both
 * emitting would collide: the ids would hash to the same `stableNotificationId`
 * and one would silently overwrite the other.
 */
export function buildActivityReminders(
  input: ReminderInput,
  now: Date,
  prefs: ReminderPrefs
): { reminders: ScheduledReminder[]; skipped: number } {
  const out: ScheduledReminder[] = [];
  let skipped = 0;
  const nowMs = now.getTime();
  for (const [date, occurrences] of Object.entries(input.occurrencesByDate)) {
    if (!withinWindow(date, input.windowStartISO, input.windowEndISO)) continue;
    for (const occ of occurrences) {
      try {
        const a = occ?.activity;
        if (!a?.id) continue;
        const ctx = activityReminderContext(a, input.currentMember, input.resolveMember);
        if (!ctx.relevant) continue;
        const lead = resolveOsActivityLead(
          a.reminderMinutes,
          ctx.dutyRoles.length > 0,
          prefs.activityReminderLead
        );
        if (lead === null) continue; // the chip says "None"
        const who = ctx.who.join(' · ');

        // Duty reminders: one per role, each anchored on its own time. A parent
        // who both drops off and picks up needs two alerts, hours apart.
        if (ctx.dutyRoles.length > 0) {
          for (const role of ctx.dutyRoles) {
            const done = isDutyDone(
              role === 'dropoff' ? a.dropoffCompletions : a.pickupCompletions,
              date
            );
            if (done) continue; // already ticked off — don't nag
            const anchorTime = role === 'dropoff' ? a.startTime : a.endTime;
            const at = anchorTime ? localDateTime(date, anchorTime) : allDayAnchor(date);
            if (!at) continue;
            const fireAt = anchorTime ? minusMinutes(at, lead) : at;
            if (fireAt.getTime() <= nowMs) continue;
            out.push({
              id: activityReminderId(a.id, date, role),
              fireAt,
              title: ctx.title,
              body: fillTemplate(
                input.t(
                  role === 'dropoff'
                    ? 'reminders.activityBodyDropoff'
                    : 'reminders.activityBodyPickup'
                ),
                { who }
              ),
              kind: 'activity',
            });
          }
          continue; // duty emitted → suppress the generic reminder
        }

        // Generic reminder. An untimed (all-day) activity fires at the morning-of
        // anchor with no lead subtracted — it has no start to lead into.
        const at = a.startTime ? localDateTime(date, a.startTime) : allDayAnchor(date);
        if (!at) continue;
        const fireAt = a.startTime ? minusMinutes(at, lead) : at;
        if (fireAt.getTime() <= nowMs) continue;
        out.push({
          id: activityReminderId(a.id, date),
          fireAt,
          title: ctx.title,
          body: ctx.who.length
            ? fillTemplate(input.t('reminders.activityBodyWho'), { who })
            : input.t('reminders.activityBody'),
          kind: 'activity',
        });
      } catch (err) {
        skipped++;
        console.warn(`[buildReminderSchedule] skipped activity occurrence on ${date}:`, err);
      }
    }
  }
  return { reminders: out, skipped };
}

/**
 * Timed-to-do reminders — active, dated todos, device lead.
 *
 * The `classifyAudience` gate is NOT optional: `input.todos` is the whole
 * family's unfiltered active list, so without it a to-do another adult assigned
 * privately to themselves is pushed to every family member's lock screen —
 * content the app deliberately hides in-app. This is the fourth caller of that
 * rule (`utils/notifications.ts:173`, `useCriticalItems.ts:254`,
 * `reminderSchedule.ts` via `activityReminderContext`, and here); if you add a
 * fifth surface, call the shared classifier rather than re-deriving it.
 */
export function buildTodoReminders(
  input: ReminderInput,
  now: Date,
  prefs: ReminderPrefs
): { reminders: ScheduledReminder[]; skipped: number } {
  const out: ScheduledReminder[] = [];
  let skipped = 0;
  const nowMs = now.getTime();
  for (const todo of input.todos) {
    try {
      if (todo.completed || !todo.dueDate) continue;
      const audience = classifyAudience(
        normalizeAssignees(todo),
        input.currentMember,
        input.resolveMember
      );
      if (audience.kind === 'hidden') continue; // someone else's — never surface it
      const dateISO = todo.dueDate.slice(0, 10);
      if (!withinWindow(dateISO, input.windowStartISO, input.windowEndISO)) continue;
      // Untimed but dated → morning-of anchor, no lead subtracted.
      const at = todo.dueTime ? localDateTime(todo.dueDate, todo.dueTime) : allDayAnchor(dateISO);
      if (!at) continue;
      const fireAt = todo.dueTime ? minusMinutes(at, prefs.todoReminderLead) : at;
      if (fireAt.getTime() <= nowMs) continue;
      out.push({
        id: todoDueId(todo.id, dateISO),
        fireAt,
        title: todo.title,
        body: todo.dueTime
          ? fillTemplate(input.t('reminders.todoBody'), { time: formatTime12(todo.dueTime) })
          : input.t('reminders.todoBodyAllDay'),
        kind: 'todo',
      });
    } catch (err) {
      skipped++;
      console.warn(`[buildReminderSchedule] skipped todo ${todo?.id ?? '?'}:`, err);
    }
  }
  return { reminders: out, skipped };
}

/**
 * Travel reminders — departure occurrences only (SupportedTravelType), per-type lead.
 *
 * Filtered to the segment's actual travellers: without this every family
 * member's phone is woken 2h before a flight only one of them is on.
 * `resolveSegmentTravellers` owns the "undefined = the whole trip" rule; an
 * empty resolved list means the trip has no assignees, which still reminds
 * everyone (today's behaviour — don't tighten it here).
 */
export function buildTravelReminders(
  input: ReminderInput,
  now: Date,
  prefs: ReminderPrefs
): { reminders: ScheduledReminder[]; skipped: number } {
  const out: ScheduledReminder[] = [];
  let skipped = 0;
  const nowMs = now.getTime();
  for (const o of input.travelOccurrences) {
    try {
      if (o.kind !== 'departure' || !o.time) continue;
      const travellers = resolveSegmentTravellers(o.travellerIds, o.tripAssigneeIds);
      if (travellers.length > 0 && !travellers.includes(input.currentMember.id)) continue;
      const at = localDateTime(o.date, o.time);
      if (!at) continue;
      const lead =
        prefs.travelReminderLeads[o.transportType] ?? DEFAULT_TRAVEL_LEADS[o.transportType];
      const fireAt = minusMinutes(at, lead);
      if (fireAt.getTime() <= nowMs) continue;
      out.push({
        id: travelReminderId(o.segmentId, o.date),
        fireAt,
        title: o.title,
        body: fillTemplate(input.t('reminders.travelBody'), { time: formatTime12(o.time) }),
        kind: 'travel',
      });
    } catch (err) {
      skipped++;
      console.warn(
        `[buildReminderSchedule] skipped travel occurrence ${o?.segmentId ?? '?'}:`,
        err
      );
    }
  }
  return { reminders: out, skipped };
}

/**
 * Assemble the full reminder schedule: soonest-first, capped to MAX_SCHEDULED.
 * Returns `[]` (never null) when reminders are off or there is no input.
 */
export function buildReminderSchedule(
  input: ReminderInput | null,
  now: Date,
  prefs: ReminderPrefs
): { reminders: ScheduledReminder[]; truncated: boolean; skipped: number } {
  if (!input || !prefs.remindersEnabled) return { reminders: [], truncated: false, skipped: 0 };
  const parts = [
    buildActivityReminders(input, now, prefs),
    buildTravelReminders(input, now, prefs),
    buildTodoReminders(input, now, prefs),
  ];
  const all = parts.flatMap((p) => p.reminders);
  // Surfaced as `notif_skipped`: a non-zero count against a healthy
  // `notif_count` is the only way to see one family's data quietly dropping a
  // reminder on every run.
  const skipped = parts.reduce((n, p) => n + p.skipped, 0);
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  const truncated = all.length > MAX_SCHEDULED;
  return { reminders: truncated ? all.slice(0, MAX_SCHEDULED) : all, truncated, skipped };
}

export function useScheduledReminders(): {
  reminderInput: ComputedRef<ReminderInput | null>;
  prefs: ComputedRef<ReminderPrefs>;
} {
  const settingsStore = useSettingsStore();
  const familyStore = useFamilyStore();
  const activityStore = useActivityStore();
  const todoStore = useTodoStore();
  const vacationStore = useVacationStore();
  const { t } = useTranslation();
  const { today } = useToday();

  const prefs = computed<ReminderPrefs>(() => ({
    remindersEnabled: settingsStore.remindersEnabled,
    todoReminderLead: settingsStore.todoReminderLead,
    activityReminderLead: settingsStore.activityReminderLead,
    travelReminderLeads: settingsStore.travelReminderLeads,
  }));

  // Reactive to activity/todo/travel data + the day clock. Bounded to the local
  // day window; the scheduler applies the finer fireAt cutoff with a fresh now.
  const reminderInput = computed<ReminderInput | null>(() => {
    const currentMember = familyStore.currentMember;
    if (!currentMember) return null;
    const windowStartISO = today.value;
    const windowEndISO = addDaysYmd(windowStartISO, REMINDER_WINDOW_DAYS);
    const start = new Date(`${windowStartISO}T00:00:00`);
    const end = new Date(`${windowEndISO}T23:59:59`);
    return {
      occurrencesByDate: assembleOccurrencesByDate(
        activityStore.activeActivitiesForMonth,
        start,
        end
      ),
      travelOccurrences: vacationStore.travelSegmentOccurrencesInRange(
        windowStartISO,
        windowEndISO
      ),
      todos: todoStore.activeTodos,
      currentMember,
      resolveMember: (id: string) => familyStore.members.find((m) => m.id === id),
      windowStartISO,
      windowEndISO,
      t,
    };
  });

  return { reminderInput, prefs };
}
