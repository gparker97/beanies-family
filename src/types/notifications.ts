/**
 * In-app notification types.
 *
 * Notifications are DERIVED (never stored) — each maps to a deterministic stable
 * id over the synced family data (todos, activities) + the release-notes
 * registry, so every device reconstructs the same list. The only persisted state
 * is per-member read/unread (`FamilyDocument.notificationReads`).
 *
 * Presentation (accent/icon/detail body) is NOT on the notification object — it
 * lives in `NOTIFICATION_KIND_PRESENTATION` (see `components/notifications/
 * notificationKinds.ts`), keyed by `kind`, so the pure deriver never decides
 * emoji or colour and a new kind is one union member + one deriver block + one
 * table entry.
 */
import type { Component } from 'vue';

export type NotificationKind =
  | 'todo-due'
  | 'todo-assigned'
  | 'activity-reminder'
  | 'whats-new'
  | 'announcement';

export interface AppNotification {
  /** Deterministic stable id (e.g. `todo-due:<todoId>:<dueDate>`). */
  id: string;
  kind: NotificationKind;
  /** Resolved, display-ready title (the entity's own name) — shown bold. */
  title: string;
  /** Data-only at-a-glance summary (who · where) — no i18n connectives; the row
   *  composes the localised line. */
  subtitle?: string;
  /** ISO — the moment this became active (its trigger time). */
  occurredAt: string;
  /** Real event/due day (YYYY-MM-DD) for the "Today · 5:00pm" line. */
  eventDate?: string;
  /** Real event/due time (HH:mm); absent ⇒ all-day. */
  eventTime?: string;
  /** The viewer's duty on an activity occurrence (drives the role chip). */
  dutyRole?: 'dropoff' | 'pickup';
  /** For `todo-assigned`: the name of whoever assigned it (when not self). */
  assignedByName?: string;
  /** `todo-due` escalation flag. */
  overdue?: boolean;
  /** Deep-link path for "Open". */
  route?: string;
  /** Deep-link query (e.g. `{ view: todoId }`). */
  query?: Record<string, string>;
  /** Source entity id. */
  sourceId?: string;
  /** Recurring-activity occurrence date. */
  occurrenceDate?: string;
  /** Resolved against the read-state map. */
  read: boolean;
}

/** Per-kind presentation — the single edit surface when adding a kind. */
export interface KindPresentation {
  accent: 'todo' | 'activity' | 'assigned' | 'whats-new' | 'announcement';
  /** Emoji shown in the row's tinted lead icon. */
  icon: string;
  /** Custom detail body component; undefined ⇒ the default meta card. */
  detailBody?: Component;
}
