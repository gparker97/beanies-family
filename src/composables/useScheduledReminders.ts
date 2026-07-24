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
import type {
  FamilyMember,
  TodoItem,
  SupportedTravelType,
  FamilyActivity,
  HelpfulHintType,
} from '@/types/models';
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
import type { ActivityReminderContext } from '@/utils/reminderSchedule';
import {
  activityReminderContext,
  localDateTime,
  minusMinutes,
  allDayAnchor,
  resolveOsActivityLead,
  DEFAULT_TRAVEL_LEADS,
} from '@/utils/reminderSchedule';
import { activityReminderId, todoDueId, travelReminderId } from '@/utils/notifications';
import { dedupeHintsByKey } from '@/utils/helpfulHints';
import { entityDeepLink, type DeepLink } from '@/utils/entityDeepLink';
import { classifyAudience, isDutyDone } from '@/utils/audience';
import { normalizeAssignees } from '@/utils/assignees';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';

/** How far ahead we arm reminders. Kept < the OS pending-notification ceiling via MAX_SCHEDULED. */
export const REMINDER_WINDOW_DAYS = 14;
/**
 * Hard cap on scheduled reminders (soonest kept). Android/iOS silently drop past
 * ~64 pending, so 60 is an iOS-ceiling constraint, not an arbitrary number.
 *
 * Earliest-first truncation is deliberate and self-healing: the 14-day window
 * rolls forward and `queueReschedule` runs on every foreground and data change,
 * so a far-out reminder that gets clipped today is armed once it comes into
 * range. Near-term reminders are also the ones you can still act on.
 *
 * NOTE: the 2026-07 activity back-fill materially raised occupancy. Before it,
 * `resolveOsActivityLead` gated out essentially the whole corpus (every stored
 * activity was `reminderMinutes: 0`), so truncation was near-theoretical; after
 * it, five daily recurring activities alone fill 70 slots in a 14-day window.
 * `notif_truncated: true` is therefore a ROUTINE signal now, not an alarm — only
 * actionable alongside a user report of a missing NEAR-TERM reminder.
 */
export const MAX_SCHEDULED = 60;

export type ReminderKind = 'activity' | 'travel' | 'todo';

export interface ScheduledReminder {
  /** Stable id (shared scheme with the in-app system → future unification). */
  id: string;
  fireAt: Date;
  title: string;
  body: string;
  kind: ReminderKind;
  /** Where a TAP on this notification should land. Carried verbatim into the
   *  notification payload (`extra.link`) and pushed straight to the router — the
   *  delivered notification id is a lossy hash, so the target must ride along.
   *  Same `{path,query}` shape the in-app bell "Open" uses. */
  deepLink: DeepLink;
}

export interface ReminderPrefs {
  remindersEnabled: boolean;
  todoReminderLead: number;
  /** Device default lead for activities that don't override it, and the
   *  fallback a duty reminder uses when the activity says "None". */
  activityReminderLead: number;
  /** Fully-resolved per-type lead map (defaults merged with device overrides). */
  travelReminderLeads: Partial<Record<SupportedTravelType, number>>;
  /** #40: per-device per-hint-type notification mute (absent key ⟹ enabled).
   *  Suppresses ONLY this device owner's notification for a hint to-do. */
  helpfulHintNotifyByType: Partial<Record<HelpfulHintType, boolean>>;
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

export interface ReminderBuildResult {
  reminders: ScheduledReminder[];
  /** Dropped by a THROWN error — a malformed record. Actionable: data bug. */
  skipped: number;
  /**
   * Dropped by a RULE — the activity says None, a hidden audience, a
   * non-traveller, an anchorless duty. EXPECTED, not a bug. Deliberately
   * separate from `skipped`: conflating "we chose to drop this" with "this
   * record is broken" would make both counters unactionable, and these are the
   * branches most likely to be blamed for "my reminder didn't fire".
   */
  gated: number;
}

/**
 * Reminders for ONE activity occurrence.
 *
 * Pure and exported so the duty/None/anchor rules — the part of #55 that has
 * regressed twice — are unit-testable from a single activity + date, with no
 * occurrence-map fixture. `buildActivityReminders` is then iteration + try/catch.
 *
 * Emits EITHER the viewer's duty reminders (one per role — dropoff on
 * `startTime`, pickup on `endTime`) OR the generic activity reminder, never
 * both, mirroring the briefing's rule at `useCriticalItems.ts:191`. Both
 * emitting would collide: the ids would hash to the same `stableNotificationId`
 * and one would silently overwrite the other.
 */
export function remindersForActivityOccurrence(
  a: FamilyActivity,
  date: string,
  ctx: ActivityReminderContext,
  prefs: ReminderPrefs,
  nowMs: number,
  t: (key: UIStringKey) => string
): { reminders: ScheduledReminder[]; gated: number } {
  const out: ScheduledReminder[] = [];
  let gated = 0;
  const who = ctx.who.join(' · ');

  // Two leads: the duty exemption applies ONLY to duty reminders. `ownLead ===
  // null` is the chip's "None" and must still suppress the generic reminder —
  // otherwise a pickup-only parent on a None activity with no endTime would fall
  // through and get a reminder they explicitly switched off.
  // No `!` on dutyLead: it is non-null only because of a branch inside
  // resolveOsActivityLead the compiler can't see. The null check in the loop is
  // dead today and stays as the fail-loud seam — an assertion here would turn a
  // future edit into minusMinutes(at, undefined) → NaN → an alarm at epoch-NaN.
  const ownLead = resolveOsActivityLead(a.reminderMinutes, false, prefs.activityReminderLead);
  const dutyLead = resolveOsActivityLead(a.reminderMinutes, true, prefs.activityReminderLead);

  // Count roles that HAVE an anchor, not roles that emitted. Three different
  // reasons a role emits nothing must NOT be conflated:
  //   • no anchor      → fall through to the generic reminder
  //   • already ticked → stay suppressed (the existing "don't nag" rule)
  //   • fireAt in past → stay suppressed (nothing left to say)
  // Counting emissions would resurrect a generic reminder the moment a parent
  // ticks their drop-off off — a new nag from the fix for a different bug.
  let dutyAnchored = 0;
  for (const role of ctx.dutyRoles) {
    // A duty fires on its OWN time. A role with no anchor emits nothing: falling
    // back to the 09:00 all-day anchor would tell a parent to collect their
    // child at breakfast.
    const anchorTime = role === 'dropoff' ? a.startTime : a.endTime;
    if (!anchorTime) {
      gated++;
      continue;
    }
    dutyAnchored++;
    if (isDutyDone(role === 'dropoff' ? a.dropoffCompletions : a.pickupCompletions, date)) continue;
    const at = localDateTime(date, anchorTime);
    if (!at) continue;
    if (dutyLead === null) continue; // see the no-`!` note above
    const fireAt = minusMinutes(at, dutyLead);
    if (fireAt.getTime() <= nowMs) continue;
    out.push({
      id: activityReminderId(a.id, date, role),
      fireAt,
      title: ctx.title,
      body: fillTemplate(
        t(role === 'dropoff' ? 'reminders.activityBodyDropoff' : 'reminders.activityBodyPickup'),
        { who }
      ),
      kind: 'activity',
      deepLink: entityDeepLink('activity', a.id),
    });
  }
  // Suppress the generic reminder only when a duty role actually had an anchor.
  if (dutyAnchored > 0) return { reminders: out, gated };
  if (ownLead === null) return { reminders: out, gated: gated + 1 }; // the chip says "None"

  // Generic reminder. An untimed (all-day) activity fires at the morning-of
  // anchor with no lead subtracted — it has no start to lead into.
  const at = a.startTime ? localDateTime(date, a.startTime) : allDayAnchor(date);
  if (!at) return { reminders: out, gated };
  const fireAt = a.startTime ? minusMinutes(at, ownLead) : at;
  if (fireAt.getTime() <= nowMs) return { reminders: out, gated };
  out.push({
    id: activityReminderId(a.id, date),
    fireAt,
    title: ctx.title,
    body: ctx.who.length
      ? fillTemplate(t('reminders.activityBodyWho'), { who })
      : t('reminders.activityBody'),
    kind: 'activity',
    deepLink: entityDeepLink('activity', a.id),
  });
  return { reminders: out, gated };
}

/** Activity reminders across the window — iteration + try/catch only. */
export function buildActivityReminders(
  input: ReminderInput,
  now: Date,
  prefs: ReminderPrefs
): ReminderBuildResult {
  const out: ScheduledReminder[] = [];
  let skipped = 0;
  let gated = 0;
  const nowMs = now.getTime();
  for (const [date, occurrences] of Object.entries(input.occurrencesByDate)) {
    if (!withinWindow(date, input.windowStartISO, input.windowEndISO)) continue;
    for (const occ of occurrences) {
      // The try MUST wrap activityReminderContext: it dereferences assignees,
      // `location` and the audience classifier on unvalidated CRDT data, so
      // moving it out would turn one malformed activity from a `skipped++` into
      // an aborted whole build.
      try {
        const a = occ?.activity;
        if (!a?.id) continue;
        const ctx = activityReminderContext(a, input.currentMember, input.resolveMember);
        if (!ctx.relevant) continue;
        const res = remindersForActivityOccurrence(a, date, ctx, prefs, nowMs, input.t);
        out.push(...res.reminders);
        gated += res.gated;
      } catch (err) {
        skipped++;
        console.warn(`[buildReminderSchedule] skipped activity occurrence on ${date}:`, err);
      }
    }
  }
  return { reminders: out, skipped, gated };
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
): ReminderBuildResult {
  const out: ScheduledReminder[] = [];
  let skipped = 0;
  let gated = 0;
  const nowMs = now.getTime();
  for (const todo of input.todos) {
    try {
      if (todo.completed || !todo.dueDate) continue;
      const audience = classifyAudience(
        normalizeAssignees(todo),
        input.currentMember,
        input.resolveMember
      );
      if (audience.kind === 'hidden') {
        gated++;
        continue; // someone else's — never surface it
      }
      // #40: a Helpful Hint whose type this device has muted → suppress only
      // THIS device owner's notification (the shared to-do still shows). Same
      // "expected rule-drop" bucket as the hidden-audience branch above.
      if (todo.hintType && prefs.helpfulHintNotifyByType?.[todo.hintType] === false) {
        gated++;
        continue;
      }
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
        // Covers Helpful Hint to-dos too — they are ordinary TodoItems.
        deepLink: entityDeepLink('todo', todo.id),
      });
    } catch (err) {
      skipped++;
      console.warn(`[buildReminderSchedule] skipped todo ${todo?.id ?? '?'}:`, err);
    }
  }
  return { reminders: out, skipped, gated };
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
): ReminderBuildResult {
  const out: ScheduledReminder[] = [];
  let skipped = 0;
  let gated = 0;
  const nowMs = now.getTime();
  for (const o of input.travelOccurrences) {
    try {
      if (o.kind !== 'departure' || !o.time) continue;
      const travellers = resolveSegmentTravellers(o.travellerIds, o.tripAssigneeIds);
      if (travellers.length > 0 && !travellers.includes(input.currentMember.id)) {
        gated++;
        continue;
      }
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
        // The occurrence already carries its parent trip id — no segment lookup.
        deepLink: entityDeepLink('vacation', o.vacationId),
      });
    } catch (err) {
      skipped++;
      console.warn(
        `[buildReminderSchedule] skipped travel occurrence ${o?.segmentId ?? '?'}:`,
        err
      );
    }
  }
  return { reminders: out, skipped, gated };
}

/**
 * Assemble the full reminder schedule: soonest-first, capped to MAX_SCHEDULED.
 * Returns `[]` (never null) when reminders are off or there is no input.
 */
export function buildReminderSchedule(
  input: ReminderInput | null,
  now: Date,
  prefs: ReminderPrefs
): { reminders: ScheduledReminder[]; truncated: boolean; skipped: number; gated: number } {
  if (!input || !prefs.remindersEnabled)
    return { reminders: [], truncated: false, skipped: 0, gated: 0 };
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
  const gated = parts.reduce((n, p) => n + p.gated, 0);
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  const truncated = all.length > MAX_SCHEDULED;
  return { reminders: truncated ? all.slice(0, MAX_SCHEDULED) : all, truncated, skipped, gated };
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
    helpfulHintNotifyByType: settingsStore.helpfulHintNotifyByType,
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
      // #40: collapse CRDT-merge duplicate hints (same hintKey, different id) so
      // a duplicated hint is not scheduled — and thus notified — twice. Non-hint
      // to-dos pass through untouched.
      todos: dedupeHintsByKey(todoStore.activeTodos),
      currentMember,
      resolveMember: (id: string) => familyStore.members.find((m) => m.id === id),
      windowStartISO,
      windowEndISO,
      t,
    };
  });

  return { reminderInput, prefs };
}
