/**
 * THE one place a payload failure becomes the fatal overlay.
 *
 * There were two: `App.vue` (boot) and `ResumePodSetup.vue` (resume). They had
 * already drifted — different `surface` names, and one sent `perf_doc_bytes`
 * while the other did not, so the same corrupt pod reached CloudWatch with the
 * byte count on one path and without it on the other, and `errorReporter`'s
 * `(surface, message)` dedup could not collapse the two into one incident.
 * Warm paths (Settings → load a file, Grant permission) had no equivalent at
 * all and just left the app wedged.
 *
 * `surface` is `pod-load-failure`, kebab-case per the observability convention,
 * so ONE CloudWatch filter isolates every pod-open failure. The `source` rides
 * in `action` instead, which keeps the message constant per class and lets the
 * dedup bucket work.
 */
import { useFatalErrorStore } from '@/stores/fatalErrorStore';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';
import { PayloadLoadError, PayloadTooLargeError, payloadErrorDetail } from '@/types/sync';

/** Where the failure was caught. Rides in `action`, so it stays queryable. */
export type PayloadFailureSource = 'boot' | 'resume' | 'reload' | 'background-sync';

export function surfacePayloadFatal(
  err: PayloadLoadError,
  ctx: { fileId: string | null; familyId: string | null; source: PayloadFailureSource }
): void {
  const tooLarge = err instanceof PayloadTooLargeError;

  // Only the CORRUPT half is reported here. `docClient.surface()` is the single
  // emitter for `PayloadTooLargeError` and has already fired by the time this
  // runs; a second report would land on a different surface, which the
  // (surface, message) dedup cannot collapse, and would double-count every
  // occurrence in the rate.
  if (!tooLarge) {
    reportError({
      surface: 'pod-load-failure',
      // CONSTANT per step — the size rides in `perf_doc_bytes`. A per-pod byte
      // figure in the message would give every pod its own dedup bucket.
      message: `Pod payload failed Automerge ${err.step}`,
      error: err,
      severity: 'critical',
      context: {
        action: `pod-load-corrupt:${ctx.source}`,
        error_code: err.step,
        file_id_tail: ctx.fileId ? ctx.fileId.slice(-6) : undefined,
        family_id: ctx.familyId ?? undefined,
        perf_doc_bytes: err.payloadBytes ?? undefined,
      },
    });
  }

  // `clearDataHelps: false` for BOTH classes. For too-large the file is intact
  // and clearing is the one action that destroys the local copy; for corrupt
  // the message says trying again will not help and points at support, so an
  // adjacent "clear your data and start fresh" button contradicts it.
  useFatalErrorStore().setFatal(
    useTranslationStore().t(tooLarge ? 'resumeSetup.podTooLarge' : 'resumeSetup.podCorrupted'),
    payloadErrorDetail(err, ctx.fileId, ctx.familyId),
    { clearDataHelps: false }
  );
}
