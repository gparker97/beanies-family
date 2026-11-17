// The one mapping from a calendar consent that failed to the toast the member sees
// (view-only calendars plan 2026-11-17; review F5). Shared by the popup paths (the
// settings drawer and the add step) and the redirect resume, for both grant kinds.
//
// Two rules it exists to keep:
//  - Every string comes from `t()`. A failure's raw `message` is never shown: it is
//    hard-coded English from `calendarAuth.ts`, or, for `account_mismatch`, the stored
//    Google account's EMAIL ADDRESS.
//  - That email may be SHOWN to the member (filled into the mismatch template, as
//    today), so the mismatch toast is always `silent`: `showToast` forwards a
//    non-silent error's title and message to `reportError`, and an email must never
//    reach telemetry.

import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';

export type ConnectGrantKind = 'sync' | 'view';

/** The parts of a failed consent the mapper reads. */
export interface ConnectFailureLike {
  code: string;
  /** For `account_mismatch`, the stored account's email; otherwise ignored. */
  message: string;
}

export interface ConnectFailureToast {
  title: string;
  message: string;
  /** `true` = shown only, never forwarded to `reportError` by `showToast`. */
  silent: boolean;
}

/** Codes the member caused or can fix themselves: shown, never reported. */
const MEMBER_RECOVERABLE = new Set(['missing_scope', 'account_mismatch', 'popup_blocked']);

/**
 * The toast for a failed consent, or `null` when there is nothing to say:
 * `cancelled` is the member's own choice, and `unexpected` was already reported and
 * toasted by the view store.
 *
 * Silent: a view failure always (the view store logs `consent-outcome` with the code
 * for every failure), a sync failure when the member can fix it. A reported sync
 * failure carries only translated copy, never an email.
 */
export function connectFailureToast(
  kind: ConnectGrantKind,
  failure: ConnectFailureLike,
  t: (key: UIStringKey) => string
): ConnectFailureToast | null {
  if (failure.code === 'cancelled' || failure.code === 'unexpected') return null;
  const silent = kind === 'view' || MEMBER_RECOVERABLE.has(failure.code);
  if (failure.code === 'account_mismatch') {
    return {
      title: t('calendarSync.toast.accountMismatch.title'),
      message: fillTemplate(t('calendarSync.toast.accountMismatch.message'), {
        account: failure.message,
      }),
      silent: true,
    };
  }
  const title = t(
    kind === 'view'
      ? 'calendarView.toast.connectFailed.title'
      : 'calendarSync.toast.connectFailed.title'
  );
  let messageKey: UIStringKey;
  if (failure.code === 'missing_scope') {
    messageKey =
      kind === 'view'
        ? 'calendarSync.connect.viewMissingScope'
        : 'calendarSync.connect.syncMissingScope';
  } else if (failure.code === 'popup_blocked') {
    messageKey = 'calendar.error.popupBlocked';
  } else if (failure.code === 'no_account') {
    // The view account was removed (on another device) before or during the consent.
    messageKey = 'calendarView.toast.accountGone.message';
  } else {
    messageKey =
      kind === 'view' ? 'calendarView.toast.connectFailed.message' : 'calendar.error.connectRetry';
  }
  return { title, message: t(messageKey), silent };
}
