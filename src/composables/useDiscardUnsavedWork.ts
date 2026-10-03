/**
 * The ONE "this delete would lose unsaved work" confirm (C6, 2026-10-03). Its own module,
 * free of the router and the sign-out state, so Settings and the family picker can use it
 * without pulling in the sign-out orchestration.
 */
import { confirm } from '@/composables/useConfirm';
import { fillTemplate } from '@/utils/fillTemplate';
import { hasUnsavedWork, type UnsavedWorkReport } from '@/services/auth/unsavedWork';
import { useTranslationStore } from '@/stores/translationStore';
import { logEvent } from '@/services/telemetry';

/**
 * Where a destructive delete was about to run, for the decision log and the copy. `sign-out`
 * is the untrusted keep-data sign-out, which asks about its queued photos only (round 3).
 */
export type DiscardSite =
  'sign-out' | 'sign-out-clear' | 'clear-data' | 'forget-family' | 'delete-family';

const MESSAGE_FOR_SITE = {
  'sign-out': 'auth.unsavedPhotosSignOutMessage',
  'sign-out-clear': 'auth.unsavedMessage',
  'clear-data': 'auth.unsavedMessage',
  'forget-family': 'auth.unsavedForgetMessage',
  'delete-family': 'auth.unsavedMessage',
} as const satisfies Record<DiscardSite, string>;

/**
 * The ONE "this delete would lose unsaved work" decision (C6), shared by the sign-out
 * clear tier, Settings Clear Data and forget family (and offered to delete family).
 * Resolves `true` when there is nothing at risk or the person chose to discard it, and
 * `false` when they kept it. Never deletes anything itself; never throws.
 *
 * The detail names WHAT goes (families with unsaved changes, photos waiting to upload, an
 * unreadable family data file, or "could not check"), so the choice is an informed one.
 * Every decision is logged: the at-risk rate and the discard rate are what tell us whether
 * people are losing work at this door.
 */
export async function confirmDiscardUnsavedWork(
  report: UnsavedWorkReport,
  site: DiscardSite
): Promise<boolean> {
  if (!hasUnsavedWork(report)) return true;
  const { t } = useTranslationStore();
  const parts: string[] = [];
  if (report.unsavedFamilies > 0) {
    parts.push(
      fillTemplate(
        t(report.unsavedFamilies === 1 ? 'auth.unsavedFamilies.one' : 'auth.unsavedFamilies.other'),
        { count: String(report.unsavedFamilies) }
      )
    );
  }
  if (report.photoUploads > 0) {
    parts.push(
      fillTemplate(
        t(report.photoUploads === 1 ? 'auth.unsavedPhotos.one' : 'auth.unsavedPhotos.other'),
        { count: String(report.photoUploads) }
      )
    );
  }
  if (report.remoteBlocked) parts.push(t('auth.unsavedBlocked'));
  if (report.unknown) parts.push(t('auth.unsavedUnknown'));
  const discard = await confirm({
    title: 'auth.unsavedTitle',
    message: MESSAGE_FOR_SITE[site],
    detail: parts.join(' '),
    detailTone: 'caution',
    variant: 'danger',
    confirmLabel: 'auth.unsavedDiscard',
    cancelLabel: 'auth.unsavedKeep',
  });
  logEvent({
    level: discard ? 'warn' : 'info',
    surface: site === 'forget-family' ? 'family-context' : 'sign-out',
    message: discard ? 'person chose to discard unsaved work' : 'person kept unsaved work',
    context: {
      action: discard ? 'unsaved_discard_confirmed' : 'unsaved_discard_declined',
      kind: site,
      file_count: report.photoUploads,
    },
  });
  return discard;
}
