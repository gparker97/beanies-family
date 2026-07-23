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
import type { TodoItem, FamilyActivity, FamilyList, FamilyMember } from '@/types/models';
import type { ReleaseNote } from '@/content/release-notes';
import type { Announcement } from '@/content/announcements';
import type { BeanTip } from '@/content/tips';
import type { AppNotification } from '@/types/notifications';
import { normalizeAssignees } from '@/utils/assignees';
import { classifyAudience } from '@/utils/audience';
import { entityDeepLink } from '@/utils/entityDeepLink';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';
import {
  activityReminderContext,
  DEFAULT_ACTIVITY_LEAD,
  localDateTime,
  minusMinutes,
} from '@/utils/reminderSchedule';

/** Minimal calendar-connection shape the deriver needs (keeps it store-decoupled). */
export interface CalendarConnectionHealth {
  id: string;
  accountEmail?: string;
  status: string;
  lastReconciledAt?: string;
  updatedAt?: string;
}

const MS_PER_DAY = 86_400_000;
/** Lead time before a timed todo's due moment that the in-app `todo-due` fires
 *  (the OS scheduler's todo lead is device-configurable — see reminderSchedule). */
const DUE_LEAD_MINUTES = 30;
/** Prefixes used by the prune exemption (all window-exempt kinds). Adding a
 *  new exempt kind = one entry here + the kind's own deriver block. */
const WHATS_NEW_PREFIX = 'whats-new:';
const ANNOUNCEMENT_PREFIX = 'announcement:';
const TIP_PREFIX = 'tip:';
const COMMUNITY_NUDGE_PREFIX = 'community-nudge:';
const PRUNE_EXEMPT_PREFIXES = [
  WHATS_NEW_PREFIX,
  ANNOUNCEMENT_PREFIX,
  TIP_PREFIX,
  COMMUNITY_NUDGE_PREFIX,
] as const;

export interface NotificationOccurrence {
  activity: FamilyActivity;
  date: string;
}

export interface DeriveInput {
  todos: TodoItem[];
  /** Beanie Lists — feeds the derived `list-completed` creator notification. */
  lists: FamilyList[];
  members: FamilyMember[];
  currentMember: FamilyMember;
  releaseNotes: readonly ReleaseNote[];
  /** Adhoc announcements (window-exempt; honour their own startsAt/expiresAt). */
  announcements: readonly Announcement[];
  /** Per-device daily tip issuance log (window-exempt; persists for re-read). */
  issuedTips: readonly { tipId: string; issuedAt: string }[];
  /** Resolver for issuedTips — module-level Map from `tips.ts`. */
  tipsById: ReadonlyMap<string, BeanTip>;
  /** The one live community nudge (Discord), or null. Window-exempt; projected 1:1. */
  activeNudge: { messageIndex: number; issuedAt: number } | null;
  /** The one-time iOS install nudge, or null. Window-exempt; projected 1:1. */
  installNudge: { shownAt: number } | null;
  /** Calendar connections — feeds the `calendar-reconnect` bell entry. Status-
   *  based (not time-windowed); only `needs_reconnect` connections surface. */
  calendarConnections: readonly CalendarConnectionHealth[];
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
// OS travel-departure reminder (no in-app equivalent kind). One per segment
// departure occurrence; the date keeps it stable across reschedules.
export const travelReminderId = (segmentId: string, occurrenceDate: string): string =>
  `travel-reminder:${segmentId}:${occurrenceDate}`;
// One per completion event (encodes completedAt so a re-completion is a new id).
export const listCompletedId = (listId: string, completedAt: string): string =>
  `list-completed:${listId}:${completedAt}`;
// One per broken connection. NOT prune-exempt: when the connection heals it
// leaves the derived list and `pruneReadState` drops its read entry, so a later
// re-break re-derives as unread (fresh alert) under the same id.
export const calendarReconnectId = (connectionId: string): string =>
  `calendar-reconnect:${connectionId}`;
export const whatsNewId = (version: string): string => `${WHATS_NEW_PREFIX}${version}`;
export const announcementId = (id: string): string => `${ANNOUNCEMENT_PREFIX}${id}`;
export const tipId = (id: string): string => `${TIP_PREFIX}${id}`;
// Encodes the rotating messageIndex so each interval's nudge is a DISTINCT id →
// re-derives as unread (so "Not now → reappears next interval" works) and the
// cap (< message count) guarantees an index never repeats within a lifetime.
export const communityNudgeId = (messageIndex: number): string =>
  `${COMMUNITY_NUDGE_PREFIX}${messageIndex}`;
// Singleton id — the install nudge is one-time, so a stable id is all it needs.
export const INSTALL_NUDGE_ID = 'install-nudge';

// ── Internal pure date helpers (LOCAL time — avoids the UTC-midnight trap of
//    `new Date('YYYY-MM-DD')`). `localDateTime` + `minusMinutes` are shared with
//    the OS forward scheduler and live in `@/utils/reminderSchedule`. ───────────
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
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
  const {
    todos,
    lists,
    members,
    currentMember,
    releaseNotes,
    announcements,
    issuedTips,
    tipsById,
    activeNudge,
    installNudge,
    calendarConnections,
    readState,
    windowDays,
    occurrencesByDate,
  } = input;
  const resolveMember = (id: string): FamilyMember | undefined => members.find((m) => m.id === id);
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

  // ── list-completed: the creator is told when SOMEONE ELSE finishes their
  //    list. Pure-derived from the persisted filing audit — no enqueue. Honours
  //    the rolling window (ages out; NOT prune-exempt). Recurring lists never
  //    file (no `completedBy`), so only one-off completions surface here.
  for (const list of lists) {
    try {
      if (!list?.id || !list.completed || !list.completedAt) continue;
      if (list.createdBy !== currentMember.id) continue; // only the creator is notified
      if (!list.completedBy || list.completedBy === list.createdBy) continue; // not a self-finish
      const triggerMs = new Date(list.completedAt).getTime();
      if (Number.isNaN(triggerMs) || !inWindow(triggerMs)) continue;
      const id = listCompletedId(list.id, list.completedAt);
      out.push({
        id,
        kind: 'list-completed',
        title: list.title,
        subtitle: resolveMember(list.completedBy)?.name,
        occurredAt: new Date(triggerMs).toISOString(),
        route: '/lists',
        query: { view: list.id },
        sourceId: list.id,
        read: isRead(id),
      });
    } catch (err) {
      console.warn(`[deriveNotifications] skipped list ${list?.id ?? '?'}:`, err);
    }
  }

  // ── activity-reminder (from the pre-resolved, UNFILTERED occurrences) ────────
  for (const [date, occurrences] of Object.entries(occurrencesByDate)) {
    for (const occ of occurrences) {
      try {
        const a = occ?.activity;
        if (!a?.id) continue;
        const ctx = activityReminderContext(a, currentMember, resolveMember);
        if (!ctx.relevant) continue;
        const occDay = localDateTime(date);
        if (!occDay) continue;
        const reminder =
          typeof a.reminderMinutes === 'number' ? a.reminderMinutes : DEFAULT_ACTIVITY_LEAD;
        const trigger = a.startTime
          ? minusMinutes(localDateTime(date, a.startTime) ?? occDay, reminder)
          : startOfLocalDay(occDay);
        const triggerMs = trigger.getTime();
        if (!inWindow(triggerMs)) continue;
        const id = activityReminderId(a.id, date);
        const link = entityDeepLink('activity', a.id);
        out.push({
          id,
          kind: 'activity-reminder',
          title: ctx.title,
          subtitle: ctx.who.length ? ctx.who.join(' · ') : undefined,
          occurredAt: trigger.toISOString(),
          eventDate: date,
          eventTime: a.startTime,
          dutyRole: ctx.dutyRole,
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

  // ── announcements (window-exempt; honour their own startsAt/expiresAt) ───────
  for (const ann of announcements) {
    try {
      if (!ann?.id) continue;
      if (ann.startsAt && nowMs < new Date(ann.startsAt).getTime()) continue;
      if (ann.expiresAt && nowMs > new Date(ann.expiresAt).getTime()) continue;
      const id = announcementId(ann.id);
      const annMs = new Date(ann.date).getTime();
      out.push({
        id,
        kind: 'announcement',
        // Language-agnostic fallback; the bilingual title is resolved in the
        // presentation layer (useNotificationPresentation) like whats-new.
        title: ann.month,
        occurredAt: Number.isNaN(annMs) ? ann.date : new Date(annMs).toISOString(),
        sourceId: ann.id,
        read: isRead(id),
      });
    } catch (err) {
      console.warn(`[deriveNotifications] skipped announcement ${ann?.id ?? '?'}:`, err);
    }
  }

  // ── tips (window-exempt; per-device issuance log) ────────────────────────────
  // Mirrors the announcement block: missing tip ids and malformed entries are
  // skipped with a single console.warn — the deriver never throws.
  for (const issued of issuedTips) {
    try {
      if (!issued?.tipId) {
        console.warn('[deriveNotifications] skipped issued tip — missing tipId', issued);
        continue;
      }
      const tip = tipsById.get(issued.tipId);
      if (!tip) {
        // Tip was removed from tips.ts since issuance — quiet skip.
        console.warn(`[deriveNotifications] skipped tip — no longer in catalogue: ${issued.tipId}`);
        continue;
      }
      const id = tipId(tip.id);
      const issuedMs = new Date(issued.issuedAt).getTime();
      out.push({
        id,
        kind: 'tip',
        // Language-agnostic fallback; the bilingual line is resolved by
        // useNotificationPresentation (txt(tip.message)) like announcements.
        title: tip.id,
        occurredAt: Number.isNaN(issuedMs) ? issued.issuedAt : new Date(issuedMs).toISOString(),
        // tryItRoute may be undefined; AppNotification.route is optional and
        // both NotificationDetail and TipBody gate their Open button on it.
        route: tip.tryItRoute,
        sourceId: tip.id,
        read: isRead(id),
      });
    } catch (err) {
      console.warn(`[deriveNotifications] skipped tip ${issued?.tipId ?? '?'}:`, err);
    }
  }

  // ── community nudge (window-exempt; at most one active at a time) ────────────
  // Pure 1:1 projection of `activeNudge`: the issue/cap/cadence policy already
  // ran in `decideIssue` (useCommunityNudge), so presence here = "fresh + chosen."
  if (activeNudge) {
    try {
      const id = communityNudgeId(activeNudge.messageIndex);
      const issuedMs = activeNudge.issuedAt;
      out.push({
        id,
        kind: 'communityNudge',
        // Language-agnostic fallback; the bilingual label resolves in the
        // presentation layer (useNotificationPresentation), like tip/announcement.
        title: '',
        occurredAt: Number.isNaN(issuedMs) ? now.toISOString() : new Date(issuedMs).toISOString(),
        sourceId: String(activeNudge.messageIndex),
        read: isRead(id),
      });
    } catch (err) {
      console.warn('[deriveNotifications] skipped community nudge:', err);
    }
  }

  // ── install nudge (window-exempt; one-time; projected 1:1) ───────────────────
  // The iOS-Safari + not-installed + status gate already ran in `useInstallNudge`,
  // so presence here = "chosen to surface." Singleton id → stable read-state.
  if (installNudge) {
    try {
      const id = INSTALL_NUDGE_ID;
      const issuedMs = installNudge.shownAt;
      out.push({
        id,
        kind: 'installNudge',
        title: '', // label resolves in the presentation layer
        occurredAt: Number.isNaN(issuedMs) ? now.toISOString() : new Date(issuedMs).toISOString(),
        read: isRead(id),
      });
    } catch (err) {
      console.warn('[deriveNotifications] skipped install nudge:', err);
    }
  }

  // ── calendar-reconnect (status-based, NOT window-gated) ──────────────────────
  // A connection whose Google grant died and needs re-consent. `needs_reconnect`
  // ONLY — never `error` (that is written on the first transient reconcile
  // failure, so keying on it would flap a re-consent CTA on a network blip, and
  // re-auth can't fix a network error). The App-level toast is the primary
  // signal; this bell entry is the durable, dismiss-surviving backstop.
  for (const conn of calendarConnections) {
    try {
      if (!conn?.id || conn.status !== 'needs_reconnect') continue;
      const id = calendarReconnectId(conn.id);
      const at = conn.lastReconciledAt ?? conn.updatedAt;
      const atMs = at ? new Date(at).getTime() : NaN;
      out.push({
        id,
        kind: 'calendar-reconnect',
        // The account email lets a multi-calendar user tell which broke; the
        // presentation layer falls back to the kind label when it's absent.
        title: conn.accountEmail && conn.accountEmail !== 'unknown' ? conn.accountEmail : '',
        occurredAt: Number.isNaN(atMs) ? now.toISOString() : new Date(atMs).toISOString(),
        route: '/settings',
        query: { open: CALENDAR_SYNC_OPEN },
        sourceId: conn.id,
        read: isRead(id),
      });
    } catch (err) {
      console.warn(`[deriveNotifications] skipped calendar connection ${conn?.id ?? '?'}:`, err);
    }
  }

  // Newest-active first (ISO strings sort lexicographically by time).
  // Array.prototype.sort is guaranteed stable since ECMAScript 2019, so ties
  // (e.g. a tip issued at the same instant as a whats-new note) retain
  // insertion order.
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
 * Drop read-state entries whose id is no longer derivable, with exemptions:
 * any id matching a prefix in `PRUNE_EXEMPT_PREFIXES` is always kept. All
 * exempt kinds are window-exempt and bounded by content count (whats-new by
 * release catalogue, announcement by registry, tip by ALL_TIPS); pruning
 * would resurface old items as unread.
 */
export function pruneReadState(
  map: Record<string, string>,
  keepIds: readonly string[]
): Record<string, string> {
  const keep = new Set(keepIds);
  const next: Record<string, string> = {};
  for (const [id, readAt] of Object.entries(map)) {
    if (keep.has(id) || PRUNE_EXEMPT_PREFIXES.some((p) => id.startsWith(p))) next[id] = readAt;
  }
  return next;
}
