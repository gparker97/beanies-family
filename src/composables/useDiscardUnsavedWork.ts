/**
 * The ONE "this delete would lose unsaved work" confirm (C6, 2026-10-03). Its own module,
 * free of the router and the sign-out state, so Settings and the family picker can use it
 * without pulling in the sign-out orchestration.
 */
import { confirm } from '@/composables/useConfirm';
import { fillTemplate } from '@/utils/fillTemplate';
import {
  hasUnsavedWork,
  type SaveProbeCause,
  type UnsavedWorkReport,
} from '@/services/auth/unsavedWork';
import { useTranslationStore } from '@/stores/translationStore';
import { logEvent } from '@/services/telemetry';

/**
 * Where a destructive delete was about to run, for the decision log and the copy. `sign-out`
 * is the untrusted keep-data sign-out, which asks about its queued photos only (round 3).
 * `disconnect-google` is not a delete itself, but revoking the grant leaves this device
 * unable to save, so what has not landed is lost the same way.
 */
export type DiscardSite =
  | 'sign-out'
  | 'sign-out-clear'
  | 'clear-data'
  | 'forget-family'
  | 'delete-family'
  | 'disconnect-google';

const MESSAGE_FOR_SITE = {
  'sign-out': 'auth.unsavedPhotosSignOutMessage',
  'sign-out-clear': 'auth.unsavedMessage',
  'clear-data': 'auth.unsavedMessage',
  'forget-family': 'auth.unsavedForgetMessage',
  'delete-family': 'auth.unsavedMessage',
  'disconnect-google': 'auth.unsavedDisconnectMessage',
} as const satisfies Record<DiscardSite, string>;

/**
 * Why the pre-delete save did not land, as one sentence. The auth sentence carries the
 * Reconnect instruction; the banner itself is raised by the token-expiry chain in the sync
 * store, never from here (a second writer of `showGoogleReconnect` suppresses its page).
 */
const CAUSE_SENTENCE = {
  auth: 'auth.unsavedCauseAuth',
  transient: 'auth.unsavedCauseOffline',
  timeout: 'auth.unsavedCauseTimeout',
  error: 'auth.unsavedCauseError',
  'no-home': 'auth.unsavedCauseNoHome',
  // A held or aborted save re-arms itself: the same "give it a moment" as a slow one.
  deferred: 'auth.unsavedCauseTimeout',
} as const satisfies Record<SaveProbeCause, string>;

/**
 * The ONE "this delete would lose unsaved work" decision (C6), shared by the sign-out
 * clear tier, Settings Clear Data and forget family (and offered to delete family).
 * Resolves `true` when there is nothing at risk or the person chose to discard it, and
 * `false` when they kept it. Never deletes anything itself; never throws.
 *
 * The detail names WHAT goes (families with unsaved changes, photos waiting to upload, an
 * unreadable family data file, or "could not check") and, when the save run first did not
 * land, WHY (`report.saveFailure`), so the choice is an informed one.
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
  // The blocked sentence already IS the cause (the save refused on the latched file); a second
  // "the save failed" line for the same event would say it twice.
  if (report.saveFailure && !report.remoteBlocked) {
    parts.push(t(CAUSE_SENTENCE[report.saveFailure]));
  }
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
      error_code: report.saveFailure ?? undefined,
    },
  });
  return discard;
}
