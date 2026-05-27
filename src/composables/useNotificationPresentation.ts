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
  /** Whether the detail should render the rich `WhatsNewBody` card. */
  const hasRichBody = computed(() => Boolean(release.value && presentation.value.detailBody));

  const title = computed(() => notificationTitle(n.value, t));
  const summary = computed(() =>
    release.value?.summary ? txt(release.value.summary) : notificationSummary(n.value, t)
  );
  const when = computed(() => notificationWhen(n.value, t));
  const roleLabel = computed(() => (n.value.dutyRole ? t(dutyRoleLabelKey(n.value.dutyRole)) : ''));

  return {
    presentation,
    tintClass,
    labelKey,
    release,
    hasRichBody,
    title,
    summary,
    when,
    roleLabel,
  };
}
