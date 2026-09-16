import { computed, ref } from 'vue';
import { usePickBeanpodFile } from '@/composables/usePickBeanpodFile';
import { useSyncStore } from '@/stores/syncStore';
import { describePickFailure } from '@/services/google/drivePicker';
import { POD_ACCESS_ERRORS } from '@/utils/podAccess';
import { assertNever } from '@/utils/assertNever';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * Pick a `.beanpod` from Drive and rebind the pod to it — the recovery both failure banners offer.
 *
 * ⚠️ WHY THIS EXISTS. `PodAccessBanner.pickFamilyFile` and `SaveFailureBanner.handleReselectFile`
 * were the same three steps, and both opened with
 *
 *     if (result.kind !== 'picked') return;   // cancelled, redirected, or pick failed
 *
 * — a comment that names three different realities and then treats them identically, on the two
 * surfaces a family reaches only when their pod is ALREADY broken. A cancel, a full-page redirect
 * and a hard Picker failure all became a banner that did nothing when tapped.
 *
 * ⚠️ IT RETURNS A `UIStringKey`, NEVER A RAW STRING. `describePickFailure` exists because
 * `reason: 'config'` carries the literal message "VITE_GOOGLE_API_KEY is not configured", which
 * had already reached users on the sign-in screen once.
 *
 * The caller owns its own markup and its own channel — `PodAccessBanner` already has `showToast`,
 * `SaveFailureBanner` already has an inline `reselectError`. Shared derivation, surface-owned
 * presentation: the division `utils/structuredError.ts` documents.
 */
export type ReselectOutcome =
  /** Picked and rebound. The pod is working again. */
  | { outcome: 'rebound' }
  /** The user dismissed the chooser. Not an error; say nothing loud. */
  | { outcome: 'declined' }
  /** A full-page redirect started. The page is going away — leave the UI alone. */
  | { outcome: 'redirecting' }
  /** Something failed. `messageKey` is translated copy, safe to show a family. */
  | { outcome: 'failed'; messageKey: UIStringKey };

export function useDriveFileReselect() {
  const syncStore = useSyncStore();
  const { pick, isPicking } = usePickBeanpodFile();

  /**
   * Busy for the WHOLE recovery, not just the Picker.
   *
   * ⚠️ `SaveFailureBanner` used to read `isPicking` from its own second
   * `usePickBeanpodFile()` call. Each call builds fresh refs, so that one belonged to an
   * instance nothing ever invoked: the flag never flipped, and the button it disabled stayed
   * live through the entire recovery — double-tappable on the screen where the pod is already
   * broken. Exposing it from the composable that owns the instance is the only shape that
   * cannot drift apart again.
   *
   * It also spans `rebindPodFile`, which `isPicking` alone does not: the Picker closes and the
   * rebind keeps running, and that gap is exactly when a second tap lands.
   */
  const isRebinding = ref(false);
  const isBusy = computed(() => isPicking.value || isRebinding.value);

  async function reselect(): Promise<ReselectOutcome> {
    // ⚠️ NO ARGUMENTS, and that now means the SILENT token path. Both callers used to invoke
    // `pick()` bare when bare meant `forceConsent: true`, which skipped the silent token and so
    // guaranteed a full-page `startRedirectAuth` on every redirect-auth platform — a redirect
    // loop on the two screens a family only reaches when their pod is ALREADY broken. Since the
    // flag became `chooseAccount` (default `false`), bare is the correct, silent default.
    //
    // Deliberately no `loginHint` either: the account is not in doubt here — the file is. The
    // signed-in account is the one whose Drive we want to show.
    const picked = await pick();

    switch (picked.kind) {
      case 'cancelled':
        logEvent({
          level: 'info',
          surface: 'pod-access-recovery',
          message: 'file reselect cancelled by user',
          context: { action: 'cancelled' },
        });
        return { outcome: 'declined' };

      case 'redirecting':
        // Not a cancel. Nothing is owed to the UI, but it is its own fact in the firehose so
        // "they backed out" and "we sent them to Google" stop sharing a number.
        logEvent({
          level: 'info',
          surface: 'pod-access-recovery',
          message: 'file reselect redirecting to auth',
          context: { action: 'redirecting' },
        });
        return { outcome: 'redirecting' };

      case 'failed': {
        const { messageKey, errorCode } = describePickFailure(picked.reason);
        reportError({
          surface: 'pod-access-recovery',
          severity: 'warning',
          message: `file reselect picker failed: ${picked.reason}`,
          context: { action: 'picker-failed', error_code: errorCode },
        });
        return { outcome: 'failed', messageKey };
      }

      case 'picked': {
        isRebinding.value = true;
        try {
          const recovery = await syncStore.rebindPodFile(picked.fileId, picked.fileName);
          if (recovery.ok) return { outcome: 'rebound' };
          // A typed code from the shared registry, so the words are translated like everything
          // else.
          return { outcome: 'failed', messageKey: POD_ACCESS_ERRORS[recovery.code].messageKey };
        } finally {
          isRebinding.value = false;
        }
      }

      default:
        return assertNever(picked, 'useDriveFileReselect');
    }
  }

  return { reselect, isBusy };
}
