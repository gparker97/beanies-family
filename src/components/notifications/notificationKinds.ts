/**
 * Per-kind presentation — THE single edit surface for a new notification kind.
 * Lives next to the components (not in `types/notifications.ts`) so the pure
 * deriver/types never import a Vue component. Adding a kind: one union member
 * (types/notifications.ts) + one deriver block (utils/notifications.ts) + one
 * entry here (+ a body component only if it needs a custom detail).
 */
import type { AppNotification, NotificationKind, KindPresentation } from '@/types/notifications';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { formatTime12, relativeDayLabel, timeAgo } from '@/utils/date';
import { getReleaseNote, isSpotlightRelease } from '@/content/release-notes';
import WhatsNewBody from '@/components/notifications/WhatsNewBody.vue';
import AnnouncementBody from '@/components/notifications/AnnouncementBody.vue';

type T = (key: UIStringKey) => string;

export const NOTIFICATION_KIND_PRESENTATION: Record<NotificationKind, KindPresentation> = {
  'todo-due': { accent: 'todo', icon: '✅' },
  'todo-assigned': { accent: 'assigned', icon: '📌' },
  'activity-reminder': { accent: 'activity', icon: '📅' },
  'whats-new': { accent: 'whats-new', icon: '✨', detailBody: WhatsNewBody },
  announcement: { accent: 'announcement', icon: '📣', detailBody: AnnouncementBody },
};

/** Tinted lead-icon background per accent (Nook-UI tints). */
export const ACCENT_TINT_CLASS: Record<KindPresentation['accent'], string> = {
  todo: 'bg-[var(--tint-purple-12,rgba(155,89,182,0.12))]',
  assigned: 'bg-[var(--tint-purple-12,rgba(155,89,182,0.12))]',
  activity: 'bg-[var(--tint-silk-20,rgba(174,214,241,0.2))]',
  'whats-new': 'bg-[var(--tint-orange-8,rgba(241,93,34,0.08))]',
  announcement: 'bg-[var(--tint-orange-8,rgba(241,93,34,0.08))]',
};

/** The framing label shown on a row/detail, by kind (overdue is a `todo-due` variant). */
export function kindLabelKey(kind: NotificationKind, overdue?: boolean): UIStringKey {
  switch (kind) {
    case 'todo-due':
      return overdue ? 'notifications.kindTodoDueOverdue' : 'notifications.kindTodoDue';
    case 'todo-assigned':
      return 'notifications.kindTodoAssigned';
    case 'activity-reminder':
      return 'notifications.kindActivityReminder';
    case 'whats-new':
      return 'notifications.kindWhatsNew';
    case 'announcement':
      return 'notifications.kindAnnouncement';
  }
}

/** Bold row title — the entity name, except whats-new which is framed by its kind. */
export function notificationTitle(n: AppNotification, t: T): string {
  return n.kind === 'whats-new' ? t('notifications.kindWhatsNew') : n.title;
}

/** At-a-glance summary line (who · where, or who-assigned-it), localised. */
export function notificationSummary(n: AppNotification, t: T): string {
  switch (n.kind) {
    case 'activity-reminder':
      return n.subtitle ?? '';
    case 'todo-assigned':
      return n.assignedByName
        ? t('notifications.assignedByYou').replace('{name}', n.assignedByName)
        : t('notifications.yourTask');
    case 'todo-due':
      return n.subtitle ?? t('notifications.yourTask');
    case 'whats-new':
      return n.title; // the release month (e.g. "may 2026")
    case 'announcement':
      return ''; // the bilingual kicker is resolved in useNotificationPresentation
  }
}

/** Date + time line: "Today · 5:00pm" / "Due Today · 4:00pm" / relative ("2 days ago"). */
export function notificationWhen(n: AppNotification, t: T): string {
  if (n.eventDate) {
    const rel = relativeDayLabel(n.eventDate, t);
    const base = n.eventTime ? `${rel} · ${formatTime12(n.eventTime)}` : rel;
    return n.kind === 'todo-due' ? `${t('notifications.due')} ${base}` : base;
  }
  return timeAgo(n.occurredAt);
}

export function dutyRoleLabelKey(role: 'dropoff' | 'pickup'): UIStringKey {
  return role === 'dropoff' ? 'notifications.youDropoff' : 'notifications.youPickup';
}

/**
 * Whether a notification gets the celebratory "gift card" row + hero detail —
 * a spotlight (significant) what's-new. Minor what's-new notes stay a quiet flat
 * row (the ✨ gradient chip) so the list never becomes a wall of gradient cards.
 */
export function isCelebratoryWhatsNew(n: AppNotification): boolean {
  if (n.kind !== 'whats-new' || !n.sourceId) return false;
  const rel = getReleaseNote(n.sourceId);
  return rel ? isSpotlightRelease(rel) : false;
}
