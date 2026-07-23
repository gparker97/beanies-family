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
  DEFAULT_ACTIVITY_LEAD,
  DEFAULT_TRAVEL_LEADS,
} from '@/utils/reminderSchedule';
import { activityReminderId, todoDueId, travelReminderId } from '@/utils/notifications';

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

/** Activity reminders — timed occurrences only, lead = per-activity reminderMinutes. */
export function buildActivityReminders(input: ReminderInput, now: Date): ScheduledReminder[] {
  const out: ScheduledReminder[] = [];
  const nowMs = now.getTime();
  for (const [date, occurrences] of Object.entries(input.occurrencesByDate)) {
    if (!withinWindow(date, input.windowStartISO, input.windowEndISO)) continue;
    for (const occ of occurrences) {
      try {
        const a = occ?.activity;
        if (!a?.id || !a.startTime) continue; // untimed → no meaningful OS fire time
        const ctx = activityReminderContext(a, input.currentMember, input.resolveMember);
        if (!ctx.relevant) continue;
        const at = localDateTime(date, a.startTime);
        if (!at) continue;
        const lead =
          typeof a.reminderMinutes === 'number' ? a.reminderMinutes : DEFAULT_ACTIVITY_LEAD;
        const fireAt = minusMinutes(at, lead);
        if (fireAt.getTime() <= nowMs) continue;
        const who = ctx.who.join(' · ');
        let body: string;
        if (ctx.dutyRole === 'dropoff') {
          body = fillTemplate(input.t('reminders.activityBodyDropoff'), { who });
        } else if (ctx.dutyRole === 'pickup') {
          body = fillTemplate(input.t('reminders.activityBodyPickup'), { who });
        } else if (ctx.who.length) {
          body = fillTemplate(input.t('reminders.activityBodyWho'), { who });
        } else {
          body = input.t('reminders.activityBody');
        }
        out.push({
          id: activityReminderId(a.id, date),
          fireAt,
          title: fillTemplate(input.t('reminders.activityTitle'), { title: ctx.title }),
          body,
          kind: 'activity',
        });
      } catch (err) {
        console.warn(`[buildReminderSchedule] skipped activity occurrence on ${date}:`, err);
      }
    }
  }
  return out;
}

/** Timed-to-do reminders — active todos with a dueDate + dueTime, device lead. */
export function buildTodoReminders(
  input: ReminderInput,
  now: Date,
  prefs: ReminderPrefs
): ScheduledReminder[] {
  const out: ScheduledReminder[] = [];
  const nowMs = now.getTime();
  for (const todo of input.todos) {
    try {
      if (todo.completed || !todo.dueDate || !todo.dueTime) continue;
      const dateISO = todo.dueDate.slice(0, 10);
      if (!withinWindow(dateISO, input.windowStartISO, input.windowEndISO)) continue;
      const at = localDateTime(todo.dueDate, todo.dueTime);
      if (!at) continue;
      const fireAt = minusMinutes(at, prefs.todoReminderLead);
      if (fireAt.getTime() <= nowMs) continue;
      out.push({
        id: todoDueId(todo.id, dateISO),
        fireAt,
        title: fillTemplate(input.t('reminders.todoTitle'), { title: todo.title }),
        body: fillTemplate(input.t('reminders.todoBody'), { time: formatTime12(todo.dueTime) }),
        kind: 'todo',
      });
    } catch (err) {
      console.warn(`[buildReminderSchedule] skipped todo ${todo?.id ?? '?'}:`, err);
    }
  }
  return out;
}

/** Travel reminders — departure occurrences only (SupportedTravelType), per-type lead. */
export function buildTravelReminders(
  input: ReminderInput,
  now: Date,
  prefs: ReminderPrefs
): ScheduledReminder[] {
  const out: ScheduledReminder[] = [];
  const nowMs = now.getTime();
  for (const o of input.travelOccurrences) {
    try {
      if (o.kind !== 'departure' || !o.time) continue;
      const at = localDateTime(o.date, o.time);
      if (!at) continue;
      const lead =
        prefs.travelReminderLeads[o.transportType] ?? DEFAULT_TRAVEL_LEADS[o.transportType];
      const fireAt = minusMinutes(at, lead);
      if (fireAt.getTime() <= nowMs) continue;
      out.push({
        id: travelReminderId(o.segmentId, o.date),
        fireAt,
        title: fillTemplate(input.t('reminders.travelTitle'), { title: o.title }),
        body: fillTemplate(input.t('reminders.travelBody'), { time: formatTime12(o.time) }),
        kind: 'travel',
      });
    } catch (err) {
      console.warn(
        `[buildReminderSchedule] skipped travel occurrence ${o?.segmentId ?? '?'}:`,
        err
      );
    }
  }
  return out;
}

/**
 * Assemble the full reminder schedule: soonest-first, capped to MAX_SCHEDULED.
 * Returns `[]` (never null) when reminders are off or there is no input.
 */
export function buildReminderSchedule(
  input: ReminderInput | null,
  now: Date,
  prefs: ReminderPrefs
): { reminders: ScheduledReminder[]; truncated: boolean } {
  if (!input || !prefs.remindersEnabled) return { reminders: [], truncated: false };
  const all = [
    ...buildActivityReminders(input, now),
    ...buildTravelReminders(input, now, prefs),
    ...buildTodoReminders(input, now, prefs),
  ];
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  const truncated = all.length > MAX_SCHEDULED;
  return { reminders: truncated ? all.slice(0, MAX_SCHEDULED) : all, truncated };
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
