/**
 * Pure, total notification derivation + read-state reducers.
 *
 * `deriveNotifications(input, now)` reconstructs the current member's
 * notification list from a plain snapshot of synced data — no Vue, no stores, no
 * `Date.now()` (the caller injects `now`), so it's fully deterministic and
 * unit-testable. It MUST NEVER throw: each item is built in its own try/catch
 * and a malformed record is skipped with a `console.warn`, never aborting the
 * whole list.
 *
 * Presentation (icon/accent) is intentionally absent — see
 * `types/notifications.ts` + `components/notifications/notificationKinds.ts`.
 */
import type { TodoItem, FamilyActivity, FamilyMember } from '@/types/models';
import type { ReleaseNote } from '@/content/release-notes';
import type { AppNotification } from '@/types/notifications';
import { normalizeAssignees } from '@/utils/assignees';
import { classifyAudience } from '@/utils/audience';
import { entityDeepLink } from '@/utils/entityDeepLink';

const MS_PER_DAY = 86_400_000;
/** Lead time before a timed todo's due moment that the `todo-due` fires. */
const DUE_LEAD_MINUTES = 30;
/** Reminder lead used when an activity has no explicit `reminderMinutes`. */
const DEFAULT_REMINDER_MINUTES = 30;
/** Prefix used by the prune exemption (whats-new is window-exempt). */
const WHATS_NEW_PREFIX = 'whats-new:';

export interface NotificationOccurrence {
  activity: FamilyActivity;
  date: string;
}

export interface DeriveInput {
  todos: TodoItem[];
  members: FamilyMember[];
  currentMember: FamilyMember;
  releaseNotes: readonly ReleaseNote[];
  /** The current member's id→readAt slice of `notificationReads`. */
  readState: Record<string, string>;
  /** Rolling history window (days) for time-based kinds; whats-new is exempt. */
  windowDays: number;
  /**
   * Activity occurrences for the window, bucketed by date — assembled ONCE by
   * the store over the UNFILTERED `activeActivities` source (so duty-only
   * occurrences survive and the same month isn't re-expanded per day).
   */
  occurrencesByDate: Record<string, NotificationOccurrence[]>;
}

// ── Stable id builders (one per logical event; escalation reuses the id) ──────
export const todoDueId = (todoId: string, dueDate: string): string =>
  `todo-due:${todoId}:${dueDate}`;
export const todoAssignedId = (todoId: string): string => `todo-assigned:${todoId}`;
export const activityReminderId = (activityId: string, occurrenceDate: string): string =>
  `activity-reminder:${activityId}:${occurrenceDate}`;
export const whatsNewId = (version: string): string => `${WHATS_NEW_PREFIX}${version}`;

// ── Internal pure date helpers (LOCAL time — avoids the UTC-midnight trap of
//    `new Date('YYYY-MM-DD')`) ─────────────────────────────────────────────────
function localDateTime(dateStr: string, time?: string): Date | null {
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

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function minusMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() - minutes * 60_000);
}
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Derive the current member's notifications from a plain snapshot. Pure + total.
 */
export function deriveNotifications(input: DeriveInput, now: Date): AppNotification[] {
  const { todos, members, currentMember, releaseNotes, readState, windowDays, occurrencesByDate } =
    input;
  const resolveMember = (id: string): FamilyMember | undefined => members.find((m) => m.id === id);
  const displayNames = (ids: string[]): string[] =>
    ids
      .map(resolveMember)
      .filter((m): m is FamilyMember => m !== undefined)
      .map((m) => m.name);
  const nowMs = now.getTime();
  const windowStartMs = nowMs - windowDays * MS_PER_DAY;
  const isRead = (id: string): boolean => readState[id] !== undefined;
  // A time-based notification is shown when it has become active (trigger ≤ now)
  // and is still within the rolling window.
  const inWindow = (triggerMs: number): boolean => triggerMs <= nowMs && triggerMs >= windowStartMs;

  const out: AppNotification[] = [];

  // ── todos: todo-assigned + todo-due ─────────────────────────────────────────
  for (const todo of todos) {
    try {
      if (!todo?.id || todo.completed || todo.someday) continue;
      const assignees = normalizeAssignees(todo);
      const audience = classifyAudience(assignees, currentMember, resolveMember);
      const isDirectAssignee = audience.kind === 'assignee';

      // todo-assigned: someone else assigned it to me (any date), OR I made it
      // with no date/time (otherwise the due trigger would never surface it).
      const otherCreated = todo.createdBy !== currentMember.id;
      const selfNoDeadline = !otherCreated && !todo.dueDate && !todo.dueTime;
      if (isDirectAssignee && (otherCreated || selfNoDeadline)) {
        const occMs = new Date(todo.createdAt).getTime();
        if (!Number.isNaN(occMs) && inWindow(occMs)) {
          const link = entityDeepLink('todo', todo.id);
          const at = new Date(occMs);
          out.push({
            id: todoAssignedId(todo.id),
            kind: 'todo-assigned',
            title: todo.title,
            occurredAt: at.toISOString(),
            eventDate: localDateStr(at),
            eventTime: localTimeStr(at),
            assignedByName: otherCreated ? resolveMember(todo.createdBy)?.name : undefined,
            route: link.path,
            query: link.query,
            sourceId: todo.id,
            read: isRead(todoAssignedId(todo.id)),
          });
        }
      }

      // todo-due: dated, eligible, not completed. Trigger = morning-of (no time)
      // or due-time − 30 min (timed). Overdue is a style on the SAME id.
      if (todo.dueDate && audience.kind !== 'hidden') {
        const dueDay = localDateTime(todo.dueDate);
        if (dueDay) {
          const trigger = todo.dueTime
            ? minusMinutes(localDateTime(todo.dueDate, todo.dueTime) ?? dueDay, DUE_LEAD_MINUTES)
            : startOfLocalDay(dueDay);
          const triggerMs = trigger.getTime();
          if (inWindow(triggerMs)) {
            const dueMoment = todo.dueTime
              ? (localDateTime(todo.dueDate, todo.dueTime) ?? endOfLocalDay(dueDay))
              : endOfLocalDay(dueDay);
            const overdue = nowMs > dueMoment.getTime();
            const id = todoDueId(todo.id, todo.dueDate);
            const link = entityDeepLink('todo', todo.id);
            out.push({
              id,
              kind: 'todo-due',
              title: todo.title,
              // For a child's task an adult sees (forChild), surface whose it is.
              subtitle: audience.kind === 'forChild' ? audience.childNames.join(' · ') : undefined,
              occurredAt: trigger.toISOString(),
              eventDate: todo.dueDate,
              eventTime: todo.dueTime,
              overdue,
              route: link.path,
              query: link.query,
              sourceId: todo.id,
              read: isRead(id),
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[deriveNotifications] skipped todo ${todo?.id ?? '?'}:`, err);
    }
  }

  // ── activity-reminder (from the pre-resolved, UNFILTERED occurrences) ────────
  for (const [date, occurrences] of Object.entries(occurrencesByDate)) {
    for (const occ of occurrences) {
      try {
        const a = occ?.activity;
        if (!a?.id) continue;
        const audience = classifyAudience(normalizeAssignees(a), currentMember, resolveMember);
        const isDuty =
          a.dropoffMemberId === currentMember.id || a.pickupMemberId === currentMember.id;
        if (audience.kind === 'hidden' && !isDuty) continue;
        const occDay = localDateTime(date);
        if (!occDay) continue;
        const reminder =
          typeof a.reminderMinutes === 'number' ? a.reminderMinutes : DEFAULT_REMINDER_MINUTES;
        const trigger = a.startTime
          ? minusMinutes(localDateTime(date, a.startTime) ?? occDay, reminder)
          : startOfLocalDay(occDay);
        const triggerMs = trigger.getTime();
        if (!inWindow(triggerMs)) continue;
        const id = activityReminderId(a.id, date);
        const link = entityDeepLink('activity', a.id);
        const who = displayNames(normalizeAssignees(a));
        if (a.location) who.push(a.location);
        const dutyRole =
          a.dropoffMemberId === currentMember.id
            ? 'dropoff'
            : a.pickupMemberId === currentMember.id
              ? 'pickup'
              : undefined;
        out.push({
          id,
          kind: 'activity-reminder',
          title: a.title,
          subtitle: who.length ? who.join(' · ') : undefined,
          occurredAt: trigger.toISOString(),
          eventDate: date,
          eventTime: a.startTime,
          dutyRole,
          route: link.path,
          query: link.query,
          sourceId: a.id,
          occurrenceDate: date,
          read: isRead(id),
        });
      } catch (err) {
        console.warn(`[deriveNotifications] skipped activity occurrence on ${date}:`, err);
      }
    }
  }

  // ── whats-new (window-exempt; always retained, bounded by release count) ─────
  for (const rel of releaseNotes) {
    try {
      if (!rel?.version) continue;
      const id = whatsNewId(rel.version);
      const relMs = new Date(rel.date).getTime();
      out.push({
        id,
        kind: 'whats-new',
        title: rel.month,
        occurredAt: Number.isNaN(relMs) ? rel.date : new Date(relMs).toISOString(),
        sourceId: rel.version,
        read: isRead(id),
      });
    } catch (err) {
      console.warn(`[deriveNotifications] skipped release ${rel?.version ?? '?'}:`, err);
    }
  }

  // Newest-active first (ISO strings sort lexicographically by time).
  out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return out;
}

// ── Pure read-state reducers (operate on the current member's id→readAt slice) ─
export function markReadIn(
  map: Record<string, string>,
  id: string,
  nowIso: string
): Record<string, string> {
  return { ...map, [id]: nowIso };
}

export function markUnreadIn(map: Record<string, string>, id: string): Record<string, string> {
  if (map[id] === undefined) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

export function markAllReadIn(
  map: Record<string, string>,
  ids: readonly string[],
  nowIso: string
): Record<string, string> {
  const next = { ...map };
  for (const id of ids) {
    if (next[id] === undefined) next[id] = nowIso;
  }
  return next;
}

/**
 * Drop read-state entries whose id is no longer derivable, with ONE exemption:
 * any `whats-new:*` id is always kept (whats-new is window-exempt; pruning it
 * would resurface old releases as unread).
 */
export function pruneReadState(
  map: Record<string, string>,
  keepIds: readonly string[]
): Record<string, string> {
  const keep = new Set(keepIds);
  const next: Record<string, string> = {};
  for (const [id, readAt] of Object.entries(map)) {
    if (keep.has(id) || id.startsWith(WHATS_NEW_PREFIX)) next[id] = readAt;
  }
  return next;
}
