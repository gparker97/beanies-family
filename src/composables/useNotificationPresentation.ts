/**
 * Shared presentation for a notification row/detail — the single source of the
 * bold title, at-a-glance summary, when-line, duty chip, and tinted icon, so
 * `NotificationRow` and `NotificationDetail` don't each re-derive them.
 *
 * For a `whats-new` note it resolves the release: a brief per-deploy note shows
 * its authored `summary` (beanie/en switched); a curated monthly release falls
 * back to the kind's generic summary (the month label).
 */
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import { getReleaseNote } from '@/content/release-notes';
import { getAnnouncement } from '@/content/announcements';
import { getTip } from '@/content/tips';
import {
  NOTIFICATION_KIND_PRESENTATION,
  ACCENT_TINT_CLASS,
  kindLabelKey,
  notificationTitle,
  notificationSummary,
  notificationWhen,
  dutyRoleLabelKey,
} from '@/components/notifications/notificationKinds';
import type { AppNotification } from '@/types/notifications';

export function useNotificationPresentation(notification: MaybeRefOrGetter<AppNotification>) {
  const { t } = useTranslation();
  const { txt } = useBeanieText();
  const n = computed(() => toValue(notification));

  const presentation = computed(() => NOTIFICATION_KIND_PRESENTATION[n.value.kind]);
  const tintClass = computed(() => ACCENT_TINT_CLASS[presentation.value.accent]);
  const labelKey = computed(() => kindLabelKey(n.value.kind, n.value.overdue));

  /** The backing release for a whats-new note (undefined for other kinds). */
  const release = computed(() =>
    n.value.kind === 'whats-new' && n.value.sourceId ? getReleaseNote(n.value.sourceId) : undefined
  );
  /** The backing announcement for an announcement note (undefined otherwise). */
  const announcement = computed(() =>
    n.value.kind === 'announcement' && n.value.sourceId
      ? getAnnouncement(n.value.sourceId)
      : undefined
  );
  /** The backing tip for a tip note (undefined for other kinds, or when the tip
   *  has been removed from tips.ts since issuance). */
  const tip = computed(() =>
    n.value.kind === 'tip' && n.value.sourceId ? getTip(n.value.sourceId) : undefined
  );
  /** Whether the detail should render a rich celebratory body (whats-new / announcement / tip). */
  const hasRichBody = computed(() =>
    Boolean((release.value || announcement.value || tip.value) && presentation.value.detailBody)
  );

  // whats-new is framed by its kind label; an announcement shows its own (bilingual)
  // title; everything else shows the entity name.
  const title = computed(() =>
    announcement.value ? txt(announcement.value.title) : notificationTitle(n.value, t)
  );
  const summary = computed(() => {
    if (release.value?.summary) return txt(release.value.summary);
    if (announcement.value) return announcement.value.kicker ? txt(announcement.value.kicker) : '';
    if (tip.value) return txt(tip.value.message);
    return notificationSummary(n.value, t);
  });
  const when = computed(() => notificationWhen(n.value, t));
  const roleLabel = computed(() => (n.value.dutyRole ? t(dutyRoleLabelKey(n.value.dutyRole)) : ''));

  return {
    presentation,
    tintClass,
    labelKey,
    release,
    announcement,
    tip,
    hasRichBody,
    title,
    summary,
    when,
    roleLabel,
  };
}
